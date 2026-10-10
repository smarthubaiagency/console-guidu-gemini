-- ============================================================================
-- Migration: 20261018090000_f4a_api_rate_limits.sql
-- Module: F4a — Fallback counters of the API rate limit (plano F4,
--         decisão 1; Especificação §15 e §17.5)
--
-- Maintenance Rationale:
-- 1. The API counts requests per API key, user and workspace in Redis.
--    When Redis is unavailable the same fixed one-minute windows are
--    counted here, so the API is never left without a limit.
-- 2. `public.api_rate_counters` is reached only through
--    `private.hit_rate_limit(bucket, window)`, a security definer function
--    owned by app_rls_helper that increments atomically and returns the
--    count. app_runtime has no grant on the table itself: it cannot read
--    other buckets or reset a counter.
-- 3. Buckets are `key:<uuid>`, `user:<uuid>` or `workspace:<uuid>`; nothing
--    else is accepted. Old windows are removed by the worker (privacy
--    maintenance) after one day.
-- Owner app_migrations, ENABLE + FORCE RLS, no grants to anon/authenticated.
-- ============================================================================

create table public.api_rate_counters (
  bucket       text not null
                 check (bucket ~ '^(key|user|workspace):[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'),
  window_start timestamptz not null,
  hits         integer not null default 0 check (hits >= 0),
  primary key (bucket, window_start)
);

create index api_rate_counters_window_idx on public.api_rate_counters (window_start);

alter table public.api_rate_counters owner to app_migrations;
revoke all on public.api_rate_counters from public, anon, authenticated;
alter table public.api_rate_counters enable row level security;
alter table public.api_rate_counters force row level security;

create policy api_rate_counters_helper_select on public.api_rate_counters
  for select to app_rls_helper
  using (true);

create policy api_rate_counters_helper_insert on public.api_rate_counters
  for insert to app_rls_helper
  with check (window_start > now() - interval '5 minutes' and window_start <= now() + interval '1 minute');

create policy api_rate_counters_helper_update on public.api_rate_counters
  for update to app_rls_helper
  using (window_start > now() - interval '5 minutes')
  with check (window_start > now() - interval '5 minutes');

grant select, insert, update on public.api_rate_counters to app_rls_helper;

-- Cleanup by the worker: windows older than a day only.
create policy api_rate_counters_worker_select on public.api_rate_counters
  for select to app_worker
  using (window_start < now() - interval '1 day');

create policy api_rate_counters_worker_delete on public.api_rate_counters
  for delete to app_worker
  using (window_start < now() - interval '1 day');

grant select (window_start), delete on public.api_rate_counters to app_worker;

set local role app_rls_helper;

-- Counts one request in the bucket's current one-minute window and returns
-- the total of that window.
create function private.hit_rate_limit(p_bucket text)
returns integer
language sql
volatile
security definer
set search_path = ''
as $$
  insert into public.api_rate_counters as c (bucket, window_start, hits)
  values (p_bucket, date_trunc('minute', now()), 1)
  on conflict (bucket, window_start) do update set hits = c.hits + 1
  returning c.hits;
$$;

revoke execute on function private.hit_rate_limit(text) from public, anon, authenticated;
grant execute on function private.hit_rate_limit(text) to app_runtime;

reset role;
