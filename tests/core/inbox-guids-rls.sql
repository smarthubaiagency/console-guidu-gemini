-- ============================================================================
-- SQL IN6: the GUIDS in the room of the Inbox.
--   workspace A a…011 (org a…010): owner a…031, viewer a…033
--   workspace B a…021 (org a…020): owner a…032
-- Fixtures add an Attendant (…e5) to A, a GUIDS of A, the Inbox settings
-- choosing it and a pending room. Each block prepares as administrator,
-- switches role with `set local role` and rolls back.
-- ============================================================================

create or replace function pg_temp.ctx(p_user uuid, p_ws uuid, p_org uuid)
returns void
language sql as $$
  select set_config('app.user_id', coalesce(p_user::text, ''), true),
         set_config('app.workspace_id', coalesce(p_ws::text, ''), true),
         set_config('app.organization_id', coalesce(p_org::text, ''), true),
         set_config('app.partner_id', '', true);
$$;

create or replace function pg_temp.fixture() returns void
language sql as $$
  insert into auth.users (id, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
  values ('1e600000-0000-4000-8000-0000000000e5', 'in6-attendant@test.guidu.co', '', now(), '{}', '{}', now(), now());
  insert into public.profiles (id, full_name, status)
  values ('1e600000-0000-4000-8000-0000000000e5', 'Atendente IN6', 'active');
  insert into public.organization_members (organization_id, user_id, role, status)
  values ('a0000000-0000-4000-8000-000000000010', '1e600000-0000-4000-8000-0000000000e5', 'member', 'active');
  insert into public.workspace_members (workspace_id, organization_id, user_id, role, status)
  values ('a0000000-0000-4000-8000-000000000011', 'a0000000-0000-4000-8000-000000000010',
          '1e600000-0000-4000-8000-0000000000e5', 'attendant', 'active');
  insert into public.ai_agents (id, kind, organization_id, workspace_id, status, config, config_version, created_by)
  values ('1e600000-0000-4000-8000-0000000000a9', 'guid', 'a0000000-0000-4000-8000-000000000010',
          'a0000000-0000-4000-8000-000000000011', 'active',
          '{"overview": {"agent_name": "Lia"}}', 1, 'a0000000-0000-4000-8000-000000000031');
  insert into public.workspace_modules (organization_id, workspace_id, module_key, status, updated_by, config)
  values ('a0000000-0000-4000-8000-000000000010', 'a0000000-0000-4000-8000-000000000011', 'inbox', 'enabled',
          'a0000000-0000-4000-8000-000000000031',
          '{"guids_agent_id": "1e600000-0000-4000-8000-0000000000a9", "service": {"grouping_seconds": 8}}')
  on conflict (workspace_id, module_key) do update
    set status = 'enabled', updated_by = excluded.updated_by, config = excluded.config;
  insert into public.matrix_rooms (id, organization_id, workspace_id, room_id, origin, state, status)
  values
    ('1e600000-0000-4000-8000-0000000000b1', 'a0000000-0000-4000-8000-000000000010',
     'a0000000-0000-4000-8000-000000000011', '!in6-pendente', 'matrix', 'active', 'pending'),
    ('1e600000-0000-4000-8000-0000000000b2', 'a0000000-0000-4000-8000-000000000010',
     'a0000000-0000-4000-8000-000000000011', '!in6-aberta', 'matrix', 'active', 'open'),
    ('1e600000-0000-4000-8000-0000000000b3', 'a0000000-0000-4000-8000-000000000020',
     'a0000000-0000-4000-8000-000000000021', '!in6-sala-b', 'matrix', 'active', 'pending');
  insert into public.matrix_agent_users (agent_id, workspace_id, organization_id, localpart, mxid, display_name, state)
  values ('1e600000-0000-4000-8000-0000000000a9', 'a0000000-0000-4000-8000-000000000011',
          'a0000000-0000-4000-8000-000000000010', '_guidu_a_abcdefghijklmnop',
          '@_guidu_a_abcdefghijklmnop:matrix.test', 'Lia', 'active');
$$;

-- ----------------------------------------------------------------------------
-- Test 1: the worker enqueues one turn per pending room, as who chose
-- ----------------------------------------------------------------------------
begin;
select pg_temp.fixture();
set local role app_worker;
do $$
declare
  v_first uuid;
  v_second uuid;
  v_run record;
begin
  if (select agent_name from private.inbox_guids_of('a0000000-0000-4000-8000-000000000011')) is distinct from 'Lia'
     or (select grouping_seconds from private.inbox_guids_of('a0000000-0000-4000-8000-000000000011')) <> 8 then
    raise exception 'in6: inbox_guids_of does not read the settings';
  end if;
  v_first := private.inbox_guids_enqueue('!in6-pendente');
  v_second := private.inbox_guids_enqueue('!in6-pendente');
  if v_first is null or v_first is distinct from v_second then
    raise exception 'in6: one pending turn per room (% / %)', v_first, v_second;
  end if;
  if private.inbox_guids_enqueue('!in6-aberta') is not null then
    raise exception 'in6: an open room is the team''s';
  end if;
  if private.inbox_guids_enqueue('!in6-sala-b') is not null then
    raise exception 'in6: a workspace without an Inbox GUIDS has no turn';
  end if;
  if private.inbox_guids_enqueue('!desconhecida') is not null then
    raise exception 'in6: an unknown room has no turn';
  end if;
  -- The flag of the helper is back to what it was.
  if coalesce(current_setting('app.inbox_guids', true), '') <> '' then
    raise exception 'in6: app.inbox_guids leaked';
  end if;
end
$$;
reset role;
do $$
declare
  v_run record;
begin
  select * into v_run from public.job_runs where kind = 'inbox.guids-turn';
  if v_run.scope <> 'workspace'
     or v_run.requested_by <> 'a0000000-0000-4000-8000-000000000031'
     or v_run.workspace_id <> 'a0000000-0000-4000-8000-000000000011'
     or v_run.payload->>'roomId' <> '!in6-pendente'
     or v_run.max_attempts <> 1
     or v_run.run_after < now() + interval '7 seconds' then
    raise exception 'in6: unexpected turn run %', row_to_json(v_run);
  end if;
end
$$;
rollback;

-- A paused GUIDS, or none chosen, answers nothing.
begin;
select pg_temp.fixture();
update public.ai_agents set status = 'paused' where id = '1e600000-0000-4000-8000-0000000000a9';
set local role app_worker;
do $$
begin
  if private.inbox_guids_enqueue('!in6-pendente') is not null then
    raise exception 'in6: a paused GUIDS has no turn';
  end if;
end
$$;
rollback;

-- The web may not enqueue a turn nor read the settings of another person.
begin;
select pg_temp.fixture();
set local role app_runtime;
do $$
begin
  perform pg_temp.ctx('a0000000-0000-4000-8000-000000000031', 'a0000000-0000-4000-8000-000000000011',
                      'a0000000-0000-4000-8000-000000000010');
  begin
    perform private.inbox_guids_enqueue('!in6-pendente');
    raise exception 'in6: the web enqueued a turn';
  exception when insufficient_privilege then null;
  end;
  -- matrix.sync-agent is a kind of the core's enqueue.
  perform private.matrix_enqueue('matrix.sync-agent', '{"workspaceId": "a0000000-0000-4000-8000-000000000011"}'::jsonb);
end
$$;
rollback;

-- ----------------------------------------------------------------------------
-- Test 2: what the GUIDS keeps per room
-- ----------------------------------------------------------------------------
begin;
select pg_temp.fixture();
set local role app_runtime;
do $$
begin
  -- The owner (the turn runs as who chose the GUIDS) writes the cursor.
  perform pg_temp.ctx('a0000000-0000-4000-8000-000000000031', 'a0000000-0000-4000-8000-000000000011',
                      'a0000000-0000-4000-8000-000000000010');
  insert into public.inbox_guids_rooms (room_id, workspace_id, organization_id, agent_id, last_answered_event_id, last_answered_ts)
  values ('!in6-pendente', 'a0000000-0000-4000-8000-000000000011', 'a0000000-0000-4000-8000-000000000010',
          '1e600000-0000-4000-8000-0000000000a9', '$1', 10);
  update public.inbox_guids_rooms
  set handoff_summary = 'Quer um orçamento.', handoff_reason = 'Pediu uma pessoa.', handoff_at = now()
  where room_id = '!in6-pendente';
  if not found then
    raise exception 'in6: the owner could not keep the handoff';
  end if;
  -- Not for a room of another workspace.
  begin
    insert into public.inbox_guids_rooms (room_id, workspace_id, organization_id, agent_id)
    values ('!in6-sala-b', 'a0000000-0000-4000-8000-000000000011', 'a0000000-0000-4000-8000-000000000010',
            '1e600000-0000-4000-8000-0000000000a9');
    raise exception 'in6: a cursor for a room of another workspace';
  exception when insufficient_privilege then null;
  end;

  -- The Attendant reads the summary and the agent's name, writes nothing.
  perform pg_temp.ctx('1e600000-0000-4000-8000-0000000000e5', 'a0000000-0000-4000-8000-000000000011',
                      'a0000000-0000-4000-8000-000000000010');
  if (select handoff_summary from public.inbox_guids_rooms where room_id = '!in6-pendente') is distinct from 'Quer um orçamento.'
     or (select display_name from public.matrix_agent_users) is distinct from 'Lia' then
    raise exception 'in6: the Attendant reads the GUIDS card';
  end if;
  update public.inbox_guids_rooms set handoff_summary = 'outro' where room_id = '!in6-pendente';
  if found then
    raise exception 'in6: the Attendant changed what the GUIDS keeps';
  end if;

  -- The viewer has no level: nothing.
  perform pg_temp.ctx('a0000000-0000-4000-8000-000000000033', 'a0000000-0000-4000-8000-000000000011',
                      'a0000000-0000-4000-8000-000000000010');
  if exists (select 1 from public.inbox_guids_rooms) or exists (select 1 from public.matrix_agent_users) then
    raise exception 'in6: the viewer reads the GUIDS of the Inbox';
  end if;

  -- The owner of B sees nothing of A.
  perform pg_temp.ctx('a0000000-0000-4000-8000-000000000032', 'a0000000-0000-4000-8000-000000000021',
                      'a0000000-0000-4000-8000-000000000020');
  if exists (select 1 from public.inbox_guids_rooms) or exists (select 1 from public.matrix_agent_users) then
    raise exception 'in6: B reads the GUIDS of A';
  end if;
end
$$;
rollback;

-- ----------------------------------------------------------------------------
-- Test 3: GUIDS conversations of a room
-- ----------------------------------------------------------------------------
begin;
select pg_temp.fixture();
set local role app_runtime;
do $$
begin
  perform pg_temp.ctx('a0000000-0000-4000-8000-000000000031', 'a0000000-0000-4000-8000-000000000011',
                      'a0000000-0000-4000-8000-000000000010');
  insert into public.ai_conversations (kind, agent_id, organization_id, workspace_id, channel, matrix_room_id)
  values ('guid', '1e600000-0000-4000-8000-0000000000a9', 'a0000000-0000-4000-8000-000000000010',
          'a0000000-0000-4000-8000-000000000011', 'matrix', '!in6-pendente');
  -- One open conversation per agent and room.
  begin
    insert into public.ai_conversations (kind, agent_id, organization_id, workspace_id, channel, matrix_room_id)
    values ('guid', '1e600000-0000-4000-8000-0000000000a9', 'a0000000-0000-4000-8000-000000000010',
            'a0000000-0000-4000-8000-000000000011', 'matrix', '!in6-pendente');
    raise exception 'in6: two open conversations of the agent in a room';
  exception when unique_violation then null;
  end;
  -- Not for a room of another workspace.
  begin
    insert into public.ai_conversations (kind, agent_id, organization_id, workspace_id, channel, matrix_room_id)
    values ('guid', '1e600000-0000-4000-8000-0000000000a9', 'a0000000-0000-4000-8000-000000000010',
            'a0000000-0000-4000-8000-000000000011', 'matrix', '!in6-sala-b');
    raise exception 'in6: a conversation for a room of another workspace';
  exception when insufficient_privilege then null;
  end;
  -- The Attendant does not create them.
  perform pg_temp.ctx('1e600000-0000-4000-8000-0000000000e5', 'a0000000-0000-4000-8000-000000000011',
                      'a0000000-0000-4000-8000-000000000010');
  begin
    insert into public.ai_conversations (kind, agent_id, organization_id, workspace_id, channel, matrix_room_id)
    values ('guid', '1e600000-0000-4000-8000-0000000000a9', 'a0000000-0000-4000-8000-000000000010',
            'a0000000-0000-4000-8000-000000000011', 'matrix', '!in6-aberta');
    raise exception 'in6: the Attendant created a GUIDS conversation';
  exception when insufficient_privilege then null;
  end;
end
$$;
reset role;
do $$
begin
  -- A Matrix conversation always points at its room.
  begin
    insert into public.ai_conversations (kind, agent_id, organization_id, workspace_id, channel)
    values ('guid', '1e600000-0000-4000-8000-0000000000a9', 'a0000000-0000-4000-8000-000000000010',
            'a0000000-0000-4000-8000-000000000011', 'matrix');
    raise exception 'in6: a Matrix conversation without its room';
  exception when check_violation then null;
  end;
end
$$;
rollback;

-- ----------------------------------------------------------------------------
-- Test 4: no grants to anon and authenticated; RLS forced
-- ----------------------------------------------------------------------------
do $$
declare
  t text;
begin
  foreach t in array array['matrix_agent_users', 'inbox_guids_rooms'] loop
    if has_table_privilege('anon', 'public.' || t, 'select')
       or has_table_privilege('authenticated', 'public.' || t, 'select') then
      raise exception 'in6: % is open to anon or authenticated', t;
    end if;
    if not (select relrowsecurity and relforcerowsecurity from pg_class where oid = ('public.' || t)::regclass) then
      raise exception 'in6: % without forced RLS', t;
    end if;
  end loop;
end
$$;
