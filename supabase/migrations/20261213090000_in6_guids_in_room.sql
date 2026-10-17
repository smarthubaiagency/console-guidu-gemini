-- ============================================================================
-- Migration: 20261213090000_in6_guids_in_room.sql
-- Module: IN6 — the GUIDS in the room (docs/modules/inbox/plano-in4b-in6.md;
--         docs/modules/inbox/guids-na-sala.md)
--
-- Maintenance Rationale:
-- 1. Each GUIDS that answers the Inbox has a virtual user of the reserved
--    namespace, `@_guidu_a_<16 base32>:<server>`, with the agent's name
--    (`matrix_agent_users`, a table of the core like the addresses of the
--    IN4a). The worker registers it and puts it in the rooms at power 10:
--    it only sends messages; the state of the conversation stays with the
--    core.
-- 2. Which GUIDS answers the Inbox of a workspace (one or none) and the
--    service rules (grouping, messages, characters, interval) live in the
--    module's workspace configuration (`workspace_modules.config` of
--    `inbox`), saved by `inbox.manage`. `private.inbox_guids_of` reads them
--    for the worker, with the person who saved them: the turn runs as that
--    person, as the dispatch of the A5b runs as who turned the route on.
-- 3. A message of the consumer in a pending room of a workspace with an
--    Inbox GUIDS enqueues `inbox.guids-turn` (`private.inbox_guids_enqueue`,
--    called by the processing of the Application Service as app_worker),
--    one pending run per room. A new message only pushes its start
--    (grouping window, never more than 30 seconds after the first).
-- 4. `inbox_guids_rooms` keeps, per room, the last message of the consumer
--    the GUIDS answered (so a message is never answered twice) and the
--    summary of its last handoff, read by the team in the context panel and
--    never sent to the room (ADR 0023, rule 6). The turn writes it as the
--    person of point 2 (owner or admin); whoever has a level reads it.
-- 5. A GUIDS conversation may come from the Inbox (`channel = 'matrix'`): it
--    points at the room (`matrix_room_id`), one open conversation per agent
--    and room, like the Chatwoot ones of the A5b.
-- 6. `matrix.sync-agent` joins the list of `private.matrix_enqueue` (the
--    settings ask for it when the GUIDS changes).
-- 7. Purge of a deleted workspace (WS1): both tables are rows of the
--    workspace; the worker deletes them like the rooms.
-- Owner app_migrations, ENABLE + FORCE RLS, no grants to anon/authenticated.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Tables
-- ----------------------------------------------------------------------------
create table public.matrix_agent_users (
  -- The GUIDS (ai_agents.id). No foreign key: the user stays on Synapse
  -- when the agent goes, and the row with its workspace.
  agent_id        uuid primary key,
  workspace_id    uuid not null,
  organization_id uuid not null,
  localpart       text not null unique check (localpart ~ '^_guidu_a_[a-z2-7]{16}$'),
  mxid            text not null unique check (length(mxid) between 4 and 255 and mxid like '@\_guidu\_a\_%:%'),
  -- The name the consumer sees (the agent's), shown to the team too.
  display_name    text check (display_name is null or length(display_name) between 1 and 120),
  -- pending: row first, user on Synapse next; active: registered.
  state           text not null default 'pending' check (state in ('pending', 'active')),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  constraint matrix_agent_users_mxid_localpart check (mxid like '@' || localpart || ':%'),
  constraint fk_matrix_agent_users_workspace
    foreign key (workspace_id, organization_id)
    references public.workspaces(id, organization_id) on delete cascade
);

create index matrix_agent_users_workspace_idx on public.matrix_agent_users (workspace_id);

create table public.inbox_guids_rooms (
  room_id                text primary key references public.matrix_rooms(room_id) on delete cascade,
  workspace_id           uuid not null,
  organization_id        uuid not null,
  -- The GUIDS that answered last.
  agent_id               uuid not null,
  -- The newest message of the consumer already given to the GUIDS.
  last_answered_event_id text check (last_answered_event_id is null or length(last_answered_event_id) between 1 and 255),
  last_answered_ts       bigint,
  -- The last handoff: what the team reads before taking the conversation.
  handoff_summary        text check (handoff_summary is null or length(handoff_summary) between 1 and 4000),
  handoff_reason         text check (handoff_reason is null or length(handoff_reason) between 1 and 1000),
  handoff_at             timestamptz,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now(),
  constraint inbox_guids_rooms_handoff check ((handoff_summary is null) = (handoff_at is null)),
  constraint fk_inbox_guids_rooms_workspace
    foreign key (workspace_id, organization_id)
    references public.workspaces(id, organization_id) on delete cascade
);

create index inbox_guids_rooms_workspace_idx on public.inbox_guids_rooms (workspace_id);

do $$
declare
  t text;
begin
  foreach t in array array['matrix_agent_users', 'inbox_guids_rooms'] loop
    execute format('alter table public.%I owner to app_migrations', t);
    execute format('revoke all on public.%I from public, anon, authenticated', t);
    execute format('alter table public.%I enable row level security', t);
    execute format('alter table public.%I force row level security', t);
    execute format('create policy %I on public.%I for all to app_worker using (true) with check (true)', t || '_worker', t);
    execute format('grant select, insert, update, delete on public.%I to app_worker', t);
  end loop;
end
$$;

create trigger matrix_agent_users_touch_updated_at
  before update on public.matrix_agent_users
  for each row execute function private.touch_updated_at();

create trigger inbox_guids_rooms_touch_updated_at
  before update on public.inbox_guids_rooms
  for each row execute function private.touch_updated_at();

-- ----------------------------------------------------------------------------
-- 2. Policies of the web and of the turn (app_runtime)
-- ----------------------------------------------------------------------------
create policy matrix_agent_users_select on public.matrix_agent_users
  for select to app_runtime
  using (
    workspace_id = private.context_uuid('app.workspace_id')
    and organization_id = private.context_uuid('app.organization_id')
    and (select private.inbox_my_level()) is not null
  );
grant select on public.matrix_agent_users to app_runtime;

create policy inbox_guids_rooms_select on public.inbox_guids_rooms
  for select to app_runtime
  using (
    workspace_id = private.context_uuid('app.workspace_id')
    and organization_id = private.context_uuid('app.organization_id')
    and (select private.inbox_my_level()) is not null
  );

-- The turn runs as the person who chose the GUIDS (a manager of the Inbox).
create policy inbox_guids_rooms_insert on public.inbox_guids_rooms
  for insert to app_runtime
  with check (
    workspace_id = private.context_uuid('app.workspace_id')
    and organization_id = private.context_uuid('app.organization_id')
    and private.inbox_my_manages()
    and exists (
      select 1 from public.matrix_rooms room
      where room.room_id = inbox_guids_rooms.room_id
        and room.workspace_id = inbox_guids_rooms.workspace_id
    )
  );

create policy inbox_guids_rooms_update on public.inbox_guids_rooms
  for update to app_runtime
  using (
    workspace_id = private.context_uuid('app.workspace_id')
    and organization_id = private.context_uuid('app.organization_id')
    and private.inbox_my_manages()
  )
  with check (
    workspace_id = private.context_uuid('app.workspace_id')
    and organization_id = private.context_uuid('app.organization_id')
    and private.inbox_my_manages()
  );

grant select on public.inbox_guids_rooms to app_runtime;
grant insert (room_id, workspace_id, organization_id, agent_id, last_answered_event_id,
              last_answered_ts, handoff_summary, handoff_reason, handoff_at)
  on public.inbox_guids_rooms to app_runtime;
grant update (agent_id, last_answered_event_id, last_answered_ts, handoff_summary,
              handoff_reason, handoff_at, updated_at)
  on public.inbox_guids_rooms to app_runtime;

-- ----------------------------------------------------------------------------
-- 3. GUIDS conversations from the Inbox
-- ----------------------------------------------------------------------------
alter table public.ai_conversations drop constraint ai_conversations_channel_check;
alter table public.ai_conversations
  add constraint ai_conversations_channel_check check (channel in ('test', 'panel', 'chatwoot', 'matrix'));
alter table public.ai_conversations
  add column matrix_room_id text check (matrix_room_id is null or length(matrix_room_id) between 2 and 255);
-- No foreign key: the history of the agent stays when a room goes.
alter table public.ai_conversations drop constraint ai_conversations_channel_ref_check;
alter table public.ai_conversations
  add constraint ai_conversations_channel_ref_check check (
    (channel = 'chatwoot') = (channel_conversation_id is not null)
    and (channel = 'matrix') = (matrix_room_id is not null)
    and (channel not in ('chatwoot', 'matrix') or (kind = 'guid' and user_id is null))
  );
-- One open conversation of an agent per room.
create unique index ai_conversations_matrix_open
  on public.ai_conversations (agent_id, matrix_room_id)
  where matrix_room_id is not null and status <> 'closed';

create policy ai_conversations_matrix_insert on public.ai_conversations
  for insert to app_runtime
  with check (
    kind = 'guid'
    and channel = 'matrix'
    and user_id is null
    and workspace_id = private.context_uuid('app.workspace_id')
    and organization_id = private.context_uuid('app.organization_id')
    and private.current_workspace_role() in ('owner', 'admin')
    and exists (
      select 1 from public.matrix_rooms room
      where room.room_id = matrix_room_id
        and room.workspace_id = ai_conversations.workspace_id
    )
  );

-- ----------------------------------------------------------------------------
-- 4. The Inbox GUIDS of a workspace and the turn's enqueue
--    (owner app_rls_helper)
-- ----------------------------------------------------------------------------
-- `app.inbox_guids` opens to the helper only what the two functions below
-- read; each sets and restores it, so no other helper function gains reach.
create policy workspace_modules_inbox_guids on public.workspace_modules
  for select to app_rls_helper
  using (current_setting('app.inbox_guids', true) = 'on' and module_key = 'inbox');
create policy ai_agents_inbox_guids_helper_select on public.ai_agents
  for select to app_rls_helper
  using (current_setting('app.inbox_guids', true) = 'on' and kind = 'guid');
create policy matrix_rooms_inbox_guids on public.matrix_rooms
  for select to app_rls_helper
  using (current_setting('app.inbox_guids', true) = 'on');

create policy job_runs_inbox_guids_select on public.job_runs
  for select to app_rls_helper
  using (current_setting('app.inbox_guids', true) = 'on' and kind = 'inbox.guids-turn');

create policy job_runs_inbox_guids_insert on public.job_runs
  for insert to app_rls_helper
  with check (
    current_setting('app.inbox_guids', true) = 'on'
    and kind = 'inbox.guids-turn'
    and scope = 'workspace'
    and status = 'pending'
    and attempts = 0
  );

create policy job_runs_inbox_guids_update on public.job_runs
  for update to app_rls_helper
  using (current_setting('app.inbox_guids', true) = 'on' and kind = 'inbox.guids-turn' and status = 'pending')
  with check (current_setting('app.inbox_guids', true) = 'on' and kind = 'inbox.guids-turn' and status = 'pending');

grant select (workspace_id, module_key, status, config, updated_by) on public.workspace_modules to app_rls_helper;
grant select (id, workspace_id, state, status, room_id) on public.matrix_rooms to app_rls_helper;

-- The GUIDS that answers the Inbox of a workspace (none when the module is
-- off, nothing was chosen or the agent is gone), its name and status, the
-- person who chose it and the grouping window (A5b default, 0 to 30 s).
create function private.inbox_guids_of(p_workspace_id uuid)
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
           module.updated_by,
           least(greatest(coalesce(
             case when (module.config->'service'->>'grouping_seconds') ~ '^[0-9]{1,3}$'
                  then (module.config->'service'->>'grouping_seconds')::integer end,
             5), 0), 30)
    from public.workspace_modules module
    join public.ai_agents agent
      on agent.id = case
           when (module.config->>'guids_agent_id') ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
           then (module.config->>'guids_agent_id')::uuid end
     and agent.workspace_id = module.workspace_id
     and agent.kind = 'guid'
    where module.workspace_id = p_workspace_id
      and module.module_key = 'inbox'
      and module.status = 'enabled';
  perform set_config('app.inbox_guids', coalesce(v_previous, ''), true);
end;
$$;

-- A message of the consumer arrived in a room: when the room is pending,
-- its workspace active and its Inbox GUIDS on, the turn of the room runs
-- after the grouping window, as the person who chose the GUIDS. One pending
-- run per room; a new message pushes it (at most 30 s after the first).
-- Returns the run, or null when the GUIDS does not answer this room.
create function private.inbox_guids_enqueue(p_room_id text)
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
  v_agent uuid;
  v_agent_status text;
  v_actor uuid;
  v_wait integer;
  v_run uuid;
begin
  perform set_config('app.inbox_guids', 'on', true);
  select room.workspace_id, room.state, room.status into v_workspace, v_state, v_status
  from public.matrix_rooms room where room.room_id = p_room_id;
  if v_workspace is null or v_state <> 'active' or v_status <> 'pending'
     or (select info.status from private.matrix_workspace_info(v_workspace) info) is distinct from 'active' then
    perform set_config('app.inbox_guids', coalesce(v_previous, ''), true);
    return null;
  end if;
  select g.agent_id, g.agent_status, g.actor, g.grouping_seconds
    into v_agent, v_agent_status, v_actor, v_wait
  from private.inbox_guids_of(v_workspace) g;
  -- inbox_guids_of restored the flag; this function still needs it.
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

revoke execute on function private.inbox_guids_of(uuid) from public, anon, authenticated;
revoke execute on function private.inbox_guids_enqueue(text) from public, anon, authenticated;
grant execute on function private.inbox_guids_of(uuid) to app_worker;
grant execute on function private.inbox_guids_enqueue(text) to app_worker;
alter function private.inbox_guids_of(uuid) owner to app_rls_helper;
alter function private.inbox_guids_enqueue(text) owner to app_rls_helper;

-- ----------------------------------------------------------------------------
-- 5. `matrix.sync-agent` in the enqueue of the core
-- ----------------------------------------------------------------------------
drop policy job_runs_matrix_insert on public.job_runs;
create policy job_runs_matrix_insert on public.job_runs
  for insert to app_rls_helper
  with check (
    current_setting('app.matrix_jobs', true) = 'on'
    and kind in ('matrix.process-events', 'matrix.sync-account', 'matrix.sync-workspace',
                 'matrix.logout-devices', 'matrix.sync-agent')
    and scope = 'platform'
    and status = 'pending'
    and attempts = 0
    and partner_id is null
    and organization_id is null
    and workspace_id is null
  );

-- Same signature and behavior as the IN3, plus the new kind. Replaced as
-- its owner: app_migrations is NOINHERIT.
set local role app_rls_helper;

create or replace function private.matrix_enqueue(p_kind text, p_payload jsonb, p_run_after timestamptz default null)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_previous text := current_setting('app.matrix_jobs', true);
  v_user uuid := private.context_uuid('app.user_id');
  v_id uuid;
begin
  if p_kind not in ('matrix.process-events', 'matrix.sync-account', 'matrix.sync-workspace',
                    'matrix.logout-devices', 'matrix.sync-agent') then
    raise exception 'matrix_enqueue: unknown kind' using errcode = 'invalid_parameter_value';
  end if;
  if jsonb_typeof(p_payload) is distinct from 'object' or pg_column_size(p_payload) > 1024 then
    raise exception 'matrix_enqueue: invalid payload' using errcode = 'invalid_parameter_value';
  end if;
  if p_kind = 'matrix.logout-devices'
     and (v_user is null or p_payload->>'userId' is distinct from v_user::text) then
    raise exception 'matrix_enqueue: devices of another person' using errcode = 'insufficient_privilege';
  end if;
  perform set_config('app.matrix_jobs', 'on', true);
  perform pg_advisory_xact_lock(hashtext('matrix_enqueue:' || p_kind || ':' || p_payload::text));
  select run.id into v_id
  from public.job_runs run
  where run.kind = p_kind and run.status = 'pending' and run.payload = p_payload
  limit 1;
  if v_id is null then
    insert into public.job_runs
      (kind, scope, requested_by, payload, idempotency_key, max_attempts, run_after)
    values
      (p_kind, 'platform', v_user, p_payload,
       left(p_kind || ':' || gen_random_uuid()::text, 200), 5,
       coalesce(p_run_after, now()))
    returning id into v_id;
  end if;
  perform set_config('app.matrix_jobs', coalesce(v_previous, ''), true);
  return v_id;
end;
$$;

reset role;
