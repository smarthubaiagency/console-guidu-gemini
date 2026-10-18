-- ============================================================================
-- SQL IN7a: WhatsApp of Meta in the core.
--   workspace A a…011 (org a…010): owner a…031, viewer a…033
--   workspace B a…021 (org a…020): owner a…032
-- Fixtures add a GUIDS of A, a number of Meta of A with its route, a room
-- of a person talking by it, a contact and an outbound row. Each block
-- prepares as administrator, switches role with `set local role` and rolls
-- back.
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
  insert into public.ai_agents (id, kind, organization_id, workspace_id, status, config, config_version, created_by)
  values ('1e700000-0000-4000-8000-0000000000a9', 'guid', 'a0000000-0000-4000-8000-000000000010',
          'a0000000-0000-4000-8000-000000000011', 'active',
          '{"overview": {"agent_name": "Bia"}}', 1, 'a0000000-0000-4000-8000-000000000031');
  insert into public.channel_connections
    (id, organization_id, workspace_id, kind, name, config, encrypted_secrets, masked_secret,
     webhook_token_hash, created_by)
  values ('1e700000-0000-4000-8000-0000000000c1', 'a0000000-0000-4000-8000-000000000010',
          'a0000000-0000-4000-8000-000000000011', 'meta_whatsapp', 'WhatsApp',
          '{"phone_number_id": "1077000000001", "waba_id": "2077000000001", "display_phone_number": null, "verified_name": null, "linked_via": "manual"}',
          'sealed', '••••0001', repeat('a', 64), 'a0000000-0000-4000-8000-000000000031');
  insert into public.channel_routes
    (organization_id, workspace_id, connection_id, scope, consumer_module, consumer_ref, created_by)
  values ('a0000000-0000-4000-8000-000000000010', 'a0000000-0000-4000-8000-000000000011',
          '1e700000-0000-4000-8000-0000000000c1', '1077000000001', 'inbox',
          '1e700000-0000-4000-8000-0000000000a9', 'a0000000-0000-4000-8000-000000000031');
  insert into public.channel_conversations
    (id, organization_id, workspace_id, connection_id, scope, external_id, last_contact_message_at)
  values ('1e700000-0000-4000-8000-0000000000d1', 'a0000000-0000-4000-8000-000000000010',
          'a0000000-0000-4000-8000-000000000011', '1e700000-0000-4000-8000-0000000000c1',
          '1077000000001', '5511987654321', now());
  insert into public.matrix_rooms
    (id, organization_id, workspace_id, room_id, origin, state, status, channel_conversation_id)
  values ('1e700000-0000-4000-8000-0000000000b1', 'a0000000-0000-4000-8000-000000000010',
          'a0000000-0000-4000-8000-000000000011', '!in7a-maria', 'meta', 'active', 'pending',
          '1e700000-0000-4000-8000-0000000000d1');
  insert into public.matrix_contacts (workspace_id, organization_id, phone, localpart, mxid, state)
  values ('a0000000-0000-4000-8000-000000000011', 'a0000000-0000-4000-8000-000000000010',
          '5511987654321', '_guidu_c_abcdefghijklmnop', '@_guidu_c_abcdefghijklmnop:matrix.test', 'active');
  insert into public.matrix_outbound (event_id, room_id, workspace_id, organization_id, connection_id, status, external_id)
  values ('$in7a-out', '!in7a-maria', 'a0000000-0000-4000-8000-000000000011',
          'a0000000-0000-4000-8000-000000000010', '1e700000-0000-4000-8000-0000000000c1', 'sent', 'wamid.OUT1');
$$;

-- ----------------------------------------------------------------------------
-- Test 1: one connection per number, and only a valid number
-- ----------------------------------------------------------------------------
begin;
select pg_temp.fixture();
do $$
begin
  begin
    insert into public.channel_connections
      (organization_id, workspace_id, kind, name, config, encrypted_secrets, masked_secret,
       webhook_token_hash, created_by)
    values ('a0000000-0000-4000-8000-000000000020', 'a0000000-0000-4000-8000-000000000021',
            'meta_whatsapp', 'Outro', '{"phone_number_id": "1077000000001"}', 'sealed', '••••',
            repeat('b', 64), 'a0000000-0000-4000-8000-000000000032');
    raise exception 'in7a: a number is linked twice';
  exception when unique_violation then null;
  end;
  begin
    insert into public.channel_connections
      (organization_id, workspace_id, kind, name, config, encrypted_secrets, masked_secret,
       webhook_token_hash, created_by)
    values ('a0000000-0000-4000-8000-000000000020', 'a0000000-0000-4000-8000-000000000021',
            'meta_whatsapp', 'Sem número', '{}', 'sealed', '••••',
            repeat('c', 64), 'a0000000-0000-4000-8000-000000000032');
    raise exception 'in7a: a Meta connection without its number';
  exception when check_violation then null;
  end;
end
$$;
rollback;

-- ----------------------------------------------------------------------------
-- Test 2: the webhook writes the events of a known number and enqueues one
-- delivery; an unknown number writes nothing
-- ----------------------------------------------------------------------------
begin;
select pg_temp.fixture();
set local role app_runtime;
do $$
declare
  v_row record;
  v_event jsonb := '[{"contractVersion": 1, "externalId": "wamid.IN1", "kind": "message", "sender": "contact",
    "scope": "1077000000001", "occurredAt": null,
    "conversation": {"externalId": "5511987654321", "contactId": "5511987654321", "status": null},
    "contact": {"externalId": "5511987654321", "name": "Maria", "phone": "5511987654321", "email": null},
    "message": {"text": "Oi", "private": false, "attachments": []}}]';
begin
  select * into v_row from private.channel_meta_ingest('1077000000001', v_event, '[]');
  if v_row.stored <> 1 then raise exception 'in7a: the event was not stored'; end if;
  select * into v_row from private.channel_meta_ingest('1077000000001', v_event, '[]');
  if v_row.duplicates <> 1 then raise exception 'in7a: a retry stored twice'; end if;
  select * into v_row from private.channel_meta_ingest('9999999999999', v_event, '[]');
  if v_row.stored is not null then raise exception 'in7a: an unknown number wrote'; end if;
  -- Statuses mark only the failed deliveries.
  perform private.channel_meta_ingest('1077000000001', '[]',
    '[{"externalId": "wamid.OUT1", "status": "failed", "error": "meta_131026"}]');
end
$$;
reset role;
do $$
begin
  if (select status from public.channel_inbound_events where external_id = 'wamid.IN1') <> 'routed' then
    raise exception 'in7a: the event of a routed number is not routed';
  end if;
  if (select count(*) from public.job_runs where kind = 'channels.meta-inbound' and status = 'pending') <> 1 then
    raise exception 'in7a: one pending delivery';
  end if;
  if (select status from public.matrix_outbound where event_id = '$in7a-out') <> 'failed' then
    raise exception 'in7a: the failed status did not mark the delivery';
  end if;
end
$$;
rollback;

-- ----------------------------------------------------------------------------
-- Test 3: a room of a number takes the GUIDS of its route, as who opened it
-- ----------------------------------------------------------------------------
begin;
select pg_temp.fixture();
set local role app_worker;
do $$
declare
  v_run uuid;
begin
  if (select agent_name from private.channel_route_guids('!in7a-maria')) is distinct from 'Bia' then
    raise exception 'in7a: channel_route_guids does not read the route';
  end if;
  v_run := private.inbox_guids_enqueue('!in7a-maria');
  if v_run is null then raise exception 'in7a: the turn of a room of a number was not enqueued'; end if;
  if (select requested_by from public.job_runs where id = v_run) <> 'a0000000-0000-4000-8000-000000000031' then
    raise exception 'in7a: the turn does not run as who opened the route';
  end if;
end
$$;
rollback;

-- ----------------------------------------------------------------------------
-- Test 4: who reads the contacts and the deliveries
-- ----------------------------------------------------------------------------
begin;
select pg_temp.fixture();
set local role app_runtime;
select pg_temp.ctx('a0000000-0000-4000-8000-000000000031', 'a0000000-0000-4000-8000-000000000011', 'a0000000-0000-4000-8000-000000000010');
do $$
begin
  if (select count(*) from public.matrix_contacts) <> 1 or (select count(*) from public.matrix_outbound) <> 1 then
    raise exception 'in7a: the owner reads the contacts and deliveries';
  end if;
  begin
    insert into public.matrix_contacts (workspace_id, organization_id, phone, localpart, mxid)
    values ('a0000000-0000-4000-8000-000000000011', 'a0000000-0000-4000-8000-000000000010',
            '5511000000000', '_guidu_c_bbbbbbbbbbbbbbbb', '@_guidu_c_bbbbbbbbbbbbbbbb:matrix.test');
    raise exception 'in7a: the web wrote a contact';
  exception when insufficient_privilege then null;
  end;
end
$$;
select pg_temp.ctx('a0000000-0000-4000-8000-000000000032', 'a0000000-0000-4000-8000-000000000021', 'a0000000-0000-4000-8000-000000000020');
do $$
begin
  if (select count(*) from public.matrix_contacts) <> 0 or (select count(*) from public.matrix_outbound) <> 0 then
    raise exception 'in7a: another workspace reads the contacts';
  end if;
end
$$;
select pg_temp.ctx('a0000000-0000-4000-8000-000000000033', 'a0000000-0000-4000-8000-000000000011', 'a0000000-0000-4000-8000-000000000010');
do $$
begin
  if (select count(*) from public.matrix_contacts) <> 0 then
    raise exception 'in7a: the viewer (no Inbox) reads the contacts';
  end if;
end
$$;
rollback;

\echo 'meta-channel-rls.sql: ok'
