-- ============================================================================
-- Migration: 20261008140000_sma100_membership_invitations_rbac.sql
-- Module: Core Identity, RBAC & Invitations Lifecycle (AC03, AC04, AC06)
--
-- Maintenance Rationale:
-- 1. Organizations seats quota:
--    - Adds max_seats to public.organizations (default 5, strictly positive).
-- 2. Invitations table (public.invitations):
--    - Supports company-level or workspace-level invitations.
--    - Stores SHA-256 hash of the high-entropy raw secret token (token_hash).
--    - Preserves AC05 composite foreign key (workspace_id, organization_id)
--      referencing public.workspaces(id, organization_id).
--    - Implements status lifecycle: pending, accepted, revoked, expired.
--    - Partial unique index ensures only one pending invitation per email
--      in the target scope.
-- 3. AC04 Database Invariant (Trigger trg_organization_members_last_owner):
--    - Prohibits removing, revoking, or demoting the last active owner of an
--      organization at the database level, preventing privilege voids or
--      orphaned organizations even under concurrency or direct execution.
-- 4. RLS & Least Privilege (ADR 0001):
--    - FORCE ROW LEVEL SECURITY enabled on public.invitations.
--    - Data API (anon, authenticated) completely closed (REVOKE ALL).
--    - Grants insert, update, delete on invitations, organization_members,
--      workspace_members and update on organizations to app_runtime.
--    - Contextual policies enforce strict multi-tenant boundaries.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Organizations: Seat Quotas (AC06)
-- ----------------------------------------------------------------------------
alter table public.organizations
  add column if not exists max_seats integer not null default 5;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'organizations_max_seats_positive'
  ) then
    alter table public.organizations
      add constraint organizations_max_seats_positive check (max_seats > 0);
  end if;
end
$$;

-- ----------------------------------------------------------------------------
-- 2. Invitations Table (AC05, AC06)
-- ----------------------------------------------------------------------------
create table if not exists public.invitations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  workspace_id uuid,
  email text not null,
  role text not null,
  token_hash text not null unique,
  invited_by_user_id uuid not null references public.profiles(id),
  status text not null default 'pending',
  expires_at timestamptz not null,
  accepted_at timestamptz,
  accepted_by_user_id uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  -- Composite foreign key to guarantee cross-workspace reference isolation (AC05)
  constraint invitations_workspace_fkey
    foreign key (workspace_id, organization_id)
    references public.workspaces(id, organization_id)
    on delete cascade,

  constraint invitations_status_check
    check (status in ('pending', 'accepted', 'revoked', 'expired')),

  constraint invitations_role_check
    check (role in ('owner', 'admin', 'member', 'editor', 'viewer'))
);

-- Index for unique pending invitation per email per target scope
create unique index if not exists invitations_active_unique_idx
  on public.invitations (
    organization_id,
    lower(email),
    coalesce(workspace_id, '00000000-0000-0000-0000-000000000000'::uuid)
  )
  where status = 'pending';

-- Index for fast lookup by organization and status
create index if not exists invitations_org_status_idx
  on public.invitations (organization_id, status);

-- Trigger to maintain updated_at authoritative in the database
drop trigger if exists invitations_touch_updated_at on public.invitations;
create trigger invitations_touch_updated_at
  before update on public.invitations
  for each row execute function private.touch_updated_at();

-- Table ownership
alter table public.invitations owner to app_migrations;

-- ----------------------------------------------------------------------------
-- 3. AC04 Protection: Prevent Last Active Organization Owner Removal
-- ----------------------------------------------------------------------------
create or replace function private.prevent_last_owner_removal()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  remaining_owners integer;
begin
  -- Trigger activates only on UPDATE or DELETE touching an active owner
  if (tg_op = 'DELETE' or tg_op = 'UPDATE') then
    if old.role = 'owner' and old.status = 'active' then
      -- If UPDATE and the record remains an active owner, no demotion occurs
      if (tg_op = 'UPDATE' and new.role = 'owner' and new.status = 'active') then
        return new;
      end if;

      -- Skip enforcement if maintenance is run by migration administrator without tenant context
      if current_user = 'app_migrations' and private.context_uuid('app.organization_id') is null then
        return coalesce(new, old);
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
  before update or delete on public.organization_members
  for each row execute function private.prevent_last_owner_removal();

-- ----------------------------------------------------------------------------
-- 4. Row-Level Security (FORCE RLS) & Least Privilege Grants (ADR 0001)
-- ----------------------------------------------------------------------------
alter table public.invitations enable row level security;
alter table public.invitations force row level security;

-- Keep Data API strictly closed (D1)
revoke all on public.invitations from public, anon, authenticated;

-- Grants for app_runtime
grant select, insert, update, delete on public.invitations to app_runtime;
grant select, insert, update, delete on public.organization_members to app_runtime;
grant select, insert, update, delete on public.workspace_members to app_runtime;
grant select, update on public.organizations to app_runtime;

-- ----------------------------------------------------------------------------
-- 5. RLS Policies for Invitations
-- ----------------------------------------------------------------------------
-- SELECT: Organization members see their org's invitations; OR matching token hash
create policy invitations_select on public.invitations
  for select to app_runtime
  using (
    private.is_organization_member(organization_id)
    or (
      current_setting('app.invitation_token_hash', true) is not null
      and current_setting('app.invitation_token_hash', true) <> ''
      and token_hash = current_setting('app.invitation_token_hash', true)
    )
  );

-- INSERT: Only active organization owner or admin
create policy invitations_insert on public.invitations
  for insert to app_runtime
  with check (
    private.is_organization_member(organization_id)
    and exists (
      select 1
      from public.organization_members m
      where m.organization_id = organization_id
        and m.user_id = private.context_uuid('app.user_id')
        and m.role in ('owner', 'admin')
        and m.status = 'active'
    )
  );

-- UPDATE: Organization owner/admin (for revoking/editing) OR acceptance path
create policy invitations_update on public.invitations
  for update to app_runtime
  using (
    (
      private.is_organization_member(organization_id)
      and exists (
        select 1
        from public.organization_members m
        where m.organization_id = organization_id
          and m.user_id = private.context_uuid('app.user_id')
          and m.role in ('owner', 'admin')
          and m.status = 'active'
      )
    )
    or (
      current_setting('app.invitation_token_hash', true) is not null
      and current_setting('app.invitation_token_hash', true) <> ''
      and token_hash = current_setting('app.invitation_token_hash', true)
      and status = 'pending'
    )
  )
  with check (
    organization_id = private.context_uuid('app.organization_id')
  );

-- DELETE: Only active organization owner or admin
create policy invitations_delete on public.invitations
  for delete to app_runtime
  using (
    private.is_organization_member(organization_id)
    and exists (
      select 1
      from public.organization_members m
      where m.organization_id = organization_id
        and m.user_id = private.context_uuid('app.user_id')
        and m.role in ('owner', 'admin')
        and m.status = 'active'
    )
  );

-- ----------------------------------------------------------------------------
-- 6. RLS Policies for Organization Members (Mutations)
-- ----------------------------------------------------------------------------
-- INSERT: Existing owner/admin adding a member, OR invited user accepting invitation
create policy organization_members_insert on public.organization_members
  for insert to app_runtime
  with check (
    organization_id = private.context_uuid('app.organization_id')
    and (
      -- Path A: Active owner/admin adding member directly
      exists (
        select 1
        from public.organization_members m
        where m.organization_id = private.context_uuid('app.organization_id')
          and m.user_id = private.context_uuid('app.user_id')
          and m.role in ('owner', 'admin')
          and m.status = 'active'
      )
      -- Path B: Invited user accepting a valid pending invitation
      or (
        user_id = private.context_uuid('app.user_id')
        and exists (
          select 1
          from public.invitations inv
          where inv.organization_id = private.context_uuid('app.organization_id')
            and inv.token_hash = current_setting('app.invitation_token_hash', true)
            and inv.status = 'pending'
            and inv.expires_at > now()
        )
      )
    )
  );

-- UPDATE: Active owner/admin managing members
create policy organization_members_update on public.organization_members
  for update to app_runtime
  using (
    organization_id = private.context_uuid('app.organization_id')
    and exists (
      select 1
      from public.organization_members m
      where m.organization_id = private.context_uuid('app.organization_id')
        and m.user_id = private.context_uuid('app.user_id')
        and m.role in ('owner', 'admin')
        and m.status = 'active'
    )
  )
  with check (
    organization_id = private.context_uuid('app.organization_id')
  );

-- DELETE: Active owner/admin removing members, OR member leaving voluntarily
create policy organization_members_delete on public.organization_members
  for delete to app_runtime
  using (
    organization_id = private.context_uuid('app.organization_id')
    and (
      user_id = private.context_uuid('app.user_id')
      or exists (
        select 1
        from public.organization_members m
        where m.organization_id = private.context_uuid('app.organization_id')
          and m.user_id = private.context_uuid('app.user_id')
          and m.role in ('owner', 'admin')
          and m.status = 'active'
      )
    )
  );

-- ----------------------------------------------------------------------------
-- 7. RLS Policies for Workspace Members (Mutations)
-- ----------------------------------------------------------------------------
-- INSERT: Active org owner/admin or workspace owner/admin, OR invitation accept
create policy workspace_members_insert on public.workspace_members
  for insert to app_runtime
  with check (
    workspace_id = private.context_uuid('app.workspace_id')
    and organization_id = private.context_uuid('app.organization_id')
    and (
      exists (
        select 1
        from public.organization_members m
        where m.organization_id = private.context_uuid('app.organization_id')
          and m.user_id = private.context_uuid('app.user_id')
          and m.role in ('owner', 'admin')
          and m.status = 'active'
      )
      or exists (
        select 1
        from public.workspace_members wm
        where wm.workspace_id = private.context_uuid('app.workspace_id')
          and wm.organization_id = private.context_uuid('app.organization_id')
          and wm.user_id = private.context_uuid('app.user_id')
          and wm.role in ('owner', 'admin')
          and wm.status = 'active'
      )
      or (
        user_id = private.context_uuid('app.user_id')
        and exists (
          select 1
          from public.invitations inv
          where inv.organization_id = private.context_uuid('app.organization_id')
            and inv.workspace_id = private.context_uuid('app.workspace_id')
            and inv.token_hash = current_setting('app.invitation_token_hash', true)
            and inv.status = 'pending'
            and inv.expires_at > now()
        )
      )
    )
  );

-- UPDATE: Active org owner/admin or workspace owner/admin
create policy workspace_members_update on public.workspace_members
  for update to app_runtime
  using (
    workspace_id = private.context_uuid('app.workspace_id')
    and organization_id = private.context_uuid('app.organization_id')
    and (
      exists (
        select 1
        from public.organization_members m
        where m.organization_id = private.context_uuid('app.organization_id')
          and m.user_id = private.context_uuid('app.user_id')
          and m.role in ('owner', 'admin')
          and m.status = 'active'
      )
      or exists (
        select 1
        from public.workspace_members wm
        where wm.workspace_id = private.context_uuid('app.workspace_id')
          and wm.organization_id = private.context_uuid('app.organization_id')
          and wm.user_id = private.context_uuid('app.user_id')
          and wm.role in ('owner', 'admin')
          and wm.status = 'active'
      )
    )
  )
  with check (
    workspace_id = private.context_uuid('app.workspace_id')
    and organization_id = private.context_uuid('app.organization_id')
  );

-- DELETE: Active org/ws owner/admin, OR member leaving voluntarily
create policy workspace_members_delete on public.workspace_members
  for delete to app_runtime
  using (
    workspace_id = private.context_uuid('app.workspace_id')
    and organization_id = private.context_uuid('app.organization_id')
    and (
      user_id = private.context_uuid('app.user_id')
      or exists (
        select 1
        from public.organization_members m
        where m.organization_id = private.context_uuid('app.organization_id')
          and m.user_id = private.context_uuid('app.user_id')
          and m.role in ('owner', 'admin')
          and m.status = 'active'
      )
      or exists (
        select 1
        from public.workspace_members wm
        where wm.workspace_id = private.context_uuid('app.workspace_id')
          and wm.organization_id = private.context_uuid('app.organization_id')
          and wm.user_id = private.context_uuid('app.user_id')
          and wm.role in ('owner', 'admin')
          and wm.status = 'active'
      )
    )
  );

-- ----------------------------------------------------------------------------
-- 8. Organizations: Read by Invitation & Update by Owner
-- ----------------------------------------------------------------------------
-- Allows invited user presenting a valid token hash to read organization metadata
create policy organizations_select_by_invitation on public.organizations
  for select to app_runtime
  using (
    current_setting('app.invitation_token_hash', true) is not null
    and current_setting('app.invitation_token_hash', true) <> ''
    and exists (
      select 1
      from public.invitations inv
      where inv.organization_id = organizations.id
        and inv.token_hash = current_setting('app.invitation_token_hash', true)
        and inv.status = 'pending'
        and inv.expires_at > now()
    )
  );

-- Update organization row (name, max_seats) only by active organization owner
create policy organizations_update on public.organizations
  for update to app_runtime
  using (
    private.is_organization_member(id)
    and exists (
      select 1
      from public.organization_members m
      where m.organization_id = id
        and m.user_id = private.context_uuid('app.user_id')
        and m.role = 'owner'
        and m.status = 'active'
    )
  )
  with check (
    private.is_organization_member(id)
  );
