-- ============================================================================
-- Migration: 20261016090000_f3d_operations.sql
-- Module: F3d — Observability: worker heartbeats and queue metrics
--         (plano F3, etapa F3d; ADR 0002)
--
-- Maintenance Rationale:
-- 1. `public.worker_heartbeats`: one row per worker instance, refreshed by
--    the worker while it runs; the operations page tells a live worker from
--    one that stopped or lost the database.
-- 2. `public.queue_metrics`: snapshots per job kind published by the worker
--    (job_runs counts, oldest pending age, durations of the last 24 hours and
--    the pg-boss queue counts, which the web runtime cannot read). Kept for
--    7 days; the worker deletes older rows.
-- 3. Only the platform reads them: internal roles owner, operations and
--    support (`platform.operations.read`). Partners and customers never do.
-- 4. app_worker writes both through its own policies; app_runtime only reads.
-- Owner app_migrations, ENABLE + FORCE RLS, no grants to anon/authenticated.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 0. Helper: internal roles that read operations
-- ----------------------------------------------------------------------------
create function private.can_read_platform_operations()
returns boolean
language sql
stable
security invoker
set search_path = ''
as $$
  select coalesce(private.current_platform_admin_role() in ('owner', 'operations', 'support'), false);
$$;

alter function private.can_read_platform_operations() owner to app_migrations;
revoke execute on function private.can_read_platform_operations() from public, anon, authenticated;
grant execute on function private.can_read_platform_operations() to app_runtime;

-- ----------------------------------------------------------------------------
-- 1. Worker heartbeats
-- ----------------------------------------------------------------------------
create table public.worker_heartbeats (
  instance_name text primary key check (instance_name ~ '^[a-zA-Z0-9][a-zA-Z0-9._-]{0,62}$'),
  started_at    timestamptz not null,
  last_seen_at  timestamptz not null default now(),
  status        text not null default 'running' check (status in ('running', 'stopped')),
  concurrency   integer not null check (concurrency between 1 and 64),
  queues        integer not null check (queues between 0 and 500),
  version       text check (version is null or length(version) <= 64)
);

alter table public.worker_heartbeats owner to app_migrations;
revoke all on public.worker_heartbeats from public, anon, authenticated;
alter table public.worker_heartbeats enable row level security;
alter table public.worker_heartbeats force row level security;

create policy worker_heartbeats_platform_select on public.worker_heartbeats
  for select to app_runtime
  using (private.can_read_platform_operations());

create policy worker_heartbeats_worker_select on public.worker_heartbeats
  for select to app_worker
  using (true);

create policy worker_heartbeats_worker_insert on public.worker_heartbeats
  for insert to app_worker
  with check (true);

create policy worker_heartbeats_worker_update on public.worker_heartbeats
  for update to app_worker
  using (true)
  with check (true);

grant select on public.worker_heartbeats to app_runtime;
grant select, insert, update on public.worker_heartbeats to app_worker;

-- ----------------------------------------------------------------------------
-- 2. Queue metrics
-- ----------------------------------------------------------------------------
create table public.queue_metrics (
  id                     bigint generated always as identity primary key,
  captured_at            timestamptz not null default now(),
  instance_name          text not null check (length(instance_name) between 1 and 63),
  kind                   text not null
                           check (kind ~ '^[a-z][a-z0-9]*(-[a-z0-9]+)*(\.[a-z][a-z0-9]*(-[a-z0-9]+)*)+$'
                                  and length(kind) <= 96),
  pending                integer not null check (pending >= 0),
  queued                 integer not null check (queued >= 0),
  running                integer not null check (running >= 0),
  succeeded_24h          integer not null check (succeeded_24h >= 0),
  failed_24h             integer not null check (failed_24h >= 0),
  skipped_24h            integer not null check (skipped_24h >= 0),
  oldest_pending_seconds integer check (oldest_pending_seconds is null or oldest_pending_seconds >= 0),
  avg_duration_ms_24h    integer check (avg_duration_ms_24h is null or avg_duration_ms_24h >= 0),
  p95_duration_ms_24h    integer check (p95_duration_ms_24h is null or p95_duration_ms_24h >= 0),
  boss_waiting           integer not null check (boss_waiting >= 0),
  boss_active            integer not null check (boss_active >= 0)
);

create index queue_metrics_captured_idx on public.queue_metrics (captured_at desc);
create index queue_metrics_kind_idx on public.queue_metrics (kind, captured_at desc);

alter table public.queue_metrics owner to app_migrations;
revoke all on public.queue_metrics from public, anon, authenticated;
alter table public.queue_metrics enable row level security;
alter table public.queue_metrics force row level security;

create policy queue_metrics_platform_select on public.queue_metrics
  for select to app_runtime
  using (private.can_read_platform_operations());

create policy queue_metrics_worker_select on public.queue_metrics
  for select to app_worker
  using (true);

create policy queue_metrics_worker_insert on public.queue_metrics
  for insert to app_worker
  with check (captured_at >= now() - interval '5 minutes');

-- Retention: the worker removes only snapshots older than 7 days.
create policy queue_metrics_worker_delete on public.queue_metrics
  for delete to app_worker
  using (captured_at < now() - interval '7 days');

grant select on public.queue_metrics to app_runtime;
grant select, insert, delete on public.queue_metrics to app_worker;
