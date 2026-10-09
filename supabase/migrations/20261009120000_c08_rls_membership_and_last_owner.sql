-- ============================================================================
-- Migration: 20261009120000_c08_rls_membership_and_last_owner.sql
-- Module: Core Membership RLS Hardening & Last Active Owner Protection (C08)
--
-- Maintenance Rationale:
-- 1. Helper functions in `private` schema owned by `app_rls_helper` (SECURITY DEFINER):
--    - `private.current_workspace_role()`: returns active role of app.user_id in context workspace.
--    - `private.current_organization_role()`: returns active role of app.user_id in context organization.
--    Immune to policy recursion via app_rls_helper's direct helper policies.
-- 2. Hardened RLS policies on `workspace_members`, `organization_members`, `credentials`, `api_keys`:
--    - workspace_members INSERT: owner/admin or invitation acceptance with matching role.
--    - workspace_members UPDATE/DELETE: owner/admin (DELETE also allows self-leave).
--    - organization_members INSERT: owner/admin or invitation acceptance with matching role.
--    - credentials SELECT: active workspace member or org owner/admin; INSERT/UPDATE/DELETE: owner/admin only.
--    - api_keys INSERT: user_id = app.user_id; SELECT/UPDATE/DELETE: key owner or owner/admin.
-- 3. Invariant triggers (`security invoker`):
--    - trg_workspace_members_invariants: prevents non-owner from assigning/modifying/removing owner;
--      blocks self-role escalation; blocks removing/demoting last active workspace owner.
--    - trg_organization_members_last_owner: blocks non-owner from assigning owner role;
--      blocks removing/demoting last active organization owner.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Private Security Definer Helpers (owned by app_rls_helper)
-- ----------------------------------------------------------------------------

create or replace function private.current_workspace_role()
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select member.role
  from public.workspace_members member
  where member.workspace_id = private.context_uuid('app.workspace_id')
    and member.organization_id = private.context_uuid('app.organization_id')
    and member.user_id = private.context_uuid('app.user_id')
    and member.status = 'active';
$$;

alter function private.current_workspace_role() owner to app_rls_helper;
grant execute on function private.current_workspace_role() to app_runtime;
revoke execute on function private.current_workspace_role() from public, anon, authenticated;

create or replace function private.current_organization_role()
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select member.role
  from public.organization_members member
  where member.organization_id = private.context_uuid('app.organization_id')
    and member.user_id = private.context_uuid('app.user_id')
    and member.status = 'active';
$$;

alter function private.current_organization_role() owner to app_rls_helper;
grant execute on function private.current_organization_role() to app_runtime;
revoke execute on function private.current_organization_role() from public, anon, authenticated;

-- ----------------------------------------------------------------------------
-- 2. Invariant Triggers for Workspace Members and Organization Members
-- ----------------------------------------------------------------------------

-- Invariant trigger for workspace_members
create or replace function private.enforce_workspace_members_invariants()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_actor_ws_role text;
  v_actor_org_role text;
  v_is_owner boolean;
  v_actor_user_id uuid;
  v_has_valid_invitation boolean;
  v_old_rank integer;
  v_new_rank integer;
  remaining_owners integer;
begin
  -- Skip enforcement if maintenance is run by migration administrator without tenant context
  if current_user = 'app_migrations' and private.context_uuid('app.workspace_id') is null then
    return coalesce(new, old);
  end if;

  v_actor_ws_role := private.current_workspace_role();
  v_actor_org_role := private.current_organization_role();
  v_is_owner := (v_actor_ws_role = 'owner' or v_actor_org_role = 'owner');
  v_actor_user_id := private.context_uuid('app.user_id');

  -- 1. Check assigning role = 'owner' (INSERT or UPDATE)
  if tg_op in ('INSERT', 'UPDATE') and new.role = 'owner' then
    v_has_valid_invitation := (
      current_setting('app.invitation_token_hash', true) is not null
      and current_setting('app.invitation_token_hash', true) <> ''
      and exists (
        select 1
        from public.invitations inv
        where inv.organization_id = new.organization_id
          and inv.workspace_id = new.workspace_id
          and inv.token_hash = current_setting('app.invitation_token_hash', true)
          and inv.role = 'owner'
          and inv.status = 'pending'
          and inv.expires_at > now()
      )
    );

    if not v_is_owner and not v_has_valid_invitation then
      raise exception 'Only an owner can assign the owner role (AC04)'
        using errcode = 'P0001';
    end if;
  end if;

  -- 2. Check modifying or removing an existing owner (UPDATE or DELETE)
  if tg_op in ('UPDATE', 'DELETE') and old.role = 'owner' then
    if not v_is_owner then
      raise exception 'Only an owner can modify or remove an owner (AC04)'
        using errcode = 'P0001';
    end if;
  end if;

  -- 3. Check escalating own role upwards (UPDATE)
  if tg_op = 'UPDATE' and v_actor_user_id is not null and old.user_id = v_actor_user_id then
    v_old_rank := case old.role
      when 'owner' then 4
      when 'admin' then 3
      when 'editor' then 2
      when 'viewer' then 1
      else 0
    end;

    v_new_rank := case new.role
      when 'owner' then 4
      when 'admin' then 3
      when 'editor' then 2
      when 'viewer' then 1
      else 0
    end;

    if v_new_rank > v_old_rank then
      raise exception 'Cannot escalate own role (AC04)'
        using errcode = 'P0001';
    end if;
  end if;

  -- 4. Check protecting the last active owner of the workspace (UPDATE or DELETE)
  if tg_op in ('UPDATE', 'DELETE') and old.role = 'owner' and old.status = 'active' then
    -- If UPDATE leaves the record as an active owner, no demotion or deactivation occurs
    if tg_op = 'UPDATE' and new.role = 'owner' and new.status = 'active' then
      return new;
    end if;

    select count(*)
    into remaining_owners
    from public.workspace_members
    where workspace_id = old.workspace_id
      and user_id <> old.user_id
      and role = 'owner'
      and status = 'active';

    if remaining_owners < 1 then
      raise exception 'Cannot remove, revoke or demote the last active owner of a workspace (AC04)'
        using errcode = 'P0001';
    end if;
  end if;

  if tg_op = 'DELETE' then
    return old;
  else
    return new;
  end if;
end;
$$;

alter function private.enforce_workspace_members_invariants() owner to app_migrations;
grant execute on function private.enforce_workspace_members_invariants() to app_runtime;
revoke execute on function private.enforce_workspace_members_invariants() from public, anon, authenticated;

drop trigger if exists trg_workspace_members_invariants on public.workspace_members;
create trigger trg_workspace_members_invariants
  before insert or update or delete on public.workspace_members
  for each row execute function private.enforce_workspace_members_invariants();

-- Updated invariant trigger for organization_members (prohibit non-owner from assigning owner)
create or replace function private.prevent_last_owner_removal()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  remaining_owners integer;
  v_actor_org_role text;
  v_has_valid_invitation boolean;
begin
  -- Skip enforcement if maintenance is run by migration administrator without tenant context
  if current_user = 'app_migrations' and private.context_uuid('app.organization_id') is null then
    return coalesce(new, old);
  end if;

  v_actor_org_role := private.current_organization_role();

  -- 1. Check assigning role = 'owner' (INSERT or UPDATE)
  if tg_op in ('INSERT', 'UPDATE') and new.role = 'owner' then
    v_has_valid_invitation := (
      current_setting('app.invitation_token_hash', true) is not null
      and current_setting('app.invitation_token_hash', true) <> ''
      and exists (
        select 1
        from public.invitations inv
        where inv.organization_id = new.organization_id
          and inv.token_hash = current_setting('app.invitation_token_hash', true)
          and inv.role = 'owner'
          and inv.status = 'pending'
          and inv.expires_at > now()
      )
    );

    if v_actor_org_role is distinct from 'owner' and not v_has_valid_invitation then
      raise exception 'Only an organization owner can assign the owner role (AC04)'
        using errcode = 'P0001';
    end if;
  end if;

  -- 2. Trigger activates on UPDATE or DELETE touching an active owner
  if (tg_op = 'DELETE' or tg_op = 'UPDATE') then
    if old.role = 'owner' and old.status = 'active' then
      -- If UPDATE and the record remains an active owner, no demotion occurs
      if (tg_op = 'UPDATE' and new.role = 'owner' and new.status = 'active') then
        return new;
      end if;

      -- Count other active owners in the same organization
      select count(*)
      into remaining_owners
      from public.organization_members
      where organization_id = old.organization_id
        and user_id <> old.user_id
        and role = 'owner'
        and status = 'active';

      if remaining_owners < 1 then
        raise exception 'Cannot remove, revoke or demote the last active owner of an organization (AC04)'
          using errcode = 'P0001';
      end if;
    end if;
  end if;

  if tg_op = 'DELETE' then
    return old;
  else
    return new;
  end if;
end;
$$;

alter function private.prevent_last_owner_removal() owner to app_migrations;
grant execute on function private.prevent_last_owner_removal() to app_runtime;
revoke execute on function private.prevent_last_owner_removal() from public, anon, authenticated;

drop trigger if exists trg_organization_members_last_owner on public.organization_members;
create trigger trg_organization_members_last_owner
  before insert or update or delete on public.organization_members
  for each row execute function private.prevent_last_owner_removal();

-- ----------------------------------------------------------------------------
-- 3. Hardened RLS Policies
-- ----------------------------------------------------------------------------

-- public.workspace_members
drop policy if exists workspace_members_insert on public.workspace_members;
create policy workspace_members_insert on public.workspace_members
  for insert to app_runtime
  with check (
    workspace_id = private.context_uuid('app.workspace_id')
    and organization_id = private.context_uuid('app.organization_id')
    and (
      private.current_workspace_role() in ('owner', 'admin')
      or private.current_organization_role() in ('owner', 'admin')
      or (
        user_id = private.context_uuid('app.user_id')
        and current_setting('app.invitation_token_hash', true) is not null
        and current_setting('app.invitation_token_hash', true) <> ''
        and exists (
          select 1
          from public.invitations inv
          where inv.organization_id = workspace_members.organization_id
            and inv.workspace_id = workspace_members.workspace_id
            and inv.token_hash = current_setting('app.invitation_token_hash', true)
            and inv.role = workspace_members.role
            and inv.status = 'pending'
            and inv.expires_at > now()
        )
      )
    )
  );

drop policy if exists workspace_members_update on public.workspace_members;
create policy workspace_members_update on public.workspace_members
  for update to app_runtime
  using (
    workspace_id = private.context_uuid('app.workspace_id')
    and organization_id = private.context_uuid('app.organization_id')
    and (
      private.current_workspace_role() in ('owner', 'admin')
      or private.current_organization_role() in ('owner', 'admin')
    )
  )
  with check (
    workspace_id = private.context_uuid('app.workspace_id')
    and organization_id = private.context_uuid('app.organization_id')
  );

drop policy if exists workspace_members_delete on public.workspace_members;
create policy workspace_members_delete on public.workspace_members
  for delete to app_runtime
  using (
    workspace_id = private.context_uuid('app.workspace_id')
    and organization_id = private.context_uuid('app.organization_id')
    and (
      user_id = private.context_uuid('app.user_id')
      or private.current_workspace_role() in ('owner', 'admin')
      or private.current_organization_role() in ('owner', 'admin')
    )
  );

-- public.organization_members
drop policy if exists organization_members_insert on public.organization_members;
create policy organization_members_insert on public.organization_members
  for insert to app_runtime
  with check (
    organization_id = private.context_uuid('app.organization_id')
    and (
      private.current_organization_role() in ('owner', 'admin')
      or (
        user_id = private.context_uuid('app.user_id')
        and current_setting('app.invitation_token_hash', true) is not null
        and current_setting('app.invitation_token_hash', true) <> ''
        and exists (
          select 1
          from public.invitations inv
          where inv.organization_id = organization_members.organization_id
            and inv.token_hash = current_setting('app.invitation_token_hash', true)
            and inv.status = 'pending'
            and inv.expires_at > now()
            and (
              inv.role = organization_members.role
              or (inv.workspace_id is not null and organization_members.role = 'member')
            )
        )
      )
    )
  );

-- public.credentials
drop policy if exists credentials_select on public.credentials;
create policy credentials_select on public.credentials
  for select to app_runtime
  using (
    workspace_id = private.context_uuid('app.workspace_id')
    and organization_id = private.context_uuid('app.organization_id')
    and (
      private.current_workspace_role() is not null
      or private.current_organization_role() in ('owner', 'admin')
    )
  );

drop policy if exists credentials_insert on public.credentials;
create policy credentials_insert on public.credentials
  for insert to app_runtime
  with check (
    workspace_id = private.context_uuid('app.workspace_id')
    and organization_id = private.context_uuid('app.organization_id')
    and (
      private.current_workspace_role() in ('owner', 'admin')
      or private.current_organization_role() in ('owner', 'admin')
    )
  );

drop policy if exists credentials_update on public.credentials;
create policy credentials_update on public.credentials
  for update to app_runtime
  using (
    workspace_id = private.context_uuid('app.workspace_id')
    and organization_id = private.context_uuid('app.organization_id')
    and (
      private.current_workspace_role() in ('owner', 'admin')
      or private.current_organization_role() in ('owner', 'admin')
    )
  )
  with check (
    workspace_id = private.context_uuid('app.workspace_id')
    and organization_id = private.context_uuid('app.organization_id')
  );

drop policy if exists credentials_delete on public.credentials;
create policy credentials_delete on public.credentials
  for delete to app_runtime
  using (
    workspace_id = private.context_uuid('app.workspace_id')
    and organization_id = private.context_uuid('app.organization_id')
    and (
      private.current_workspace_role() in ('owner', 'admin')
      or private.current_organization_role() in ('owner', 'admin')
    )
  );

-- public.api_keys
drop policy if exists api_keys_select on public.api_keys;
create policy api_keys_select on public.api_keys
  for select to app_runtime
  using (
    workspace_id = private.context_uuid('app.workspace_id')
    and organization_id = private.context_uuid('app.organization_id')
    and (
      user_id = private.context_uuid('app.user_id')
      or private.current_workspace_role() in ('owner', 'admin')
      or private.current_organization_role() in ('owner', 'admin')
    )
  );

drop policy if exists api_keys_insert on public.api_keys;
create policy api_keys_insert on public.api_keys
  for insert to app_runtime
  with check (
    workspace_id = private.context_uuid('app.workspace_id')
    and organization_id = private.context_uuid('app.organization_id')
    and user_id = private.context_uuid('app.user_id')
    and (
      private.current_workspace_role() is not null
      or private.current_organization_role() in ('owner', 'admin')
    )
  );

drop policy if exists api_keys_update on public.api_keys;
create policy api_keys_update on public.api_keys
  for update to app_runtime
  using (
    workspace_id = private.context_uuid('app.workspace_id')
    and organization_id = private.context_uuid('app.organization_id')
    and (
      user_id = private.context_uuid('app.user_id')
      or private.current_workspace_role() in ('owner', 'admin')
      or private.current_organization_role() in ('owner', 'admin')
    )
  )
  with check (
    workspace_id = private.context_uuid('app.workspace_id')
    and organization_id = private.context_uuid('app.organization_id')
  );

drop policy if exists api_keys_delete on public.api_keys;
create policy api_keys_delete on public.api_keys
  for delete to app_runtime
  using (
    workspace_id = private.context_uuid('app.workspace_id')
    and organization_id = private.context_uuid('app.organization_id')
    and (
      user_id = private.context_uuid('app.user_id')
      or private.current_workspace_role() in ('owner', 'admin')
      or private.current_organization_role() in ('owner', 'admin')
    )
  );
