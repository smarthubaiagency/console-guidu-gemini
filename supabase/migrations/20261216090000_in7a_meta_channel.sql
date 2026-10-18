-- ============================================================================
-- Migration: 20261216090000_in7a_meta_channel.sql
-- Module: IN7a — WhatsApp of Meta in the core (ADR 0023 rules 8 and 11;
--         canais.md, Meta row; docs/modules/inbox/plano-in7.md)
--
-- Maintenance Rationale:
-- 1. A connection of kind `meta_whatsapp` is one number of the WhatsApp
--    Cloud API (`config.phone_number_id`), at most once on the platform:
--    Meta posts every number of the GUIDU app to one webhook, which finds
--    the connection by the number. The token stays encrypted in
--    `encrypted_secrets`; the webhook token of the A5a is unused for it.
-- 2. The webhook has no user: `private.channel_meta_ingest` (owner
--    app_rls_helper, flag `app.channel_ingest` as in the A5a) writes the
--    normalized events with a unique external id, keeps when the contact
--    last wrote (the 24-hour window of Meta) and enqueues one
--    `channels.meta-inbound` run. Statuses of messages sent by the core only
--    mark the failed ones.
-- 3. Every WhatsApp conversation lives in a room of the Matrix core,
--    whatever the route (plano-in7.md §0): `matrix_contacts` is the person
--    of a workspace (by phone), with a user of the reserved namespace
--    (`@_guidu_c_<16 base32>`); `matrix_rooms.channel_conversation_id`
--    says by which number the room talks now.
-- 4. What the team or the agent says in such a room goes out by Meta
--    (`channels.meta-send`): `matrix_outbound` keeps one row per Matrix
--    event, never the text (ADR 0023 rule 6).
-- 5. The route of a number (consumer `inbox`) names the GUIDS that answers
--    it (`consumer_ref`); `private.channel_route_guids` gives it to the
--    enqueue of the turn, which now prefers it to the Inbox GUIDS for a
--    room of a number, with or without the Inbox module on.
-- 6. The worker (platform jobs) reads the Meta connections and routes,
--    claims their events and keeps the contacts and the outbound rows; the
--    purge of a deleted workspace (WS1) covers the new tables.
-- Owner app_migrations, ENABLE + FORCE RLS, no grants to anon/authenticated.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Connections and conversations of Meta
-- ----------------------------------------------------------------------------
alter table public.channel_connections drop constraint channel_connections_kind_check;
alter table public.channel_connections
  add constraint channel_connections_kind_check check (kind in ('chatwoot', 'meta_whatsapp'));
alter table public.channel_connections
  add constraint channel_connections_meta_number check (
    kind <> 'meta_whatsapp' or coalesce(config->>'phone_number_id', '') ~ '^[0-9]{5,30}$'
  );
-- One connection per number on the platform: the webhook finds it by it.
create unique index channel_connections_meta_number_key
  on public.channel_connections ((config->>'phone_number_id'))
  where kind = 'meta_whatsapp';

-- When the contact last wrote: Meta accepts free text only within 24 hours.
alter table public.channel_conversations add column last_contact_message_at timestamptz;

-- ----------------------------------------------------------------------------
-- 2. The person behind a conversation and the room's number
-- ----------------------------------------------------------------------------
create table public.matrix_contacts (
  id              uuid primary key default gen_random_uuid(),
  workspace_id    uuid not null,
  organization_id uuid not null,
  -- The WhatsApp id (digits of the phone, country first).
  phone           text not null check (phone ~ '^[0-9]{6,20}$'),
  localpart       text not null unique check (localpart ~ '^_guidu_c_[a-z2-7]{16}$'),
  mxid            text not null unique check (length(mxid) between 4 and 255 and mxid like '@\_guidu\_c\_%:%'),
  -- The profile name of WhatsApp, as the team sees it.
  display_name    text check (display_name is null or length(display_name) between 1 and 120),
  -- pending: row first, user on Synapse next; active: registered.
  state           text not null default 'pending' check (state in ('pending', 'active')),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  constraint matrix_contacts_phone_key unique (workspace_id, phone),
  constraint matrix_contacts_mxid_localpart check (mxid like '@' || localpart || ':%'),
  constraint fk_matrix_contacts_workspace
    foreign key (workspace_id, organization_id)
    references public.workspaces(id, organization_id) on delete cascade
);

create trigger matrix_contacts_touch_updated_at
  before update on public.matrix_contacts
  for each row execute function private.touch_updated_at();

alter table public.matrix_rooms
  add column channel_conversation_id uuid
    references public.channel_conversations(id) on delete set null;
create index matrix_rooms_channel_conversation_idx
  on public.matrix_rooms (channel_conversation_id) where channel_conversation_id is not null;

create table public.matrix_outbound (
  -- The Matrix event sent out: one delivery per event, whatever the retries.
  event_id        text primary key check (length(event_id) between 2 and 255),
  room_id         text not null references public.matrix_rooms(room_id) on delete cascade,
  workspace_id    uuid not null,
  organization_id uuid not null,
  connection_id   uuid not null,
  status          text not null default 'pending' check (status in ('pending', 'sent', 'failed')),
  -- The provider's id of the message (Meta: wamid), for its statuses.
  external_id     text check (external_id is null or length(external_id) between 1 and 200),
  error           text check (error is null or length(error) <= 80),
  created_at      timestamptz not null default now(),
  sent_at         timestamptz,
  constraint fk_matrix_outbound_workspace
    foreign key (workspace_id, organization_id)
    references public.workspaces(id, organization_id) on delete cascade,
  constraint fk_matrix_outbound_connection
    foreign key (connection_id, workspace_id)
    references public.channel_connections(id, workspace_id) on delete cascade
);

create index matrix_outbound_room_idx on public.matrix_outbound (room_id, created_at);
create index matrix_outbound_external_idx
  on public.matrix_outbound (connection_id, external_id) where external_id is not null;

do $$
declare
  t text;
begin
  foreach t in array array['matrix_contacts', 'matrix_outbound'] loop
    execute format('alter table public.%I owner to app_migrations', t);
    execute format('revoke all on public.%I from public, anon, authenticated', t);
    execute format('alter table public.%I enable row level security', t);
    execute format('alter table public.%I force row level security', t);
    -- The Matrix core runs as platform jobs (IN3): the worker keeps them,
    -- the purge of a deleted workspace included.
    execute format('create policy %I on public.%I for all to app_worker using (true) with check (true)', t || '_worker', t);
    execute format('grant select, insert, update, delete on public.%I to app_worker', t);
    -- Whoever has a level in the Inbox reads them.
    execute format(
      'create policy %I on public.%I for select to app_runtime using (
         workspace_id = private.context_uuid(''app.workspace_id'')
         and organization_id = private.context_uuid(''app.organization_id'')
         and (select private.inbox_my_level()) is not null
       )',
      t || '_select', t
    );
    execute format('grant select on public.%I to app_runtime', t);
  end loop;
end
$$;

-- ----------------------------------------------------------------------------
-- 3. The worker on the channels of Meta
-- ----------------------------------------------------------------------------
create policy channel_connections_meta_worker_select on public.channel_connections
  for select to app_worker
  using (kind = 'meta_whatsapp');
create policy channel_routes_meta_worker_select on public.channel_routes
  for select to app_worker
  using (exists (
    select 1 from public.channel_connections connection
    where connection.id = channel_routes.connection_id and connection.kind = 'meta_whatsapp'
  ));
create policy channel_conversations_meta_worker_select on public.channel_conversations
  for select to app_worker
  using (exists (
    select 1 from public.channel_connections connection
    where connection.id = channel_conversations.connection_id and connection.kind = 'meta_whatsapp'
  ));
create policy channel_inbound_events_meta_worker_select on public.channel_inbound_events
  for select to app_worker
  using (exists (
    select 1 from public.channel_connections connection
    where connection.id = channel_inbound_events.connection_id and connection.kind = 'meta_whatsapp'
  ));
-- The worker claims the events and takes the text out once it is in the
-- room (the text lives in Synapse, ADR 0023 rule 6).
create policy channel_inbound_events_meta_worker_update on public.channel_inbound_events
  for update to app_worker
  using (exists (
    select 1 from public.channel_connections connection
    where connection.id = channel_inbound_events.connection_id and connection.kind = 'meta_whatsapp'
  ))
  with check (status in ('dispatched', 'ignored', 'failed'));

grant select (id, organization_id, workspace_id, kind, status, config, encrypted_secrets)
  on public.channel_connections to app_worker;
grant select (id, organization_id, workspace_id, connection_id, scope, consumer_module,
              consumer_ref, status, created_by, updated_by)
  on public.channel_routes to app_worker;
grant select (id, organization_id, workspace_id, connection_id, scope, external_id,
              external_contact_id, last_contact_message_at)
  on public.channel_conversations to app_worker;
grant select (id, organization_id, workspace_id, connection_id, conversation_id, external_id,
              kind, sender, scope, payload, status, occurred_at, received_at)
  on public.channel_inbound_events to app_worker;
grant update (status, payload) on public.channel_inbound_events to app_worker;

-- ----------------------------------------------------------------------------
-- 4. Ingestion from the webhook of Meta (owner app_rls_helper)
-- ----------------------------------------------------------------------------
create policy job_runs_meta_ingest_select on public.job_runs
  for select to app_rls_helper
  using (current_setting('app.channel_ingest', true) = 'on' and kind = 'channels.meta-inbound');

create policy job_runs_meta_ingest_insert on public.job_runs
  for insert to app_rls_helper
  with check (
    current_setting('app.channel_ingest', true) = 'on'
    and kind = 'channels.meta-inbound'
    and scope = 'platform'
    and status = 'pending'
    and attempts = 0
  );

create policy matrix_outbound_meta_ingest_select on public.matrix_outbound
  for select to app_rls_helper
  using (current_setting('app.channel_ingest', true) = 'on');

create policy matrix_outbound_meta_ingest_update on public.matrix_outbound
  for update to app_rls_helper
  using (current_setting('app.channel_ingest', true) = 'on' and status = 'sent')
  with check (current_setting('app.channel_ingest', true) = 'on' and status = 'failed');

grant update (last_contact_message_at) on public.channel_conversations to app_rls_helper;
grant select (connection_id, external_id, status) on public.matrix_outbound to app_rls_helper;
grant update (status, error) on public.matrix_outbound to app_rls_helper;

-- Writes the normalized events of one number (p_events: the contract of
-- src/core/channels/contract.ts; p_statuses: [{ externalId, status, error? }]
-- of the messages the core sent) and enqueues their delivery to the rooms.
-- Nothing when the number is not an active connection.
create function private.channel_meta_ingest(p_phone_number_id text, p_events jsonb, p_statuses jsonb)
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
  v_status jsonb;
  v_conversation_id uuid;
  v_routed boolean;
  v_id uuid;
  v_run uuid;
  v_stored integer := 0;
  v_duplicates integer := 0;
begin
  if jsonb_typeof(p_events) is distinct from 'array' or jsonb_typeof(p_statuses) is distinct from 'array' then
    raise exception 'channel_meta_ingest: events and statuses must be arrays' using errcode = 'invalid_parameter_value';
  end if;
  perform set_config('app.channel_ingest', 'on', true);
  select connection.id, connection.organization_id, connection.workspace_id
    into v_connection.id, v_connection.organization_id, v_connection.workspace_id
  from public.channel_connections connection
  where connection.kind = 'meta_whatsapp'
    and connection.config->>'phone_number_id' = p_phone_number_id
    and connection.status = 'active';
  if v_connection.id is null then
    perform set_config('app.channel_ingest', coalesce(v_previous, ''), true);
    return;
  end if;

  for v_event in select value from jsonb_array_elements(p_events) loop
    insert into public.channel_conversations as conversation
      (organization_id, workspace_id, connection_id, scope, external_id,
       external_contact_id, last_contact_message_at)
    values
      (v_connection.organization_id, v_connection.workspace_id, v_connection.id,
       v_event->>'scope', v_event->'conversation'->>'externalId',
       v_event->'conversation'->>'contactId',
       case when v_event->>'sender' = 'contact' then coalesce((v_event->>'occurredAt')::timestamptz, now()) end)
    on conflict (connection_id, external_id) do update
      set external_contact_id = coalesce(excluded.external_contact_id, conversation.external_contact_id),
          last_contact_message_at = greatest(conversation.last_contact_message_at, excluded.last_contact_message_at),
          last_event_at = now()
    returning conversation.id into v_conversation_id;

    v_routed := exists (
      select 1 from public.channel_routes route
      where route.connection_id = v_connection.id
        and route.scope = v_event->>'scope'
        and route.status = 'active'
    );

    v_id := null;
    insert into public.channel_inbound_events
      (organization_id, workspace_id, connection_id, conversation_id, external_id,
       contract_version, kind, sender, scope, payload, status, occurred_at)
    values
      (v_connection.organization_id, v_connection.workspace_id, v_connection.id,
       v_conversation_id, v_event->>'externalId',
       coalesce((v_event->>'contractVersion')::integer, 1),
       v_event->>'kind', v_event->>'sender', v_event->>'scope', v_event,
       case when v_routed then 'routed' else 'no_route' end,
       (v_event->>'occurredAt')::timestamptz)
    on conflict (connection_id, external_id) do nothing
    returning id into v_id;
    if v_id is null then
      v_duplicates := v_duplicates + 1;
    else
      v_stored := v_stored + 1;
    end if;
  end loop;

  for v_status in select value from jsonb_array_elements(p_statuses) loop
    if v_status->>'status' = 'failed' then
      update public.matrix_outbound outbound
      set status = 'failed', error = left(coalesce(v_status->>'error', 'failed'), 80)
      where outbound.connection_id = v_connection.id
        and outbound.external_id = v_status->>'externalId'
        and outbound.status = 'sent';
    end if;
  end loop;

  if v_stored > 0 then
    -- One run delivers whatever is routed; a pending one already will.
    perform pg_advisory_xact_lock(hashtext('channel_meta_ingest'));
    select run.id into v_run
    from public.job_runs run
    where run.kind = 'channels.meta-inbound' and run.status = 'pending'
    limit 1;
    if v_run is null then
      insert into public.job_runs (kind, scope, payload, idempotency_key, max_attempts)
      values ('channels.meta-inbound', 'platform', '{}'::jsonb,
              left('channels.meta-inbound:' || gen_random_uuid()::text, 200), 5);
    end if;
  end if;

  update public.channel_connections connection
  set last_event_at = now()
  where connection.id = v_connection.id;
  perform set_config('app.channel_ingest', coalesce(v_previous, ''), true);
  return query select v_stored, v_duplicates;
end;
$$;

revoke execute on function private.channel_meta_ingest(text, jsonb, jsonb) from public, anon, authenticated;
grant execute on function private.channel_meta_ingest(text, jsonb, jsonb) to app_runtime;
alter function private.channel_meta_ingest(text, jsonb, jsonb) owner to app_rls_helper;

-- ----------------------------------------------------------------------------
-- 5. The GUIDS of a room of a number (owner app_rls_helper)
-- ----------------------------------------------------------------------------
create policy channel_routes_inbox_guids on public.channel_routes
  for select to app_rls_helper
  using (current_setting('app.inbox_guids', true) = 'on' and status = 'active');
create policy channel_conversations_inbox_guids on public.channel_conversations
  for select to app_rls_helper
  using (current_setting('app.inbox_guids', true) = 'on');

grant select (consumer_module, consumer_ref) on public.channel_routes to app_rls_helper;
grant select (id, connection_id, scope) on public.channel_conversations to app_rls_helper;
grant select (channel_conversation_id) on public.matrix_rooms to app_rls_helper;
grant select (id, status, kind, workspace_id, config) on public.ai_agents to app_rls_helper;

-- The GUIDS named by the active route of the number a room talks by, its
-- name and status, and the person who turned the route on (the turn runs
-- as them). Nothing for a room that is not of a number.
create function private.channel_route_guids(p_room_id text)
returns table(agent_id uuid, agent_name text, agent_status text, actor uuid, grouping_seconds integer)
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_previous text := current_setting('app.inbox_guids', true);
begin
  perform set_config('app.inbox_guids', 'on', true);
  return query
    select agent.id,
           left(coalesce(nullif(btrim(agent.config->'overview'->>'agent_name'), ''), 'GUIDS'), 120),
           agent.status,
           coalesce(route.updated_by, route.created_by),
           5
    from public.matrix_rooms room
    join public.channel_conversations conversation on conversation.id = room.channel_conversation_id
    join public.channel_routes route
      on route.connection_id = conversation.connection_id
     and route.scope = conversation.scope
     and route.status = 'active'
     and route.consumer_module = 'inbox'
    join public.ai_agents agent
      on agent.id = route.consumer_ref
     and agent.workspace_id = room.workspace_id
     and agent.kind = 'guid'
    where room.room_id = p_room_id;
  perform set_config('app.inbox_guids', coalesce(v_previous, ''), true);
end;
$$;

revoke execute on function private.channel_route_guids(text) from public, anon, authenticated;
grant execute on function private.channel_route_guids(text) to app_worker, app_runtime;
alter function private.channel_route_guids(text) owner to app_rls_helper;

-- Replaced as its owner (same pattern as the IN6).
set local role app_rls_helper;

-- Same as the IN6, but a room of a number takes the GUIDS of its route
-- (and only it), with or without the Inbox module on.
create or replace function private.inbox_guids_enqueue(p_room_id text)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_previous text := current_setting('app.inbox_guids', true);
  v_workspace uuid;
  v_state text;
  v_status text;
  v_channel uuid;
  v_agent uuid;
  v_agent_status text;
  v_actor uuid;
  v_wait integer;
  v_run uuid;
begin
  perform set_config('app.inbox_guids', 'on', true);
  select room.workspace_id, room.state, room.status, room.channel_conversation_id
    into v_workspace, v_state, v_status, v_channel
  from public.matrix_rooms room where room.room_id = p_room_id;
  if v_workspace is null or v_state <> 'active' or v_status <> 'pending'
     or (select info.status from private.matrix_workspace_info(v_workspace) info) is distinct from 'active' then
    perform set_config('app.inbox_guids', coalesce(v_previous, ''), true);
    return null;
  end if;
  if v_channel is not null then
    select g.agent_id, g.agent_status, g.actor, g.grouping_seconds
      into v_agent, v_agent_status, v_actor, v_wait
    from private.channel_route_guids(p_room_id) g;
  else
    select g.agent_id, g.agent_status, g.actor, g.grouping_seconds
      into v_agent, v_agent_status, v_actor, v_wait
    from private.inbox_guids_of(v_workspace) g;
  end if;
  -- The functions above restored the flag; this one still needs it.
  perform set_config('app.inbox_guids', 'on', true);
  if v_agent is null or v_agent_status <> 'active' or v_actor is null then
    perform set_config('app.inbox_guids', coalesce(v_previous, ''), true);
    return null;
  end if;
  perform pg_advisory_xact_lock(hashtext('inbox_guids_enqueue:' || p_room_id));
  select run.id into v_run
  from public.job_runs run
  where run.kind = 'inbox.guids-turn'
    and run.status = 'pending'
    and run.workspace_id = v_workspace
    and run.payload->>'roomId' = p_room_id
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
    select 'inbox.guids-turn', 'workspace', workspace.organization_id, v_workspace,
           v_actor, jsonb_build_object('roomId', p_room_id),
           left('room:' || p_room_id || ':' || gen_random_uuid()::text, 200), 1,
           now() + make_interval(secs => v_wait)
    from private.matrix_workspace_info(v_workspace) workspace
    returning id into v_run;
  end if;
  perform set_config('app.inbox_guids', coalesce(v_previous, ''), true);
  return v_run;
end;
$$;

reset role;
