-- ============================================================================
-- SQL Central de Eventos (H2): access to the data of events
-- (`event_access_grants` and `private.read_event_data_by_grant`), the trace
-- functions, the versioned WhatsApp texts, the person's own WhatsApp number,
-- the hub's audience and settings for the worker, and the grants.
--   partner P f2a…001: d…004 partner_owner, d…006 partner_support,
--     d…008 partner_finance; partner Q f2a…002: d…009 partner_owner
--   company S f2a…020 (P, padrão): workspace f2a…021, owner d…007,
--     admin d…002, viewer d…005
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
    ('f2a00000-0000-4000-8000-000000000001', 'agencia-h2', 'Agência H2'),
    ('f2a00000-0000-4000-8000-000000000002', 'outra-h2', 'Outra H2');
  insert into public.partner_members (partner_id, user_id, email, role) values
    ('f2a00000-0000-4000-8000-000000000001', 'd0000000-0000-4000-8000-000000000004', 'owner@h2.test', 'partner_owner'),
    ('f2a00000-0000-4000-8000-000000000001', 'd0000000-0000-4000-8000-000000000006', 'sup@h2.test', 'partner_support'),
    ('f2a00000-0000-4000-8000-000000000001', 'd0000000-0000-4000-8000-000000000008', 'fin@h2.test', 'partner_finance'),
    ('f2a00000-0000-4000-8000-000000000002', 'd0000000-0000-4000-8000-000000000009', 'owner@outra-h2.test', 'partner_owner');
  insert into public.organizations (id, name, status, partner_id) values
    ('f2a00000-0000-4000-8000-000000000020', 'Padrão H2', 'active', 'f2a00000-0000-4000-8000-000000000001');
  insert into public.workspaces (id, organization_id, slug, name, status) values
    ('f2a00000-0000-4000-8000-000000000021', 'f2a00000-0000-4000-8000-000000000020', 'h2-padrao', 'Loja H2', 'active');
  insert into public.organization_members (organization_id, user_id, role, status) values
    ('f2a00000-0000-4000-8000-000000000020', 'd0000000-0000-4000-8000-000000000007', 'owner', 'active');
  insert into public.workspace_members (workspace_id, organization_id, user_id, role, status) values
    ('f2a00000-0000-4000-8000-000000000021', 'f2a00000-0000-4000-8000-000000000020', 'd0000000-0000-4000-8000-000000000007', 'owner', 'active'),
    ('f2a00000-0000-4000-8000-000000000021', 'f2a00000-0000-4000-8000-000000000020', 'd0000000-0000-4000-8000-000000000002', 'admin', 'active'),
    ('f2a00000-0000-4000-8000-000000000021', 'f2a00000-0000-4000-8000-000000000020', 'd0000000-0000-4000-8000-000000000005', 'viewer', 'active');
  insert into public.organization_service_modes (organization_id, partner_id, mode) values
    ('f2a00000-0000-4000-8000-000000000020', 'f2a00000-0000-4000-8000-000000000001', 'padrao');
  insert into public.platform_admin_members (user_id, role, status) values
    ('d0000000-0000-4000-8000-000000000010', 'operations', 'active'),
    ('d0000000-0000-4000-8000-000000000001', 'billing', 'active')
  on conflict (user_id) do update set role = excluded.role, status = 'active';
  insert into public.events (id, type, module, level, partner_id, organization_id, workspace_id,
                             severity, audiences, route, data, idempotency_key, created_by,
                             occurred_at, chain_key, seq, content_hash, prev_hash, key_version) values
    ('f2a00000-0000-4000-8000-0000000000e1', 'ai.agent.key_backup', 'ai_agents', 'workspace',
     'f2a00000-0000-4000-8000-000000000001', 'f2a00000-0000-4000-8000-000000000020',
     'f2a00000-0000-4000-8000-000000000021', 'attention', array['customer'], 'service_mode',
     '{"secret":"um"}', 'h2:e1', null, now(), 'ws:f2a00000-0000-4000-8000-000000000021', 1,
     repeat('a', 64), null, 'k1'),
    ('f2a00000-0000-4000-8000-0000000000e2', 'security.api_key_created', 'security', 'workspace',
     'f2a00000-0000-4000-8000-000000000001', 'f2a00000-0000-4000-8000-000000000020',
     'f2a00000-0000-4000-8000-000000000021', 'attention', array['customer'], 'customer',
     '{"secret":"dois"}', 'h2:e2', null, now(), 'ws:f2a00000-0000-4000-8000-000000000021', 2,
     repeat('b', 64), repeat('a', 64), 'k1'),
    ('f2a00000-0000-4000-8000-0000000000e9', 'platform.events.chain_broken', 'events', 'platform',
     null, null, null, 'urgent', array['platform'], 'platform', '{}', 'h2:e9', null, now(),
     'platform', 1, repeat('9', 64), null, 'k1');
$$;

-- ----------------------------------------------------------------------------
-- Test 1: who may ask, for which events
-- ----------------------------------------------------------------------------
begin;
select pg_temp.fixture();
set local role app_runtime;
do $$
declare
  v_ok text := 'insert into public.event_access_grants (requester_kind, partner_id, organization_id,
      workspace_id, event_ids, requested_by, reason, reference) values (%L, %L, %L, %L, %L::uuid[], %L,
      ''Chamado do cliente sobre o aviso'', ''REF-1'')';
  v_label text;
begin
  -- Platform owner and operations ask; billing does not.
  perform pg_temp.ctx('d0000000-0000-4000-8000-000000000003', null, null);
  execute format(v_ok, 'platform', null, 'f2a00000-0000-4000-8000-000000000020',
                 'f2a00000-0000-4000-8000-000000000021', '{f2a00000-0000-4000-8000-0000000000e1}',
                 'd0000000-0000-4000-8000-000000000003');
  perform pg_temp.ctx('d0000000-0000-4000-8000-000000000001', null, null);
  begin
    execute format(v_ok, 'platform', null, 'f2a00000-0000-4000-8000-000000000020',
                   'f2a00000-0000-4000-8000-000000000021', '{f2a00000-0000-4000-8000-0000000000e1}',
                   'd0000000-0000-4000-8000-000000000001');
    raise exception 'grants: billing asked for access';
  exception when insufficient_privilege then null;
  end;
  -- In someone else's name.
  perform pg_temp.ctx('d0000000-0000-4000-8000-000000000010', null, null);
  begin
    execute format(v_ok, 'platform', null, 'f2a00000-0000-4000-8000-000000000020',
                   'f2a00000-0000-4000-8000-000000000021', '{f2a00000-0000-4000-8000-0000000000e1}',
                   'd0000000-0000-4000-8000-000000000003');
    raise exception 'grants: asked in another person''s name';
  exception when insufficient_privilege then null;
  end;
  -- An event of another workspace (the platform's own).
  begin
    execute format(v_ok, 'platform', null, 'f2a00000-0000-4000-8000-000000000020',
                   'f2a00000-0000-4000-8000-000000000021', '{f2a00000-0000-4000-8000-0000000000e9}',
                   'd0000000-0000-4000-8000-000000000010');
    raise exception 'grants: asked for an event outside the workspace';
  exception when insufficient_privilege then null;
  end;
  -- Already approved on the way in.
  begin
    insert into public.event_access_grants (requester_kind, organization_id, workspace_id, event_ids,
        requested_by, reason, reference, status, expires_at)
    values ('platform', 'f2a00000-0000-4000-8000-000000000020', 'f2a00000-0000-4000-8000-000000000021',
        '{f2a00000-0000-4000-8000-0000000000e1}', 'd0000000-0000-4000-8000-000000000010',
        'Chamado do cliente sobre o aviso', 'REF-2', 'approved', now() + interval '1 day');
    raise exception 'grants: inserted an approved grant';
  exception when insufficient_privilege then null;
  end;
  -- Partner support of P asks for its customer; finance and another partner do not.
  perform pg_temp.ctx('d0000000-0000-4000-8000-000000000006', null, null, 'f2a00000-0000-4000-8000-000000000001');
  execute format(v_ok, 'partner', 'f2a00000-0000-4000-8000-000000000001', 'f2a00000-0000-4000-8000-000000000020',
                 'f2a00000-0000-4000-8000-000000000021', '{f2a00000-0000-4000-8000-0000000000e1,f2a00000-0000-4000-8000-0000000000e2}',
                 'd0000000-0000-4000-8000-000000000006');
  select requester_label into v_label from public.event_access_grants
  where requested_by = 'd0000000-0000-4000-8000-000000000006';
  if v_label is distinct from 'sup@h2.test' then
    raise exception 'grants: requester label not written by the database (%)', v_label;
  end if;
  perform pg_temp.ctx('d0000000-0000-4000-8000-000000000008', null, null, 'f2a00000-0000-4000-8000-000000000001');
  begin
    execute format(v_ok, 'partner', 'f2a00000-0000-4000-8000-000000000001', 'f2a00000-0000-4000-8000-000000000020',
                   'f2a00000-0000-4000-8000-000000000021', '{f2a00000-0000-4000-8000-0000000000e1}',
                   'd0000000-0000-4000-8000-000000000008');
    raise exception 'grants: partner finance asked';
  exception when insufficient_privilege then null;
  end;
  perform pg_temp.ctx('d0000000-0000-4000-8000-000000000009', null, null, 'f2a00000-0000-4000-8000-000000000002');
  begin
    execute format(v_ok, 'partner', 'f2a00000-0000-4000-8000-000000000002', 'f2a00000-0000-4000-8000-000000000020',
                   'f2a00000-0000-4000-8000-000000000021', '{f2a00000-0000-4000-8000-0000000000e1}',
                   'd0000000-0000-4000-8000-000000000009');
    raise exception 'grants: another partner asked';
  exception when insufficient_privilege then null;
  end;
end $$;
rollback;

-- ----------------------------------------------------------------------------
-- Test 2: decision, term, reading only by the requester, audit, revocation
-- ----------------------------------------------------------------------------
begin;
select pg_temp.fixture();
insert into public.event_access_grants (id, requester_kind, organization_id, workspace_id, event_ids,
    requested_by, reason, reference, duration_hours)
values ('f2a00000-0000-4000-8000-0000000000a1', 'platform', 'f2a00000-0000-4000-8000-000000000020',
    'f2a00000-0000-4000-8000-000000000021', '{f2a00000-0000-4000-8000-0000000000e1}',
    'd0000000-0000-4000-8000-000000000003', 'Chamado do cliente sobre o aviso', 'REF-9', 48);
set local role app_runtime;
do $$
declare
  v_data jsonb;
begin
  -- Not approved yet: no data.
  perform pg_temp.ctx('d0000000-0000-4000-8000-000000000003', null, null);
  begin
    perform private.read_event_data_by_grant('f2a00000-0000-4000-8000-0000000000e1', '203.0.113.9');
    raise exception 'grants: read before approval';
  exception when insufficient_privilege then null;
  end;
  -- Only the requester sees the request on the platform side.
  perform pg_temp.ctx('d0000000-0000-4000-8000-000000000010', null, null);
  if exists (select 1 from public.event_access_grants) then
    raise exception 'grants: another platform member sees the request';
  end if;
  -- The requester cannot approve their own request.
  perform pg_temp.ctx('d0000000-0000-4000-8000-000000000003', null, null);
  begin
    update public.event_access_grants set status = 'approved', expires_at = now() + interval '1 hour',
           decided_by = 'd0000000-0000-4000-8000-000000000003', decided_at = now()
    where id = 'f2a00000-0000-4000-8000-0000000000a1';
    raise exception 'grants: the requester approved';
  exception when insufficient_privilege then null;
  end;
  -- The viewer of the workspace neither sees nor decides.
  perform pg_temp.ctx('d0000000-0000-4000-8000-000000000005', 'f2a00000-0000-4000-8000-000000000021',
                      'f2a00000-0000-4000-8000-000000000020');
  if exists (select 1 from public.event_access_grants) then
    raise exception 'grants: a viewer sees requests';
  end if;
  -- The admin approves, but never beyond the asked term.
  perform pg_temp.ctx('d0000000-0000-4000-8000-000000000002', 'f2a00000-0000-4000-8000-000000000021',
                      'f2a00000-0000-4000-8000-000000000020');
  begin
    update public.event_access_grants set status = 'approved', expires_at = now() + interval '72 hours',
           decided_by = 'd0000000-0000-4000-8000-000000000002', decided_at = now()
    where id = 'f2a00000-0000-4000-8000-0000000000a1';
    raise exception 'grants: approved beyond the term';
  exception when insufficient_privilege then null;
  end;
  update public.event_access_grants set status = 'approved', expires_at = now() + interval '24 hours',
         decided_by = 'd0000000-0000-4000-8000-000000000002', decided_at = now()
  where id = 'f2a00000-0000-4000-8000-0000000000a1';
  if not exists (select 1 from public.event_access_grants where status = 'approved') then
    raise exception 'grants: the admin could not approve';
  end if;

  -- The requester reads the event of the grant, and only it.
  perform pg_temp.ctx('d0000000-0000-4000-8000-000000000003', null, null);
  v_data := private.read_event_data_by_grant('f2a00000-0000-4000-8000-0000000000e1', '203.0.113.9');
  if v_data ->> 'secret' <> 'um' then raise exception 'grants: wrong data %', v_data; end if;
  begin
    perform private.read_event_data_by_grant('f2a00000-0000-4000-8000-0000000000e2', null);
    raise exception 'grants: read an event outside the grant';
  exception when insufficient_privilege then null;
  end;
  -- Another platform member does not.
  perform pg_temp.ctx('d0000000-0000-4000-8000-000000000010', null, null);
  begin
    perform private.read_event_data_by_grant('f2a00000-0000-4000-8000-0000000000e1', null);
    raise exception 'grants: someone else read with the grant';
  exception when insufficient_privilege then null;
  end;

  -- The customer sees the view in the event, with who authorized.
  perform pg_temp.ctx('d0000000-0000-4000-8000-000000000005', 'f2a00000-0000-4000-8000-000000000021',
                      'f2a00000-0000-4000-8000-000000000020');
  if (select count(*) from private.event_data_views('f2a00000-0000-4000-8000-0000000000e1')
      where requester_kind = 'platform' and decided_by = 'd0000000-0000-4000-8000-000000000002') <> 1 then
    raise exception 'grants: the customer does not see the view';
  end if;
  if not exists (select 1 from private.event_trace_audit('f2a00000-0000-4000-8000-0000000000e1')
                 where action = 'event.data.viewed') then
    raise exception 'trace: the view is not in the audit of the event';
  end if;

  -- The owner revokes; the requester reads no more.
  perform pg_temp.ctx('d0000000-0000-4000-8000-000000000007', 'f2a00000-0000-4000-8000-000000000021',
                      'f2a00000-0000-4000-8000-000000000020');
  update public.event_access_grants set status = 'revoked', revoked_by = 'd0000000-0000-4000-8000-000000000007',
         revoked_at = now()
  where id = 'f2a00000-0000-4000-8000-0000000000a1';
  perform pg_temp.ctx('d0000000-0000-4000-8000-000000000003', null, null);
  begin
    perform private.read_event_data_by_grant('f2a00000-0000-4000-8000-0000000000e1', null);
    raise exception 'grants: read after revocation';
  exception when insufficient_privilege then null;
  end;
end $$;
reset role;
do $$
begin
  if (select count(*) from public.audit_events
      where action = 'event.data.viewed' and resource_id = 'f2a00000-0000-4000-8000-0000000000e1'
        and workspace_id = 'f2a00000-0000-4000-8000-000000000021'
        and actor_user_id = 'd0000000-0000-4000-8000-000000000003'
        and metadata ->> 'accessGrantId' = 'f2a00000-0000-4000-8000-0000000000a1') <> 1 then
    raise exception 'grants: the view was not audited once with the workspace';
  end if;
end $$;
rollback;

-- ----------------------------------------------------------------------------
-- Test 3: expiry by term and by the worker; the keychain stays hidden
-- ----------------------------------------------------------------------------
begin;
select pg_temp.fixture();
insert into public.event_access_grants (id, requester_kind, organization_id, workspace_id, event_ids,
    requested_by, reason, reference, status, expires_at, decided_by, decided_at)
values ('f2a00000-0000-4000-8000-0000000000a2', 'platform', 'f2a00000-0000-4000-8000-000000000020',
    'f2a00000-0000-4000-8000-000000000021', '{f2a00000-0000-4000-8000-0000000000e1}',
    'd0000000-0000-4000-8000-000000000003', 'Chamado do cliente sobre o aviso', 'REF-3', 'approved',
    now() - interval '1 minute', 'd0000000-0000-4000-8000-000000000007', now() - interval '1 day');
insert into public.audit_events (organization_id, workspace_id, actor_user_id, actor_principal_type, origin,
    action, resource_type, resource_id, result, metadata)
values (null, null, 'd0000000-0000-4000-8000-000000000003', 'user', 'admin', 'platform.event.view_data',
    'event', 'f2a00000-0000-4000-8000-0000000000e1', 'success',
    '{"eventId":"f2a00000-0000-4000-8000-0000000000e1"}');
set local role app_runtime;
do $$
begin
  perform pg_temp.ctx('d0000000-0000-4000-8000-000000000003', null, null);
  begin
    perform private.read_event_data_by_grant('f2a00000-0000-4000-8000-0000000000e1', null);
    raise exception 'grants: read after the term';
  exception when insufficient_privilege then null;
  end;
  -- The platform sees its keychain opening; the customer does not.
  if not exists (select 1 from private.event_trace_audit('f2a00000-0000-4000-8000-0000000000e1')
                 where action = 'platform.event.view_data') then
    raise exception 'trace: the platform does not see its keychain record';
  end if;
  perform pg_temp.ctx('d0000000-0000-4000-8000-000000000007', 'f2a00000-0000-4000-8000-000000000021',
                      'f2a00000-0000-4000-8000-000000000020');
  if exists (select 1 from private.event_trace_audit('f2a00000-0000-4000-8000-0000000000e1')
             where action = 'platform.event.view_data') then
    raise exception 'trace: the customer sees a keychain opening';
  end if;
  if (select private.event_trace_viewer('f2a00000-0000-4000-8000-0000000000e1')) <> 'customer' then
    raise exception 'trace: wrong viewer for the customer';
  end if;
  -- The partner of a standard company sees only the situation.
  perform pg_temp.ctx('d0000000-0000-4000-8000-000000000004', null, null, 'f2a00000-0000-4000-8000-000000000001');
  if (select private.event_trace_viewer('f2a00000-0000-4000-8000-0000000000e1')) <> 'partner_situation'
     or exists (select 1 from private.event_trace_audit('f2a00000-0000-4000-8000-0000000000e1')) then
    raise exception 'trace: the partner of a standard company sees the audit';
  end if;
end $$;
reset role;
set local role app_worker;
do $$
begin
  update public.event_access_grants set status = 'expired'
  where status = 'approved' and expires_at <= now();
  -- An expired grant never comes back (the worker may only expire).
  begin
    update public.event_access_grants set status = 'approved' where id = 'f2a00000-0000-4000-8000-0000000000a2';
  exception when insufficient_privilege then null;
  end;
end $$;
reset role;
do $$
begin
  if (select status from public.event_access_grants where id = 'f2a00000-0000-4000-8000-0000000000a2') <> 'expired' then
    raise exception 'grants: the worker did not expire the grant';
  end if;
end $$;
rollback;

-- ----------------------------------------------------------------------------
-- Test 4: versioned WhatsApp texts
-- ----------------------------------------------------------------------------
begin;
select pg_temp.fixture();
set local role app_runtime;
do $$
declare
  v_body text;
begin
  perform pg_temp.ctx('d0000000-0000-4000-8000-000000000003', null, null);
  insert into public.whatsapp_templates (scope, event_type, locale, version, body, created_by)
  values ('platform', 'ai.agent.key_backup', 'pt-BR', 1, 'Plataforma v1 {{marca}}', 'd0000000-0000-4000-8000-000000000003');
  -- Two current versions are refused; the previous one is retired first.
  begin
    insert into public.whatsapp_templates (scope, event_type, locale, version, body, created_by)
    values ('platform', 'ai.agent.key_backup', 'pt-BR', 2, 'Plataforma v2', 'd0000000-0000-4000-8000-000000000003');
    raise exception 'templates: two current versions';
  exception when unique_violation then null;
  end;
  update public.whatsapp_templates set is_current = false
  where scope = 'platform' and event_type = 'ai.agent.key_backup' and version = 1;
  insert into public.whatsapp_templates (scope, event_type, locale, version, body, created_by)
  values ('platform', 'ai.agent.key_backup', 'pt-BR', 2, 'Plataforma v2 {{marca}}', 'd0000000-0000-4000-8000-000000000003');
  -- The text never changes and nothing is deleted.
  begin
    update public.whatsapp_templates set body = 'mudado' where version = 2;
    raise exception 'templates: the text changed';
  exception when insufficient_privilege then null;
  end;
  begin
    delete from public.whatsapp_templates;
    raise exception 'templates: a version was deleted';
  exception when insufficient_privilege then null;
  end;
  -- Billing does not write.
  perform pg_temp.ctx('d0000000-0000-4000-8000-000000000001', null, null);
  begin
    insert into public.whatsapp_templates (scope, event_type, locale, version, body, created_by)
    values ('platform', 'ai.agent.key_backup', 'en', 1, 'x', 'd0000000-0000-4000-8000-000000000001');
    raise exception 'templates: billing wrote';
  exception when insufficient_privilege then null;
  end;
  -- The partner owner writes its own; the partner support does not.
  perform pg_temp.ctx('d0000000-0000-4000-8000-000000000004', null, null, 'f2a00000-0000-4000-8000-000000000001');
  insert into public.whatsapp_templates (scope, partner_id, event_type, locale, version, body, created_by)
  values ('partner', 'f2a00000-0000-4000-8000-000000000001', 'ai.agent.key_backup', 'pt-BR', 1,
          'Parceiro v1 {{marca}}', 'd0000000-0000-4000-8000-000000000004');
  if (select count(*) from public.whatsapp_templates) <> 1 then
    raise exception 'templates: the partner reads the platform rows';
  end if;
  perform pg_temp.ctx('d0000000-0000-4000-8000-000000000006', null, null, 'f2a00000-0000-4000-8000-000000000001');
  begin
    insert into public.whatsapp_templates (scope, partner_id, event_type, locale, version, body, created_by)
    values ('partner', 'f2a00000-0000-4000-8000-000000000001', 'ai.agent.key_backup', 'en', 1, 'x',
            'd0000000-0000-4000-8000-000000000006');
    raise exception 'templates: partner support wrote';
  exception when insufficient_privilege then null;
  end;
  -- Sending: the partner's current text, else the platform's.
  select body into v_body from private.whatsapp_template('f2a00000-0000-4000-8000-000000000001', 'ai.agent.key_backup', 'pt-BR');
  if v_body <> 'Parceiro v1 {{marca}}' then raise exception 'templates: partner text not chosen (%)', v_body; end if;
  select body into v_body from private.whatsapp_template('f2a00000-0000-4000-8000-000000000002', 'ai.agent.key_backup', 'pt-BR');
  if v_body <> 'Plataforma v2 {{marca}}' then raise exception 'templates: platform text not chosen (%)', v_body; end if;
end $$;
rollback;

-- ----------------------------------------------------------------------------
-- Test 5: the WhatsApp number is the person's own; the hub's audience
-- ----------------------------------------------------------------------------
begin;
select pg_temp.fixture();
set local role app_runtime;
do $$
begin
  perform pg_temp.ctx('d0000000-0000-4000-8000-000000000007', null, null);
  insert into public.user_whatsapp_numbers (user_id, phone, consented_at)
  values ('d0000000-0000-4000-8000-000000000007', '+5511912345678', now());
  begin
    insert into public.user_whatsapp_numbers (user_id, phone, consented_at)
    values ('d0000000-0000-4000-8000-000000000002', '+5511900000000', now());
    raise exception 'whatsapp: wrote another person''s number';
  exception when insufficient_privilege then null;
  end;
  begin
    insert into public.user_whatsapp_numbers (user_id, phone, consented_at)
    values ('d0000000-0000-4000-8000-000000000007', '11912345678', now());
    raise exception 'whatsapp: kept a number outside E.164';
  exception when check_violation or unique_violation then null;
  end;
  perform pg_temp.ctx('d0000000-0000-4000-8000-000000000002', null, null);
  if exists (select 1 from public.user_whatsapp_numbers) then
    raise exception 'whatsapp: someone else reads the number';
  end if;
  update public.user_whatsapp_numbers set phone = '+5511999999999';
  delete from public.user_whatsapp_numbers;
  begin
    perform private.event_audience('f2a00000-0000-4000-8000-0000000000e1', null);
    raise exception 'audience: the web may call it';
  exception when insufficient_privilege then null;
  end;
end $$;
reset role;
do $$
begin
  if (select phone from public.user_whatsapp_numbers where user_id = 'd0000000-0000-4000-8000-000000000007')
     <> '+5511912345678' then
    raise exception 'whatsapp: someone else changed or removed the number';
  end if;
end $$;
insert into public.settings (scope, key, value, updated_by) values
  ('platform', 'notifications.digest_time', '"07:30"', 'd0000000-0000-4000-8000-000000000003'),
  ('platform', 'email.from_name', '"Outro"', 'd0000000-0000-4000-8000-000000000003');
set local role app_worker;
do $$
declare
  v_list text;
begin
  -- The route of a standard company: owner (with the accepted number) and admin.
  select string_agg(user_id::text || '=' || coalesce(whatsapp, '-'), ',' order by user_id) into v_list
  from private.event_audience('f2a00000-0000-4000-8000-0000000000e1', null);
  if v_list <> 'd0000000-0000-4000-8000-000000000002=-,d0000000-0000-4000-8000-000000000007=+5511912345678' then
    raise exception 'audience: route gave %', v_list;
  end if;
  -- Roles of a rule: the viewer; partner roles only where the partner manages.
  select string_agg(user_id::text, ',' order by user_id) into v_list
  from private.event_audience('f2a00000-0000-4000-8000-0000000000e1', array['viewer', 'partner_owner']);
  if v_list <> 'd0000000-0000-4000-8000-000000000005' then
    raise exception 'audience: roles gave %', v_list;
  end if;
  if coalesce(current_setting('app.event_phones', true), '') <> '' then
    raise exception 'audience: context variables left set';
  end if;
  -- The event's settings: only the notification keys (and the time zone).
  select string_agg(key, ',') into v_list
  from private.event_settings('f2a00000-0000-4000-8000-0000000000e1');
  if v_list <> 'notifications.digest_time' then
    raise exception 'settings: the worker read %', v_list;
  end if;
end $$;
rollback;

-- ----------------------------------------------------------------------------
-- Test 6: status changes and the grants of the H2 objects
-- ----------------------------------------------------------------------------
begin;
select pg_temp.fixture();
set local role app_runtime;
do $$
begin
  -- The viewer cannot; the admin resolves; approvals keep their status.
  perform pg_temp.ctx('d0000000-0000-4000-8000-000000000005', 'f2a00000-0000-4000-8000-000000000021',
                      'f2a00000-0000-4000-8000-000000000020');
  if private.set_event_status('f2a00000-0000-4000-8000-0000000000e1', 'resolved') then
    raise exception 'status: a viewer resolved';
  end if;
  perform pg_temp.ctx('d0000000-0000-4000-8000-000000000002', 'f2a00000-0000-4000-8000-000000000021',
                      'f2a00000-0000-4000-8000-000000000020');
  if not private.set_event_status('f2a00000-0000-4000-8000-0000000000e1', 'resolved') then
    raise exception 'status: the admin could not resolve';
  end if;
  if private.set_event_status('f2a00000-0000-4000-8000-0000000000e9', 'resolved') then
    raise exception 'status: the customer resolved a platform event';
  end if;
  begin
    perform private.set_event_status('f2a00000-0000-4000-8000-0000000000e1', 'approved');
    raise exception 'status: set an approval status';
  exception when invalid_parameter_value then null;
  end;
  -- The platform operations resolves its own event.
  perform pg_temp.ctx('d0000000-0000-4000-8000-000000000010', null, null);
  if not private.set_event_status('f2a00000-0000-4000-8000-0000000000e9', 'dismissed') then
    raise exception 'status: operations could not dismiss a platform event';
  end if;
end $$;
reset role;
do $$
declare
  v_fn text;
begin
  if (select status from public.events where id = 'f2a00000-0000-4000-8000-0000000000e1') <> 'resolved' then
    raise exception 'status: not recorded';
  end if;
  foreach v_fn in array array[
    'private.event_settings(uuid)', 'private.event_audience(uuid,text[])',
    'private.delivery_whatsapp(uuid)', 'private.whatsapp_template(uuid,text,text)',
    'private.set_event_status(uuid,text)', 'private.event_access_target_ok(uuid[],uuid,uuid)',
    'private.event_access_request_pending(text)', 'private.event_access_sync(uuid)',
    'private.read_event_data_by_grant(uuid,text)', 'private.event_trace_viewer(uuid)',
    'private.event_trace_deliveries(uuid)', 'private.event_trace_audit(uuid)',
    'private.event_data_views(uuid)', 'private.event_access_grant_fill()'
  ] loop
    if (select pg_get_userbyid(p.proowner) from pg_proc p where p.oid = v_fn::regprocedure) <> 'app_rls_helper'
       or not (select prosecdef from pg_proc p where p.oid = v_fn::regprocedure)
       or has_function_privilege('anon', v_fn, 'EXECUTE')
       or has_function_privilege('authenticated', v_fn, 'EXECUTE') then
      raise exception 'grants: % has the wrong owner or grants', v_fn;
    end if;
  end loop;
  if has_function_privilege('app_runtime', 'private.event_audience(uuid,text[])', 'EXECUTE')
     or has_function_privilege('app_runtime', 'private.event_settings(uuid)', 'EXECUTE')
     or not has_function_privilege('app_worker', 'private.event_audience(uuid,text[])', 'EXECUTE')
     or not has_function_privilege('app_runtime', 'private.read_event_data_by_grant(uuid,text)', 'EXECUTE')
     or has_function_privilege('app_worker', 'private.read_event_data_by_grant(uuid,text)', 'EXECUTE') then
    raise exception 'grants: execute grants of the H2 functions are wrong';
  end if;
  if exists (
    select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relname in ('event_access_grants', 'whatsapp_templates', 'user_whatsapp_numbers')
      and (not c.relrowsecurity or not c.relforcerowsecurity or pg_get_userbyid(c.relowner) <> 'app_migrations')
  ) then
    raise exception 'grants: FORCE RLS or owner missing';
  end if;
  if has_table_privilege('anon', 'public.event_access_grants', 'SELECT')
     or has_table_privilege('authenticated', 'public.whatsapp_templates', 'SELECT')
     or has_table_privilege('app_worker', 'public.user_whatsapp_numbers', 'SELECT')
     or has_table_privilege('app_runtime', 'public.whatsapp_templates', 'DELETE')
     or has_column_privilege('app_runtime', 'public.whatsapp_templates', 'body', 'UPDATE')
     or has_column_privilege('app_runtime', 'public.event_access_grants', 'event_ids', 'UPDATE')
     or has_column_privilege('app_runtime', 'public.event_access_grants', 'requester_label', 'UPDATE')
     or has_table_privilege('app_runtime', 'public.event_access_grants', 'DELETE') then
    raise exception 'grants: table grants of the H2 tables are wrong';
  end if;
end $$;
rollback;
