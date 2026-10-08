-- SMA-97 SQL-level RLS verification. Execute as the hosted postgres
-- migration administrator. Every mutation is rolled back; fixtures are
-- from tests/core/seed.sql.
--
-- Identities used (see tests/core/fixtures.ts):
--   ...031 owner of organization/workspace A
--   ...032 owner of organization/workspace B
--   ...033 member of organizations A and B, workspace A only
--   ...034 member of organization A only (no workspace membership)
--   ...035 workspace A membership revoked (status inactive)
--   ...036 active memberships, identity blocked
--   ...037 auth user with no profile row (first sign-in path)
--   ...038 auth user with no profile row (forge target)

-- ============================================================================
-- Schema contract: FORCE RLS on every core table (ADR 0001, spec section 9)
-- ============================================================================

do $$
declare
  checked int;
  offenders text;
begin
  select count(*),
         string_agg(c.relname, ', ') filter (
           where not (c.relrowsecurity and c.relforcerowsecurity)
         )
  into checked, offenders
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public'
    and c.relname in (
      'profiles', 'organizations', 'organization_members',
      'workspaces', 'workspace_members', 'platform_admin_members',
      'invitations'
    );

  if checked <> 7 then
    raise exception 'FORCE contract: expected 7 core tables, found %', checked;
  end if;
  if offenders is not null then
    raise exception 'FORCE contract: ENABLE+FORCE row level security missing on %', offenders;
  end if;
end
$$;

-- ============================================================================
-- Role contract: the security-definer principal is unreachable and unprivileged
-- ============================================================================

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'app_rls_helper') then
    raise exception 'role contract: app_rls_helper does not exist';
  end if;
  if exists (
    select 1 from pg_roles
    where rolname = 'app_rls_helper'
      and (rolcanlogin or rolbypassrls or rolsuper or rolcreaterole or rolcreatedb)
  ) then
    raise exception 'role contract: app_rls_helper must be nologin, nobypassrls, unprivileged';
  end if;
  if exists (
    select 1 from pg_roles
    where rolname in ('app_runtime', 'app_migrations') and rolbypassrls
  ) then
    raise exception 'role contract: app_runtime/app_migrations must not have BYPASSRLS';
  end if;
  -- app_runtime must not be able to assume the helper principal, nor the owner.
  if pg_has_role('app_runtime', 'app_rls_helper', 'USAGE') then
    raise exception 'role contract: app_runtime can assume app_rls_helper';
  end if;
  if pg_has_role('app_runtime', 'app_migrations', 'USAGE') then
    raise exception 'role contract: app_runtime can assume app_migrations';
  end if;
  if pg_has_role('app_rls_helper', 'app_runtime', 'USAGE') then
    raise exception 'role contract: app_rls_helper can assume app_runtime';
  end if;
  -- The helper functions must run as app_rls_helper, not as the table owner.
  if exists (
    select 1
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'private'
      and p.proname in ('is_workspace_member', 'is_organization_member', 'resolve_workspace_slug')
      and (not p.prosecdef or pg_get_userbyid(p.proowner) <> 'app_rls_helper')
  ) then
    raise exception 'role contract: security-definer helpers must be owned by app_rls_helper';
  end if;
end
$$;

-- ============================================================================
-- FORCE in practice: the table owner reads nothing, even with full context
-- ============================================================================

begin;
set local role app_migrations;
select set_config('app.user_id', 'a0000000-0000-4000-8000-000000000031', true);
select set_config('app.workspace_id', 'a0000000-0000-4000-8000-000000000011', true);
select set_config('app.organization_id', 'a0000000-0000-4000-8000-000000000010', true);
do $$
begin
  if (select count(*) from public.profiles) <> 0 then
    raise exception 'FORCE: owner read profiles';
  end if;
  if (select count(*) from public.organizations) <> 0 then
    raise exception 'FORCE: owner read organizations';
  end if;
  if (select count(*) from public.organization_members) <> 0 then
    raise exception 'FORCE: owner read organization_members';
  end if;
  if (select count(*) from public.workspaces) <> 0 then
    raise exception 'FORCE: owner read workspaces';
  end if;
  if (select count(*) from public.workspace_members) <> 0 then
    raise exception 'FORCE: owner read workspace_members';
  end if;
  if (select count(*) from public.platform_admin_members) <> 0 then
    raise exception 'FORCE: owner read platform_admin_members';
  end if;
  if (select count(*) from public.invitations) <> 0 then
    raise exception 'FORCE: owner read invitations';
  end if;
end
$$;
rollback;

-- ============================================================================
-- The helper principal is confined to the context user's own rows
-- ============================================================================

begin;
set local role app_rls_helper;
select set_config('app.user_id', 'a0000000-0000-4000-8000-000000000031', true);
do $$
begin
  if (select array_agg(distinct user_id) from public.workspace_members)
     is distinct from array['a0000000-0000-4000-8000-000000000031'::uuid] then
    raise exception 'helper: read workspace memberships of other users';
  end if;

  if (select array_agg(distinct user_id) from public.organization_members)
     is distinct from array['a0000000-0000-4000-8000-000000000031'::uuid] then
    raise exception 'helper: read organization memberships of other users';
  end if;

  if (select array_agg(id order by id) from public.workspaces)
     is distinct from array['a0000000-0000-4000-8000-000000000011'::uuid] then
    raise exception 'helper: read workspaces without an active membership';
  end if;

  -- No helper policy and no grant on organizations or profiles.
  begin
    perform count(*) from public.organizations;
    raise exception 'helper: can read organizations';
  exception
    when insufficient_privilege then null;
  end;

  begin
    perform count(*) from public.profiles;
    raise exception 'helper: can read profiles';
  exception
    when insufficient_privilege then null;
  end;
end
$$;
rollback;

begin;
set local role app_rls_helper;
do $$
begin
  if (select count(*) from public.workspaces) <> 0 then
    raise exception 'helper: read workspaces with no context';
  end if;
  if (select count(*) from public.workspace_members) <> 0 then
    raise exception 'helper: read memberships with no context';
  end if;
end
$$;
rollback;

-- ============================================================================
-- AC01: cross-workspace isolation
-- ============================================================================

begin;
set local role app_runtime;
select set_config('app.user_id', 'a0000000-0000-4000-8000-000000000031', true);
select set_config('app.workspace_id', 'a0000000-0000-4000-8000-000000000011', true);
select set_config('app.organization_id', 'a0000000-0000-4000-8000-000000000010', true);
do $$
begin
  -- workspace A member sees only org A
  if (select array_agg(id order by id) from public.organizations)
     is distinct from array['a0000000-0000-4000-8000-000000000010'::uuid] then
    raise exception 'AC01: workspace A member saw unexpected organizations';
  end if;

  if (select array_agg(id order by id) from public.workspaces)
     is distinct from array['a0000000-0000-4000-8000-000000000011'::uuid] then
    raise exception 'AC01: workspace A member saw unexpected workspaces';
  end if;

  -- Every visible membership row belongs to workspace A / organization A.
  if exists (
    select 1 from public.workspace_members
    where workspace_id <> 'a0000000-0000-4000-8000-000000000011'::uuid
       or organization_id <> 'a0000000-0000-4000-8000-000000000010'::uuid
  ) then
    raise exception 'AC01: workspace A member saw foreign workspace members';
  end if;

  if exists (
    select 1 from public.organization_members
    where organization_id <> 'a0000000-0000-4000-8000-000000000010'::uuid
  ) then
    raise exception 'AC01: workspace A member saw foreign organization members';
  end if;

  if (select count(*) from public.workspace_members) = 0 then
    raise exception 'AC01: workspace A member saw no workspace members at all';
  end if;
end
$$;
rollback;

begin;
set local role app_runtime;
select set_config('app.user_id', 'a0000000-0000-4000-8000-000000000032', true);
select set_config('app.workspace_id', 'a0000000-0000-4000-8000-000000000021', true);
select set_config('app.organization_id', 'a0000000-0000-4000-8000-000000000020', true);
do $$
begin
  if (select array_agg(id order by id) from public.organizations)
     is distinct from array['a0000000-0000-4000-8000-000000000020'::uuid] then
    raise exception 'AC01: workspace B member saw unexpected organizations';
  end if;

  if (select array_agg(id order by id) from public.workspaces)
     is distinct from array['a0000000-0000-4000-8000-000000000021'::uuid] then
    raise exception 'AC01: workspace B member saw unexpected workspaces';
  end if;
end
$$;
rollback;

-- ============================================================================
-- AC02: missing, malformed or partial context denies access
-- ============================================================================

begin;
set local role app_runtime;
do $$
begin
  if (select count(*) from public.organizations) <> 0 then
    raise exception 'AC02: missing context exposed organizations';
  end if;
  if (select count(*) from public.workspaces) <> 0 then
    raise exception 'AC02: missing context exposed workspaces';
  end if;
  if (select count(*) from public.workspace_members) <> 0 then
    raise exception 'AC02: missing context exposed workspace members';
  end if;
  if (select count(*) from public.organization_members) <> 0 then
    raise exception 'AC02: missing context exposed organization members';
  end if;
  if (select count(*) from public.profiles) <> 0 then
    raise exception 'AC02: missing context exposed profiles';
  end if;
end
$$;
rollback;

begin;
set local role app_runtime;
select set_config('app.user_id', 'malformed', true);
select set_config('app.workspace_id', 'malformed', true);
select set_config('app.organization_id', 'malformed', true);
do $$
begin
  if (select count(*) from public.organizations) <> 0 then
    raise exception 'AC02: malformed context exposed organizations';
  end if;
  if (select count(*) from public.workspaces) <> 0 then
    raise exception 'AC02: malformed context exposed workspaces';
  end if;
  if (select count(*) from public.profiles) <> 0 then
    raise exception 'AC02: malformed context exposed profiles';
  end if;
end
$$;
rollback;

-- Valid user, but no organization context: organization reads must stay closed.
begin;
set local role app_runtime;
select set_config('app.user_id', 'a0000000-0000-4000-8000-000000000031', true);
select set_config('app.workspace_id', 'a0000000-0000-4000-8000-000000000011', true);
do $$
begin
  if (select count(*) from public.organizations) <> 0 then
    raise exception 'AC02: absent app.organization_id exposed organizations';
  end if;
  if (select count(*) from public.organization_members) <> 0 then
    raise exception 'AC02: absent app.organization_id exposed organization members';
  end if;
  if (select count(*) from public.workspaces) <> 0 then
    raise exception 'AC02: absent app.organization_id exposed workspaces';
  end if;
end
$$;
rollback;

-- Valid user and organization, but no workspace context.
begin;
set local role app_runtime;
select set_config('app.user_id', 'a0000000-0000-4000-8000-000000000031', true);
select set_config('app.organization_id', 'a0000000-0000-4000-8000-000000000010', true);
do $$
begin
  if (select count(*) from public.workspaces) <> 0 then
    raise exception 'AC02: absent app.workspace_id exposed workspaces';
  end if;
  if (select count(*) from public.workspace_members) <> 0 then
    raise exception 'AC02: absent app.workspace_id exposed workspace members';
  end if;
end
$$;
rollback;

-- ============================================================================
-- Organization context is honoured for a multi-organization user
-- ============================================================================

begin;
set local role app_runtime;
select set_config('app.user_id', 'a0000000-0000-4000-8000-000000000033', true);
select set_config('app.workspace_id', 'a0000000-0000-4000-8000-000000000011', true);
select set_config('app.organization_id', 'a0000000-0000-4000-8000-000000000010', true);
do $$
begin
  -- Member of A and B, operating in A: only A may be visible.
  if (select array_agg(id order by id) from public.organizations)
     is distinct from array['a0000000-0000-4000-8000-000000000010'::uuid] then
    raise exception 'multi-org: contextual organization was not honoured';
  end if;

  if exists (
    select 1 from public.organization_members
    where organization_id = 'a0000000-0000-4000-8000-000000000020'::uuid
  ) then
    raise exception 'multi-org: saw members of the non-contextual organization';
  end if;

  if (select array_agg(id order by id) from public.workspaces)
     is distinct from array['a0000000-0000-4000-8000-000000000011'::uuid] then
    raise exception 'multi-org: saw unexpected workspaces';
  end if;
end
$$;
rollback;

-- Mismatched context (workspace of A, organization of B) resolves to nothing.
begin;
set local role app_runtime;
select set_config('app.user_id', 'a0000000-0000-4000-8000-000000000033', true);
select set_config('app.workspace_id', 'a0000000-0000-4000-8000-000000000011', true);
select set_config('app.organization_id', 'a0000000-0000-4000-8000-000000000020', true);
do $$
begin
  if (select count(*) from public.workspaces) <> 0 then
    raise exception 'multi-org: mismatched context exposed a workspace';
  end if;
  if (select count(*) from public.workspace_members) <> 0 then
    raise exception 'multi-org: mismatched context exposed workspace members';
  end if;
end
$$;
rollback;

-- ============================================================================
-- Company -> workspace inheritance stays off (spec section 7)
-- ============================================================================

begin;
set local role app_runtime;
select set_config('app.user_id', 'a0000000-0000-4000-8000-000000000034', true);
select set_config('app.workspace_id', 'a0000000-0000-4000-8000-000000000011', true);
select set_config('app.organization_id', 'a0000000-0000-4000-8000-000000000010', true);
do $$
begin
  -- Organization membership alone must not open the workspace.
  if (select count(*) from public.workspaces) <> 0 then
    raise exception 'inheritance: organization member reached a workspace';
  end if;
  if (select count(*) from public.workspace_members) <> 0 then
    raise exception 'inheritance: organization member reached workspace members';
  end if;
  -- The organization itself is still visible: that is the explicit grant.
  if (select count(*) from public.organizations) <> 1 then
    raise exception 'inheritance: organization member lost its own organization';
  end if;
end
$$;
rollback;

-- ============================================================================
-- Revoked workspace membership loses access immediately
-- ============================================================================

begin;
set local role app_runtime;
select set_config('app.user_id', 'a0000000-0000-4000-8000-000000000035', true);
select set_config('app.workspace_id', 'a0000000-0000-4000-8000-000000000011', true);
select set_config('app.organization_id', 'a0000000-0000-4000-8000-000000000010', true);
do $$
begin
  if (select count(*) from public.workspaces) <> 0 then
    raise exception 'revocation: inactive member still reads the workspace';
  end if;
  if (select count(*) from public.workspace_members) <> 0 then
    raise exception 'revocation: inactive member still reads workspace members';
  end if;
end
$$;
rollback;

-- ============================================================================
-- private.resolve_workspace_slug never discloses ids outside the context
-- ============================================================================

begin;
set local role app_runtime;
do $$
begin
  -- No context at all.
  if (select count(*) from private.resolve_workspace_slug('workspace-a')) <> 0 then
    raise exception 'resolver: disclosed ids with no context';
  end if;
end
$$;
rollback;

begin;
set local role app_runtime;
select set_config('app.user_id', 'malformed', true);
do $$
begin
  if (select count(*) from private.resolve_workspace_slug('workspace-a')) <> 0 then
    raise exception 'resolver: disclosed ids with malformed context';
  end if;
end
$$;
rollback;

begin;
set local role app_runtime;
select set_config('app.user_id', 'a0000000-0000-4000-8000-000000000034', true);
do $$
begin
  -- Organization A member without a workspace A membership.
  if (select count(*) from private.resolve_workspace_slug('workspace-a')) <> 0 then
    raise exception 'resolver: disclosed ids to a non-member of the workspace';
  end if;
end
$$;
rollback;

begin;
set local role app_runtime;
select set_config('app.user_id', 'a0000000-0000-4000-8000-000000000031', true);
do $$
begin
  -- Cross-tenant slug: owner of A asking for B.
  if (select count(*) from private.resolve_workspace_slug('workspace-b')) <> 0 then
    raise exception 'resolver: disclosed ids of another tenant';
  end if;

  -- Unknown slug and foreign slug must be indistinguishable: both empty.
  if (select count(*) from private.resolve_workspace_slug('does-not-exist')) <> 0 then
    raise exception 'resolver: returned rows for an unknown slug';
  end if;

  -- The member path still works.
  if (
    select array_agg(workspace_id)
    from private.resolve_workspace_slug('workspace-a')
  ) is distinct from array['a0000000-0000-4000-8000-000000000011'::uuid] then
    raise exception 'resolver: active member could not resolve its own workspace';
  end if;
end
$$;
rollback;

-- ============================================================================
-- profiles: self-service writes, and the block that cannot be lifted
-- ============================================================================

begin;
set local role app_runtime;
select set_config('app.user_id', 'a0000000-0000-4000-8000-000000000031', true);
do $$
declare
  affected int;
begin
  -- Own row, active identity: allowed.
  update public.profiles set full_name = 'User A renamed'
  where id = 'a0000000-0000-4000-8000-000000000031';
  get diagnostics affected = row_count;
  if affected <> 1 then
    raise exception 'profiles: active identity could not update its own row';
  end if;

  -- Another user's row: invisible, so no row is updated.
  update public.profiles set full_name = 'hijacked'
  where id = 'a0000000-0000-4000-8000-000000000032';
  get diagnostics affected = row_count;
  if affected <> 0 then
    raise exception 'profiles: updated another identity row';
  end if;

  -- Self-blocking or self-suspending is not a runtime operation.
  begin
    update public.profiles set status = 'blocked'
    where id = 'a0000000-0000-4000-8000-000000000031';
    raise exception 'profiles: runtime wrote a non-active status';
  exception
    when insufficient_privilege then null;
  end;
end
$$;
rollback;

begin;
set local role app_runtime;
select set_config('app.user_id', 'a0000000-0000-4000-8000-000000000036', true);
do $$
declare
  affected int;
begin
  -- A blocked identity still reads its own row (the server needs the status).
  if (select count(*) from public.profiles) <> 1 then
    raise exception 'profiles: blocked identity lost read access to its own row';
  end if;

  -- ...but cannot write it, and above all cannot lift its own block.
  update public.profiles set status = 'active'
  where id = 'a0000000-0000-4000-8000-000000000036';
  get diagnostics affected = row_count;
  if affected <> 0 then
    raise exception 'profiles: blocked identity lifted its own block';
  end if;

  update public.profiles set full_name = 'still blocked'
  where id = 'a0000000-0000-4000-8000-000000000036';
  get diagnostics affected = row_count;
  if affected <> 0 then
    raise exception 'profiles: blocked identity updated its own row';
  end if;
end
$$;
rollback;

begin;
set local role app_runtime;
select set_config('app.user_id', 'a0000000-0000-4000-8000-000000000037', true);
do $$
begin
  -- First sign-in creates the own row as active.
  insert into public.profiles (id, full_name)
  values ('a0000000-0000-4000-8000-000000000037', 'User Without Profile');

  -- Creating someone else's profile is denied.
  begin
    insert into public.profiles (id, full_name)
    values ('a0000000-0000-4000-8000-000000000038', 'Forged');
    raise exception 'profiles: inserted a row for another identity';
  exception
    when insufficient_privilege then null;
  end;
end
$$;
rollback;

begin;
set local role app_runtime;
select set_config('app.user_id', 'a0000000-0000-4000-8000-000000000037', true);
do $$
begin
  -- A row cannot be born suspended or blocked through the runtime.
  begin
    insert into public.profiles (id, full_name, status)
    values ('a0000000-0000-4000-8000-000000000037', 'Born blocked', 'blocked');
    raise exception 'profiles: inserted a non-active status';
  exception
    when insufficient_privilege then null;
  end;
end
$$;
rollback;

-- ============================================================================
-- AC05: composite FK prevents cross-workspace reference
-- ============================================================================

begin;
do $$
begin
  begin
    insert into public.workspace_members (workspace_id, organization_id, user_id, role)
    values (
      'a0000000-0000-4000-8000-000000000021',
      'a0000000-0000-4000-8000-000000000010',
      'a0000000-0000-4000-8000-000000000031',
      'viewer'
    );
    raise exception 'AC05: mismatched workspace/organization should violate composite FK';
  exception
    when foreign_key_violation then
      null;
  end;
end
$$;
rollback;

-- ============================================================================
-- anon / authenticated have no grants (D1)
-- ============================================================================

begin;
set local role anon;
do $$
begin
  begin
    perform count(*) from public.profiles;
    raise exception 'anon can read public.profiles';
  exception
    when insufficient_privilege then null;
  end;
end
$$;
rollback;

begin;
set local role authenticated;
do $$
begin
  begin
    perform count(*) from public.workspaces;
    raise exception 'authenticated can read public.workspaces';
  exception
    when insufficient_privilege then null;
  end;
end
$$;
rollback;

-- Neither role may reach the private helper schema.
begin;
set local role authenticated;
do $$
begin
  begin
    perform private.resolve_workspace_slug('workspace-a');
    raise exception 'authenticated can execute private.resolve_workspace_slug';
  exception
    when insufficient_privilege then null;
  end;
end
$$;
rollback;

-- ============================================================================
-- platform_admin_members has no app_runtime grants
-- ============================================================================

begin;
set local role app_runtime;
do $$
begin
  begin
    perform count(*) from public.platform_admin_members;
    raise exception 'app_runtime can read platform_admin_members';
  exception
    when insufficient_privilege then null;
  end;
end
$$;
rollback;
