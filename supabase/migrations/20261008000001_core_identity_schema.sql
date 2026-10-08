-- SMA-97 F1.2: core identity schema with RLS isolation.
-- Profiles, organizations, workspaces, memberships, and platform admins.
--
-- Roles app_migrations and app_runtime were created in SMA-92 migration
-- 20261007220000_prisma_rls_spike.sql; this migration does not recreate them.
--
-- RLS strategy (ADR 0001 / D1, spec section 9):
--   * FORCE ROW LEVEL SECURITY on every table, including for the owner
--     (app_migrations). No object in this schema relies on owner bypass.
--   * The security-definer helpers that RLS policies call run as a dedicated
--     NOLOGIN, NOBYPASSRLS role (app_rls_helper) that is granted to no
--     application role. That role reads the membership tables only through
--     explicit, non-recursive policies scoped to the transaction context, so
--     the "read without RLS" hole that owner-bypass would leave does not exist.
--   * Policies read only transaction-local app.* context set by the server
--     after authentication and workspace-slug resolution.
--   * anon / authenticated receive no table grants (D1 / ADR 0001).
--
-- Table ownership of `profiles` belongs to this migration (F1.2). SMA-98
-- (F1.3) only adds its auth-slice columns; it must not create the table,
-- the helper schema, or additional profiles policies, because permissive
-- policies combine with OR and a second, laxer policy would undo the block
-- enforced here.
--
-- The profiles_*_self policy names below are deliberately the ones SMA-98's
-- migration drops and recreates (20261008120000, which always replays after
-- this one by timestamp). That makes SMA-98's "drop policy if exists ...;
-- create policy ..." the single owner of the final profiles policy once both
-- chains have run, instead of two differently named policies combining by OR
-- and undoing the block (SMA-135 finding 1). SMA-98 still must not introduce
-- a second, independently named policy for the same action.

-- ============================================================================
-- Roles
-- ============================================================================

-- Principal used by the security-definer RLS helpers. NOLOGIN, NOBYPASSRLS,
-- granted to no application role: it is only reachable by executing the
-- functions below. Membership is granted to the migration administrator so it
-- can transfer function ownership and so SQL tests can assume it.
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'app_rls_helper') then
    create role app_rls_helper nologin nosuperuser nocreatedb nocreaterole noinherit nobypassrls;
  end if;
end
$$;

grant app_rls_helper to postgres, app_migrations;
grant usage on schema public to app_rls_helper;

-- ============================================================================
-- Schema and privileges
-- ============================================================================

create schema if not exists private authorization app_migrations;

revoke all on schema private from public, anon, authenticated;
grant usage on schema private to app_runtime, app_rls_helper;
-- Required so app_rls_helper can own functions stored in this schema.
grant create on schema private to app_rls_helper;

-- ============================================================================
-- Domain tables
-- ============================================================================

-- `status` is the server-side revocation switch for an identity: anything
-- other than 'active' stops the identity from writing its own profile even
-- while its JWT is still valid (spec section 8, AC03). SMA-98 adds the
-- remaining auth-slice columns on top of this definition.
create table public.profiles (
  id         uuid primary key references auth.users(id) on delete cascade,
  full_name  text,
  status     text not null default 'active'
               check (status in ('active', 'suspended', 'blocked')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.organizations (
  id         uuid primary key,
  name       text not null check (length(name) > 0),
  status     text not null default 'active'
               check (status in ('active', 'suspended', 'inactive')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.organization_members (
  organization_id uuid not null references public.organizations(id) on delete cascade,
  user_id         uuid not null references auth.users(id) on delete cascade,
  role            text not null
                    check (role in ('owner', 'admin')),
  status          text not null default 'active'
                    check (status in ('active', 'inactive')),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  primary key (organization_id, user_id)
);

create table public.workspaces (
  id              uuid primary key,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  slug            text not null unique,
  name            text not null check (length(name) > 0),
  status          text not null default 'active'
                    check (status in ('active', 'suspended', 'inactive')),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (id, organization_id)
);

create table public.workspace_members (
  workspace_id    uuid not null,
  organization_id uuid not null,
  user_id         uuid not null references auth.users(id) on delete cascade,
  role            text not null
                    check (role in ('owner', 'admin', 'editor', 'viewer')),
  status          text not null default 'active'
                    check (status in ('active', 'inactive')),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  primary key (workspace_id, user_id),
  foreign key (workspace_id, organization_id)
    references public.workspaces(id, organization_id) on delete cascade
);

create table public.platform_admin_members (
  user_id    uuid not null primary key references auth.users(id) on delete cascade,
  role       text not null
               check (role in ('owner', 'operations', 'billing', 'support')),
  status     text not null default 'active'
               check (status in ('active', 'inactive')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ============================================================================
-- Indexes (justified by query patterns)
-- ============================================================================

-- Workspace lookup by slug (navigation routing).
-- The UNIQUE constraint already creates an index; this is explicit for clarity.

-- List workspaces of an organization.
create index workspaces_organization_id_idx
  on public.workspaces (organization_id);

-- Find user memberships across organizations. The primary key already covers
-- (organization_id, user_id); this index leads with user_id, which is what
-- private.is_organization_member and the app_rls_helper policy filter on.
create index organization_members_user_id_idx
  on public.organization_members (user_id, organization_id, status);

-- Same shape for workspaces: user-led lookup for the helper policy and for
-- private.is_workspace_member.
create index workspace_members_user_id_idx
  on public.workspace_members (user_id, workspace_id, organization_id, status);

-- ============================================================================
-- Table ownership (all domain tables owned by app_migrations)
-- ============================================================================

alter table public.profiles owner to app_migrations;
alter table public.organizations owner to app_migrations;
alter table public.organization_members owner to app_migrations;
alter table public.workspaces owner to app_migrations;
alter table public.workspace_members owner to app_migrations;
alter table public.platform_admin_members owner to app_migrations;

-- ============================================================================
-- Helper functions (private schema)
-- ============================================================================

-- Reads a uuid from the transaction-local context set by the server. Returns
-- null for an absent, empty or malformed value, so "no context" denies.
create function private.context_uuid(setting_name text)
returns uuid
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  value text;
begin
  value := current_setting(setting_name, true);
  if value is null or value = '' then
    return null;
  end if;
  return value::uuid;
exception
  when invalid_text_representation then return null;
end
$$;

-- Keeps updated_at authoritative in the database, not in the caller.
create function private.touch_updated_at()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end
$$;

-- Active membership in the *contextual* workspace. Every component of the
-- context must match: a user with several memberships only ever sees the
-- workspace the server resolved for this request.
create function private.is_workspace_member(
  p_workspace_id uuid,
  p_organization_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select p_workspace_id = private.context_uuid('app.workspace_id')
    and p_organization_id = private.context_uuid('app.organization_id')
    and exists (
      select 1
      from public.workspace_members member
      where member.workspace_id = p_workspace_id
        and member.organization_id = p_organization_id
        and member.user_id = private.context_uuid('app.user_id')
        and member.status = 'active'
    );
$$;

-- Active membership in the *contextual* organization. Comparing against
-- app.organization_id is what keeps a multi-organization user from reading
-- organization B while operating in context A, and what makes a partial or
-- malformed context deny instead of widen.
create function private.is_organization_member(
  p_organization_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select p_organization_id = private.context_uuid('app.organization_id')
    and exists (
      select 1
      from public.organization_members member
      where member.organization_id = p_organization_id
        and member.user_id = private.context_uuid('app.user_id')
        and member.status = 'active'
    );
$$;

-- Slug resolution is an authenticated, membership-bound operation: it returns
-- ids only when the context user holds an active membership in the workspace.
-- Without this, any caller holding EXECUTE could enumerate workspace and
-- organization ids of other tenants, even with no app.* context at all.
create function private.resolve_workspace_slug(
  p_slug text
)
returns table(workspace_id uuid, organization_id uuid)
language sql
stable
security definer
set search_path = ''
as $$
  select workspace.id, workspace.organization_id
  from public.workspaces workspace
  where workspace.slug = p_slug
    and workspace.status = 'active'
    and private.context_uuid('app.user_id') is not null
    and exists (
      select 1
      from public.workspace_members member
      where member.workspace_id = workspace.id
        and member.organization_id = workspace.organization_id
        and member.user_id = private.context_uuid('app.user_id')
        and member.status = 'active'
    );
$$;

alter function private.context_uuid(text) owner to app_migrations;
alter function private.touch_updated_at() owner to app_migrations;

-- The security-definer helpers run as app_rls_helper, never as the table
-- owner: with FORCE enabled everywhere, owner-bypass does not exist, and
-- these functions reach the membership tables only through the explicit
-- app_rls_helper policies declared below.
alter function private.is_workspace_member(uuid, uuid) owner to app_rls_helper;
alter function private.is_organization_member(uuid) owner to app_rls_helper;
alter function private.resolve_workspace_slug(text) owner to app_rls_helper;

revoke execute on function private.context_uuid(text) from public, anon, authenticated;
revoke execute on function private.touch_updated_at() from public, anon, authenticated;
revoke execute on function private.is_workspace_member(uuid, uuid) from public, anon, authenticated;
revoke execute on function private.is_organization_member(uuid) from public, anon, authenticated;
revoke execute on function private.resolve_workspace_slug(text) from public, anon, authenticated;

grant execute on function private.context_uuid(text) to app_runtime, app_rls_helper;
grant execute on function private.is_workspace_member(uuid, uuid) to app_runtime;
grant execute on function private.is_organization_member(uuid) to app_runtime;
grant execute on function private.resolve_workspace_slug(text) to app_runtime;

-- ============================================================================
-- updated_at triggers
-- ============================================================================

create trigger profiles_touch_updated_at
  before update on public.profiles
  for each row execute function private.touch_updated_at();

create trigger organizations_touch_updated_at
  before update on public.organizations
  for each row execute function private.touch_updated_at();

create trigger organization_members_touch_updated_at
  before update on public.organization_members
  for each row execute function private.touch_updated_at();

create trigger workspaces_touch_updated_at
  before update on public.workspaces
  for each row execute function private.touch_updated_at();

create trigger workspace_members_touch_updated_at
  before update on public.workspace_members
  for each row execute function private.touch_updated_at();

create trigger platform_admin_members_touch_updated_at
  before update on public.platform_admin_members
  for each row execute function private.touch_updated_at();

-- ============================================================================
-- Row-level security — FORCE on every table (ADR 0001, spec section 9)
-- ============================================================================

alter table public.profiles enable row level security;
alter table public.profiles force row level security;

alter table public.organizations enable row level security;
alter table public.organizations force row level security;

alter table public.workspaces enable row level security;
alter table public.workspaces force row level security;

alter table public.organization_members enable row level security;
alter table public.organization_members force row level security;

alter table public.workspace_members enable row level security;
alter table public.workspace_members force row level security;

alter table public.platform_admin_members enable row level security;
alter table public.platform_admin_members force row level security;

-- ============================================================================
-- RLS policies — application runtime
-- ============================================================================

-- profiles: own profile only. SELECT is not gated on status so the server can
-- read the row that tells it the identity is blocked.
create policy profiles_select_self on public.profiles
  for select to app_runtime
  using (id = private.context_uuid('app.user_id'));

-- The row is created active; a non-active status is an administrative act.
create policy profiles_insert_self on public.profiles
  for insert to app_runtime
  with check (
    id = private.context_uuid('app.user_id')
    and status = 'active'
  );

-- A suspended or blocked identity cannot touch its own row, so revocation
-- holds even if an application path forgets to check the status first.
-- Lifting a block never comes through this policy.
create policy profiles_update_self on public.profiles
  for update to app_runtime
  using (
    id = private.context_uuid('app.user_id')
    and status = 'active'
  )
  with check (
    id = private.context_uuid('app.user_id')
    and status = 'active'
  );

-- organizations: members can read the contextual organization only
create policy organizations_select on public.organizations
  for select to app_runtime
  using (private.is_organization_member(id));

-- organization_members: members can see other members of that organization
create policy organization_members_select on public.organization_members
  for select to app_runtime
  using (private.is_organization_member(organization_id));

-- workspaces: members can read the contextual workspace only
create policy workspaces_select on public.workspaces
  for select to app_runtime
  using (private.is_workspace_member(id, organization_id));

-- workspace_members: members can see other members of their workspace
create policy workspace_members_select on public.workspace_members
  for select to app_runtime
  using (private.is_workspace_member(workspace_id, organization_id));

-- platform_admin_members: no policies for app_runtime
-- This table is writable only by privileged processes (service_role / postgres).
-- app_runtime has no grants on it.

-- ============================================================================
-- RLS policies — security-definer helper principal
-- ============================================================================
-- Minimum surface for the helpers above. Each policy is scoped to the
-- transaction context and references no function that reads the same table,
-- so policy evaluation cannot recurse.

-- is_workspace_member / resolve_workspace_slug: only the context user's own
-- membership rows.
create policy workspace_members_helper_select on public.workspace_members
  for select to app_rls_helper
  using (user_id = private.context_uuid('app.user_id'));

-- is_organization_member: only the context user's own membership rows.
create policy organization_members_helper_select on public.organization_members
  for select to app_rls_helper
  using (user_id = private.context_uuid('app.user_id'));

-- resolve_workspace_slug: only workspaces where the context user holds an
-- active membership. The subquery is evaluated under the policy above.
create policy workspaces_helper_select on public.workspaces
  for select to app_rls_helper
  using (
    exists (
      select 1
      from public.workspace_members member
      where member.workspace_id = workspaces.id
        and member.organization_id = workspaces.organization_id
        and member.user_id = private.context_uuid('app.user_id')
        and member.status = 'active'
    )
  );

-- No helper policy on organizations, profiles or platform_admin_members: no
-- security-definer function reads them.

-- ============================================================================
-- Privilege grants
-- ============================================================================

revoke all on public.profiles from public, anon, authenticated;
revoke all on public.organizations from public, anon, authenticated;
revoke all on public.organization_members from public, anon, authenticated;
revoke all on public.workspaces from public, anon, authenticated;
revoke all on public.workspace_members from public, anon, authenticated;
revoke all on public.platform_admin_members from public, anon, authenticated;

grant select, insert, update on public.profiles to app_runtime;
grant select on public.organizations to app_runtime;
grant select on public.organization_members to app_runtime;
grant select on public.workspaces to app_runtime;
grant select on public.workspace_members to app_runtime;

-- Minimum privileges for the helper principal: read-only, three tables.
grant select on public.workspaces to app_rls_helper;
grant select on public.workspace_members to app_rls_helper;
grant select on public.organization_members to app_rls_helper;

-- platform_admin_members: no grants for app_runtime or app_rls_helper.
