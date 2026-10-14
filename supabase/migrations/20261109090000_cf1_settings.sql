-- ============================================================================
-- Migration: 20261109090000_cf1_settings.sql
-- Module: CF1 — settings of the three levels with inheritance
--         (/mnt/project-files/configuracoes/levantamento.md, menus-admin-app.md)
--
-- Maintenance Rationale:
-- 1. Marcelo (14/10/2026): the settings are defined top-down, so that every
--    limit has a field. One table holds the values of the three levels:
--    the platform sets the default (and may lock it), the partner adjusts it
--    for its customers, the workspace adjusts it for itself. What each key
--    means, where it may be set and its default live in the code catalog
--    (`src/core/settings/catalog.ts`); a row only overrides.
-- 2. A key may never hold a secret: secrets stay in their encrypted tables
--    (credentials, partner_credentials, webhooks). The values of the upper
--    levels are therefore readable by whoever reads the cascade.
-- 3. Writes go through the table with the level's managers: platform owner
--    and operations, partner owner and admin, workspace owner and admin.
--    `locked` on a platform or partner row stops the levels below; the
--    reader honours it, so a row written below a lock has no effect.
-- 4. `private.settings_cascade()` returns the rows of the platform, of the
--    partner of the context (the /admin partner or the workspace's partner)
--    and of the workspace of the context, for every request that needs the
--    effective values.
-- 5. Purge of a deleted workspace (F3e) as the worker.
-- Owner app_migrations, ENABLE + FORCE RLS, no grants to anon/authenticated.
-- ============================================================================

create table public.settings (
  id               uuid primary key default gen_random_uuid(),
  scope            text not null check (scope in ('platform', 'partner', 'workspace')),
  partner_id       uuid references public.partners(id) on delete cascade,
  organization_id  uuid,
  workspace_id     uuid,
  key              text not null
                     check (key ~ '^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$' and length(key) <= 80),
  value            jsonb not null check (octet_length(value::text) <= 8192),
  locked           boolean not null default false,
  updated_by       uuid not null references public.profiles(id) on delete cascade,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  constraint settings_level_check check (
    (scope = 'platform' and partner_id is null and organization_id is null and workspace_id is null)
    or (scope = 'partner' and partner_id is not null and organization_id is null and workspace_id is null)
    or (scope = 'workspace' and partner_id is null and organization_id is not null
        and workspace_id is not null and not locked)
  ),
  constraint fk_settings_workspace
    foreign key (workspace_id, organization_id)
    references public.workspaces(id, organization_id) on delete cascade
);

create unique index settings_platform_key on public.settings (key) where scope = 'platform';
create unique index settings_partner_key on public.settings (partner_id, key) where scope = 'partner';
create unique index settings_workspace_key on public.settings (workspace_id, key) where scope = 'workspace';

alter table public.settings owner to app_migrations;
revoke all on public.settings from public, anon, authenticated;
alter table public.settings enable row level security;
alter table public.settings force row level security;

create trigger settings_touch_updated_at
  before update on public.settings
  for each row execute function private.touch_updated_at();

-- ----------------------------------------------------------------------------
-- 1. Managers of each level
-- ----------------------------------------------------------------------------
create policy settings_select on public.settings
  for select to app_runtime
  using (
    (scope = 'platform' and private.current_platform_admin_role() is not null)
    or (scope = 'partner'
        and partner_id = private.current_partner_id()
        and private.current_partner_role() is not null)
    or (scope = 'workspace'
        and workspace_id = private.context_uuid('app.workspace_id')
        and organization_id = private.context_uuid('app.organization_id')
        and private.current_workspace_role() is not null)
  );

create policy settings_insert on public.settings
  for insert to app_runtime
  with check (
    updated_by = private.context_uuid('app.user_id')
    and (
      (scope = 'platform' and private.current_platform_admin_role() in ('owner', 'operations'))
      or (scope = 'partner'
          and partner_id = private.current_partner_id()
          and private.current_partner_role() in ('partner_owner', 'partner_admin'))
      or (scope = 'workspace'
          and workspace_id = private.context_uuid('app.workspace_id')
          and organization_id = private.context_uuid('app.organization_id')
          and private.current_workspace_role() in ('owner', 'admin'))
    )
  );

create policy settings_update on public.settings
  for update to app_runtime
  using (
    (scope = 'platform' and private.current_platform_admin_role() in ('owner', 'operations'))
    or (scope = 'partner'
        and partner_id = private.current_partner_id()
        and private.current_partner_role() in ('partner_owner', 'partner_admin'))
    or (scope = 'workspace'
        and workspace_id = private.context_uuid('app.workspace_id')
        and organization_id = private.context_uuid('app.organization_id')
        and private.current_workspace_role() in ('owner', 'admin'))
  )
  with check (
    updated_by = private.context_uuid('app.user_id')
  );

create policy settings_delete on public.settings
  for delete to app_runtime
  using (
    (scope = 'platform' and private.current_platform_admin_role() in ('owner', 'operations'))
    or (scope = 'partner'
        and partner_id = private.current_partner_id()
        and private.current_partner_role() in ('partner_owner', 'partner_admin'))
    or (scope = 'workspace'
        and workspace_id = private.context_uuid('app.workspace_id')
        and organization_id = private.context_uuid('app.organization_id')
        and private.current_workspace_role() in ('owner', 'admin'))
  );

-- Scope and owner never change: a value moves level by delete and insert.
grant select, insert, delete on public.settings to app_runtime;
grant update (value, locked, updated_by, updated_at) on public.settings to app_runtime;

-- ----------------------------------------------------------------------------
-- 2. The cascade of the context
-- ----------------------------------------------------------------------------
create policy settings_helper_select on public.settings
  for select to app_rls_helper
  using (
    scope = 'platform'
    or (scope = 'partner' and partner_id = private.ai_turn_partner_id())
    or (scope = 'workspace'
        and workspace_id = private.context_uuid('app.workspace_id')
        and organization_id = private.context_uuid('app.organization_id')
        and private.current_workspace_role() is not null)
  );

grant select on public.settings to app_rls_helper;

create function private.settings_cascade()
returns table(scope text, key text, value jsonb, locked boolean)
language sql
stable
security definer
set search_path = ''
as $$
  select s.scope, s.key, s.value, s.locked
  from public.settings s
  where s.scope = 'platform'
    or (s.scope = 'partner' and s.partner_id = private.ai_turn_partner_id())
    or (s.scope = 'workspace'
        and s.workspace_id = private.context_uuid('app.workspace_id')
        and s.organization_id = private.context_uuid('app.organization_id')
        and private.current_workspace_role() is not null);
$$;

revoke execute on function private.settings_cascade() from public, anon, authenticated;
grant execute on function private.settings_cascade() to app_runtime;
alter function private.settings_cascade() owner to app_rls_helper;

-- ----------------------------------------------------------------------------
-- 3. Purge of a deleted workspace (F3e)
-- ----------------------------------------------------------------------------
create policy settings_worker_purge on public.settings
  for delete to app_worker
  using (scope = 'workspace' and private.workspace_purgeable(workspace_id));
create policy settings_worker_purge_select on public.settings
  for select to app_worker
  using (scope = 'workspace' and private.workspace_purgeable(workspace_id));
grant select (scope, workspace_id), delete on public.settings to app_worker;
