-- ============================================================================
-- SQL Central de Eventos (H4): chain of causes (`caused_by_event_id`,
-- `depth`), hand-offs (`event_handoffs` and `private.event_trace_handoffs`),
-- module state for the worker, WhatsApp `sending`, proposals in the hub
-- (agent origin, managed decision, expiry by the worker, the request's
-- event following the proposal) and the grants.
--   partner P fa4…001: d…004 partner_owner, d…008 partner_finance;
--     partner Q fa4…002: d…009 partner_owner
--   company S fa4…020 (P, padrão): workspace fa4…021, owner d…007,
--     viewer d…005
--   company M fa4…030 (P, gerenciado): workspace fa4…031, owner d…002
--   platform: d…003 owner (seed), d…001 billing
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

create or replace function pg_temp.event(p_id uuid, p_ws uuid, p_org uuid, p_seq int, p_cause uuid default null,
                                         p_type text default 'proposals.approved', p_status text default 'open')
returns void
language sql as $$
  insert into public.events (id, type, module, level, partner_id, organization_id, workspace_id,
                             severity, audiences, route, data, idempotency_key, created_by,
                             occurred_at, chain_key, seq, content_hash, prev_hash, key_version,
                             caused_by_event_id, depth, status)
  values (p_id, p_type, 'proposals', 'workspace', 'fa400000-0000-4000-8000-000000000001', p_org, p_ws,
          'info', array['customer'], 'service_mode', '{"secret":"x"}', 'h4:' || p_id, null, now(),
          'ws:' || p_ws, p_seq, lpad(to_hex(p_seq), 64, '0'),
          case when p_seq = 1 then null else lpad(to_hex(p_seq - 1), 64, '0') end, 'k1',
          p_cause, 3, p_status);
$$;

create or replace function pg_temp.fixture() returns void
language sql as $$
  insert into public.partners (id, slug, name) values
    ('fa400000-0000-4000-8000-000000000001', 'agencia-h4', 'Agência H4'),
    ('fa400000-0000-4000-8000-000000000002', 'outra-h4', 'Outra H4');
  insert into public.partner_members (partner_id, user_id, email, role) values
    ('fa400000-0000-4000-8000-000000000001', 'd0000000-0000-4000-8000-000000000004', 'owner@h4.test', 'partner_owner'),
    ('fa400000-0000-4000-8000-000000000001', 'd0000000-0000-4000-8000-000000000008', 'fin@h4.test', 'partner_finance'),
    ('fa400000-0000-4000-8000-000000000002', 'd0000000-0000-4000-8000-000000000009', 'owner@outra-h4.test', 'partner_owner');
  insert into public.organizations (id, name, status, partner_id) values
    ('fa400000-0000-4000-8000-000000000020', 'Padrão H4', 'active', 'fa400000-0000-4000-8000-000000000001'),
    ('fa400000-0000-4000-8000-000000000030', 'Gerenciada H4', 'active', 'fa400000-0000-4000-8000-000000000001');
  insert into public.workspaces (id, organization_id, slug, name, status) values
    ('fa400000-0000-4000-8000-000000000021', 'fa400000-0000-4000-8000-000000000020', 'h4-padrao', 'Loja H4', 'active'),
    ('fa400000-0000-4000-8000-000000000031', 'fa400000-0000-4000-8000-000000000030', 'h4-gerenciada', 'Loja G H4', 'active');
  insert into public.workspace_members (workspace_id, organization_id, user_id, role, status) values
    ('fa400000-0000-4000-8000-000000000021', 'fa400000-0000-4000-8000-000000000020', 'd0000000-0000-4000-8000-000000000007', 'owner', 'active'),
    ('fa400000-0000-4000-8000-000000000021', 'fa400000-0000-4000-8000-000000000020', 'd0000000-0000-4000-8000-000000000005', 'viewer', 'active'),
    ('fa400000-0000-4000-8000-000000000031', 'fa400000-0000-4000-8000-000000000030', 'd0000000-0000-4000-8000-000000000002', 'owner', 'active');
  insert into public.organization_service_modes (organization_id, partner_id, mode) values
    ('fa400000-0000-4000-8000-000000000020', 'fa400000-0000-4000-8000-000000000001', 'padrao'),
    ('fa400000-0000-4000-8000-000000000030', 'fa400000-0000-4000-8000-000000000001', 'gerenciado');
  insert into public.platform_admin_members (user_id, role, status) values
    ('d0000000-0000-4000-8000-000000000001', 'billing', 'active')
  on conflict (user_id) do update set role = excluded.role, status = 'active';
  select pg_temp.event('fa400000-0000-4000-8000-0000000000e1', 'fa400000-0000-4000-8000-000000000021',
                       'fa400000-0000-4000-8000-000000000020', 1);
  select pg_temp.event('fa400000-0000-4000-8000-0000000000f1', 'fa400000-0000-4000-8000-000000000031',
                       'fa400000-0000-4000-8000-000000000030', 1);
$$;

-- ----------------------------------------------------------------------------
-- Test 1: the depth comes from the cause, in the same workspace, up to 5
-- ----------------------------------------------------------------------------
begin;
select pg_temp.fixture();
do $$
declare
  v_depth smallint;
  v_cause uuid := 'fa400000-0000-4000-8000-0000000000e1';
  v_id uuid;
begin
  -- A root is 0 whatever the caller wrote.
  select depth into v_depth from public.events where id = 'fa400000-0000-4000-8000-0000000000e1';
  if v_depth <> 0 then raise exception 'depth: a root got %', v_depth; end if;
  for i in 2..6 loop
    v_id := ('fa400000-0000-4000-8000-0000000000e' || i)::uuid;
    perform pg_temp.event(v_id, 'fa400000-0000-4000-8000-000000000021',
                          'fa400000-0000-4000-8000-000000000020', i, v_cause);
    select depth into v_depth from public.events where id = v_id;
    if v_depth <> i - 1 then raise exception 'depth: level % got %', i - 1, v_depth; end if;
    v_cause := v_id;
  end loop;
  -- A sixth level is refused.
  begin
    perform pg_temp.event('fa400000-0000-4000-8000-0000000000e7', 'fa400000-0000-4000-8000-000000000021',
                          'fa400000-0000-4000-8000-000000000020', 7, v_cause);
    raise exception 'depth: a sixth level went in';
  exception when check_violation then null;
  end;
  -- A cause in another workspace, or none at all, is refused.
  begin
    perform pg_temp.event('fa400000-0000-4000-8000-0000000000f2', 'fa400000-0000-4000-8000-000000000031',
                          'fa400000-0000-4000-8000-000000000030', 2, 'fa400000-0000-4000-8000-0000000000e1');
    raise exception 'depth: a cause of another workspace went in';
  exception when check_violation then null;
  end;
  begin
    perform pg_temp.event('fa400000-0000-4000-8000-0000000000f3', 'fa400000-0000-4000-8000-000000000031',
                          'fa400000-0000-4000-8000-000000000030', 2, 'fa400000-0000-4000-8000-0000000000ff');
    raise exception 'depth: an unknown cause went in';
  exception when foreign_key_violation then null;
  end;
end $$;
-- `emitEvent` asks the depth through the function; app_runtime may.
set local role app_runtime;
do $$
begin
  if private.event_depth('fa400000-0000-4000-8000-0000000000e6') <> 5
     or private.event_depth('fa400000-0000-4000-8000-0000000000ff') is not null then
    raise exception 'depth: event_depth answered wrong';
  end if;
end $$;
rollback;

-- ----------------------------------------------------------------------------
-- Test 2: hand-offs: the worker writes, members and the trace read
-- ----------------------------------------------------------------------------
begin;
select pg_temp.fixture();
set local role app_worker;
insert into public.event_handoffs (id, event_id, subscriber, module, partner_id, organization_id, workspace_id)
values ('fa400000-0000-4000-8000-0000000000a1', 'fa400000-0000-4000-8000-0000000000e1', 'proposals.execute',
        'core', 'fa400000-0000-4000-8000-000000000001', 'fa400000-0000-4000-8000-000000000020',
        'fa400000-0000-4000-8000-000000000021');
do $$
begin
  -- Born done, or with attempts: refused.
  begin
    insert into public.event_handoffs (event_id, subscriber, module, status, finished_at)
    values ('fa400000-0000-4000-8000-0000000000e1', 'teste.feito', 'core', 'done', now());
    raise exception 'handoffs: the worker inserted a done hand-off';
  exception when insufficient_privilege then null;
  end;
  update public.event_handoffs set status = 'done', attempts = 1, finished_at = now()
  where id = 'fa400000-0000-4000-8000-0000000000a1';
  -- Done never moves again.
  update public.event_handoffs set status = 'queued'
  where id = 'fa400000-0000-4000-8000-0000000000a1';
  if (select status from public.event_handoffs where id = 'fa400000-0000-4000-8000-0000000000a1') <> 'done' then
    raise exception 'handoffs: a done hand-off moved';
  end if;
  begin
    update public.event_handoffs set subscriber = 'outro.nome'
    where id = 'fa400000-0000-4000-8000-0000000000a1';
    raise exception 'handoffs: the worker changed the subscriber';
  exception when insufficient_privilege then null;
  end;
  -- The module state of the event's workspace.
  if private.event_module_enabled('fa400000-0000-4000-8000-0000000000e1', 'crm') then
    raise exception 'handoffs: crm on without enabling';
  end if;
end $$;
reset role;
insert into public.workspace_modules (organization_id, workspace_id, module_key, status, updated_by)
values ('fa400000-0000-4000-8000-000000000020', 'fa400000-0000-4000-8000-000000000021', 'crm', 'enabled',
        'd0000000-0000-4000-8000-000000000007');
set local role app_worker;
do $$
begin
  if not private.event_module_enabled('fa400000-0000-4000-8000-0000000000e1', 'crm') then
    raise exception 'handoffs: crm off after enabling';
  end if;
end $$;
reset role;
set local role app_runtime;
do $$
declare
  v_count int;
begin
  -- The viewer of the workspace reads the hand-offs of the events it reads.
  perform pg_temp.ctx('d0000000-0000-4000-8000-000000000005', 'fa400000-0000-4000-8000-000000000021',
                      'fa400000-0000-4000-8000-000000000020');
  select count(*) into v_count from public.event_handoffs;
  if v_count <> 1 then raise exception 'handoffs: the member read % rows', v_count; end if;
  select count(*) into v_count from private.event_trace_handoffs('fa400000-0000-4000-8000-0000000000e1');
  if v_count <> 1 then raise exception 'handoffs: the member trace has % rows', v_count; end if;
  begin
    insert into public.event_handoffs (event_id, subscriber, module)
    values ('fa400000-0000-4000-8000-0000000000e1', 'teste.web', 'core');
    raise exception 'handoffs: app_runtime inserted';
  exception when insufficient_privilege then null;
  end;
  -- The owner of another company reads nothing.
  perform pg_temp.ctx('d0000000-0000-4000-8000-000000000002', 'fa400000-0000-4000-8000-000000000031',
                      'fa400000-0000-4000-8000-000000000030');
  select count(*) into v_count from public.event_handoffs;
  if v_count <> 0 then raise exception 'handoffs: another company read % rows', v_count; end if;
  select count(*) into v_count from private.event_trace_handoffs('fa400000-0000-4000-8000-0000000000e1');
  if v_count <> 0 then raise exception 'handoffs: another company traced % rows', v_count; end if;
  -- The partner of the company sees the situation (standard mode); another partner does not.
  perform pg_temp.ctx('d0000000-0000-4000-8000-000000000004', null, null, 'fa400000-0000-4000-8000-000000000001');
  select count(*) into v_count from private.event_trace_handoffs('fa400000-0000-4000-8000-0000000000e1');
  if v_count <> 1 then raise exception 'handoffs: the partner traced % rows', v_count; end if;
  select count(*) into v_count from public.event_handoffs;
  if v_count <> 0 then raise exception 'handoffs: the partner read the table'; end if;
  perform pg_temp.ctx('d0000000-0000-4000-8000-000000000009', null, null, 'fa400000-0000-4000-8000-000000000002');
  select count(*) into v_count from private.event_trace_handoffs('fa400000-0000-4000-8000-0000000000e1');
  if v_count <> 0 then raise exception 'handoffs: another partner traced % rows', v_count; end if;
  -- The platform owner sees the situation; billing only billing events.
  perform pg_temp.ctx('d0000000-0000-4000-8000-000000000003', null, null);
  select count(*) into v_count from private.event_trace_handoffs('fa400000-0000-4000-8000-0000000000e1');
  if v_count <> 1 then raise exception 'handoffs: the platform traced % rows', v_count; end if;
  perform pg_temp.ctx('d0000000-0000-4000-8000-000000000001', null, null);
  select count(*) into v_count from private.event_trace_handoffs('fa400000-0000-4000-8000-0000000000e1');
  if v_count <> 0 then raise exception 'handoffs: billing traced % rows', v_count; end if;
end $$;
rollback;

-- ----------------------------------------------------------------------------
-- Test 3: WhatsApp `sending` needs its moment; the worker moves it on
-- ----------------------------------------------------------------------------
begin;
select pg_temp.fixture();
insert into public.notification_deliveries (id, partner_id, event_type, idempotency_key, event_id, channel)
values ('fa400000-0000-4000-8000-0000000000d1', 'fa400000-0000-4000-8000-000000000001', 'proposals.requested',
        'h4:d1', 'fa400000-0000-4000-8000-0000000000e1', 'whatsapp');
do $$
begin
  begin
    update public.notification_deliveries set status = 'sending' where id = 'fa400000-0000-4000-8000-0000000000d1';
    raise exception 'sending: went in without sending_at';
  exception when check_violation then null;
  end;
end $$;
set local role app_worker;
update public.notification_deliveries set status = 'sending', sending_at = now(), attempts = 1
where id = 'fa400000-0000-4000-8000-0000000000d1';
update public.notification_deliveries set status = 'sent'
where id = 'fa400000-0000-4000-8000-0000000000d1' and status = 'sending';
do $$
begin
  if (select status from public.notification_deliveries where id = 'fa400000-0000-4000-8000-0000000000d1') <> 'sent' then
    raise exception 'sending: the worker could not record the result';
  end if;
end $$;
rollback;

-- ----------------------------------------------------------------------------
-- Test 4: proposals: agent origin, validity, managed decision, expiry
-- ----------------------------------------------------------------------------
begin;
select pg_temp.fixture();
insert into public.execution_proposals (id, organization_id, workspace_id, requested_by, origin, source_event_id,
    operation, payload, payload_hash, idempotency_key, expires_at)
values ('fa400000-0000-4000-8000-0000000000b1', 'fa400000-0000-4000-8000-000000000030',
        'fa400000-0000-4000-8000-000000000031', 'd0000000-0000-4000-8000-000000000004', 'agent',
        'fa400000-0000-4000-8000-0000000000f1', 'crm.contacts.create', '{"name":"G"}', repeat('c', 64),
        'h4-b1', now() + interval '6 days'),
       ('fa400000-0000-4000-8000-0000000000b2', 'fa400000-0000-4000-8000-000000000030',
        'fa400000-0000-4000-8000-000000000031', 'd0000000-0000-4000-8000-000000000004', 'agent',
        'fa400000-0000-4000-8000-0000000000f1', 'crm.contacts.create', '{"name":"V"}', repeat('d', 64),
        'h4-b2', now() + interval '1 day');
-- The request's event of b1 (pending), to follow the proposal.
select pg_temp.event('fa400000-0000-4000-8000-0000000000f4', 'fa400000-0000-4000-8000-000000000031',
                     'fa400000-0000-4000-8000-000000000030', 2, null, 'proposals.requested', 'pending');
update public.events set subject_id = 'fa400000-0000-4000-8000-0000000000b1'
where id = 'fa400000-0000-4000-8000-0000000000f4';
set local role app_runtime;
do $$
declare
  v_insert text := 'insert into public.execution_proposals (organization_id, workspace_id, requested_by, origin,
      source_event_id, operation, payload, payload_hash, idempotency_key, expires_at)
    values (%L, %L, %L, ''agent'', %L, ''crm.contacts.create'', ''{"name":"A"}'', repeat(''e'', 64), %L, now() + %L::interval)';
  v_event text := 'insert into public.events (id, type, module, level, partner_id, organization_id,
      workspace_id, severity, audiences, route, data, idempotency_key, created_by, occurred_at, chain_key,
      seq, content_hash, prev_hash, key_version, status)
    values (%L, %L, ''proposals'', ''workspace'', ''fa400000-0000-4000-8000-000000000001'',
      ''fa400000-0000-4000-8000-000000000020'', ''fa400000-0000-4000-8000-000000000021'', ''attention'',
      array[''customer''], ''service_mode'', ''{}'', ''h4:'' || %3$s, ''d0000000-0000-4000-8000-000000000007'',
      now(), ''ws:fa400000-0000-4000-8000-000000000021'', %3$s, repeat(''9'', 64), repeat(''8'', 64), ''k1'',
      ''pending'')';
  v_count int;
begin
  -- A member's agent proposes with an event of its workspace, up to 7 days.
  perform pg_temp.ctx('d0000000-0000-4000-8000-000000000007', 'fa400000-0000-4000-8000-000000000021',
                      'fa400000-0000-4000-8000-000000000020');
  execute format(v_insert, 'fa400000-0000-4000-8000-000000000020', 'fa400000-0000-4000-8000-000000000021',
                 'd0000000-0000-4000-8000-000000000007', 'fa400000-0000-4000-8000-0000000000e1', 'h4-a1', '7 days');
  begin
    execute format(v_insert, 'fa400000-0000-4000-8000-000000000020', 'fa400000-0000-4000-8000-000000000021',
                   'd0000000-0000-4000-8000-000000000007', 'fa400000-0000-4000-8000-0000000000e1', 'h4-a2', '8 days');
    raise exception 'proposals: an agent proposal for 8 days went in';
  exception when insufficient_privilege then null;
  end;
  -- The event must be of the same workspace.
  begin
    execute format(v_insert, 'fa400000-0000-4000-8000-000000000020', 'fa400000-0000-4000-8000-000000000021',
                   'd0000000-0000-4000-8000-000000000007', 'fa400000-0000-4000-8000-0000000000f1', 'h4-a3', '1 day');
    raise exception 'proposals: an agent proposal with another workspace''s event went in';
  exception when insufficient_privilege then null;
  end;
  -- An API key keeps 24 hours.
  begin
    insert into public.execution_proposals (organization_id, workspace_id, requested_by, origin, operation,
        payload, payload_hash, idempotency_key, expires_at)
    values ('fa400000-0000-4000-8000-000000000020', 'fa400000-0000-4000-8000-000000000021',
            'd0000000-0000-4000-8000-000000000007', 'api_key', 'crm.contacts.create', '{"name":"K"}',
            repeat('f', 64), 'h4-k1', now() + interval '2 days');
    raise exception 'proposals: a session proposed as a key';
  exception when insufficient_privilege then null;
  end;
  -- Only a proposal's request goes in pending from the web.
  execute format(v_event, 'fa400000-0000-4000-8000-0000000000e8', 'proposals.requested', 8);
  begin
    execute format(v_event, 'fa400000-0000-4000-8000-0000000000e9', 'proposals.approved', 9);
    raise exception 'events: a pending event of another type went in';
  exception when insufficient_privilege then null;
  end;

  -- The managed customer's owner reads, but does not decide.
  perform pg_temp.ctx('d0000000-0000-4000-8000-000000000002', 'fa400000-0000-4000-8000-000000000031',
                      'fa400000-0000-4000-8000-000000000030');
  select count(*) into v_count from public.execution_proposals;
  if v_count <> 2 then raise exception 'proposals: the managed owner read % rows', v_count; end if;
  begin
    update public.execution_proposals
    set status = 'approved', decided_by = 'd0000000-0000-4000-8000-000000000002', decided_at = now(),
        approved_hash = repeat('c', 64)
    where id = 'fa400000-0000-4000-8000-0000000000b1';
    raise exception 'proposals: the managed customer approved';
  exception when insufficient_privilege then null;
  end;

  -- The managing partner's owner lists (no workspace) and decides (in it).
  perform pg_temp.ctx('d0000000-0000-4000-8000-000000000004', null, null, 'fa400000-0000-4000-8000-000000000001');
  select count(*) into v_count from public.execution_proposals;
  if v_count <> 2 then raise exception 'proposals: the partner listed % rows', v_count; end if;
  perform pg_temp.ctx('d0000000-0000-4000-8000-000000000004', 'fa400000-0000-4000-8000-000000000031',
                      'fa400000-0000-4000-8000-000000000030', 'fa400000-0000-4000-8000-000000000001');
  update public.execution_proposals
  set status = 'approved', decided_by = 'd0000000-0000-4000-8000-000000000004', decided_at = now(),
      approved_hash = repeat('c', 64)
  where id = 'fa400000-0000-4000-8000-0000000000b1';
  if (select status from public.execution_proposals where id = 'fa400000-0000-4000-8000-0000000000b1') <> 'approved' then
    raise exception 'proposals: the managing partner could not approve';
  end if;
  perform private.proposal_event_sync('fa400000-0000-4000-8000-0000000000b1');
  -- Partner finance and another partner see nothing.
  perform pg_temp.ctx('d0000000-0000-4000-8000-000000000008', null, null, 'fa400000-0000-4000-8000-000000000001');
  select count(*) into v_count from public.execution_proposals;
  if v_count <> 0 then raise exception 'proposals: partner finance read % rows', v_count; end if;
  perform pg_temp.ctx('d0000000-0000-4000-8000-000000000009', null, null, 'fa400000-0000-4000-8000-000000000002');
  select count(*) into v_count from public.execution_proposals;
  if v_count <> 0 then raise exception 'proposals: another partner read % rows', v_count; end if;
  -- The standard company's partner sees nothing of it either.
  perform pg_temp.ctx('d0000000-0000-4000-8000-000000000004', null, null, 'fa400000-0000-4000-8000-000000000001');
  if exists (select 1 from public.execution_proposals where workspace_id = 'fa400000-0000-4000-8000-000000000021') then
    raise exception 'proposals: the partner read a standard company''s proposal';
  end if;
end $$;
reset role;
do $$
begin
  if (select status from public.events where id = 'fa400000-0000-4000-8000-0000000000f4') <> 'approved' then
    raise exception 'proposals: the request''s event did not follow the approval';
  end if;
  -- A proposal still valid never expires, whoever asks.
  begin
    update public.execution_proposals set status = 'expired' where id = 'fa400000-0000-4000-8000-0000000000b2';
    raise exception 'proposals: a valid proposal expired';
  exception when check_violation then null;
  end;
end $$;
alter table public.execution_proposals disable trigger execution_proposals_guard_update;
update public.execution_proposals set expires_at = now() - interval '1 minute'
where id = 'fa400000-0000-4000-8000-0000000000b2';
alter table public.execution_proposals enable trigger execution_proposals_guard_update;
set local role app_worker;
do $$
declare
  v_ids uuid[];
begin
  -- The worker closes only pending proposals past their validity.
  with closed as (
    update public.execution_proposals set status = 'expired'
    where status = 'pending' and expires_at <= now()
    returning id
  ) select array_agg(id) into v_ids from closed;
  if v_ids is distinct from array['fa400000-0000-4000-8000-0000000000b2'::uuid] then
    raise exception 'proposals: the worker expired %', v_ids;
  end if;
  -- Nothing else: an approved proposal is out of its reach.
  update public.execution_proposals set status = 'expired' where id = 'fa400000-0000-4000-8000-0000000000b1';
  if found then raise exception 'proposals: the worker touched an approved proposal'; end if;
end $$;
rollback;

-- ----------------------------------------------------------------------------
-- Test 5: owners and grants
-- ----------------------------------------------------------------------------
begin;
do $$
declare
  v_fn text;
begin
  foreach v_fn in array array[
    'private.events_set_depth()', 'private.event_depth(uuid)', 'private.event_trace_handoffs(uuid)',
    'private.event_module_enabled(uuid,text)', 'private.proposal_source_event_ok(uuid,uuid)',
    'private.organization_is_managed(uuid)', 'private.proposal_event_sync(uuid)',
    'private.platform_events(text,text,uuid,uuid,timestamptz,timestamptz,uuid,integer)'
  ] loop
    if (select pg_get_userbyid(p.proowner) from pg_proc p where p.oid = v_fn::regprocedure) <> 'app_rls_helper'
       or not (select prosecdef from pg_proc p where p.oid = v_fn::regprocedure)
       or has_function_privilege('anon', v_fn, 'EXECUTE')
       or has_function_privilege('authenticated', v_fn, 'EXECUTE') then
      raise exception 'grants: % has the wrong owner or grants', v_fn;
    end if;
  end loop;
  if not has_function_privilege('app_runtime', 'private.event_depth(uuid)', 'EXECUTE')
     or not has_function_privilege('app_worker', 'private.event_depth(uuid)', 'EXECUTE')
     or not has_function_privilege('app_runtime', 'private.event_trace_handoffs(uuid)', 'EXECUTE')
     or has_function_privilege('app_runtime', 'private.event_module_enabled(uuid,text)', 'EXECUTE')
     or not has_function_privilege('app_worker', 'private.event_module_enabled(uuid,text)', 'EXECUTE')
     or not has_function_privilege('app_worker', 'private.proposal_event_sync(uuid)', 'EXECUTE')
     or not has_function_privilege('app_runtime', 'private.platform_events(text,text,uuid,uuid,timestamptz,timestamptz,uuid,integer)', 'EXECUTE')
     or has_function_privilege('app_runtime', 'private.events_set_depth()', 'EXECUTE') then
    raise exception 'grants: execute grants of the H4 functions are wrong';
  end if;
  if exists (
    select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relname = 'event_handoffs'
      and (not c.relrowsecurity or not c.relforcerowsecurity or pg_get_userbyid(c.relowner) <> 'app_migrations')
  ) then
    raise exception 'grants: FORCE RLS or owner missing on event_handoffs';
  end if;
  if has_table_privilege('anon', 'public.event_handoffs', 'SELECT')
     or has_table_privilege('authenticated', 'public.event_handoffs', 'SELECT')
     or has_table_privilege('app_runtime', 'public.event_handoffs', 'INSERT')
     or has_table_privilege('app_runtime', 'public.event_handoffs', 'UPDATE')
     or has_table_privilege('app_worker', 'public.event_handoffs', 'DELETE')
     or has_column_privilege('app_worker', 'public.event_handoffs', 'subscriber', 'UPDATE')
     or has_column_privilege('app_worker', 'public.event_handoffs', 'event_id', 'UPDATE')
     or has_column_privilege('app_worker', 'public.execution_proposals', 'payload', 'SELECT')
     or has_column_privilege('app_worker', 'public.execution_proposals', 'decided_by', 'UPDATE')
     or has_column_privilege('app_worker', 'public.events', 'caused_by_event_id', 'UPDATE')
     or has_column_privilege('app_worker', 'public.events', 'depth', 'UPDATE') then
    raise exception 'grants: table grants of the H4 tables are wrong';
  end if;
end $$;
rollback;
