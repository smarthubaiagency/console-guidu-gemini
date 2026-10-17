-- ============================================================================
-- AT1: workspace role Atendente (`attendant`)
--
-- Decision of Marcelo (16/10/2026, especificação do Inbox §3): a new
-- workspace role that enters only the dashboard and the Inbox. The
-- application matrix (src/core/permissions/matrix.ts) gives it only
-- `inbox.view` and `inbox.reply`.
--
-- Additive:
--   1. `workspace_members.role` and `invitations.role` accept 'attendant'.
--   2. The invariant trigger of workspace_members lists 'attendant' at the
--      bottom of the rank, so an Attendant never "escalates" into another
--      role by itself (it cannot write workspace_members anyway).
--   3. Credentials and API keys: `credentials_select` and `api_keys_insert`
--      admitted any workspace role (`current_workspace_role() is not null`).
--      They now list the four roles that had them, so the Attendant reads
--      no BYOK credential (masked value and encrypted payload) and creates
--      no API key, as the application matrix already says. Nothing changes
--      for owner, admin, editor and viewer.
--
-- Every other write policy already lists its roles
-- (`private.current_workspace_role() in ('owner', 'admin'[, 'editor'])`),
-- so the Attendant writes nothing there; the read policies that admit any
-- active member are listed in the AT1 delivery and revisited with the Inbox.
-- ============================================================================

-- 1. Role lists -------------------------------------------------------------

alter table public.workspace_members
  drop constraint if exists workspace_members_role_check;
alter table public.workspace_members
  add constraint workspace_members_role_check
  check (role in ('owner', 'admin', 'editor', 'viewer', 'attendant'));

alter table public.invitations
  drop constraint if exists invitations_role_check;
alter table public.invitations
  add constraint invitations_role_check
  check (role in ('owner', 'admin', 'member', 'editor', 'viewer', 'attendant'));

-- 2. Invariants of workspace_members (same body as F3e, plus 'attendant') --

create or replace function private.enforce_workspace_members_invariants()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $fn$
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
  if current_user = 'app_worker' then
    if tg_op = 'DELETE' and private.workspace_purgeable(old.workspace_id) then
      return old;
    end if;
    raise exception 'workspace members: the worker only purges deleted workspaces'
      using errcode = 'insufficient_privilege';
  end if;

  -- Skip enforcement if maintenance is run by migration administrator without tenant context
  if current_user in ('app_migrations', 'postgres') and private.context_uuid('app.workspace_id') is null then
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

  -- 3. Check escalating own role upwards (UPDATE). The Attendant (AT1) is
  -- the lowest rank: it reads less of the workspace than a viewer.
  if tg_op = 'UPDATE' and v_actor_user_id is not null and old.user_id = v_actor_user_id then
    v_old_rank := case old.role
      when 'owner' then 4
      when 'admin' then 3
      when 'editor' then 2
      when 'viewer' then 1
      when 'attendant' then 0
      else 0
    end;

    v_new_rank := case new.role
      when 'owner' then 4
      when 'admin' then 3
      when 'editor' then 2
      when 'viewer' then 1
      when 'attendant' then 0
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
$fn$;

-- 3. Credentials and API keys without the Attendant -------------------------

drop policy if exists credentials_select on public.credentials;
create policy credentials_select on public.credentials
  for select to app_runtime
  using (
    workspace_id = private.context_uuid('app.workspace_id')
    and organization_id = private.context_uuid('app.organization_id')
    and (
      private.current_workspace_role() in ('owner', 'admin', 'editor', 'viewer')
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
      private.current_workspace_role() in ('owner', 'admin', 'editor', 'viewer')
      or private.current_organization_role() in ('owner', 'admin')
    )
  );
