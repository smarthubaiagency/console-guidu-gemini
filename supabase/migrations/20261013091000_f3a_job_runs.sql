-- ============================================================================
-- Migration: 20261013091000_f3a_job_runs.sql
-- Module: F3a — Job runs: transactional outbox and executions projection
--         (ADR 0002, plano F3, decision 2)
--
-- Maintenance Rationale:
-- 1. `public.job_runs` is written by the web runtime in the same transaction
--    as the action that asks for the job (status `pending`), so an action
--    that rolls back leaves no job behind. app_runtime never touches the
--    queue schema: the worker (app_worker) dispatches pending rows to
--    pg-boss using the row id as the job id, and keeps the row's state in
--    step, so the Executions page reads only this RLS-protected table.
-- 2. Members of the workspace read its runs; platform admins read all. A
--    workspace owner/admin may put a failed run back to `pending` (retry);
--    a trigger restricts that update to the retry columns.
-- 3. app_worker reads, inserts (scheduled and follow-up jobs) and updates
--    runs through its own explicit policies; it has no other table grants.
-- 4. The payload carries references and small inputs only, never tokens or
--    secrets (§21); its size is bounded.
-- Owner app_migrations, ENABLE + FORCE RLS, no grants to anon/authenticated.
-- ============================================================================

create table public.job_runs (
  id              uuid primary key default gen_random_uuid(),
  kind            text not null
                    check (kind ~ '^[a-z][a-z0-9]*(-[a-z0-9]+)*(\.[a-z][a-z0-9]*(-[a-z0-9]+)*)+$'
                           and length(kind) <= 96),
  scope           text not null default 'workspace' check (scope in ('workspace', 'platform')),
  partner_id      uuid references public.partners(id) on delete cascade,
  organization_id uuid,
  workspace_id    uuid,
  requested_by    uuid references public.profiles(id) on delete set null,
  payload         jsonb not null default '{}'::jsonb check (pg_column_size(payload) <= 8192),
  idempotency_key text not null check (length(idempotency_key) between 1 and 200),
  status          text not null default 'pending'
                    check (status in ('pending', 'queued', 'running', 'succeeded', 'failed', 'skipped', 'canceled')),
  attempts        integer not null default 0 check (attempts >= 0),
  max_attempts    integer not null default 3 check (max_attempts between 1 and 20),
  run_after       timestamptz not null default now(),
  last_error      text check (last_error is null or length(last_error) <= 500),
  result          jsonb check (result is null or pg_column_size(result) <= 4096),
  created_at      timestamptz not null default now(),
  dispatched_at   timestamptz,
  started_at      timestamptz,
  finished_at     timestamptz,
  updated_at      timestamptz not null default now(),
  unique (kind, idempotency_key),
  foreign key (workspace_id, organization_id)
    references public.workspaces(id, organization_id) on delete cascade,
  check (
    (scope = 'workspace' and workspace_id is not null and organization_id is not null)
    or (scope = 'platform' and workspace_id is null and organization_id is null)
  )
);

create index job_runs_pending_idx on public.job_runs (run_after) where status = 'pending';
create index job_runs_workspace_idx on public.job_runs (workspace_id, created_at desc);
create index job_runs_status_idx on public.job_runs (status, updated_at desc);

alter table public.job_runs owner to app_migrations;
revoke all on public.job_runs from public, anon, authenticated;
alter table public.job_runs enable row level security;
alter table public.job_runs force row level security;

create trigger job_runs_touch_updated_at
  before update on public.job_runs
  for each row execute function private.touch_updated_at();

-- ----------------------------------------------------------------------------
-- Web runtime (app_runtime)
-- ----------------------------------------------------------------------------
create policy job_runs_member_select on public.job_runs
  for select to app_runtime
  using (
    private.current_platform_admin_role() is not null
    or (
      workspace_id = private.context_uuid('app.workspace_id')
      and private.is_workspace_member(workspace_id, organization_id)
    )
  );

-- Enqueue: always pending, for the context workspace, by its member.
create policy job_runs_member_insert on public.job_runs
  for insert to app_runtime
  with check (
    scope = 'workspace'
    and status = 'pending'
    and attempts = 0
    and requested_by = private.context_uuid('app.user_id')
    and workspace_id = private.context_uuid('app.workspace_id')
    and organization_id = private.context_uuid('app.organization_id')
    and private.is_workspace_member(workspace_id, organization_id)
  );

-- Retry: a failed run goes back to pending, by a workspace owner/admin.
create policy job_runs_member_retry on public.job_runs
  for update to app_runtime
  using (
    status = 'failed'
    and workspace_id = private.context_uuid('app.workspace_id')
    and organization_id = private.context_uuid('app.organization_id')
    and private.current_workspace_role() in ('owner', 'admin')
  )
  with check (
    status = 'pending'
    and workspace_id = private.context_uuid('app.workspace_id')
    and organization_id = private.context_uuid('app.organization_id')
    and private.current_workspace_role() in ('owner', 'admin')
  );

grant select, insert, update on public.job_runs to app_runtime;

-- Through the retry policy only the retry columns change.
create function private.job_runs_guard_runtime_update()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if current_user <> 'app_runtime' then
    return new;
  end if;
  if new.id is distinct from old.id
     or new.kind is distinct from old.kind
     or new.scope is distinct from old.scope
     or new.partner_id is distinct from old.partner_id
     or new.organization_id is distinct from old.organization_id
     or new.workspace_id is distinct from old.workspace_id
     or new.requested_by is distinct from old.requested_by
     or new.payload is distinct from old.payload
     or new.idempotency_key is distinct from old.idempotency_key
     or new.max_attempts is distinct from old.max_attempts
     or new.created_at is distinct from old.created_at
     or new.result is distinct from old.result
     or new.attempts <> 0 then
    raise exception 'job runs: only a retry may change a run from the web runtime'
      using errcode = 'insufficient_privilege';
  end if;
  return new;
end;
$$;

alter function private.job_runs_guard_runtime_update() owner to app_migrations;
revoke execute on function private.job_runs_guard_runtime_update() from public, anon, authenticated;

create trigger job_runs_guard_runtime_update
  before update on public.job_runs
  for each row execute function private.job_runs_guard_runtime_update();

-- ----------------------------------------------------------------------------
-- Worker (app_worker): bookkeeping of every run, nothing else
-- ----------------------------------------------------------------------------
create policy job_runs_worker_select on public.job_runs
  for select to app_worker
  using (true);

create policy job_runs_worker_insert on public.job_runs
  for insert to app_worker
  with check (status = 'pending');

create policy job_runs_worker_update on public.job_runs
  for update to app_worker
  using (true)
  with check (true);

grant select, insert, update on public.job_runs to app_worker;
