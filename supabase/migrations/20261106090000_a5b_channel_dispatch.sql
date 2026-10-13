-- ============================================================================
-- Migration: 20261106090000_a5b_channel_dispatch.sql
-- Module: A5b — GUIDS answering in Chatwoot (ADR 0011; canais.md §3 and §4;
--         plano-a5.md)
--
-- Maintenance Rationale:
-- 1. The ingestion of the A5a now hands a routed conversation to its
--    consumer: for each new message of a contact (public, with text or an
--    attachment) on a routed inbox it enqueues one `channels.dispatch` run
--    per external conversation. While that run is still pending, a new
--    message only pushes its start (grouping window of the integration's
--    settings, default 5 seconds, never more than 30 seconds after the
--    first message). The run is asked by the person who turned the route
--    on (`updated_by`, else `created_by`), whose access the worker
--    re-checks on every run, as for any job of the workspace.
-- 2. The dispatch claims the events (`routed` -> `dispatched` or
--    `ignored`) as that person: owner and admin may change only the status
--    of an event.
-- 3. `channel_deliveries` keeps each part of an answer sent to a provider,
--    unique per (run, part), so a retried run never sends a part twice.
-- 4. A GUIDS conversation may come from Chatwoot (`channel = 'chatwoot'`):
--    it has no person of the workspace on the other side (`user_id` null)
--    and points at the external conversation it answers. It is created by
--    the dispatch, never from the screens.
-- 5. Purge of a deleted workspace (F3e) as the worker.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Deliveries
-- ----------------------------------------------------------------------------
create table public.channel_deliveries (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null,
  workspace_id     uuid not null,
  connection_id    uuid not null,
  conversation_id  uuid not null,
  -- The run of `job_runs` that produced the answer.
  execution_id     uuid not null,
  part             integer not null check (part between 0 and 9),
  content          text not null check (length(content) between 1 and 4000),
  status           text not null default 'pending' check (status in ('pending', 'sent', 'failed')),
  external_id      text check (external_id is null or length(external_id) between 1 and 200),
  error            text check (error is null or length(error) <= 80),
  created_at       timestamptz not null default now(),
  sent_at          timestamptz,
  constraint channel_deliveries_part_key unique (execution_id, part),
  constraint fk_channel_deliveries_workspace
    foreign key (workspace_id, organization_id)
    references public.workspaces(id, organization_id) on delete cascade,
  constraint fk_channel_deliveries_connection
    foreign key (connection_id, workspace_id)
    references public.channel_connections(id, workspace_id) on delete cascade,
  constraint fk_channel_deliveries_conversation
    foreign key (conversation_id, workspace_id)
    references public.channel_conversations(id, workspace_id) on delete cascade
);

create index channel_deliveries_conversation_idx
  on public.channel_deliveries (conversation_id, created_at);
create index channel_deliveries_failed_idx
  on public.channel_deliveries (connection_id) where status = 'failed';

alter table public.channel_deliveries owner to app_migrations;
revoke all on public.channel_deliveries from public, anon, authenticated;
alter table public.channel_deliveries enable row level security;
alter table public.channel_deliveries force row level security;

create policy channel_deliveries_select on public.channel_deliveries
  for select to app_runtime
  using (
    workspace_id = private.context_uuid('app.workspace_id')
    and organization_id = private.context_uuid('app.organization_id')
    and private.current_workspace_role() in ('owner', 'admin', 'editor')
  );

create policy channel_deliveries_insert on public.channel_deliveries
  for insert to app_runtime
  with check (
    workspace_id = private.context_uuid('app.workspace_id')
    and organization_id = private.context_uuid('app.organization_id')
    and status = 'pending'
    and private.current_workspace_role() in ('owner', 'admin')
  );

create policy channel_deliveries_update on public.channel_deliveries
  for update to app_runtime
  using (
    workspace_id = private.context_uuid('app.workspace_id')
    and organization_id = private.context_uuid('app.organization_id')
    and private.current_workspace_role() in ('owner', 'admin')
  )
  with check (
    workspace_id = private.context_uuid('app.workspace_id')
    and organization_id = private.context_uuid('app.organization_id')
    and private.current_workspace_role() in ('owner', 'admin')
  );

grant select, insert on public.channel_deliveries to app_runtime;
grant update (status, external_id, error, sent_at) on public.channel_deliveries to app_runtime;

-- ----------------------------------------------------------------------------
-- 2. The dispatch claims the events
-- ----------------------------------------------------------------------------
create policy channel_inbound_events_dispatch on public.channel_inbound_events
  for update to app_runtime
  using (
    workspace_id = private.context_uuid('app.workspace_id')
    and organization_id = private.context_uuid('app.organization_id')
    and private.current_workspace_role() in ('owner', 'admin')
  )
  with check (
    workspace_id = private.context_uuid('app.workspace_id')
    and organization_id = private.context_uuid('app.organization_id')
    and private.current_workspace_role() in ('owner', 'admin')
  );

grant update (status) on public.channel_inbound_events to app_runtime;

-- ----------------------------------------------------------------------------
-- 3. GUIDS conversations from Chatwoot
-- ----------------------------------------------------------------------------
alter table public.ai_conversations drop constraint ai_conversations_channel_check;
alter table public.ai_conversations
  add constraint ai_conversations_channel_check check (channel in ('test', 'panel', 'chatwoot'));
alter table public.ai_conversations add column channel_conversation_id uuid;
-- No foreign key: the history of the agent stays when a connection goes.
alter table public.ai_conversations
  add constraint ai_conversations_channel_ref_check check (
    (channel = 'chatwoot') = (channel_conversation_id is not null)
    and (channel <> 'chatwoot' or (kind = 'guid' and user_id is null))
  );
-- One open conversation of an agent per external conversation.
create unique index ai_conversations_channel_open
  on public.ai_conversations (agent_id, channel_conversation_id)
  where channel_conversation_id is not null and status <> 'closed';

create policy ai_conversations_channel_insert on public.ai_conversations
  for insert to app_runtime
  with check (
    kind = 'guid'
    and channel = 'chatwoot'
    and user_id is null
    and workspace_id = private.context_uuid('app.workspace_id')
    and organization_id = private.context_uuid('app.organization_id')
    and private.current_workspace_role() in ('owner', 'admin')
    and exists (
      select 1 from public.channel_conversations conversation
      where conversation.id = channel_conversation_id
    )
  );

-- ----------------------------------------------------------------------------
-- 4. Ingestion enqueues the dispatch
-- ----------------------------------------------------------------------------
create policy job_runs_channel_ingest_select on public.job_runs
  for select to app_rls_helper
  using (current_setting('app.channel_ingest', true) = 'on' and kind = 'channels.dispatch');

create policy job_runs_channel_ingest_insert on public.job_runs
  for insert to app_rls_helper
  with check (
    current_setting('app.channel_ingest', true) = 'on'
    and kind = 'channels.dispatch'
    and scope = 'workspace'
    and status = 'pending'
    and attempts = 0
  );

create policy job_runs_channel_ingest_update on public.job_runs
  for update to app_rls_helper
  using (current_setting('app.channel_ingest', true) = 'on' and kind = 'channels.dispatch' and status = 'pending')
  with check (current_setting('app.channel_ingest', true) = 'on' and kind = 'channels.dispatch' and status = 'pending');

grant select (id, kind, status, workspace_id, payload, created_at) on public.job_runs to app_rls_helper;
grant insert on public.job_runs to app_rls_helper;
grant update (run_after) on public.job_runs to app_rls_helper;
grant select (config) on public.channel_connections to app_rls_helper;
grant select (created_by, updated_by) on public.channel_routes to app_rls_helper;

-- Same signature and behavior as the A5a, plus the dispatch of point 1.
-- Replaced as its owner (same pattern as the F3e).
set local role app_rls_helper;

create or replace function private.channel_ingest(p_connection_id uuid, p_token_hash text, p_events jsonb)
returns table(stored integer, duplicates integer)
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_previous text := current_setting('app.channel_ingest', true);
  v_connection public.channel_connections%rowtype;
  v_event jsonb;
  v_conversation_id uuid;
  v_route_actor uuid;
  v_id uuid;
  v_run uuid;
  v_wait integer;
  v_trigger boolean;
  v_stored integer := 0;
  v_duplicates integer := 0;
begin
  if jsonb_typeof(p_events) is distinct from 'array' then
    raise exception 'channel_ingest: events must be an array' using errcode = 'invalid_parameter_value';
  end if;
  perform set_config('app.channel_ingest', 'on', true);
  select connection.id, connection.organization_id, connection.workspace_id, connection.config
    into v_connection.id, v_connection.organization_id, v_connection.workspace_id, v_connection.config
  from public.channel_connections connection
  where connection.id = p_connection_id
    and connection.webhook_token_hash = p_token_hash
    and connection.status = 'active';
  if v_connection.id is null then
    perform set_config('app.channel_ingest', coalesce(v_previous, ''), true);
    return;
  end if;

  for v_event in select value from jsonb_array_elements(p_events) loop
    v_conversation_id := null;
    if v_event->'conversation'->>'externalId' is not null then
      insert into public.channel_conversations as conversation
        (organization_id, workspace_id, connection_id, scope, external_id,
         external_contact_id, external_status)
      values
        (v_connection.organization_id, v_connection.workspace_id, v_connection.id,
         v_event->>'scope', v_event->'conversation'->>'externalId',
         v_event->'conversation'->>'contactId', v_event->'conversation'->>'status')
      on conflict (connection_id, external_id) do update
        set external_contact_id = coalesce(excluded.external_contact_id, conversation.external_contact_id),
            external_status = coalesce(excluded.external_status, conversation.external_status),
            last_event_at = now()
      returning conversation.id into v_conversation_id;
    end if;

    v_route_actor := null;
    select coalesce(route.updated_by, route.created_by) into v_route_actor
    from public.channel_routes route
    where route.connection_id = v_connection.id
      and route.scope = v_event->>'scope'
      and route.status = 'active';

    v_id := null;
    insert into public.channel_inbound_events
      (organization_id, workspace_id, connection_id, conversation_id, external_id,
       contract_version, kind, sender, scope, payload, status, occurred_at)
    values
      (v_connection.organization_id, v_connection.workspace_id, v_connection.id,
       v_conversation_id, v_event->>'externalId',
       coalesce((v_event->>'contractVersion')::integer, 1),
       v_event->>'kind', v_event->>'sender', v_event->>'scope', v_event,
       case when v_route_actor is not null then 'routed' else 'no_route' end,
       (v_event->>'occurredAt')::timestamptz)
    on conflict (connection_id, external_id) do nothing
    returning id into v_id;
    if v_id is null then
      v_duplicates := v_duplicates + 1;
      continue;
    end if;
    v_stored := v_stored + 1;

    -- A new public message of a contact, on a routed inbox, starts (or
    -- pushes) the dispatch of its conversation (isTrigger in chatwoot.ts).
    v_trigger := v_route_actor is not null
      and v_conversation_id is not null
      and v_event->>'kind' = 'message'
      and v_event->>'sender' = 'contact'
      and coalesce((v_event->'message'->>'private')::boolean, false) = false
      and (
        length(btrim(coalesce(v_event->'message'->>'text', ''))) > 0
        or jsonb_array_length(coalesce(v_event->'message'->'attachments', '[]'::jsonb)) > 0
      );
    if not v_trigger then
      continue;
    end if;
    v_wait := least(greatest(coalesce(
      (v_connection.config->'service'->'inboxes'->(v_event->>'scope')->>'grouping_seconds')::integer,
      (v_connection.config->'service'->'defaults'->>'grouping_seconds')::integer,
      5), 0), 30);
    v_run := null;
    select run.id into v_run
    from public.job_runs run
    where run.kind = 'channels.dispatch'
      and run.status = 'pending'
      and run.workspace_id = v_connection.workspace_id
      and run.payload->>'conversationId' = v_conversation_id::text
    limit 1
    for update;
    if v_run is not null then
      update public.job_runs run
      set run_after = least(now() + make_interval(secs => v_wait), run.created_at + interval '30 seconds')
      where run.id = v_run;
    else
      insert into public.job_runs
        (kind, scope, organization_id, workspace_id, requested_by, payload,
         idempotency_key, max_attempts, run_after)
      values
        ('channels.dispatch', 'workspace', v_connection.organization_id, v_connection.workspace_id,
         v_route_actor, jsonb_build_object('conversationId', v_conversation_id),
         'conversation:' || v_conversation_id || ':' || v_id, 1,
         now() + make_interval(secs => v_wait));
    end if;
  end loop;

  update public.channel_connections connection
  set last_event_at = now()
  where connection.id = v_connection.id;
  perform set_config('app.channel_ingest', coalesce(v_previous, ''), true);
  return query select v_stored, v_duplicates;
end;
$$;

reset role;

-- ----------------------------------------------------------------------------
-- 5. Purge of a deleted workspace (F3e)
-- ----------------------------------------------------------------------------
create policy channel_deliveries_worker_purge on public.channel_deliveries
  for delete to app_worker using (private.workspace_purgeable(workspace_id));
create policy channel_deliveries_worker_purge_select on public.channel_deliveries
  for select to app_worker using (private.workspace_purgeable(workspace_id));
grant select (workspace_id), delete on public.channel_deliveries to app_worker;
