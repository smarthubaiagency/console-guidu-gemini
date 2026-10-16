-- ============================================================================
-- SQL Central de Eventos (H1): `public.events`, the chain functions, the
-- dispatch queue, the recipients of the worker, the situation reads of the
-- partner and of the platform, `notification_deliveries` with the hub's
-- columns and the `keychain` capability.
--   partner P e1a…001: d…004 partner_owner, d…006 partner_support,
--     d…008 partner_finance; partner Q e1a…002: d…009 partner_owner
--   company M e1a…010 (P, gerenciado): workspace e1a…011, owner d…005
--   company S e1a…020 (P, padrão): workspace e1a…021, owner d…007, admin d…002
--   company A a…010 (house, no mode row): workspace a…011, owner a…031,
--     viewer a…033
--   platform: d…003 owner (seed), d…010 operations, d…001 billing
-- Each block prepares its fixtures as administrator, switches role with
-- `set local role` and rolls back.
-- ============================================================================

create or replace function pg_temp.ctx(p_user uuid, p_ws uuid, p_org uuid, p_partner uuid default null)
returns void
language sql as $$
  select set_config('app.user_id', coalesce(p_user::text, ''), true),
         set_config('app.principal_type', 'user', true),
         set_config('app.grant_id', '', true),
         set_config('app.workspace_id', coalesce(p_ws::text, ''), true),
         set_config('app.organization_id', coalesce(p_org::text, ''), true),
         set_config('app.partner_id', coalesce(p_partner::text, ''), true);
$$;

create or replace function pg_temp.fixture() returns void
language sql as $$
  insert into public.partners (id, slug, name) values
    ('e1a00000-0000-4000-8000-000000000001', 'agencia-h1', 'Agência H1'),
    ('e1a00000-0000-4000-8000-000000000002', 'outra-h1', 'Outra H1');
  insert into public.partner_members (partner_id, user_id, email, role) values
    ('e1a00000-0000-4000-8000-000000000001', 'd0000000-0000-4000-8000-000000000004', 'owner@h1.test', 'partner_owner'),
    ('e1a00000-0000-4000-8000-000000000001', 'd0000000-0000-4000-8000-000000000006', 'sup@h1.test', 'partner_support'),
    ('e1a00000-0000-4000-8000-000000000001', 'd0000000-0000-4000-8000-000000000008', 'fin@h1.test', 'partner_finance'),
    ('e1a00000-0000-4000-8000-000000000002', 'd0000000-0000-4000-8000-000000000009', 'owner@outra-h1.test', 'partner_owner');
  insert into public.organizations (id, name, status, partner_id) values
    ('e1a00000-0000-4000-8000-000000000010', 'Gerenciada H1', 'active', 'e1a00000-0000-4000-8000-000000000001'),
    ('e1a00000-0000-4000-8000-000000000020', 'Padrão H1', 'active', 'e1a00000-0000-4000-8000-000000000001');
  insert into public.workspaces (id, organization_id, slug, name, status) values
    ('e1a00000-0000-4000-8000-000000000011', 'e1a00000-0000-4000-8000-000000000010', 'h1-gerenciada', 'Gerenciada', 'active'),
    ('e1a00000-0000-4000-8000-000000000021', 'e1a00000-0000-4000-8000-000000000020', 'h1-padrao', 'Padrão', 'active');
  insert into public.organization_members (organization_id, user_id, role, status) values
    ('e1a00000-0000-4000-8000-000000000010', 'd0000000-0000-4000-8000-000000000005', 'owner', 'active'),
    ('e1a00000-0000-4000-8000-000000000020', 'd0000000-0000-4000-8000-000000000007', 'owner', 'active');
  insert into public.workspace_members (workspace_id, organization_id, user_id, role, status) values
    ('e1a00000-0000-4000-8000-000000000011', 'e1a00000-0000-4000-8000-000000000010', 'd0000000-0000-4000-8000-000000000005', 'owner', 'active'),
    ('e1a00000-0000-4000-8000-000000000021', 'e1a00000-0000-4000-8000-000000000020', 'd0000000-0000-4000-8000-000000000007', 'owner', 'active'),
    ('e1a00000-0000-4000-8000-000000000021', 'e1a00000-0000-4000-8000-000000000020', 'd0000000-0000-4000-8000-000000000002', 'admin', 'active');
  insert into public.invitations (organization_id, workspace_id, email, role, token_hash, invited_by_user_id,
                                  status, expires_at, accepted_at, accepted_by_user_id) values
    ('e1a00000-0000-4000-8000-000000000020', 'e1a00000-0000-4000-8000-000000000021', 'Dono@Padrao.test', 'owner',
     'h1-token-1', 'd0000000-0000-4000-8000-000000000007', 'accepted', now() + interval '1 day', now(),
     'd0000000-0000-4000-8000-000000000007');
  insert into public.organization_service_modes (organization_id, partner_id, mode) values
    ('e1a00000-0000-4000-8000-000000000010', 'e1a00000-0000-4000-8000-000000000001', 'gerenciado'),
    ('e1a00000-0000-4000-8000-000000000020', 'e1a00000-0000-4000-8000-000000000001', 'padrao');
  insert into public.platform_admin_members (user_id, role, status) values
    ('d0000000-0000-4000-8000-000000000010', 'operations', 'active'),
    ('d0000000-0000-4000-8000-000000000001', 'billing', 'active')
  on conflict (user_id) do update set role = excluded.role, status = 'active';
  -- Events: customer notices of M, S and A; a billing notice of P about S;
  -- a platform event.
  insert into public.events (id, type, module, level, partner_id, organization_id, workspace_id,
                             severity, audiences, route, data, idempotency_key, created_by,
                             occurred_at, chain_key, seq, content_hash, prev_hash, key_version,
                             recipient_user_id) values
    ('e1a00000-0000-4000-8000-0000000000e1', 'ai.agent.key_backup', 'ai_agents', 'workspace',
     'e1a00000-0000-4000-8000-000000000001', 'e1a00000-0000-4000-8000-000000000010',
     'e1a00000-0000-4000-8000-000000000011', 'attention', array['customer'], 'service_mode',
     '{"secret":"gerenciada"}', 'h1:e1', null, now(), 'ws:e1a00000-0000-4000-8000-000000000011', 1,
     repeat('a', 64), null, 'k1', null),
    ('e1a00000-0000-4000-8000-0000000000e2', 'ai.agent.key_backup', 'ai_agents', 'workspace',
     'e1a00000-0000-4000-8000-000000000001', 'e1a00000-0000-4000-8000-000000000020',
     'e1a00000-0000-4000-8000-000000000021', 'attention', array['customer'], 'service_mode',
     '{"secret":"padrao"}', 'h1:e2', null, now(), 'ws:e1a00000-0000-4000-8000-000000000021', 1,
     repeat('b', 64), null, 'k1', null),
    ('e1a00000-0000-4000-8000-0000000000e3', 'google_business.analyses_done', 'google_business', 'workspace',
     '00000000-0000-4000-8000-000000000000', 'a0000000-0000-4000-8000-000000000010',
     'a0000000-0000-4000-8000-000000000011', 'info', array['customer'], 'subject_person',
     '{"secret":"casa"}', 'h1:e3', 'a0000000-0000-4000-8000-000000000031', now(),
     'ws:a0000000-0000-4000-8000-000000000011', 1, repeat('c', 64), null, 'k1',
     'a0000000-0000-4000-8000-000000000031'),
    ('e1a00000-0000-4000-8000-0000000000e4', 'billing.subscription.past_due', 'billing', 'partner',
     'e1a00000-0000-4000-8000-000000000001', 'e1a00000-0000-4000-8000-000000000020', null,
     'attention', array['partner'], 'partner', '{"secret":"cobranca"}', 'h1:e4', null, now(),
     'partner:e1a00000-0000-4000-8000-000000000001', 1, repeat('d', 64), null, 'k1', null),
    ('e1a00000-0000-4000-8000-0000000000e5', 'platform.events.chain_broken', 'events', 'platform',
     null, null, null, 'urgent', array['platform'], 'platform', '{"secret":"plataforma"}', 'h1:e5',
     null, now(), 'platform', 1, repeat('e', 64), null, 'k1', null);
  insert into public.notification_deliveries (partner_id, event_type, idempotency_key, event_id, channel,
                                              status, reason, recipient_email, subject, recipient_user_id) values
    ('e1a00000-0000-4000-8000-000000000001', 'ai.agent.key_backup', 'h1:e2:dono@padrao.test',
     'e1a00000-0000-4000-8000-0000000000e2', 'email', 'skipped', 'no_provider', 'dono@padrao.test',
     'Assunto', 'd0000000-0000-4000-8000-000000000007'),
    ('e1a00000-0000-4000-8000-000000000001', 'ai.agent.key_backup', 'h1:e2:whatsapp',
     'e1a00000-0000-4000-8000-0000000000e2', 'whatsapp', 'failed', 'http_500', null, null, null),
    ('e1a00000-0000-4000-8000-000000000001', 'billing.subscription.past_due', 'h1:e4:cobranca',
     'e1a00000-0000-4000-8000-0000000000e4', 'email', 'sent', null, 'cobranca@h1.test', 'Assunto', null);
$$;

-- ----------------------------------------------------------------------------
-- Test 1: members read their workspace's customer events, with data; nobody
-- else reads the table
-- ----------------------------------------------------------------------------
begin;
select pg_temp.fixture();
set local role app_runtime;
do $$
declare
  v_data jsonb;
begin
  perform pg_temp.ctx('a0000000-0000-4000-8000-000000000031', 'a0000000-0000-4000-8000-000000000011',
                      'a0000000-0000-4000-8000-000000000010', '00000000-0000-4000-8000-000000000000');
  if (select count(*) from public.events) <> 1 then
    raise exception 'events: owner of A does not see exactly the events of A';
  end if;
  select data into v_data from public.events;
  if v_data ->> 'secret' <> 'casa' then raise exception 'events: member does not read the data'; end if;
  -- The viewer reads too (any member of the workspace).
  perform pg_temp.ctx('a0000000-0000-4000-8000-000000000033', 'a0000000-0000-4000-8000-000000000011',
                      'a0000000-0000-4000-8000-000000000010', '00000000-0000-4000-8000-000000000000');
  if (select count(*) from public.events) <> 1 then raise exception 'events: viewer of A does not read'; end if;
  -- Another workspace in the context gives nothing to a non-member.
  perform pg_temp.ctx('a0000000-0000-4000-8000-000000000031', 'e1a00000-0000-4000-8000-000000000021',
                      'e1a00000-0000-4000-8000-000000000020');
  if exists (select 1 from public.events) then raise exception 'events: non-member reads a workspace'; end if;
  -- The partner managers and the platform read nothing from the table.
  perform pg_temp.ctx('d0000000-0000-4000-8000-000000000004', 'e1a00000-0000-4000-8000-000000000011',
                      'e1a00000-0000-4000-8000-000000000010', 'e1a00000-0000-4000-8000-000000000001');
  if exists (select 1 from public.events) then raise exception 'events: partner reads the table'; end if;
  perform pg_temp.ctx('d0000000-0000-4000-8000-000000000003', null, null);
  if exists (select 1 from public.events) then raise exception 'events: platform reads the table'; end if;
  -- The partner-only billing event never reaches the customer.
  perform pg_temp.ctx('d0000000-0000-4000-8000-000000000007', 'e1a00000-0000-4000-8000-000000000021',
                      'e1a00000-0000-4000-8000-000000000020', 'e1a00000-0000-4000-8000-000000000001');
  if (select count(*) from public.events) <> 1
     or exists (select 1 from public.events where audiences @> array['partner']) then
    raise exception 'events: customer reads a partner event';
  end if;
  -- No change and no removal from the web.
  begin
    update public.events set status = 'resolved';
    raise exception 'events: web changed an event';
  exception when insufficient_privilege then null;
  end;
  begin
    delete from public.events;
    raise exception 'events: web deleted an event';
  exception when insufficient_privilege then null;
  end;
end $$;
rollback;

-- ----------------------------------------------------------------------------
-- Test 2: emitEvent from the web: the context's workspace, as whom acts,
-- with the company's partner, now
-- ----------------------------------------------------------------------------
begin;
select pg_temp.fixture();
set local role app_runtime;
do $$
declare
  v_ok text := 'insert into public.events (id, type, module, level, partner_id, organization_id, workspace_id,
      severity, audiences, route, data, idempotency_key, created_by, occurred_at, chain_key, seq,
      content_hash, prev_hash, key_version) values (gen_random_uuid(), ''google_business.analyses_done'',
      ''google_business'', ''workspace'', %L, %L, %L, ''info'', array[''customer''], ''subject_person'',
      ''{}'', %L, %L, %s, %L, 2, repeat(''f'', 64), repeat(''b'', 64), ''k1'')';
begin
  -- Owner of S (padrão), in S.
  perform pg_temp.ctx('d0000000-0000-4000-8000-000000000007', 'e1a00000-0000-4000-8000-000000000021',
                      'e1a00000-0000-4000-8000-000000000020', 'e1a00000-0000-4000-8000-000000000001');
  execute format(v_ok, 'e1a00000-0000-4000-8000-000000000001', 'e1a00000-0000-4000-8000-000000000020',
                 'e1a00000-0000-4000-8000-000000000021', 'h1:web1', 'd0000000-0000-4000-8000-000000000007',
                 'now()', 'ws:e1a00000-0000-4000-8000-000000000021');
  -- In someone else's name.
  begin
    execute format(v_ok, 'e1a00000-0000-4000-8000-000000000001', 'e1a00000-0000-4000-8000-000000000020',
                   'e1a00000-0000-4000-8000-000000000021', 'h1:web2', 'd0000000-0000-4000-8000-000000000002',
                   'now()', 'ws:e1a00000-0000-4000-8000-000000000021');
    raise exception 'events: inserted in another person''s name';
  exception when insufficient_privilege then null;
  end;
  -- With another partner.
  begin
    execute format(v_ok, 'e1a00000-0000-4000-8000-000000000002', 'e1a00000-0000-4000-8000-000000000020',
                   'e1a00000-0000-4000-8000-000000000021', 'h1:web3', 'd0000000-0000-4000-8000-000000000007',
                   'now()', 'ws:e1a00000-0000-4000-8000-000000000021');
    raise exception 'events: inserted with another partner';
  exception when insufficient_privilege then null;
  end;
  -- Backdated.
  begin
    execute format(v_ok, 'e1a00000-0000-4000-8000-000000000001', 'e1a00000-0000-4000-8000-000000000020',
                   'e1a00000-0000-4000-8000-000000000021', 'h1:web4', 'd0000000-0000-4000-8000-000000000007',
                   'now() - interval ''1 day''', 'ws:e1a00000-0000-4000-8000-000000000021');
    raise exception 'events: inserted a backdated event';
  exception when insufficient_privilege then null;
  end;
  -- Another workspace than the chain says.
  begin
    execute format(v_ok, 'e1a00000-0000-4000-8000-000000000001', 'e1a00000-0000-4000-8000-000000000020',
                   'e1a00000-0000-4000-8000-000000000021', 'h1:web5', 'd0000000-0000-4000-8000-000000000007',
                   'now()', 'ws:e1a00000-0000-4000-8000-000000000011');
    raise exception 'events: inserted in another chain';
  exception when insufficient_privilege then null;
  end;
  -- A member of another workspace, naming S.
  perform pg_temp.ctx('d0000000-0000-4000-8000-000000000005', 'e1a00000-0000-4000-8000-000000000021',
                      'e1a00000-0000-4000-8000-000000000020', 'e1a00000-0000-4000-8000-000000000001');
  begin
    execute format(v_ok, 'e1a00000-0000-4000-8000-000000000001', 'e1a00000-0000-4000-8000-000000000020',
                   'e1a00000-0000-4000-8000-000000000021', 'h1:web6', 'd0000000-0000-4000-8000-000000000005',
                   'now()', 'ws:e1a00000-0000-4000-8000-000000000021');
    raise exception 'events: non-member inserted';
  exception when insufficient_privilege then null;
  end;
  -- The managing partner, in M (gerenciado); not in S (padrão).
  perform pg_temp.ctx('d0000000-0000-4000-8000-000000000006', 'e1a00000-0000-4000-8000-000000000011',
                      'e1a00000-0000-4000-8000-000000000010', 'e1a00000-0000-4000-8000-000000000001');
  execute format(v_ok, 'e1a00000-0000-4000-8000-000000000001',
                 'e1a00000-0000-4000-8000-000000000010', 'e1a00000-0000-4000-8000-000000000011', 'h1:web7',
                 'd0000000-0000-4000-8000-000000000006', 'now()', 'ws:e1a00000-0000-4000-8000-000000000011');
  perform pg_temp.ctx('d0000000-0000-4000-8000-000000000006', 'e1a00000-0000-4000-8000-000000000021',
                      'e1a00000-0000-4000-8000-000000000020', 'e1a00000-0000-4000-8000-000000000001');
  begin
    execute format(v_ok, 'e1a00000-0000-4000-8000-000000000001', 'e1a00000-0000-4000-8000-000000000020',
                   'e1a00000-0000-4000-8000-000000000021', 'h1:web8', 'd0000000-0000-4000-8000-000000000006',
                   'now()', 'ws:e1a00000-0000-4000-8000-000000000021');
    raise exception 'events: partner inserted in a standard company';
  exception when insufficient_privilege then null;
  end;
end $$;
reset role;
do $$
begin
  if (select count(*) from public.events where idempotency_key in ('h1:web1', 'h1:web7')) <> 2 then
    raise exception 'events: the allowed inserts did not land';
  end if;
end $$;
rollback;

-- ----------------------------------------------------------------------------
-- Test 3: the chain head and the dispatch queue from the web
-- ----------------------------------------------------------------------------
begin;
select pg_temp.fixture();
set local role app_runtime;
do $$
declare
  v_row record;
begin
  perform pg_temp.ctx('d0000000-0000-4000-8000-000000000007', 'e1a00000-0000-4000-8000-000000000021',
                      'e1a00000-0000-4000-8000-000000000020', 'e1a00000-0000-4000-8000-000000000001');
  select * into v_row from private.event_prepare('ws:e1a00000-0000-4000-8000-000000000021', 'h1:new');
  if v_row.existing_id is not null or v_row.prev_hash <> repeat('b', 64) or v_row.next_seq <> 2 then
    raise exception 'event_prepare: wrong head %', row_to_json(v_row);
  end if;
  select * into v_row from private.event_prepare('ws:e1a00000-0000-4000-8000-000000000021', 'h1:e2');
  if v_row.existing_id <> 'e1a00000-0000-4000-8000-0000000000e2' then
    raise exception 'event_prepare: the existing key was not found';
  end if;
  -- The variables do not outlive the call.
  if coalesce(current_setting('app.event_chain', true), '') <> ''
     or coalesce(current_setting('app.event_key', true), '') <> '' then
    raise exception 'event_prepare: context variables left set';
  end if;
  begin
    perform private.event_prepare('ws:not-a-chain', 'x');
    raise exception 'event_prepare: accepted an invalid chain';
  exception when invalid_parameter_value then null;
  end;

  -- The caller's own new event goes to the queue; another one does not.
  insert into public.events (id, type, module, level, partner_id, organization_id, workspace_id,
      severity, audiences, route, data, idempotency_key, created_by, occurred_at, chain_key, seq,
      content_hash, prev_hash, key_version, recipient_user_id)
  values ('e1a00000-0000-4000-8000-0000000000f1', 'google_business.analyses_done', 'google_business',
      'workspace', 'e1a00000-0000-4000-8000-000000000001', 'e1a00000-0000-4000-8000-000000000020',
      'e1a00000-0000-4000-8000-000000000021', 'info', array['customer'], 'subject_person', '{}',
      'h1:queued', 'd0000000-0000-4000-8000-000000000007', now(),
      'ws:e1a00000-0000-4000-8000-000000000021', 2, repeat('f', 64), repeat('b', 64), 'k1',
      'd0000000-0000-4000-8000-000000000007');
  insert into public.job_runs (kind, scope, requested_by, payload, idempotency_key)
  values ('events.dispatch', 'platform', 'd0000000-0000-4000-8000-000000000007',
          '{"eventId": "e1a00000-0000-4000-8000-0000000000f1"}', 'event:e1a00000-0000-4000-8000-0000000000f1');
  begin
    insert into public.job_runs (kind, scope, requested_by, payload, idempotency_key)
    values ('events.dispatch', 'platform', 'd0000000-0000-4000-8000-000000000007',
            '{"eventId": "e1a00000-0000-4000-8000-0000000000e2"}', 'event:e1a00000-0000-4000-8000-0000000000e2');
    raise exception 'job_runs: queued the dispatch of an event the caller did not create';
  exception when insufficient_privilege then null;
  end;
  begin
    insert into public.job_runs (kind, scope, requested_by, payload, idempotency_key)
    values ('events.dispatch', 'platform', 'd0000000-0000-4000-8000-000000000007',
            '{"eventId": "e1a00000-0000-4000-8000-0000000000f1"}', 'outra-chave');
    raise exception 'job_runs: queued with another key';
  exception when insufficient_privilege then null;
  end;
  begin
    insert into public.job_runs (kind, scope, requested_by, payload, idempotency_key)
    values ('billing.daily-transitions', 'platform', 'd0000000-0000-4000-8000-000000000007',
            '{"eventId": "e1a00000-0000-4000-8000-0000000000f1"}', 'event:e1a00000-0000-4000-8000-0000000000f1');
    raise exception 'job_runs: queued another platform job';
  exception when insufficient_privilege then null;
  end;
end $$;
rollback;

-- ----------------------------------------------------------------------------
-- Test 4: the worker emits, dispatches and verifies; the content never changes
-- ----------------------------------------------------------------------------
begin;
select pg_temp.fixture();
set local role app_worker;
do $$
begin
  if (select count(*) from public.events where id::text like 'e1a00000-%') <> 5 then
    raise exception 'events: worker does not read every event';
  end if;
  insert into public.events (id, type, module, level, severity, audiences, route, data,
      idempotency_key, occurred_at, chain_key, seq, content_hash, prev_hash, key_version)
  values (gen_random_uuid(), 'platform.events.chain_broken', 'events', 'platform', 'urgent',
      array['platform'], 'platform', '{}', 'h1:worker', now(), 'platform', 2, repeat('1', 64),
      repeat('e', 64), 'k1');
  update public.events set status = 'resolved', dispatched_at = now(), verified_at = now(),
         integrity = 'ok'
  where id = 'e1a00000-0000-4000-8000-0000000000e2';
  begin
    update public.events set data = '{"secret":"forjado"}' where id = 'e1a00000-0000-4000-8000-0000000000e2';
    raise exception 'events: worker changed the data';
  exception when insufficient_privilege then null;
  end;
  begin
    update public.events set content_hash = repeat('0', 64);
    raise exception 'events: worker changed the seal';
  exception when insufficient_privilege then null;
  end;
  begin
    insert into public.events (id, type, module, level, severity, audiences, route, data,
        idempotency_key, occurred_at, chain_key, seq, content_hash, prev_hash, key_version, integrity)
    values (gen_random_uuid(), 'platform.events.chain_broken', 'events', 'platform', 'urgent',
        array['platform'], 'platform', '{}', 'h1:worker2', now(), 'platform', 3, repeat('2', 64),
        repeat('1', 64), 'k1', 'ok');
    raise exception 'events: worker inserted an event already verified';
  exception when insufficient_privilege then null;
  end;
  -- Retention is off: nothing is deleted.
  delete from public.events;
  if not exists (select 1 from public.events) then raise exception 'events: deleted with retention off'; end if;
  -- A broken link of the chain is refused by the database (first link).
  begin
    insert into public.events (id, type, module, level, severity, audiences, route, data,
        idempotency_key, occurred_at, chain_key, seq, content_hash, prev_hash, key_version)
    values (gen_random_uuid(), 'platform.events.chain_broken', 'events', 'platform', 'urgent',
        array['platform'], 'platform', '{}', 'h1:worker3', now(), 'platform', 9, repeat('3', 64),
        null, 'k1');
    raise exception 'events: a later event without the previous seal';
  exception when check_violation then null;
  end;
end $$;
rollback;

-- ----------------------------------------------------------------------------
-- Test 5: recipients of the worker, by route
-- ----------------------------------------------------------------------------
begin;
select pg_temp.fixture();
insert into public.partner_billing_profiles (partner_id, legal_name, tax_id, billing_email)
values ('e1a00000-0000-4000-8000-000000000001', 'Agência H1 Ltda', '12345678000199', 'Cobranca@H1.test');
set local role app_worker;
do $$
declare
  v_list text;
begin
  -- Standard company: owner (with the invitation's e-mail) and admin.
  select string_agg(user_id::text || '=' || coalesce(email, '-'), ',' order by user_id) into v_list
  from private.event_recipients('e1a00000-0000-4000-8000-0000000000e2');
  if v_list <> 'd0000000-0000-4000-8000-000000000002=-,d0000000-0000-4000-8000-000000000007=dono@padrao.test' then
    raise exception 'event_recipients: standard company gave %', v_list;
  end if;
  -- Managed company: the partner's owner, admin and support (not finance).
  select string_agg(user_id::text || '=' || email, ',' order by user_id) into v_list
  from private.event_recipients('e1a00000-0000-4000-8000-0000000000e1');
  if v_list <> 'd0000000-0000-4000-8000-000000000004=owner@h1.test,d0000000-0000-4000-8000-000000000006=sup@h1.test' then
    raise exception 'event_recipients: managed company gave %', v_list;
  end if;
  -- Partner route: the billing e-mail (no person) and the owners' bell.
  select string_agg(coalesce(user_id::text, '-') || '=' || coalesce(email, '-'), ',' order by user_id nulls first) into v_list
  from private.event_recipients('e1a00000-0000-4000-8000-0000000000e4');
  if v_list <> '-=cobranca@h1.test,d0000000-0000-4000-8000-000000000004=-' then
    raise exception 'event_recipients: partner route gave %', v_list;
  end if;
  -- The person of the event.
  select string_agg(user_id::text, ',') into v_list
  from private.event_recipients('e1a00000-0000-4000-8000-0000000000e3');
  if v_list <> 'a0000000-0000-4000-8000-000000000031' then
    raise exception 'event_recipients: subject person gave %', v_list;
  end if;
  -- Platform owners and operations.
  select string_agg(user_id::text, ',' order by user_id) into v_list
  from private.event_recipients('e1a00000-0000-4000-8000-0000000000e5');
  if v_list not like '%d0000000-0000-4000-8000-000000000003%'
     or v_list not like '%d0000000-0000-4000-8000-000000000010%'
     or v_list like '%d0000000-0000-4000-8000-000000000001%' then
    raise exception 'event_recipients: platform route gave %', v_list;
  end if;
  if coalesce(current_setting('app.event_id', true), '') <> ''
     or coalesce(current_setting('app.event_partner', true), '') <> ''
     or coalesce(current_setting('app.platform_team', true), '') <> '' then
    raise exception 'event_recipients: context variables left set';
  end if;
end $$;
reset role;
set local role app_runtime;
do $$
begin
  begin
    perform private.event_recipients('e1a00000-0000-4000-8000-0000000000e2');
    raise exception 'event_recipients: the web may call it';
  exception when insufficient_privilege then null;
  end;
end $$;
rollback;

-- ----------------------------------------------------------------------------
-- Test 6: the partner reads the situation, the data only where it manages
-- ----------------------------------------------------------------------------
begin;
select pg_temp.fixture();
set local role app_runtime;
do $$
declare
  v_list text;
begin
  perform pg_temp.ctx('d0000000-0000-4000-8000-000000000004', null, null, 'e1a00000-0000-4000-8000-000000000001');
  select string_agg(right(id::text, 2) || '=' || coalesce(data ->> 'secret', '-'), ',' order by id) into v_list
  from private.partner_events(null, 50);
  if v_list <> 'e1=gerenciada,e2=-,e4=cobranca' then
    raise exception 'partner_events: owner of P got %', v_list;
  end if;
  perform pg_temp.ctx('d0000000-0000-4000-8000-000000000006', null, null, 'e1a00000-0000-4000-8000-000000000001');
  if (select count(*) from private.partner_events(null, 50)) <> 3 then
    raise exception 'partner_events: support of P does not read';
  end if;
  -- Finance and another partner read nothing.
  perform pg_temp.ctx('d0000000-0000-4000-8000-000000000008', null, null, 'e1a00000-0000-4000-8000-000000000001');
  if exists (select 1 from private.partner_events(null, 50)) then
    raise exception 'partner_events: finance reads events';
  end if;
  perform pg_temp.ctx('d0000000-0000-4000-8000-000000000009', null, null, 'e1a00000-0000-4000-8000-000000000001');
  if exists (select 1 from private.partner_events(null, 50)) then
    raise exception 'partner_events: a member of another partner reads';
  end if;
end $$;
rollback;

-- ----------------------------------------------------------------------------
-- Test 7: the platform reads the situation of everything, without data
-- ----------------------------------------------------------------------------
begin;
select pg_temp.fixture();
set local role app_runtime;
do $$
declare
  v_count integer;
begin
  if exists (
    select 1 from information_schema.routines r
    join information_schema.parameters p on p.specific_name = r.specific_name
    where r.routine_schema = 'private' and r.routine_name in ('platform_events', 'event_deliveries')
      and p.parameter_mode = 'OUT' and p.parameter_name in ('data', 'recipient_email', 'recipient_user_id')
  ) then
    raise exception 'platform_events: returns data or recipients';
  end if;
  foreach v_count in array array[3, 10] loop
    perform pg_temp.ctx(('d0000000-0000-4000-8000-0000000000' || lpad(v_count::text, 2, '0'))::uuid, null, null);
    if (select count(*) from private.platform_events(null, null, null, null, null, null, null, 200)
        where id::text like 'e1a00000-%') <> 5 then
      raise exception 'platform_events: % does not see every event', v_count;
    end if;
  end loop;
  perform pg_temp.ctx('d0000000-0000-4000-8000-000000000003', null, null);
  if (select count(*) from private.platform_events(null, 'billing', null, null, null, null, null, 200)
      where id::text like 'e1a00000-%') <> 1 then
    raise exception 'platform_events: module filter';
  end if;
  if (select count(*) from private.platform_events(null, null, 'e1a00000-0000-4000-8000-000000000001',
        'e1a00000-0000-4000-8000-000000000020', now() - interval '1 hour', now() + interval '1 hour', null, 200)) <> 2 then
    raise exception 'platform_events: partner, customer and period filters';
  end if;
  if not (select chain_ok from private.platform_events(null, null, null, null, null, null,
          'e1a00000-0000-4000-8000-0000000000e2', 1)) then
    raise exception 'platform_events: first link reported broken';
  end if;
  if (select string_agg(channel || ':' || status, ',' order by channel)
      from private.event_deliveries('e1a00000-0000-4000-8000-0000000000e2')) <> 'email:skipped,whatsapp:failed' then
    raise exception 'event_deliveries: wrong situation';
  end if;
  -- Billing reads the billing events only.
  perform pg_temp.ctx('d0000000-0000-4000-8000-000000000001', null, null);
  if (select string_agg(type, ',') from private.platform_events(null, null, null, null, null, null, null, 200)
      where id::text like 'e1a00000-%') <> 'billing.subscription.past_due' then
    raise exception 'platform_events: billing reads other events';
  end if;
  if exists (select 1 from private.event_deliveries('e1a00000-0000-4000-8000-0000000000e2')) then
    raise exception 'event_deliveries: billing reads a non-billing event';
  end if;
  -- Without a platform role, nothing.
  perform pg_temp.ctx('a0000000-0000-4000-8000-000000000031', null, null);
  if exists (select 1 from private.platform_events(null, null, null, null, null, null, null, 200)) then
    raise exception 'platform_events: a customer reads';
  end if;
  -- Support (not billing) still does not read the deliveries' table itself.
  if exists (select 1 from public.notification_deliveries where event_id is not null) then
    raise exception 'notification_deliveries: a customer reads';
  end if;
end $$;
rollback;

-- ----------------------------------------------------------------------------
-- Test 8: deliveries keep the old rows and take the hub's columns
-- ----------------------------------------------------------------------------
begin;
select pg_temp.fixture();
set local role app_worker;
do $$
begin
  -- An e-mail as before (no event, channel e-mail by default).
  insert into public.notification_deliveries (partner_id, event_type, recipient_email, subject, idempotency_key)
  values ('e1a00000-0000-4000-8000-000000000001', 'billing.subscription.suspended', 'a@b.test', 'Assunto', 'h1:old');
  if (select channel from public.notification_deliveries where idempotency_key = 'h1:old') <> 'email' then
    raise exception 'notification_deliveries: default channel';
  end if;
  begin
    insert into public.notification_deliveries (partner_id, event_type, idempotency_key, channel)
    values ('e1a00000-0000-4000-8000-000000000001', 'ai.agent.key_backup', 'h1:noaddress', 'email');
    raise exception 'notification_deliveries: e-mail without an address';
  exception when check_violation then null;
  end;
  insert into public.notification_deliveries (partner_id, event_type, idempotency_key, channel, event_id)
  values ('e1a00000-0000-4000-8000-000000000001', 'google_business.analyses_done', 'h1:wa', 'whatsapp',
          'e1a00000-0000-4000-8000-0000000000e2');
  update public.notification_deliveries set status = 'failed', reason = 'http_500', attempts = 1
  where idempotency_key = 'h1:wa';
  update public.notification_deliveries set status = 'sent', provider = 'partner_webhook', attempts = 2
  where idempotency_key = 'h1:wa';
  if (select status from public.notification_deliveries where idempotency_key = 'h1:wa') <> 'sent' then
    raise exception 'notification_deliveries: failed WhatsApp not retried';
  end if;
  -- A sent delivery stays sent.
  update public.notification_deliveries set status = 'failed' where idempotency_key = 'h1:wa';
  if (select status from public.notification_deliveries where idempotency_key = 'h1:wa') <> 'sent' then
    raise exception 'notification_deliveries: a sent delivery changed';
  end if;
  begin
    update public.notification_deliveries set status = 'pending' where idempotency_key = 'h1:old';
    raise exception 'notification_deliveries: went back to pending';
  exception when insufficient_privilege then null;
  end;
end $$;
rollback;

-- ----------------------------------------------------------------------------
-- Test 9: keychain — only the owner grants; the data opens with the
-- capability and a reason, and the audit goes in with it
-- ----------------------------------------------------------------------------
begin;
select pg_temp.fixture();
set local role app_runtime;
do $$
declare
  v_data jsonb;
  v_audit record;
begin
  -- Operations cannot grant, not even to itself.
  perform pg_temp.ctx('d0000000-0000-4000-8000-000000000010', null, null);
  begin
    insert into public.platform_admin_capabilities (user_id, capability, granted_by)
    values ('d0000000-0000-4000-8000-000000000010', 'keychain', 'd0000000-0000-4000-8000-000000000010');
    raise exception 'capabilities: operations granted keychain';
  exception when insufficient_privilege then null;
  end;
  -- Without the capability nobody opens the data, the owner included.
  perform pg_temp.ctx('d0000000-0000-4000-8000-000000000003', null, null);
  begin
    perform private.read_event_data('e1a00000-0000-4000-8000-0000000000e2', 'Pedido de suporte 123', null);
    raise exception 'read_event_data: opened without keychain';
  exception when insufficient_privilege then null;
  end;
  if exists (select 1 from private.platform_team() where keychain) then
    raise exception 'platform_team: someone has keychain by default';
  end if;
  -- The owner grants to operations and to a non-member (refused) and in
  -- another person's name (refused).
  insert into public.platform_admin_capabilities (user_id, capability, granted_by)
  values ('d0000000-0000-4000-8000-000000000010', 'keychain', 'd0000000-0000-4000-8000-000000000003');
  begin
    insert into public.platform_admin_capabilities (user_id, capability, granted_by)
    values ('a0000000-0000-4000-8000-000000000031', 'keychain', 'd0000000-0000-4000-8000-000000000003');
    raise exception 'capabilities: granted to someone outside the team';
  exception when insufficient_privilege then null;
  end;
  begin
    insert into public.platform_admin_capabilities (user_id, capability, granted_by)
    values ('d0000000-0000-4000-8000-000000000003', 'keychain', 'd0000000-0000-4000-8000-000000000010');
    raise exception 'capabilities: granted in another person''s name';
  exception when insufficient_privilege then null;
  end;
  if (select count(*) from private.platform_team() where keychain) <> 1 then
    raise exception 'platform_team: grant not shown';
  end if;
  if coalesce(current_setting('app.platform_team', true), '') <> '' then
    raise exception 'platform_team: context variable left set';
  end if;

  -- Operations with keychain: a reason is required; then the data and the audit.
  perform pg_temp.ctx('d0000000-0000-4000-8000-000000000010', null, null);
  if exists (select 1 from private.platform_team()) then
    raise exception 'platform_team: operations reads the team';
  end if;
  begin
    perform private.read_event_data('e1a00000-0000-4000-8000-0000000000e2', 'curto', null);
    raise exception 'read_event_data: opened without a reason';
  exception when invalid_parameter_value then null;
  end;
  v_data := private.read_event_data('e1a00000-0000-4000-8000-0000000000e2', '  Chamado 4521 do cliente  ', '203.0.113.9');
  if v_data ->> 'secret' <> 'padrao' then raise exception 'read_event_data: wrong data'; end if;
  if coalesce(current_setting('app.event_id', true), '') <> '' then
    raise exception 'read_event_data: context variable left set';
  end if;
  -- The capability row is the member's own; it cannot remove it.
  if (select count(*) from public.platform_admin_capabilities) <> 1 then
    raise exception 'capabilities: member does not see their own';
  end if;
  delete from public.platform_admin_capabilities;
  if not found then null; end if;
end $$;
reset role;
do $$
declare
  v_audit record;
begin
  select * into v_audit from public.audit_events
  where action = 'platform.event.view_data' and resource_id = 'e1a00000-0000-4000-8000-0000000000e2';
  if v_audit.id is null then raise exception 'read_event_data: no audit'; end if;
  if v_audit.actor_user_id <> 'd0000000-0000-4000-8000-000000000010'
     or v_audit.organization_id is not null or v_audit.workspace_id is not null
     or v_audit.origin <> 'admin'
     or v_audit.metadata ->> 'reason' <> 'Chamado 4521 do cliente'
     or v_audit.metadata ->> 'ip' <> '203.0.113.9'
     or v_audit.metadata ->> 'eventType' <> 'ai.agent.key_backup' then
    raise exception 'read_event_data: wrong audit %', row_to_json(v_audit);
  end if;
  if (select count(*) from public.platform_admin_capabilities) <> 1 then
    raise exception 'capabilities: a member removed their own capability';
  end if;
end $$;
-- The owner removes it.
set local role app_runtime;
do $$
begin
  perform pg_temp.ctx('d0000000-0000-4000-8000-000000000003', null, null);
  delete from public.platform_admin_capabilities where user_id = 'd0000000-0000-4000-8000-000000000010';
  if not found then raise exception 'capabilities: owner could not remove'; end if;
end $$;
rollback;

-- ----------------------------------------------------------------------------
-- Test 10: the audit record of the keychain cannot be forged from the web
-- ----------------------------------------------------------------------------
begin;
select pg_temp.fixture();
set local role app_runtime;
do $$
begin
  perform pg_temp.ctx('d0000000-0000-4000-8000-000000000003', null, null);
  perform set_config('app.event_id', 'e1a00000-0000-4000-8000-0000000000e2', true);
  -- The web's own audit policy applies (its own name, now); the helper's
  -- policy is reachable only inside read_event_data.
  begin
    insert into public.audit_events (id, occurred_at, actor_user_id, actor_principal_type, origin,
        action, resource_type, resource_id, result, metadata)
    values (gen_random_uuid(), now(), 'd0000000-0000-4000-8000-000000000010', 'user', 'admin',
        'platform.event.view_data', 'event', 'e1a00000-0000-4000-8000-0000000000e2', 'success', '{}');
    raise exception 'audit_events: forged a view in another person''s name';
  exception when insufficient_privilege then null;
  end;
end $$;
rollback;

-- ----------------------------------------------------------------------------
-- Test 11: grants, owners and retention, as applied
-- ----------------------------------------------------------------------------
do $$
declare
  v_fn text;
begin
  foreach v_fn in array array[
    'event_prepare(text,text)', 'event_dispatch_allowed(text)', 'event_recipients(uuid)',
    'event_notice_webhook(uuid)', 'platform_events(text,text,uuid,uuid,timestamp with time zone,timestamp with time zone,uuid,integer)',
    'event_deliveries(uuid)', 'partner_events(timestamp with time zone,integer)',
    'platform_member_active(uuid)', 'platform_team()', 'read_event_data(uuid,text,text)'
  ] loop
    if (select pg_get_userbyid(p.proowner) from pg_proc p where p.oid = ('private.' || v_fn)::regprocedure)
       <> 'app_rls_helper' then
      raise exception 'grants: private.% is not owned by app_rls_helper', v_fn;
    end if;
    if (select prosecdef from pg_proc where oid = ('private.' || v_fn)::regprocedure) is not true then
      raise exception 'grants: private.% is not security definer', v_fn;
    end if;
    if has_function_privilege('anon', 'private.' || v_fn, 'EXECUTE')
       or has_function_privilege('authenticated', 'private.' || v_fn, 'EXECUTE') then
      raise exception 'grants: private.% executable by anon/authenticated', v_fn;
    end if;
  end loop;
  -- Who may call what (the grants survived the ownership transfer).
  if not has_function_privilege('app_runtime', 'private.event_prepare(text,text)', 'EXECUTE')
     or not has_function_privilege('app_worker', 'private.event_prepare(text,text)', 'EXECUTE')
     or not has_function_privilege('app_worker', 'private.event_recipients(uuid)', 'EXECUTE')
     or has_function_privilege('app_runtime', 'private.event_recipients(uuid)', 'EXECUTE')
     or not has_function_privilege('app_worker', 'private.event_notice_webhook(uuid)', 'EXECUTE')
     or has_function_privilege('app_runtime', 'private.event_notice_webhook(uuid)', 'EXECUTE')
     or not has_function_privilege('app_runtime', 'private.read_event_data(uuid,text,text)', 'EXECUTE')
     or has_function_privilege('app_worker', 'private.read_event_data(uuid,text,text)', 'EXECUTE')
     or has_function_privilege('app_worker', 'private.platform_team()', 'EXECUTE')
     or has_function_privilege('app_worker',
          'private.platform_events(text,text,uuid,uuid,timestamp with time zone,timestamp with time zone,uuid,integer)',
          'EXECUTE') then
    raise exception 'grants: execute grants of the event functions are wrong';
  end if;
  if (select pg_get_userbyid(relowner) from pg_class where oid = 'public.events'::regclass) <> 'app_migrations'
     or (select pg_get_userbyid(relowner) from pg_class where oid = 'public.platform_admin_capabilities'::regclass) <> 'app_migrations' then
    raise exception 'grants: tables not owned by app_migrations';
  end if;
  if not (select relforcerowsecurity from pg_class where oid = 'public.events'::regclass)
     or not (select relforcerowsecurity from pg_class where oid = 'public.platform_admin_capabilities'::regclass) then
    raise exception 'grants: FORCE RLS missing';
  end if;
  if has_table_privilege('app_runtime', 'public.events', 'UPDATE')
     or has_table_privilege('app_runtime', 'public.events', 'DELETE')
     or has_column_privilege('app_worker', 'public.events', 'data', 'UPDATE')
     or has_column_privilege('app_worker', 'public.events', 'content_hash', 'UPDATE')
     or not has_column_privilege('app_worker', 'public.events', 'integrity', 'UPDATE')
     or has_table_privilege('app_worker', 'public.platform_admin_capabilities', 'SELECT')
     or has_table_privilege('anon', 'public.events', 'SELECT')
     or has_table_privilege('authenticated', 'public.platform_admin_capabilities', 'SELECT') then
    raise exception 'grants: table grants of the hub are wrong';
  end if;
  if not exists (select 1 from public.retention_policies where category = 'events' and not enabled) then
    raise exception 'retention: category events missing or on';
  end if;
end $$;
