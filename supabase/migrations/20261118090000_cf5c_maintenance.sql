-- ============================================================================
-- Migration: 20261118090000_cf5c_maintenance.sql
-- Module: CF5c — Operações › Manutenção: maintenance and read-only windows
--         (/mnt/project-files/configuracoes/plano-cf5.md, levantamento item 15)
--
-- Maintenance Rationale:
-- 1. One window at a time for the whole platform: `public.platform_maintenance`
--    is a single row (`id` is always true). `enabled` turns the window on;
--    `mode` is `maintenance` (/app and /admin closed, the API answers 503) or
--    `read_only` (reads go on, writes are refused). `starts_at` and `ends_at`
--    schedule it; a null end lasts until someone turns it off. The message
--    to the users comes in the three languages of the dashboard, each one
--    optional (the default text stands in).
-- 2. The platform owner and operations write it (the roles of
--    `platform.settings.manage`); support also reads it in Operações. Turning
--    off is an update (`enabled = false`), so the row never goes away.
-- 3. Every request asks `private.maintenance_state()` (behind a short cache
--    in each process): security definer, no context needed, it returns the
--    row only while a window is on and not over, never who changed it. The
--    worker asks it too, to hold the jobs during the window.
-- Owner app_migrations, ENABLE + FORCE RLS, no grants to anon/authenticated.
-- Functions owned by app_rls_helper get their grants before the ownership
-- transfer (app_migrations is NOINHERIT).
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Table: public.platform_maintenance (a single row)
-- ----------------------------------------------------------------------------
create table public.platform_maintenance (
  id            boolean primary key default true check (id),
  enabled       boolean not null default false,
  mode          text not null default 'maintenance'
                  check (mode in ('maintenance', 'read_only')),
  starts_at     timestamptz,
  ends_at       timestamptz,
  message_pt_br text check (char_length(btrim(message_pt_br)) between 1 and 500),
  message_en    text check (char_length(btrim(message_en)) between 1 and 500),
  message_es    text check (char_length(btrim(message_es)) between 1 and 500),
  updated_by    uuid references public.profiles(id) on delete set null,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  constraint platform_maintenance_window_check
    check (ends_at is null or starts_at is null or ends_at > starts_at)
);

alter table public.platform_maintenance owner to app_migrations;
revoke all on public.platform_maintenance from public, anon, authenticated;
alter table public.platform_maintenance enable row level security;
alter table public.platform_maintenance force row level security;

create trigger platform_maintenance_touch_updated_at
  before update on public.platform_maintenance
  for each row execute function private.touch_updated_at();

-- Operações readers see the window; owner and operations change it.
create policy platform_maintenance_select on public.platform_maintenance
  for select to app_runtime
  using (private.current_platform_admin_role() in ('owner', 'operations', 'support'));

create policy platform_maintenance_insert on public.platform_maintenance
  for insert to app_runtime
  with check (
    updated_by = private.context_uuid('app.user_id')
    and private.current_platform_admin_role() in ('owner', 'operations')
  );

create policy platform_maintenance_update on public.platform_maintenance
  for update to app_runtime
  using (private.current_platform_admin_role() in ('owner', 'operations'))
  with check (
    updated_by = private.context_uuid('app.user_id')
    and private.current_platform_admin_role() in ('owner', 'operations')
  );

grant select, insert on public.platform_maintenance to app_runtime;
grant update (enabled, mode, starts_at, ends_at, message_pt_br, message_en,
              message_es, updated_by, updated_at)
  on public.platform_maintenance to app_runtime;

-- ----------------------------------------------------------------------------
-- 2. The state every request and the worker read
-- ----------------------------------------------------------------------------
create policy platform_maintenance_helper_select on public.platform_maintenance
  for select to app_rls_helper
  using (true);

grant select on public.platform_maintenance to app_rls_helper;

create function private.maintenance_state()
returns table(
  mode text,
  starts_at timestamptz,
  ends_at timestamptz,
  message_pt_br text,
  message_en text,
  message_es text,
  updated_at timestamptz
)
language sql
stable
security definer
set search_path = ''
as $$
  select m.mode, m.starts_at, m.ends_at, m.message_pt_br, m.message_en,
         m.message_es, m.updated_at
  from public.platform_maintenance m
  where m.enabled
    and (m.ends_at is null or m.ends_at > now());
$$;

revoke execute on function private.maintenance_state() from public, anon, authenticated;
grant execute on function private.maintenance_state() to app_runtime, app_worker;
alter function private.maintenance_state() owner to app_rls_helper;
