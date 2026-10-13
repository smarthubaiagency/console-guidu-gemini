-- ============================================================================
-- SQL channels (A5a): workspace isolation and roles of the connections and
-- routes, one active route per (connection, scope), events and
-- conversations written only by the ingestion, and the ingestion itself
-- (token hash, idempotency, routed or no_route, disabled connection).
--   workspace A a…011 (org a…010): owner a…031, viewer a…033
--   workspace B a…021 (org a…020): owner a…032
-- Each block prepares its fixtures as administrator, switches to
-- `app_runtime` with `set local role` and rolls back.
-- ============================================================================

create or replace function pg_temp.ctx(p_user uuid, p_ws uuid, p_org uuid)
returns void
language sql as $$
  select set_config('app.user_id', p_user::text, true),
         set_config('app.workspace_id', p_ws::text, true),
         set_config('app.organization_id', p_org::text, true),
         set_config('app.partner_id', '', true);
$$;

-- One connection in A (token hash = sha256 of 'token-a') and one in B.
create or replace function pg_temp.fixture() returns void
language sql as $$
  insert into public.channel_connections
    (id, organization_id, workspace_id, kind, name, config, encrypted_secrets,
     masked_secret, webhook_token_hash, created_by)
  values
    ('c5a00000-0000-4000-8000-0000000000a1', 'a0000000-0000-4000-8000-000000000010',
     'a0000000-0000-4000-8000-000000000011', 'chatwoot', 'Chatwoot A',
     '{"base_url": "https://chat.a.test", "account_id": 1, "agent_bot_id": 7}', 'cipher-a', '••••a',
     encode(sha256('token-a'::bytea), 'hex'), 'a0000000-0000-4000-8000-000000000031'),
    ('c5a00000-0000-4000-8000-0000000000b1', 'a0000000-0000-4000-8000-000000000020',
     'a0000000-0000-4000-8000-000000000021', 'chatwoot', 'Chatwoot B',
     '{"base_url": "https://chat.b.test", "account_id": 2, "agent_bot_id": 8}', 'cipher-b', '••••b',
     encode(sha256('token-b'::bytea), 'hex'), 'a0000000-0000-4000-8000-000000000032');
$$;

-- ----------------------------------------------------------------------------
-- Test 1: owner manages only the connections of its workspace
-- ----------------------------------------------------------------------------
begin;
select pg_temp.fixture();
set local role app_runtime;
do $$
begin
  perform pg_temp.ctx('a0000000-0000-4000-8000-000000000031', 'a0000000-0000-4000-8000-000000000011',
                      'a0000000-0000-4000-8000-000000000010');
  if (select count(*) from public.channel_connections) <> 1
     or not exists (select 1 from public.channel_connections where name = 'Chatwoot A') then
    raise exception 'channels: owner of A does not see exactly the connection of A';
  end if;

  update public.channel_connections set name = 'Atendimento',
    updated_by = 'a0000000-0000-4000-8000-000000000031'
  where id = 'c5a00000-0000-4000-8000-0000000000a1';
  if not found then raise exception 'channels: owner could not rename'; end if;

  update public.channel_connections set name = 'x', updated_by = 'a0000000-0000-4000-8000-000000000031'
  where id = 'c5a00000-0000-4000-8000-0000000000b1';
  if found then raise exception 'channels: owner of A changed the connection of B'; end if;

  -- The author and the kind never change.
  begin
    update public.channel_connections set created_by = 'a0000000-0000-4000-8000-000000000033',
      updated_by = 'a0000000-0000-4000-8000-000000000031'
    where id = 'c5a00000-0000-4000-8000-0000000000a1';
    raise exception 'channels: author changed';
  exception when check_violation then null;
  end;

  -- A connection cannot be created in another workspace.
  begin
    insert into public.channel_connections
      (organization_id, workspace_id, kind, name, encrypted_secrets, masked_secret, webhook_token_hash, created_by)
    values ('a0000000-0000-4000-8000-000000000020', 'a0000000-0000-4000-8000-000000000021', 'chatwoot', 'x',
            'c', 'm', repeat('a', 64), 'a0000000-0000-4000-8000-000000000031');
    raise exception 'channels: connection created in workspace B';
  exception when insufficient_privilege then null;
  end;
end
$$;
rollback;

-- ----------------------------------------------------------------------------
-- Test 2: an editor reads, a viewer sees nothing, neither manages
-- ----------------------------------------------------------------------------
begin;
select pg_temp.fixture();
insert into public.channel_routes (organization_id, workspace_id, connection_id, scope, consumer_module, consumer_ref, created_by)
values ('a0000000-0000-4000-8000-000000000010', 'a0000000-0000-4000-8000-000000000011',
        'c5a00000-0000-4000-8000-0000000000a1', '10', 'ai-agents', gen_random_uuid(),
        'a0000000-0000-4000-8000-000000000031');
set local role app_runtime;
do $$
begin
  perform pg_temp.ctx('a0000000-0000-4000-8000-000000000033', 'a0000000-0000-4000-8000-000000000011',
                      'a0000000-0000-4000-8000-000000000010');
  if exists (select 1 from public.channel_connections) or exists (select 1 from public.channel_routes) then
    raise exception 'channels: viewer sees connections or routes';
  end if;
end
$$;
reset role;
select set_config('app.user_id', '', true);
update public.workspace_members set role = 'editor'
where workspace_id = 'a0000000-0000-4000-8000-000000000011' and user_id = 'a0000000-0000-4000-8000-000000000033';
set local role app_runtime;
do $$
begin
  perform pg_temp.ctx('a0000000-0000-4000-8000-000000000033', 'a0000000-0000-4000-8000-000000000011',
                      'a0000000-0000-4000-8000-000000000010');
  if (select count(*) from public.channel_connections) <> 1 or (select count(*) from public.channel_routes) <> 1 then
    raise exception 'channels: editor does not read the connection and route of A';
  end if;
  update public.channel_connections set name = 'x', updated_by = 'a0000000-0000-4000-8000-000000000033';
  if found then raise exception 'channels: editor changed a connection'; end if;
  delete from public.channel_routes;
  if found then raise exception 'channels: editor removed a route'; end if;
  begin
    insert into public.channel_routes (organization_id, workspace_id, connection_id, scope, consumer_module, consumer_ref, created_by)
    values ('a0000000-0000-4000-8000-000000000010', 'a0000000-0000-4000-8000-000000000011',
            'c5a00000-0000-4000-8000-0000000000a1', '11', 'ai-agents', gen_random_uuid(),
            'a0000000-0000-4000-8000-000000000033');
    raise exception 'channels: editor created a route';
  exception when insufficient_privilege then null;
  end;
end
$$;
rollback;

-- ----------------------------------------------------------------------------
-- Test 3: one active route per (connection, scope); a route changes only
-- its status; events and conversations are not written by the app
-- ----------------------------------------------------------------------------
begin;
select pg_temp.fixture();
set local role app_runtime;
do $$
declare
  v_route uuid;
begin
  perform pg_temp.ctx('a0000000-0000-4000-8000-000000000031', 'a0000000-0000-4000-8000-000000000011',
                      'a0000000-0000-4000-8000-000000000010');
  insert into public.channel_routes (organization_id, workspace_id, connection_id, scope, consumer_module, consumer_ref, created_by)
  values ('a0000000-0000-4000-8000-000000000010', 'a0000000-0000-4000-8000-000000000011',
          'c5a00000-0000-4000-8000-0000000000a1', '10', 'ai-agents', gen_random_uuid(),
          'a0000000-0000-4000-8000-000000000031')
  returning id into v_route;
  begin
    insert into public.channel_routes (organization_id, workspace_id, connection_id, scope, consumer_module, consumer_ref, created_by)
    values ('a0000000-0000-4000-8000-000000000010', 'a0000000-0000-4000-8000-000000000011',
            'c5a00000-0000-4000-8000-0000000000a1', '10', 'crm', gen_random_uuid(),
            'a0000000-0000-4000-8000-000000000031');
    raise exception 'channels: two active routes for the same inbox';
  exception when unique_violation then null;
  end;
  begin
    update public.channel_routes set scope = '99', updated_by = 'a0000000-0000-4000-8000-000000000031'
    where id = v_route;
    raise exception 'channels: route scope changed';
  exception when check_violation then null;
  end;
  update public.channel_routes set status = 'closed', updated_by = 'a0000000-0000-4000-8000-000000000031'
  where id = v_route;
  -- Closed, the inbox may get a new owner.
  insert into public.channel_routes (organization_id, workspace_id, connection_id, scope, consumer_module, consumer_ref, created_by)
  values ('a0000000-0000-4000-8000-000000000010', 'a0000000-0000-4000-8000-000000000011',
          'c5a00000-0000-4000-8000-0000000000a1', '10', 'crm', gen_random_uuid(),
          'a0000000-0000-4000-8000-000000000031');

  -- A route of A cannot point at the connection of B.
  begin
    insert into public.channel_routes (organization_id, workspace_id, connection_id, scope, consumer_module, consumer_ref, created_by)
    values ('a0000000-0000-4000-8000-000000000010', 'a0000000-0000-4000-8000-000000000011',
            'c5a00000-0000-4000-8000-0000000000b1', '10', 'ai-agents', gen_random_uuid(),
            'a0000000-0000-4000-8000-000000000031');
    raise exception 'channels: route of A on the connection of B';
  exception when foreign_key_violation then null;
  end;

  begin
    insert into public.channel_inbound_events (organization_id, workspace_id, connection_id, external_id,
      contract_version, kind, sender, scope, payload, status)
    values ('a0000000-0000-4000-8000-000000000010', 'a0000000-0000-4000-8000-000000000011',
            'c5a00000-0000-4000-8000-0000000000a1', 'forged', 1, 'message', 'contact', '10', '{}', 'routed');
    raise exception 'channels: app wrote an inbound event';
  exception when insufficient_privilege then null;
  end;
  begin
    insert into public.channel_conversations (organization_id, workspace_id, connection_id, scope, external_id)
    values ('a0000000-0000-4000-8000-000000000010', 'a0000000-0000-4000-8000-000000000011',
            'c5a00000-0000-4000-8000-0000000000a1', '10', 'forged');
    raise exception 'channels: app wrote a conversation';
  exception when insufficient_privilege then null;
  end;
end
$$;
rollback;

-- ----------------------------------------------------------------------------
-- Test 4: the ingestion checks the token hash, writes once, marks routed or
-- no_route and refuses a disabled connection; the helper sees nothing
-- outside the functions
-- ----------------------------------------------------------------------------
begin;
select pg_temp.fixture();
insert into public.channel_routes (organization_id, workspace_id, connection_id, scope, consumer_module, consumer_ref, created_by)
values ('a0000000-0000-4000-8000-000000000010', 'a0000000-0000-4000-8000-000000000011',
        'c5a00000-0000-4000-8000-0000000000a1', '10', 'ai-agents', gen_random_uuid(),
        'a0000000-0000-4000-8000-000000000031');
set local role app_runtime;
do $$
declare
  v_hash text := encode(sha256('token-a'::bytea), 'hex');
  v_events jsonb := '[
    {"contractVersion": 1, "externalId": "message:1", "kind": "message", "sender": "contact", "scope": "10",
     "conversation": {"externalId": "500", "contactId": "9", "status": "pending"}},
    {"contractVersion": 1, "externalId": "message:2", "kind": "message", "sender": "contact", "scope": "20",
     "conversation": {"externalId": "501", "contactId": null, "status": "open"}}
  ]';
  v_row record;
begin
  -- No context: the webhook has no user.
  if private.channel_webhook_connection('c5a00000-0000-4000-8000-0000000000a1', v_hash) is distinct from 'chatwoot' then
    raise exception 'channels: right token not accepted';
  end if;
  if private.channel_webhook_connection('c5a00000-0000-4000-8000-0000000000a1',
       encode(sha256('token-b'::bytea), 'hex')) is not null then
    raise exception 'channels: token of B accepted for A';
  end if;
  if exists (select 1 from private.channel_ingest('c5a00000-0000-4000-8000-0000000000a1', repeat('0', 64), v_events)) then
    raise exception 'channels: ingestion with a wrong token';
  end if;

  select * into v_row from private.channel_ingest('c5a00000-0000-4000-8000-0000000000a1', v_hash, v_events);
  if v_row.stored <> 2 or v_row.duplicates <> 0 then
    raise exception 'channels: first call stored %/% duplicates', v_row.stored, v_row.duplicates;
  end if;
  select * into v_row from private.channel_ingest('c5a00000-0000-4000-8000-0000000000a1', v_hash, v_events);
  if v_row.stored <> 0 or v_row.duplicates <> 2 then
    raise exception 'channels: retry stored % events', v_row.stored;
  end if;
  if current_setting('app.channel_ingest', true) = 'on' then
    raise exception 'channels: ingestion flag left on';
  end if;

  -- Seen by the owner of A, with the status by route.
  perform pg_temp.ctx('a0000000-0000-4000-8000-000000000031', 'a0000000-0000-4000-8000-000000000011',
                      'a0000000-0000-4000-8000-000000000010');
  if (select status from public.channel_inbound_events where external_id = 'message:1') <> 'routed'
     or (select status from public.channel_inbound_events where external_id = 'message:2') <> 'no_route' then
    raise exception 'channels: routed/no_route not set';
  end if;
  if (select count(*) from public.channel_conversations) <> 2
     or (select external_contact_id from public.channel_conversations where external_id = '500') <> '9' then
    raise exception 'channels: conversations not written';
  end if;
  if (select last_event_at from public.channel_connections where id = 'c5a00000-0000-4000-8000-0000000000a1') is null then
    raise exception 'channels: last_event_at not set';
  end if;

  -- The owner of B sees none of it.
  perform pg_temp.ctx('a0000000-0000-4000-8000-000000000032', 'a0000000-0000-4000-8000-000000000021',
                      'a0000000-0000-4000-8000-000000000020');
  if exists (select 1 from public.channel_inbound_events) or exists (select 1 from public.channel_conversations) then
    raise exception 'channels: owner of B sees events of A';
  end if;

  -- Disabled, the connection takes nothing.
  perform pg_temp.ctx('a0000000-0000-4000-8000-000000000031', 'a0000000-0000-4000-8000-000000000011',
                      'a0000000-0000-4000-8000-000000000010');
  update public.channel_connections set status = 'disabled', updated_by = 'a0000000-0000-4000-8000-000000000031'
  where id = 'c5a00000-0000-4000-8000-0000000000a1';
  if private.channel_webhook_connection('c5a00000-0000-4000-8000-0000000000a1', v_hash) is not null
     or exists (select 1 from private.channel_ingest('c5a00000-0000-4000-8000-0000000000a1', v_hash,
                  '[{"externalId": "message:3", "kind": "message", "sender": "contact", "scope": "10"}]')) then
    raise exception 'channels: disabled connection accepted events';
  end if;
end
$$;
reset role;
set local role app_rls_helper;
do $$
begin
  if exists (select 1 from public.channel_inbound_events) or exists (select 1 from public.channel_connections) then
    raise exception 'channels: helper sees channels outside the ingestion';
  end if;
end
$$;
rollback;

-- ----------------------------------------------------------------------------
-- Test 5: the worker purges only a purgeable workspace
-- ----------------------------------------------------------------------------
begin;
select pg_temp.fixture();
set local role app_worker;
do $$
begin
  delete from public.channel_connections;
  if found then raise exception 'channels: worker deleted connections of a live workspace'; end if;
end
$$;
rollback;

select 'channels-rls: all tests passed' as result;
