-- ============================================================================
-- Migration: 20261011090000_p4b_partner_customers.sql
-- Module: P4b (1/2) — Customers created by the partner, workspace templates
--         and the partner's module catalog (ADR 0012, plano P4)
--
-- Maintenance Rationale:
-- 1. A partner_owner or partner_admin of the context partner registers a
--    customer: organization, first workspace, enabled modules and the
--    invitation of the responsible person (owner). Everything is written in
--    the partner context; the partner still gains no read access to the
--    workspace or its data (no select policy is added on workspaces).
-- 2. `private.is_partner_organization(org)`: true when the organization
--    belongs to the context partner. Security definer owned by
--    app_rls_helper, reading organizations only through the helper policy
--    scoped to the context partner.
-- 3. `public.partner_offered_modules`: modules the partner offers to its
--    customers. `public.partner_workspace_templates`: named sets of offered
--    modules applied to the first workspace of a new customer.
-- Owner app_migrations, ENABLE + FORCE RLS, no grants to anon/authenticated.
-- Function grants come before the ownership transfer (app_migrations is
-- NOINHERIT).
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Helpers
-- ----------------------------------------------------------------------------
create policy organizations_partner_helper_select on public.organizations
  for select to app_rls_helper
  using (partner_id = private.current_partner_id());

create function private.is_partner_organization(p_organization_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.organizations organization
    where organization.id = p_organization_id
      and organization.partner_id = private.current_partner_id()
  );
$$;

revoke execute on function private.is_partner_organization(uuid) from public, anon, authenticated;
grant execute on function private.is_partner_organization(uuid) to app_runtime;
alter function private.is_partner_organization(uuid) owner to app_rls_helper;

-- partner_owner or partner_admin of the context partner (P4b permission
-- partner.customers.manage). Invoker: composes the existing helpers.
create function private.can_manage_partner_customers()
returns boolean
language sql
stable
security invoker
set search_path = ''
as $$
  select coalesce(private.current_partner_role() in ('partner_owner', 'partner_admin'), false);
$$;

alter function private.can_manage_partner_customers() owner to app_migrations;
revoke execute on function private.can_manage_partner_customers() from public, anon, authenticated;
grant execute on function private.can_manage_partner_customers() to app_runtime;

-- ----------------------------------------------------------------------------
-- 2. Customer registration (insert only; no new read access)
-- ----------------------------------------------------------------------------
create policy organizations_partner_insert on public.organizations
  for insert to app_runtime
  with check (
    partner_id = private.current_partner_id()
    and status = 'active'
    and private.can_manage_partner_customers()
  );

create policy workspaces_partner_insert on public.workspaces
  for insert to app_runtime
  with check (
    status = 'active'
    and private.is_partner_organization(organization_id)
    and private.can_manage_partner_customers()
  );

create policy invitations_partner_insert on public.invitations
  for insert to app_runtime
  with check (
    status = 'pending'
    and invited_by_user_id = private.context_uuid('app.user_id')
    and private.is_partner_organization(organization_id)
    and private.can_manage_partner_customers()
  );

create policy workspace_modules_partner_insert on public.workspace_modules
  for insert to app_runtime
  with check (
    updated_by = private.context_uuid('app.user_id')
    and private.is_partner_organization(organization_id)
    and private.can_manage_partner_customers()
  );

grant insert on public.organizations to app_runtime;
grant insert on public.workspaces to app_runtime;

-- ----------------------------------------------------------------------------
-- 3. Module catalog of the partner
-- ----------------------------------------------------------------------------
create table public.partner_offered_modules (
  partner_id uuid not null references public.partners(id) on delete cascade,
  module_key text not null
               check (module_key ~ '^[a-z][a-z0-9]*(-[a-z0-9]+)*$' and length(module_key) <= 48),
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  primary key (partner_id, module_key)
);

alter table public.partner_offered_modules owner to app_migrations;
revoke all on public.partner_offered_modules from public, anon, authenticated;
alter table public.partner_offered_modules enable row level security;
alter table public.partner_offered_modules force row level security;

create policy partner_offered_modules_select on public.partner_offered_modules
  for select to app_runtime
  using (
    partner_id = private.current_partner_id()
    and private.current_partner_role() is not null
  );

create policy partner_offered_modules_insert on public.partner_offered_modules
  for insert to app_runtime
  with check (
    partner_id = private.current_partner_id()
    and created_by = private.context_uuid('app.user_id')
    and private.can_manage_partner_customers()
  );

create policy partner_offered_modules_delete on public.partner_offered_modules
  for delete to app_runtime
  using (
    partner_id = private.current_partner_id()
    and private.can_manage_partner_customers()
  );

grant select, insert, delete on public.partner_offered_modules to app_runtime;

-- ----------------------------------------------------------------------------
-- 4. Workspace templates of the partner
-- ----------------------------------------------------------------------------
create table public.partner_workspace_templates (
  id          uuid primary key default gen_random_uuid(),
  partner_id  uuid not null references public.partners(id) on delete cascade,
  name        text not null check (length(trim(name)) > 0 and length(name) <= 80),
  module_keys text[] not null default '{}'
                check (cardinality(module_keys) <= 32),
  created_by  uuid references public.profiles(id) on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (partner_id, name)
);

alter table public.partner_workspace_templates owner to app_migrations;
revoke all on public.partner_workspace_templates from public, anon, authenticated;
alter table public.partner_workspace_templates enable row level security;
alter table public.partner_workspace_templates force row level security;

create trigger partner_workspace_templates_touch_updated_at
  before update on public.partner_workspace_templates
  for each row execute function private.touch_updated_at();

create policy partner_workspace_templates_select on public.partner_workspace_templates
  for select to app_runtime
  using (
    partner_id = private.current_partner_id()
    and private.current_partner_role() is not null
  );

create policy partner_workspace_templates_insert on public.partner_workspace_templates
  for insert to app_runtime
  with check (
    partner_id = private.current_partner_id()
    and created_by = private.context_uuid('app.user_id')
    and private.can_manage_partner_customers()
  );

create policy partner_workspace_templates_update on public.partner_workspace_templates
  for update to app_runtime
  using (
    partner_id = private.current_partner_id()
    and private.can_manage_partner_customers()
  )
  with check (
    partner_id = private.current_partner_id()
    and private.can_manage_partner_customers()
  );

create policy partner_workspace_templates_delete on public.partner_workspace_templates
  for delete to app_runtime
  using (
    partner_id = private.current_partner_id()
    and private.can_manage_partner_customers()
  );

grant select, insert, update, delete on public.partner_workspace_templates to app_runtime;
