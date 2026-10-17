-- ============================================================================
-- SQL AJ1: back to `padrao` by the partner or the platform, the event
-- `service_mode.reverted_by_partner` and its recipients, and the job of
-- `security.ip_blocked`.
--   partner P a1a…001: d…004 partner_owner, d…006 partner_support;
--     partner Q a1a…002: d…009 partner_owner
--   company S a1a…020 (P, gerenciado): workspace a1a…021, owner d…007
--   company H a1a…040 (house partner, gerenciado): workspace a1a…041,
--     owner d…007
--   platform admins: d…003 owner (admin-seed), d…010 support
-- Each block prepares its fixtures as administrator, switches to
-- `app_runtime` (or `app_worker`) with `set local role` and rolls back.
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
    ('a1a00000-0000-4000-8000-000000000001', 'agencia-aj1', 'Agência AJ1'),
    ('a1a00000-0000-4000-8000-000000000002', 'outra-aj1', 'Outra AJ1');
  insert into public.partner_members (partner_id, user_id, email, role) values
    ('a1a00000-0000-4000-8000-000000000001', 'd0000000-0000-4000-8000-000000000004', 'owner@aj1.test', 'partner_owner'),
    ('a1a00000-0000-4000-8000-000000000001', 'd0000000-0000-4000-8000-000000000006', 'sup@aj1.test', 'partner_support'),
    ('a1a00000-0000-4000-8000-000000000002', 'd0000000-0000-4000-8000-000000000009', 'owner@outra-aj1.test', 'partner_owner');
  insert into public.organizations (id, name, status, partner_id, created_at) values
    ('a1a00000-0000-4000-8000-000000000020', 'Padaria AJ1', 'active', 'a1a00000-0000-4000-8000-000000000001', now() - interval '30 days'),
    ('a1a00000-0000-4000-8000-000000000040', 'Direta AJ1', 'active', '00000000-0000-4000-8000-000000000000', now() - interval '30 days');
  insert into public.workspaces (id, organization_id, slug, name, status) values
    ('a1a00000-0000-4000-8000-000000000021', 'a1a00000-0000-4000-8000-000000000020', 'aj1-padaria', 'Padaria', 'active'),
    ('a1a00000-0000-4000-8000-000000000041', 'a1a00000-0000-4000-8000-000000000040', 'aj1-direta', 'Direta', 'active');
  insert into public.organization_members (organization_id, user_id, role, status) values
    ('a1a00000-0000-4000-8000-000000000020', 'd0000000-0000-4000-8000-000000000007', 'owner', 'active'),
    ('a1a00000-0000-4000-8000-000000000040', 'd0000000-0000-4000-8000-000000000007', 'owner', 'active');
  insert into public.invitations (organization_id, workspace_id, email, role, token_hash, invited_by_user_id, status, expires_at, accepted_at, accepted_by_user_id)
  values ('a1a00000-0000-4000-8000-000000000020', 'a1a00000-0000-4000-8000-000000000021', 'dono@padaria-aj1.test', 'owner',
          repeat('f', 64), 'd0000000-0000-4000-8000-000000000004', 'accepted', now() + interval '1 day', now(),
          'd0000000-0000-4000-8000-000000000007');
  insert into public.organization_service_modes (organization_id, partner_id, mode, source) values
    ('a1a00000-0000-4000-8000-000000000020', 'a1a00000-0000-4000-8000-000000000001', 'gerenciado', 'request'),
    ('a1a00000-0000-4000-8000-000000000040', '00000000-0000-4000-8000-000000000000', 'gerenciado', 'request');
  insert into public.crm_contacts (organization_id, workspace_id, name, created_by)
  values ('a1a00000-0000-4000-8000-000000000020', 'a1a00000-0000-4000-8000-000000000021', 'Cliente fiel',
          'd0000000-0000-4000-8000-000000000007');
  insert into public.platform_admin_members (user_id, role, status)
  values ('d0000000-0000-4000-8000-000000000010', 'support', 'active')
  on conflict (user_id) do update set role = 'support', status = 'active';
$$;

-- Asserts that a call raises `service_mode:<code>`.
create or replace function pg_temp.expect_error(p_sql text, p_code text) returns void
language plpgsql as $$
begin
  begin
    execute p_sql;
  exception when others then
    if sqlerrm like '%service_mode:' || p_code || '%' then
      return;
    end if;
    raise exception 'expected service_mode:% but got: %', p_code, sqlerrm;
  end;
  raise exception 'expected service_mode:% but the call succeeded: %', p_code, p_sql;
end
$$;

-- ----------------------------------------------------------------------------
-- Test 1: who may give a company back; the access falls in the transaction
-- ----------------------------------------------------------------------------
begin;
select pg_temp.fixture();
set local role app_runtime;
do $$
declare
  v_ws uuid;
  v_count integer;
begin
  -- The managing support reads the CRM while the company is managed.
  perform pg_temp.ctx('d0000000-0000-4000-8000-000000000006', 'a1a00000-0000-4000-8000-000000000021',
                      'a1a00000-0000-4000-8000-000000000020', 'a1a00000-0000-4000-8000-000000000001');
  select count(*) into v_count from public.crm_contacts where workspace_id = 'a1a00000-0000-4000-8000-000000000021';
  if v_count <> 1 then raise exception 'setup: the managing partner does not read the CRM'; end if;

  -- Support of P, owner of Q and the platform path are refused.
  perform pg_temp.ctx('d0000000-0000-4000-8000-000000000006', null, null, 'a1a00000-0000-4000-8000-000000000001');
  perform pg_temp.expect_error($q$select * from private.service_mode_revert('a1a00000-0000-4000-8000-000000000020', 'partner', 'Fim do contrato com a agência')$q$, 'forbidden');
  perform pg_temp.ctx('d0000000-0000-4000-8000-000000000009', null, null, 'a1a00000-0000-4000-8000-000000000002');
  perform pg_temp.expect_error($q$select * from private.service_mode_revert('a1a00000-0000-4000-8000-000000000020', 'partner', 'Fim do contrato com a agência')$q$, 'not_found');
  perform pg_temp.ctx('d0000000-0000-4000-8000-000000000004', null, null, 'a1a00000-0000-4000-8000-000000000001');
  perform pg_temp.expect_error($q$select * from private.service_mode_revert('a1a00000-0000-4000-8000-000000000020', 'platform', 'Fim do contrato com a agência')$q$, 'forbidden');
  -- The reason is mandatory for the partner.
  perform pg_temp.expect_error($q$select * from private.service_mode_revert('a1a00000-0000-4000-8000-000000000020', 'partner', '  curto ')$q$, 'reason');
  perform pg_temp.expect_error($q$select * from private.service_mode_revert('a1a00000-0000-4000-8000-000000000020', 'partner', null)$q$, 'reason');
  -- The owner path needs the owner in the company's context.
  perform pg_temp.expect_error($q$select * from private.service_mode_revert('a1a00000-0000-4000-8000-000000000020', 'customer', null)$q$, 'forbidden');

  -- The partner owner gives it back.
  select workspace_id into v_ws
  from private.service_mode_revert('a1a00000-0000-4000-8000-000000000020', 'partner', 'Fim do contrato com a agência');
  if v_ws is distinct from 'a1a00000-0000-4000-8000-000000000021'::uuid then
    raise exception 'revert: workspace %', v_ws;
  end if;
  -- Twice: no longer managed.
  perform pg_temp.expect_error($q$select * from private.service_mode_revert('a1a00000-0000-4000-8000-000000000020', 'partner', 'Fim do contrato com a agência')$q$, 'not_managed');
  -- The event of what the same person just did is accepted; someone else's is not.
  if not private.service_mode_event_allowed('service_mode.reverted_by_partner', 'organization_service_mode',
      'a1a00000-0000-4000-8000-000000000020', 'a1a00000-0000-4000-8000-000000000020',
      'a1a00000-0000-4000-8000-000000000021', 'a1a00000-0000-4000-8000-000000000001',
      'd0000000-0000-4000-8000-000000000004') then
    raise exception 'events: the revert event refused';
  end if;
  if private.service_mode_event_allowed('service_mode.reverted_by_partner', 'organization_service_mode',
      'a1a00000-0000-4000-8000-000000000020', 'a1a00000-0000-4000-8000-000000000020',
      'a1a00000-0000-4000-8000-000000000021', 'a1a00000-0000-4000-8000-000000000001',
      'd0000000-0000-4000-8000-000000000009') then
    raise exception 'events: someone else signed the revert event';
  end if;

  -- The managing support lost the CRM in this transaction.
  perform pg_temp.ctx('d0000000-0000-4000-8000-000000000006', 'a1a00000-0000-4000-8000-000000000021',
                      'a1a00000-0000-4000-8000-000000000020', 'a1a00000-0000-4000-8000-000000000001');
  select count(*) into v_count from public.crm_contacts where workspace_id = 'a1a00000-0000-4000-8000-000000000021';
  if v_count <> 0 then raise exception 'revert: the partner still reads the CRM'; end if;

  -- The platform: support may not, owner gives a direct customer back.
  perform pg_temp.ctx('d0000000-0000-4000-8000-000000000010', null, null);
  perform pg_temp.expect_error($q$select * from private.service_mode_revert('a1a00000-0000-4000-8000-000000000040', 'platform', 'Contrato direto encerrado')$q$, 'forbidden');
  perform pg_temp.ctx('d0000000-0000-4000-8000-000000000003', null, null);
  perform pg_temp.expect_error($q$select * from private.service_mode_revert('a1a00000-0000-4000-8000-000000000020', 'platform', 'Contrato direto encerrado')$q$, 'not_found');
  perform * from private.service_mode_revert('a1a00000-0000-4000-8000-000000000040', 'platform', 'Contrato direto encerrado');
end
$$;
reset role;
do $$
begin
  if (select count(*) from public.organization_service_modes
      where organization_id in ('a1a00000-0000-4000-8000-000000000020', 'a1a00000-0000-4000-8000-000000000040')
        and mode = 'padrao' and source = 'partner' and request_id is null) <> 2 then
    raise exception 'revert: modes not back to padrao';
  end if;
  if (select string_agg(origin || ':' || (metadata ->> 'reason'), ',' order by origin)
      from public.audit_events
      where action = 'service_mode.reverted_by_partner'
        and organization_id in ('a1a00000-0000-4000-8000-000000000020', 'a1a00000-0000-4000-8000-000000000040'))
     is distinct from 'admin:Contrato direto encerrado,partner:Fim do contrato com a agência' then
    raise exception 'revert: audit missing';
  end if;
end
$$;
rollback;

-- ----------------------------------------------------------------------------
-- Test 2: the owner goes back through the same function
-- ----------------------------------------------------------------------------
begin;
select pg_temp.fixture();
set local role app_runtime;
do $$
begin
  perform pg_temp.ctx('d0000000-0000-4000-8000-000000000007', 'a1a00000-0000-4000-8000-000000000021',
                      'a1a00000-0000-4000-8000-000000000020');
  -- Only the company of the context.
  perform pg_temp.expect_error($q$select * from private.service_mode_revert('a1a00000-0000-4000-8000-000000000040', 'customer', null)$q$, 'forbidden');
  perform * from private.service_mode_revert('a1a00000-0000-4000-8000-000000000020', 'customer', null);
  if not private.service_mode_event_allowed('service_mode.changed', 'organization_service_mode',
      'a1a00000-0000-4000-8000-000000000020', 'a1a00000-0000-4000-8000-000000000020',
      'a1a00000-0000-4000-8000-000000000021', 'a1a00000-0000-4000-8000-000000000001',
      'd0000000-0000-4000-8000-000000000007') then
    raise exception 'events: the owner revert event refused';
  end if;
  -- The owner's way back is not the partner's event.
  if private.service_mode_event_allowed('service_mode.reverted_by_partner', 'organization_service_mode',
      'a1a00000-0000-4000-8000-000000000020', 'a1a00000-0000-4000-8000-000000000020',
      'a1a00000-0000-4000-8000-000000000021', 'a1a00000-0000-4000-8000-000000000001',
      'd0000000-0000-4000-8000-000000000007') then
    raise exception 'events: the owner signed a partner revert event';
  end if;
end
$$;
reset role;
do $$
begin
  if not exists (select 1 from public.organization_service_modes
                 where organization_id = 'a1a00000-0000-4000-8000-000000000020'
                   and mode = 'padrao' and source = 'customer'
                   and set_by = 'd0000000-0000-4000-8000-000000000007') then
    raise exception 'owner revert: mode not back';
  end if;
  if not exists (select 1 from public.audit_events
                 where organization_id = 'a1a00000-0000-4000-8000-000000000020'
                   and action = 'service_mode.reverted' and origin = 'app') then
    raise exception 'owner revert: audit missing';
  end if;
end
$$;
rollback;

-- ----------------------------------------------------------------------------
-- Test 3: recipients of `service_mode.reverted_by_partner` (worker only)
-- ----------------------------------------------------------------------------
begin;
select pg_temp.fixture();
insert into public.events (id, type, module, level, partner_id, organization_id, workspace_id,
  subject_type, subject_id, severity, audiences, route, data, idempotency_key, created_by,
  occurred_at, chain_key, seq, content_hash, key_version)
values ('a1a00000-0000-4000-8000-0000000000e1', 'service_mode.reverted_by_partner', 'service_modes', 'workspace',
  'a1a00000-0000-4000-8000-000000000001', 'a1a00000-0000-4000-8000-000000000020',
  'a1a00000-0000-4000-8000-000000000021', 'organization_service_mode', 'a1a00000-0000-4000-8000-000000000020',
  'attention', array['customer', 'partner'], 'explicit', '{}', 'aj1-revert-test',
  'd0000000-0000-4000-8000-000000000004', now(), 'ws:a1a00000-0000-4000-8000-000000000021', 1,
  repeat('a', 64), 'k1');
set local role app_worker;
do $$
declare
  v text;
begin
  select string_agg(kind || ':' || coalesce(email, '-') || ':' || organization_name || ':' || partner_name, ',' order by kind)
    into v
  from private.service_mode_revert_recipients('a1a00000-0000-4000-8000-0000000000e1');
  if v is distinct from 'owner:dono@padaria-aj1.test:Padaria AJ1:Agência AJ1,partner:-:Padaria AJ1:Agência AJ1' then
    raise exception 'recipients: %', v;
  end if;
end
$$;
reset role;
set local role app_runtime;
do $$
begin
  perform private.service_mode_revert_recipients('a1a00000-0000-4000-8000-0000000000e1');
  raise exception 'recipients: app_runtime may call it';
exception when insufficient_privilege then null;
end
$$;
rollback;

-- ----------------------------------------------------------------------------
-- Test 4: the job of `security.ip_blocked` only for a refused address, keyed
-- by area, partner, address and the current hour
-- ----------------------------------------------------------------------------
begin;
select pg_temp.fixture();
insert into public.ip_allowlists (area, partner_id, entries, updated_by) values
  ('platform', null, array['203.0.113.0/24']::cidr[], 'd0000000-0000-4000-8000-000000000003'),
  ('admin', 'a1a00000-0000-4000-8000-000000000001', array['203.0.113.0/24']::cidr[], 'd0000000-0000-4000-8000-000000000004');
set local role app_runtime;
do $$
declare
  v_hour text := to_char(date_trunc('hour', now() at time zone 'UTC'), 'YYYY-MM-DD"T"HH24');
begin
  perform pg_temp.ctx(null, null, null);
  -- Refused address in /platform and in P's /admin: accepted, once.
  insert into public.job_runs (kind, scope, payload, idempotency_key)
  values ('security.ip-blocked', 'platform',
          jsonb_build_object('area', 'platform', 'partnerId', null, 'ip', '198.51.100.7', 'hour', v_hour),
          'ip_blocked:platform:198.51.100.7:' || v_hour);
  insert into public.job_runs (kind, scope, payload, idempotency_key)
  values ('security.ip-blocked', 'platform',
          jsonb_build_object('area', 'admin', 'partnerId', 'a1a00000-0000-4000-8000-000000000001', 'ip', '198.51.100.7', 'hour', v_hour),
          'ip_blocked:admin:a1a00000-0000-4000-8000-000000000001:198.51.100.7:' || v_hour);
  begin
    insert into public.job_runs (kind, scope, payload, idempotency_key)
    values ('security.ip-blocked', 'platform',
            jsonb_build_object('area', 'platform', 'partnerId', null, 'ip', '198.51.100.7', 'hour', v_hour),
            'ip_blocked:platform:198.51.100.7:' || v_hour);
    raise exception 'ip_blocked: the same address twice in the hour';
  exception when unique_violation then null;
  end;
  -- An allowed address, another hour, a wrong key, a mask, a partner
  -- without a list (everybody passes) or extra data: refused.
  begin
    insert into public.job_runs (kind, scope, payload, idempotency_key)
    values ('security.ip-blocked', 'platform',
            jsonb_build_object('area', 'platform', 'partnerId', null, 'ip', '203.0.113.5', 'hour', v_hour),
            'ip_blocked:platform:203.0.113.5:' || v_hour);
    raise exception 'ip_blocked: an allowed address';
  exception when insufficient_privilege then null;
  end;
  begin
    insert into public.job_runs (kind, scope, payload, idempotency_key)
    values ('security.ip-blocked', 'platform',
            jsonb_build_object('area', 'platform', 'partnerId', null, 'ip', '198.51.100.8', 'hour', '2020-01-01T00'),
            'ip_blocked:platform:198.51.100.8:2020-01-01T00');
    raise exception 'ip_blocked: another hour';
  exception when insufficient_privilege then null;
  end;
  begin
    insert into public.job_runs (kind, scope, payload, idempotency_key)
    values ('security.ip-blocked', 'platform',
            jsonb_build_object('area', 'platform', 'partnerId', null, 'ip', '198.51.100.8', 'hour', v_hour),
            'ip_blocked:platform:198.51.100.9:' || v_hour);
    raise exception 'ip_blocked: a key of another address';
  exception when insufficient_privilege then null;
  end;
  begin
    insert into public.job_runs (kind, scope, payload, idempotency_key)
    values ('security.ip-blocked', 'platform',
            jsonb_build_object('area', 'platform', 'partnerId', null, 'ip', '198.51.100.0/24', 'hour', v_hour),
            'ip_blocked:platform:198.51.100.0/24:' || v_hour);
    raise exception 'ip_blocked: a network instead of an address';
  exception when insufficient_privilege then null;
  end;
  begin
    insert into public.job_runs (kind, scope, payload, idempotency_key)
    values ('security.ip-blocked', 'platform',
            jsonb_build_object('area', 'admin', 'partnerId', 'a1a00000-0000-4000-8000-000000000002', 'ip', '198.51.100.7', 'hour', v_hour),
            'ip_blocked:admin:a1a00000-0000-4000-8000-000000000002:198.51.100.7:' || v_hour);
    raise exception 'ip_blocked: a partner without a list';
  exception when insufficient_privilege then null;
  end;
  begin
    insert into public.job_runs (kind, scope, payload, idempotency_key)
    values ('security.ip-blocked', 'platform',
            jsonb_build_object('area', 'platform', 'partnerId', null, 'ip', '198.51.100.8', 'hour', v_hour, 'user', 'x'),
            'ip_blocked:platform:198.51.100.8:' || v_hour);
    raise exception 'ip_blocked: extra data';
  exception when insufficient_privilege then null;
  end;
  begin
    insert into public.job_runs (kind, scope, payload, idempotency_key, requested_by)
    values ('security.ip-blocked', 'platform',
            jsonb_build_object('area', 'platform', 'partnerId', null, 'ip', '198.51.100.8', 'hour', v_hour),
            'ip_blocked:platform:198.51.100.8:' || v_hour, 'd0000000-0000-4000-8000-000000000003');
    raise exception 'ip_blocked: a person in the job';
  exception when insufficient_privilege then null;
  end;
end
$$;
rollback;

-- ----------------------------------------------------------------------------
-- Test 5: owners and grants of the new functions
-- ----------------------------------------------------------------------------
do $$
declare
  f text;
begin
  foreach f in array array[
    'private.service_mode_revert(uuid,text,text)',
    'private.service_mode_revert_recipients(uuid)',
    'private.ip_blocked_job_allowed(jsonb,text)',
    'private.security_events(timestamptz,uuid,integer)'
  ] loop
    if (select pg_get_userbyid(proowner) from pg_proc where oid = f::regprocedure) <> 'app_rls_helper' then
      raise exception '%: owner is not app_rls_helper', f;
    end if;
    if has_function_privilege('anon', f, 'execute') or has_function_privilege('authenticated', f, 'execute') then
      raise exception '%: anon or authenticated may execute', f;
    end if;
  end loop;
  if not has_function_privilege('app_runtime', 'private.service_mode_revert(uuid,text,text)', 'execute')
     or has_function_privilege('app_runtime', 'private.service_mode_revert_recipients(uuid)', 'execute')
     or not has_function_privilege('app_worker', 'private.service_mode_revert_recipients(uuid)', 'execute') then
    raise exception 'grants of the revert functions';
  end if;
end
$$;
