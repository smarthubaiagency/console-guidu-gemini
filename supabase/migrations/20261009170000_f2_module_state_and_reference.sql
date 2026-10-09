-- ============================================================================
-- Migration: 20261009170000_f2_module_state_and_reference.sql
-- Module: F2 — Module state (ADRs 0005 e 0006) and reference module (Adendo §9)
--
-- Maintenance Rationale:
-- 1. `public.platform_modules`: global module availability (enabled,
--    maintenance, disabled) and global configuration, written only by active
--    platform admins with the owner or operations role. A missing row means
--    "enabled" with an empty configuration.
-- 2. `public.workspace_modules`: per-workspace enablement and configuration
--    (Especificação §6). Writes are restricted to workspace owner/admin, the
--    same roles the service guard grants `workspace.modules.manage`. Company
--    roles grant nothing here: enterprise inheritance is still an open
--    decision (docs/pendencias.md).
-- 3. `public.hello_world_records`: demonstration table of the reference
--    module. It ships in every environment because the migration history is
--    central, but it receives no seed data and the module is gated off unless
--    GUIDU_MODULE_HELLO_WORLD_ENABLED="true" (development and tests only).
-- 4. `private.current_platform_admin_role()`: security definer helper that
--    returns the active internal role of app.user_id, owned by app_rls_helper.
-- All tables: owner app_migrations, ENABLE + FORCE RLS, no grants to anon or
-- authenticated, composite (workspace_id, organization_id) foreign keys.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Helper: active platform admin role of the context user
-- ----------------------------------------------------------------------------
create or replace function private.current_platform_admin_role()
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select pam.role
  from public.platform_admin_members pam
  where pam.user_id = private.context_uuid('app.user_id')
    and pam.status = 'active';
$$;

alter function private.current_platform_admin_role() owner to app_rls_helper;
revoke execute on function private.current_platform_admin_role() from public, anon, authenticated;
grant execute on function private.current_platform_admin_role() to app_runtime;

-- ----------------------------------------------------------------------------
-- 2. Table: public.platform_modules (global state, ADR 0005 admin side)
-- ----------------------------------------------------------------------------
create table public.platform_modules (
  module_key   text primary key
                 check (module_key ~ '^[a-z][a-z0-9]*(-[a-z0-9]+)*$' and length(module_key) <= 48),
  availability text not null default 'enabled'
                 check (availability in ('enabled', 'maintenance', 'disabled')),
  config       jsonb not null default '{}'::jsonb
                 check (jsonb_typeof(config) = 'object'),
  updated_by   uuid references public.profiles(id) on delete set null,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

alter table public.platform_modules owner to app_migrations;

create trigger platform_modules_touch_updated_at
  before update on public.platform_modules
  for each row execute function private.touch_updated_at();

alter table public.platform_modules enable row level security;
alter table public.platform_modules force row level security;

-- Any authenticated context may read global module state (non-sensitive
-- metadata needed to resolve availability); no context, no rows.
create policy platform_modules_select on public.platform_modules
  for select to app_runtime
  using (private.context_uuid('app.user_id') is not null);

create policy platform_modules_insert on public.platform_modules
  for insert to app_runtime
  with check (
    private.current_platform_admin_role() in ('owner', 'operations')
    and updated_by = private.context_uuid('app.user_id')
  );

create policy platform_modules_update on public.platform_modules
  for update to app_runtime
  using (private.current_platform_admin_role() in ('owner', 'operations'))
  with check (
    private.current_platform_admin_role() in ('owner', 'operations')
    and updated_by = private.context_uuid('app.user_id')
  );

revoke all on public.platform_modules from public, anon, authenticated;
grant select, insert, update on public.platform_modules to app_runtime;

-- ----------------------------------------------------------------------------
-- 3. Table: public.workspace_modules (per-workspace enablement, ADR 0005 app side)
-- ----------------------------------------------------------------------------
create table public.workspace_modules (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  workspace_id    uuid not null,
  module_key      text not null
                    check (module_key ~ '^[a-z][a-z0-9]*(-[a-z0-9]+)*$' and length(module_key) <= 48),
  status          text not null default 'disabled'
                    check (status in ('enabled', 'disabled')),
  config          jsonb not null default '{}'::jsonb
                    check (jsonb_typeof(config) = 'object'),
  updated_by      uuid references public.profiles(id) on delete set null,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  constraint fk_workspace_modules_workspace
    foreign key (workspace_id, organization_id)
    references public.workspaces(id, organization_id) on delete cascade,
  constraint uq_workspace_modules_key unique (workspace_id, module_key)
);

alter table public.workspace_modules owner to app_migrations;

create index idx_workspace_modules_workspace
  on public.workspace_modules (workspace_id, organization_id);

create trigger workspace_modules_touch_updated_at
  before update on public.workspace_modules
  for each row execute function private.touch_updated_at();

alter table public.workspace_modules enable row level security;
alter table public.workspace_modules force row level security;

create policy workspace_modules_select on public.workspace_modules
  for select to app_runtime
  using (
    workspace_id = private.context_uuid('app.workspace_id')
    and organization_id = private.context_uuid('app.organization_id')
    and private.is_workspace_member(workspace_id, organization_id)
  );

create policy workspace_modules_insert on public.workspace_modules
  for insert to app_runtime
  with check (
    workspace_id = private.context_uuid('app.workspace_id')
    and organization_id = private.context_uuid('app.organization_id')
    and updated_by = private.context_uuid('app.user_id')
    and private.current_workspace_role() in ('owner', 'admin')
  );

create policy workspace_modules_update on public.workspace_modules
  for update to app_runtime
  using (
    workspace_id = private.context_uuid('app.workspace_id')
    and organization_id = private.context_uuid('app.organization_id')
    and private.current_workspace_role() in ('owner', 'admin')
  )
  with check (
    workspace_id = private.context_uuid('app.workspace_id')
    and organization_id = private.context_uuid('app.organization_id')
    and updated_by = private.context_uuid('app.user_id')
    and private.current_workspace_role() in ('owner', 'admin')
  );

revoke all on public.workspace_modules from public, anon, authenticated;
grant select, insert, update on public.workspace_modules to app_runtime;

-- ----------------------------------------------------------------------------
-- 4. Table: public.hello_world_records (reference module demonstration data)
-- ----------------------------------------------------------------------------
create table public.hello_world_records (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  workspace_id    uuid not null,
  title           text not null check (length(btrim(title)) between 1 and 120),
  created_by      uuid not null references public.profiles(id) on delete cascade,
  created_at      timestamptz not null default now(),
  constraint fk_hello_world_records_workspace
    foreign key (workspace_id, organization_id)
    references public.workspaces(id, organization_id) on delete cascade
);

alter table public.hello_world_records owner to app_migrations;

create index idx_hello_world_records_workspace
  on public.hello_world_records (workspace_id, organization_id, created_at desc);

alter table public.hello_world_records enable row level security;
alter table public.hello_world_records force row level security;

create policy hello_world_records_select on public.hello_world_records
  for select to app_runtime
  using (
    workspace_id = private.context_uuid('app.workspace_id')
    and organization_id = private.context_uuid('app.organization_id')
    and private.is_workspace_member(workspace_id, organization_id)
  );

create policy hello_world_records_insert on public.hello_world_records
  for insert to app_runtime
  with check (
    workspace_id = private.context_uuid('app.workspace_id')
    and organization_id = private.context_uuid('app.organization_id')
    and created_by = private.context_uuid('app.user_id')
    and private.current_workspace_role() in ('owner', 'admin', 'editor')
  );

revoke all on public.hello_world_records from public, anon, authenticated;
grant select, insert on public.hello_world_records to app_runtime;
