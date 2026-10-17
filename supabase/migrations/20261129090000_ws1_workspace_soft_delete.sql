-- ============================================================================
-- Migration: 20261129090000_ws1_workspace_soft_delete.sql
-- Module: WS1 — Complete soft delete of a workspace (plano IN3 + WS1, §3;
--         critério de aceite do Marcelo, 17/10/2026: com o workspace em
--         exclusão suave, nenhum serviço funciona, principalmente os GUIDS)
--
-- Maintenance Rationale:
-- 1. `private.workspace_is_active(uuid)`: the one database answer to "is
--    this workspace active?", for app_runtime, app_worker and the helper's
--    own functions. Owned by app_rls_helper, it reads the status of any
--    workspace only while the flag it sets and restores is on (I5 pattern),
--    and returns a boolean only. A workspace that is not `active`
--    (deletion_scheduled, suspended, inactive, deleted) is closed to every
--    service.
-- 2. Channel webhook (A5a/A5b): the helper policies that let
--    `private.channel_webhook_connection` and `private.channel_ingest` read
--    and touch a connection now also require its workspace to be active.
--    Both functions are closed at once, with the same answer as an unknown
--    connection (404, nothing stored, no `channels.dispatch` queued); after
--    a cancel they accept again. The functions themselves stay as they are.
-- 3. Lifecycle of a deletion (hooks of modules and core resources): the
--    request and the cancel queue one `privacy.workspace-lifecycle` run
--    (platform, app_worker) in the same transaction, allowed only for the
--    deletion its caller has just requested or canceled. The run calls the
--    hooks and sends the notices.
-- 4. `workspace_deletions.lifecycle` keeps the result of each hook
--    (scheduled, canceled and external purge) and the notices sent;
--    `reminder_sent_at` marks the reminder of 7 days before the purge, sent
--    once. The worker writes both while the record is not purged.
-- 5. External purge (before the database purge): the worker reads, for a
--    workspace past its grace period only (existing purge policies), the
--    Google tokens to revoke and the Cloudflare custom hostnames to remove.
-- 6. `private.partner_scheduled_deletions()`: the scheduled deletions of the
--    context partner's companies, for the badge of /admin › Clientes.
-- 7. `private.canceled_deletion_id(uuid)`: the record the caller has just
--    canceled, so the cancel can queue its lifecycle run by the record's id.
-- Owner app_migrations, ENABLE + FORCE RLS stays; no grants to
-- anon/authenticated. Functions owned by app_rls_helper get their grants
-- before the ownership transfer (app_migrations is NOINHERIT).
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Is the workspace active?
-- ----------------------------------------------------------------------------
create policy workspaces_helper_status_select on public.workspaces
  for select to app_rls_helper
  using (current_setting('app.workspace_status_check', true) = 'on');

create function private.workspace_is_active(p_workspace_id uuid)
returns boolean
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_previous text := current_setting('app.workspace_status_check', true);
  v_active boolean;
begin
  perform set_config('app.workspace_status_check', 'on', true);
  select exists (
    select 1 from public.workspaces w
    where w.id = p_workspace_id and w.status = 'active'
  ) into v_active;
  perform set_config('app.workspace_status_check', coalesce(v_previous, ''), true);
  return v_active;
end;
$$;

revoke execute on function private.workspace_is_active(uuid) from public, anon, authenticated;
grant execute on function private.workspace_is_active(uuid) to app_runtime, app_worker;
alter function private.workspace_is_active(uuid) owner to app_rls_helper;

-- ----------------------------------------------------------------------------
-- 2. Channel webhook: only connections of an active workspace
-- ----------------------------------------------------------------------------
alter policy channel_connections_ingest_select on public.channel_connections
  using (
    current_setting('app.channel_ingest', true) = 'on'
    and status = 'active'
    and private.workspace_is_active(workspace_id)
  );

alter policy channel_connections_ingest_update on public.channel_connections
  using (
    current_setting('app.channel_ingest', true) = 'on'
    and status = 'active'
    and private.workspace_is_active(workspace_id)
  )
  with check (
    current_setting('app.channel_ingest', true) = 'on'
    and status = 'active'
    and private.workspace_is_active(workspace_id)
  );

-- ----------------------------------------------------------------------------
-- 3. and 4. Lifecycle of a deletion
-- ----------------------------------------------------------------------------
alter table public.workspace_deletions
  add column lifecycle jsonb not null default '{}'::jsonb
    check (jsonb_typeof(lifecycle) = 'object' and pg_column_size(lifecycle) <= 8192),
  add column reminder_sent_at timestamptz;

-- The worker records hooks and notices while the record is open or
-- canceled; closing it (purged) stays with workspace_deletions_worker_update.
create policy workspace_deletions_worker_lifecycle on public.workspace_deletions
  for update to app_worker
  using (purged_at is null)
  with check (purged_at is null);

grant update (lifecycle, reminder_sent_at) on public.workspace_deletions to app_worker;

-- True for the deletion the caller has just requested (still open) or
-- canceled, so the web queues its lifecycle run once and for itself only.
create function private.workspace_lifecycle_job_allowed(p_deletion_id text, p_action text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    p_deletion_id ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    and exists (
      select 1 from public.workspace_deletions d
      where d.id = p_deletion_id::uuid
        and (
          (p_action = 'scheduled'
           and d.requested_by = private.context_uuid('app.user_id')
           and d.canceled_at is null and d.purged_at is null
           and d.requested_at >= now() - interval '10 minutes')
          or (p_action = 'canceled'
              and d.canceled_by = private.context_uuid('app.user_id')
              and d.canceled_at >= now() - interval '10 minutes')
        )
    ),
    false
  );
$$;

revoke execute on function private.workspace_lifecycle_job_allowed(text, text) from public, anon, authenticated;
grant execute on function private.workspace_lifecycle_job_allowed(text, text) to app_runtime;
alter function private.workspace_lifecycle_job_allowed(text, text) owner to app_rls_helper;

create policy job_runs_workspace_lifecycle_insert on public.job_runs
  for insert to app_runtime
  with check (
    kind = 'privacy.workspace-lifecycle'
    and scope = 'platform'
    and status = 'pending'
    and attempts = 0
    and partner_id is null
    and organization_id is null
    and workspace_id is null
    and requested_by = private.context_uuid('app.user_id')
    and idempotency_key = (payload ->> 'action') || ':' || (payload ->> 'deletionId')
    and private.workspace_lifecycle_job_allowed(payload ->> 'deletionId', payload ->> 'action')
  );

-- ----------------------------------------------------------------------------
-- 5. External purge: what the worker removes outside the database
-- ----------------------------------------------------------------------------
-- Rows stay limited to workspaces past their grace period by the existing
-- `*_worker_purge_select` policies (F3e, CF2b, CF6b).
grant select (access_token_encrypted, refresh_token_encrypted)
  on public.workspace_google_connections to app_worker;
grant select (id, host, cloudflare_hostname_id) on public.workspace_domains to app_worker;

-- ----------------------------------------------------------------------------
-- 6. Scheduled deletions of the partner's companies (/admin › Clientes)
-- ----------------------------------------------------------------------------
create function private.partner_scheduled_deletions()
returns table(
  organization_id uuid,
  workspace_id uuid,
  workspace_name text,
  purge_after timestamptz
)
language sql
stable
security definer
set search_path = ''
as $$
  select w.organization_id, w.id, w.name, w.purge_after
  from public.workspaces w
  join public.organizations o on o.id = w.organization_id
  where w.status = 'deletion_scheduled'
    and o.partner_id = private.current_partner_id()
    and private.current_partner_role() is not null
  order by w.purge_after, w.id;
$$;

revoke execute on function private.partner_scheduled_deletions() from public, anon, authenticated;
grant execute on function private.partner_scheduled_deletions() to app_runtime;
alter function private.partner_scheduled_deletions() owner to app_rls_helper;

-- ----------------------------------------------------------------------------
-- 7. The deletion the caller has just canceled (its lifecycle run's key)
-- ----------------------------------------------------------------------------
create function private.canceled_deletion_id(p_workspace_id uuid)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select d.id
  from public.workspace_deletions d
  where d.workspace_id = p_workspace_id
    and d.canceled_by = private.context_uuid('app.user_id')
    and d.canceled_at >= now() - interval '10 minutes'
  order by d.canceled_at desc
  limit 1;
$$;

revoke execute on function private.canceled_deletion_id(uuid) from public, anon, authenticated;
grant execute on function private.canceled_deletion_id(uuid) to app_runtime;
alter function private.canceled_deletion_id(uuid) owner to app_rls_helper;
