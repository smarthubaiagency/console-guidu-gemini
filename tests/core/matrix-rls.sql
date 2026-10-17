-- ============================================================================
-- SQL Matrix core (IN3): who may have an account, the workspace isolation of
-- the rooms, the own account of each person, the ingestion of the
-- Application Service (idempotent, one pending run), the queue of the
-- Matrix jobs and the immutable columns.
--   workspace A a…011 (org a…010): owner a…031, viewer a…033, blocked a…036
--   workspace B a…021 (org a…020): owner a…032
-- Each block prepares its fixtures as administrator, switches role with
-- `set local role` and rolls back.
-- ============================================================================

create or replace function pg_temp.ctx(p_user uuid, p_ws uuid, p_org uuid)
returns void
language sql as $$
  select set_config('app.user_id', coalesce(p_user::text, ''), true),
         set_config('app.workspace_id', coalesce(p_ws::text, ''), true),
         set_config('app.organization_id', coalesce(p_org::text, ''), true),
         set_config('app.partner_id', '', true);
$$;

-- One room in A and one in B.
create or replace function pg_temp.fixture() returns void
language sql as $$
  insert into public.matrix_rooms (id, organization_id, workspace_id, room_id, origin, state)
  values
    ('1a300000-0000-4000-8000-0000000000a1', 'a0000000-0000-4000-8000-000000000010',
     'a0000000-0000-4000-8000-000000000011', '!sala-a', 'matrix', 'active'),
    ('1a300000-0000-4000-8000-0000000000b1', 'a0000000-0000-4000-8000-000000000020',
     'a0000000-0000-4000-8000-000000000021', '!sala-b', 'matrix', 'active');
  insert into public.matrix_room_members (room_id, organization_id, workspace_id, user_mxid, membership)
  values
    ('!sala-a', 'a0000000-0000-4000-8000-000000000010', 'a0000000-0000-4000-8000-000000000011',
     '@cliente:matrix.test', 'join'),
    ('!sala-b', 'a0000000-0000-4000-8000-000000000020', 'a0000000-0000-4000-8000-000000000021',
     '@cliente:matrix.test', 'join');
$$;

-- ----------------------------------------------------------------------------
-- Test 1: who may have an account
-- ----------------------------------------------------------------------------
begin;
-- Workspace A2 in organization A, where the owner of the company has no
-- membership row: they stand in as its owner.
insert into public.workspaces (id, organization_id, slug, name, status)
values ('a0000000-0000-4000-8000-000000000012', 'a0000000-0000-4000-8000-000000000010',
        'workspace-a2', 'Workspace A2', 'active');
set local role app_worker;
do $$
begin
  if (select count(*) from private.matrix_user_memberships('a0000000-0000-4000-8000-000000000031')) <> 2
     or not exists (
       select 1 from private.matrix_user_memberships('a0000000-0000-4000-8000-000000000031')
       where workspace_id = 'a0000000-0000-4000-8000-000000000012' and role = 'owner'
     ) then
    raise exception 'matrix: the company owner should count as owner of A and A2';
  end if;
  if exists (select 1 from private.matrix_user_memberships('a0000000-0000-4000-8000-000000000036')) then
    raise exception 'matrix: a blocked identity must not have memberships';
  end if;
  if exists (select 1 from private.matrix_user_memberships('a0000000-0000-4000-8000-000000000034')) then
    raise exception 'matrix: an organization admin without membership must have none';
  end if;
  if (select count(*) from private.matrix_workspace_people('a0000000-0000-4000-8000-000000000011')) <> 2 then
    raise exception 'matrix: workspace A has the owner and the viewer (not the blocked one)';
  end if;
  if (select status from private.matrix_workspace('a0000000-0000-4000-8000-000000000011')) <> 'active' then
    raise exception 'matrix: the worker reads the status of a workspace';
  end if;
end
$$;
reset role;
-- A workspace out of `active` gives no membership.
update public.workspaces set status = 'deletion_scheduled', deletion_requested_at = now(),
  purge_after = now() + interval '30 days'
where id = 'a0000000-0000-4000-8000-000000000011';
set local role app_worker;
do $$
begin
  if exists (
    select 1 from private.matrix_user_memberships('a0000000-0000-4000-8000-000000000031')
    where workspace_id = 'a0000000-0000-4000-8000-000000000011'
  ) or exists (select 1 from private.matrix_workspace_people('a0000000-0000-4000-8000-000000000011')) then
    raise exception 'matrix: a workspace in deletion still gives memberships';
  end if;
end
$$;
rollback;

-- ----------------------------------------------------------------------------
-- Test 2: rooms are read only by inbox roles of their workspace
-- ----------------------------------------------------------------------------
begin;
select pg_temp.fixture();
set local role app_runtime;
do $$
begin
  perform pg_temp.ctx('a0000000-0000-4000-8000-000000000031', 'a0000000-0000-4000-8000-000000000011',
                      'a0000000-0000-4000-8000-000000000010');
  if (select count(*) from public.matrix_rooms) <> 1
     or not exists (select 1 from public.matrix_rooms where room_id = '!sala-a')
     or (select count(*) from public.matrix_room_members) <> 1 then
    raise exception 'matrix: owner of A does not see exactly the room of A';
  end if;

  -- Viewer of A: no inbox.view.
  perform pg_temp.ctx('a0000000-0000-4000-8000-000000000033', 'a0000000-0000-4000-8000-000000000011',
                      'a0000000-0000-4000-8000-000000000010');
  if exists (select 1 from public.matrix_rooms) or exists (select 1 from public.matrix_room_members) then
    raise exception 'matrix: a viewer reads the rooms';
  end if;

  -- Owner of A pointed at B.
  perform pg_temp.ctx('a0000000-0000-4000-8000-000000000031', 'a0000000-0000-4000-8000-000000000021',
                      'a0000000-0000-4000-8000-000000000020');
  if exists (select 1 from public.matrix_rooms) then
    raise exception 'matrix: owner of A reads the rooms of B';
  end if;
end
$$;
-- The web never writes a room.
do $$
begin
  perform pg_temp.ctx('a0000000-0000-4000-8000-000000000031', 'a0000000-0000-4000-8000-000000000011',
                      'a0000000-0000-4000-8000-000000000010');
  begin
    update public.matrix_rooms set status = 'resolved' where room_id = '!sala-a';
    raise exception 'matrix: app_runtime updated a room';
  exception when insufficient_privilege then null;
  end;
end
$$;
rollback;

-- ----------------------------------------------------------------------------
-- Test 3: each person creates and reactivates only their own account
-- ----------------------------------------------------------------------------
begin;
set local role app_runtime;
do $$
begin
  perform pg_temp.ctx('a0000000-0000-4000-8000-000000000031', null, null);
  insert into public.matrix_accounts (profile_id, localpart, mxid)
  values ('a0000000-0000-4000-8000-000000000031', 'u_aaaaaaaaaaaaaaaaaaaaaaaa', '@u_aaaaaaaaaaaaaaaaaaaaaaaa:matrix.test');
  if (select count(*) from public.matrix_accounts) <> 1 then
    raise exception 'matrix: the owner does not see their own account';
  end if;

  begin
    insert into public.matrix_accounts (profile_id, localpart, mxid)
    values ('a0000000-0000-4000-8000-000000000032', 'u_bbbbbbbbbbbbbbbbbbbbbbbb', '@u_bbbbbbbbbbbbbbbbbbbbbbbb:matrix.test');
    raise exception 'matrix: someone created the account of another person';
  exception when insufficient_privilege then null;
  end;

  begin
    update public.matrix_accounts set status = 'deactivated', deactivated_at = now()
    where profile_id = 'a0000000-0000-4000-8000-000000000031';
    raise exception 'matrix: a person deactivated their own account';
  exception when insufficient_privilege then null;
  end;

  -- The viewer has no inbox.view anywhere: no account.
  perform pg_temp.ctx('a0000000-0000-4000-8000-000000000033', null, null);
  if exists (select 1 from public.matrix_accounts) then
    raise exception 'matrix: the viewer sees an account that is not theirs';
  end if;
  begin
    insert into public.matrix_accounts (profile_id, localpart, mxid)
    values ('a0000000-0000-4000-8000-000000000033', 'u_cccccccccccccccccccccccc', '@u_cccccccccccccccccccccccc:matrix.test');
    raise exception 'matrix: a viewer created an account';
  exception when insufficient_privilege then null;
  end;
end
$$;
reset role;
update public.matrix_accounts set status = 'deactivated', deactivated_at = now()
where profile_id = 'a0000000-0000-4000-8000-000000000031';
set local role app_runtime;
do $$
begin
  perform pg_temp.ctx('a0000000-0000-4000-8000-000000000031', null, null);
  update public.matrix_accounts set status = 'active', deactivated_at = null
  where profile_id = 'a0000000-0000-4000-8000-000000000031';
  if not found then raise exception 'matrix: an eligible person could not reactivate their account'; end if;
end
$$;
reset role;
-- The localpart is opaque: never the internal id.
do $$
begin
  begin
    insert into public.matrix_accounts (profile_id, localpart, mxid)
    values ('a0000000-0000-4000-8000-000000000032', 'u_a0000000000040008000000000000032',
            '@u_a0000000000040008000000000000032:matrix.test');
    raise exception 'matrix: a localpart outside the opaque format was accepted';
  exception when check_violation then null;
  end;
  begin
    update public.matrix_accounts set mxid = '@u_zzzzzzzzzzzzzzzzzzzzzzzz:matrix.test'
    where profile_id = 'a0000000-0000-4000-8000-000000000031';
    raise exception 'matrix: the mxid of an account changed';
  exception when check_violation then null;
  end;
end
$$;
rollback;

-- ----------------------------------------------------------------------------
-- Test 4: ingestion of the Application Service
-- ----------------------------------------------------------------------------
begin;
delete from public.job_runs where kind like 'matrix.%';
set local role app_runtime;
do $$
declare
  v_events jsonb := '[
    {"event_id": "$e1", "room_id": "!sala-a", "type": "m.room.member", "state_key": "@x:matrix.test",
     "sender": "@x:matrix.test", "content": {"membership": "join"}, "origin_server_ts": 1},
    {"event_id": "$e2", "room_id": "!sala-a", "type": "chat.guidu.conversation", "state_key": "",
     "sender": "@x:matrix.test", "content": {"status": "open", "assignee": null}, "origin_server_ts": 2}
  ]';
begin
  perform pg_temp.ctx(null, null, null);
  if private.matrix_as_ingest('10', 2, v_events) <> 2 then
    raise exception 'matrix: the first transaction did not store both events';
  end if;
  -- Synapse retries the transaction; and the same events in a new one.
  if private.matrix_as_ingest('10', 2, v_events) <> 0 or private.matrix_as_ingest('11', 2, v_events) <> 0 then
    raise exception 'matrix: a retried event was stored again';
  end if;
  begin
    perform 1 from public.matrix_events;
    raise exception 'matrix: app_runtime reads the events';
  exception when insufficient_privilege then null;
  end;
  begin
    perform private.matrix_as_ingest('12', 1, '[{"event_id": "$e3", "room_id": "!x", "type": "m.room.message",
      "sender": "@x:matrix.test", "content": {"body": "oi"}}]');
    raise exception 'matrix: a message event was stored';
  exception when check_violation then null;
  end;
end
$$;
reset role;
do $$
begin
  if (select count(*) from public.matrix_events) <> 2
     or (select count(*) from public.matrix_as_transactions) <> 2 then
    raise exception 'matrix: expected 2 events and 2 transactions';
  end if;
  if (select count(*) from public.job_runs where kind = 'matrix.process-events' and status = 'pending'
        and scope = 'platform' and workspace_id is null) <> 1 then
    raise exception 'matrix: expected one pending processing run';
  end if;
end
$$;
rollback;

-- ----------------------------------------------------------------------------
-- Test 5: queue of the Matrix jobs
-- ----------------------------------------------------------------------------
begin;
delete from public.job_runs where kind like 'matrix.%';
set local role app_runtime;
do $$
declare
  v_first uuid;
begin
  perform pg_temp.ctx('a0000000-0000-4000-8000-000000000031', 'a0000000-0000-4000-8000-000000000011',
                      'a0000000-0000-4000-8000-000000000010');
  v_first := private.matrix_enqueue('matrix.sync-account', '{"userId": "a0000000-0000-4000-8000-000000000033"}');
  if private.matrix_enqueue('matrix.sync-account', '{"userId": "a0000000-0000-4000-8000-000000000033"}') <> v_first then
    raise exception 'matrix: a second pending run of the same sync';
  end if;
  perform private.matrix_enqueue('matrix.logout-devices', '{"userId": "a0000000-0000-4000-8000-000000000031"}');
  begin
    perform private.matrix_enqueue('matrix.logout-devices', '{"userId": "a0000000-0000-4000-8000-000000000032"}');
    raise exception 'matrix: logout of the devices of another person';
  exception when insufficient_privilege then null;
  end;
  begin
    perform private.matrix_enqueue('billing.daily', '{}');
    raise exception 'matrix: enqueue accepted a kind outside the Matrix core';
  exception when invalid_parameter_value then null;
  end;
  begin
    insert into public.job_runs (kind, scope, payload, idempotency_key)
    values ('matrix.sync-account', 'platform', '{}', 'x');
    raise exception 'matrix: app_runtime inserted a platform run directly';
  exception when insufficient_privilege then null;
  end;
end
$$;
reset role;
do $$
begin
  if (select count(*) from public.job_runs where kind like 'matrix.%') <> 2 then
    raise exception 'matrix: expected two runs (sync and logout)';
  end if;
  if (select requested_by from public.job_runs where kind = 'matrix.sync-account')
     is distinct from 'a0000000-0000-4000-8000-000000000031' then
    raise exception 'matrix: the run does not record who asked';
  end if;
end
$$;
rollback;

-- ----------------------------------------------------------------------------
-- Test 6: the worker manages the Matrix tables; rooms keep their identity
-- ----------------------------------------------------------------------------
begin;
select pg_temp.fixture();
set local role app_worker;
do $$
begin
  if (select count(*) from public.matrix_rooms) <> 2 then
    raise exception 'matrix: the worker does not see every room';
  end if;
  update public.matrix_rooms set status = 'open', assignee = '@u_aaaaaaaaaaaaaaaaaaaaaaaa:matrix.test'
  where room_id = '!sala-a';
  if not found then raise exception 'matrix: the worker could not mirror the state'; end if;
  begin
    update public.matrix_rooms set room_id = '!outra' where room_id = '!sala-a';
    raise exception 'matrix: the room id of a room changed';
  exception when check_violation then null;
  end;
  begin
    update public.matrix_rooms set workspace_id = 'a0000000-0000-4000-8000-000000000021',
      organization_id = 'a0000000-0000-4000-8000-000000000020' where room_id = '!sala-a';
    raise exception 'matrix: a room moved to another workspace';
  exception when check_violation then null;
  end;
  begin
    insert into public.matrix_rooms (organization_id, workspace_id, origin, state)
    values ('a0000000-0000-4000-8000-000000000010', 'a0000000-0000-4000-8000-000000000011', 'matrix', 'active');
    raise exception 'matrix: an active room without room id';
  exception when check_violation then null;
  end;
  -- Deleting a room takes its members with it.
  delete from public.matrix_rooms where room_id = '!sala-b';
  if exists (select 1 from public.matrix_room_members where room_id = '!sala-b') then
    raise exception 'matrix: members outlived their room';
  end if;
end
$$;
rollback;

select 'matrix-rls: ok' as result;
