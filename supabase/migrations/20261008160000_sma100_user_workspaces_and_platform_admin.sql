-- ============================================================================
-- Migration: 20261008160000_sma100_user_workspaces_and_platform_admin.sql
-- Module: Workspace Navigation & Platform Administration Functions
--
-- Maintenance Rationale:
-- 1. Introduces `private.list_user_workspaces()` allowing authenticated users
--    in `withIdentityContext` to list exclusively workspaces where they hold
--    an active membership, with organization metadata.
-- 2. Grants `app_rls_helper` select on `public.organizations` guarded by
--    `organizations_helper_select` to prevent cross-tenant enumeration.
-- 3. Grants `app_runtime` select on `public.platform_admin_members` guarded by
--    `platform_admin_members_select` for the caller's own active row.
-- 4. Exposes security-definer helper functions for platform admins:
--    `private.is_platform_admin()`, `private.get_admin_metrics()`,
--    `private.list_admin_organizations()`, `private.list_admin_workspaces()`,
--    and `private.list_admin_users()`.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Helper Select Policy & Grants for Organizations
-- ----------------------------------------------------------------------------
grant select on public.organizations to app_rls_helper;

drop policy if exists organizations_helper_select on public.organizations;
create policy organizations_helper_select on public.organizations
  for select to app_rls_helper
  using (
    exists (
      select 1
      from public.organization_members member
      where member.organization_id = organizations.id
        and member.user_id = private.context_uuid('app.user_id')
        and member.status = 'active'
    )
  );

-- ----------------------------------------------------------------------------
-- 2. Security-Definer Function: list_user_workspaces
-- ----------------------------------------------------------------------------
create or replace function private.list_user_workspaces()
returns table(
  workspace_id uuid,
  workspace_name text,
  workspace_slug text,
  workspace_status text,
  workspace_role text,
  organization_id uuid,
  organization_name text,
  organization_role text
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    w.id as workspace_id,
    w.name as workspace_name,
    w.slug as workspace_slug,
    w.status as workspace_status,
    wm.role as workspace_role,
    o.id as organization_id,
    o.name as organization_name,
    coalesce(om.role, 'member') as organization_role
  from public.workspaces w
  join public.workspace_members wm on wm.workspace_id = w.id and wm.organization_id = w.organization_id
  join public.organizations o on o.id = w.organization_id
  left join public.organization_members om on om.organization_id = o.id and om.user_id = wm.user_id and om.status = 'active'
  where wm.user_id = private.context_uuid('app.user_id')
    and wm.status = 'active'
    and w.status = 'active'
    and o.status = 'active'
  order by o.name asc, w.name asc;
$$;

alter function private.list_user_workspaces() owner to app_rls_helper;
revoke execute on function private.list_user_workspaces() from public, anon, authenticated;
grant execute on function private.list_user_workspaces() to app_runtime;

-- ----------------------------------------------------------------------------
-- 3. Platform Admin Membership Select Policy
-- ----------------------------------------------------------------------------
grant select on public.platform_admin_members to app_runtime;

drop policy if exists platform_admin_members_select on public.platform_admin_members;
create policy platform_admin_members_select on public.platform_admin_members
  for select to app_runtime
  using (
    user_id = private.context_uuid('app.user_id')
    and status = 'active'
  );

-- Helper policy on platform_admin_members for app_rls_helper
grant select on public.platform_admin_members to app_rls_helper;

drop policy if exists platform_admin_members_helper_select on public.platform_admin_members;
create policy platform_admin_members_helper_select on public.platform_admin_members
  for select to app_rls_helper
  using (
    user_id = private.context_uuid('app.user_id')
    and status = 'active'
  );

-- ----------------------------------------------------------------------------
-- 4. Security-Definer Helpers for Platform Admin Queries
-- ----------------------------------------------------------------------------

create or replace function private.is_platform_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.platform_admin_members pam
    where pam.user_id = private.context_uuid('app.user_id')
      and pam.status = 'active'
  );
$$;

alter function private.is_platform_admin() owner to app_rls_helper;
revoke execute on function private.is_platform_admin() from public, anon, authenticated;
grant execute on function private.is_platform_admin() to app_runtime;

-- Helper policies for app_rls_helper to view admin global tables when caller is platform admin
drop policy if exists organizations_admin_helper_select on public.organizations;
create policy organizations_admin_helper_select on public.organizations
  for select to app_rls_helper
  using (private.is_platform_admin());

drop policy if exists workspaces_admin_helper_select on public.workspaces;
create policy workspaces_admin_helper_select on public.workspaces
  for select to app_rls_helper
  using (private.is_platform_admin());

grant select on public.profiles to app_rls_helper;
drop policy if exists profiles_admin_helper_select on public.profiles;
create policy profiles_admin_helper_select on public.profiles
  for select to app_rls_helper
  using (private.is_platform_admin());

-- Metrics function
create or replace function private.get_admin_metrics()
returns table(
  total_organizations bigint,
  total_workspaces bigint,
  total_users bigint
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not private.is_platform_admin() then
    raise exception 'Access denied: not an active platform administrator';
  end if;

  return query
  select
    (select count(*)::bigint from public.organizations where status = 'active') as total_organizations,
    (select count(*)::bigint from public.workspaces where status = 'active') as total_workspaces,
    (select count(*)::bigint from public.profiles where status = 'active') as total_users;
end;
$$;

alter function private.get_admin_metrics() owner to app_rls_helper;
revoke execute on function private.get_admin_metrics() from public, anon, authenticated;
grant execute on function private.get_admin_metrics() to app_runtime;

-- Admin organizations list function
create or replace function private.list_admin_organizations()
returns table(
  id uuid,
  name text,
  status text,
  max_seats integer,
  created_at timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not private.is_platform_admin() then
    raise exception 'Access denied: not an active platform administrator';
  end if;

  return query
  select o.id, o.name, o.status, o.max_seats, o.created_at
  from public.organizations o
  order by o.created_at desc;
end;
$$;

alter function private.list_admin_organizations() owner to app_rls_helper;
revoke execute on function private.list_admin_organizations() from public, anon, authenticated;
grant execute on function private.list_admin_organizations() to app_runtime;

-- Admin workspaces list function
create or replace function private.list_admin_workspaces()
returns table(
  id uuid,
  organization_id uuid,
  organization_name text,
  name text,
  slug text,
  status text,
  created_at timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not private.is_platform_admin() then
    raise exception 'Access denied: not an active platform administrator';
  end if;

  return query
  select w.id, w.organization_id, o.name as organization_name, w.name, w.slug, w.status, w.created_at
  from public.workspaces w
  join public.organizations o on o.id = w.organization_id
  order by w.created_at desc;
end;
$$;

alter function private.list_admin_workspaces() owner to app_rls_helper;
revoke execute on function private.list_admin_workspaces() from public, anon, authenticated;
grant execute on function private.list_admin_workspaces() to app_runtime;

-- Admin users list function
create or replace function private.list_admin_users()
returns table(
  id uuid,
  full_name text,
  status text,
  created_at timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not private.is_platform_admin() then
    raise exception 'Access denied: not an active platform administrator';
  end if;

  return query
  select p.id, p.full_name, p.status, p.created_at
  from public.profiles p
  order by p.created_at desc;
end;
$$;

alter function private.list_admin_users() owner to app_rls_helper;
revoke execute on function private.list_admin_users() from public, anon, authenticated;
grant execute on function private.list_admin_users() to app_runtime;
