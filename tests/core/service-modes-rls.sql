-- ============================================================================
-- SQL GB1c: complete service modes (ADR 0020).
--   partner P c1c…001: d…004 partner_owner, d…006 partner_support,
--     d…008 partner_finance; partner Q c1c…002: d…009 partner_owner
--   company S c1c…020 (P, padrao): workspace c1c…021, owner d…007,
--     admin d…005
--   company N c1c…030 (P, no owner)
--   company H c1c…040 (house partner, padrao): workspace c1c…041, owner d…007
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
    ('c1c00000-0000-4000-8000-000000000001', 'agencia-gb1c', 'Agência GB1c'),
    ('c1c00000-0000-4000-8000-000000000002', 'outra-gb1c', 'Outra GB1c');
  insert into public.partner_members (partner_id, user_id, email, role) values
    ('c1c00000-0000-4000-8000-000000000001', 'd0000000-0000-4000-8000-000000000004', 'owner@gb1c.test', 'partner_owner'),
    ('c1c00000-0000-4000-8000-000000000001', 'd0000000-0000-4000-8000-000000000006', 'sup@gb1c.test', 'partner_support'),
    ('c1c00000-0000-4000-8000-000000000001', 'd0000000-0000-4000-8000-000000000008', 'fin@gb1c.test', 'partner_finance'),
    ('c1c00000-0000-4000-8000-000000000002', 'd0000000-0000-4000-8000-000000000009', 'owner@outra.test', 'partner_owner');
  insert into public.organizations (id, name, status, partner_id) values
    ('c1c00000-0000-4000-8000-000000000020', 'Padaria', 'active', 'c1c00000-0000-4000-8000-000000000001'),
    ('c1c00000-0000-4000-8000-000000000030', 'Sem dono', 'active', 'c1c00000-0000-4000-8000-000000000001'),
    ('c1c00000-0000-4000-8000-000000000040', 'Direta', 'active', '00000000-0000-4000-8000-000000000000');
  insert into public.workspaces (id, organization_id, slug, name, status) values
    ('c1c00000-0000-4000-8000-000000000021', 'c1c00000-0000-4000-8000-000000000020', 'gb1c-padaria', 'Padaria', 'active'),
    ('c1c00000-0000-4000-8000-000000000031', 'c1c00000-0000-4000-8000-000000000030', 'gb1c-sem-dono', 'Sem dono', 'active'),
    ('c1c00000-0000-4000-8000-000000000041', 'c1c00000-0000-4000-8000-000000000040', 'gb1c-direta', 'Direta', 'active');
  insert into public.organization_members (organization_id, user_id, role, status) values
    ('c1c00000-0000-4000-8000-000000000020', 'd0000000-0000-4000-8000-000000000007', 'owner', 'active'),
    ('c1c00000-0000-4000-8000-000000000020', 'd0000000-0000-4000-8000-000000000005', 'member', 'active'),
    ('c1c00000-0000-4000-8000-000000000040', 'd0000000-0000-4000-8000-000000000007', 'owner', 'active');
  insert into public.workspace_members (workspace_id, organization_id, user_id, role, status) values
    ('c1c00000-0000-4000-8000-000000000021', 'c1c00000-0000-4000-8000-000000000020', 'd0000000-0000-4000-8000-000000000007', 'owner', 'active'),
    ('c1c00000-0000-4000-8000-000000000021', 'c1c00000-0000-4000-8000-000000000020', 'd0000000-0000-4000-8000-000000000005', 'admin', 'active'),
    ('c1c00000-0000-4000-8000-000000000041', 'c1c00000-0000-4000-8000-000000000040', 'd0000000-0000-4000-8000-000000000007', 'owner', 'active');
  insert into public.invitations (organization_id, workspace_id, email, role, token_hash, invited_by_user_id, status, expires_at, accepted_at, accepted_by_user_id)
  values ('c1c00000-0000-4000-8000-000000000020', 'c1c00000-0000-4000-8000-000000000021', 'dono@padaria.test', 'owner',
          repeat('e', 64), 'd0000000-0000-4000-8000-000000000004', 'accepted', now() + interval '1 day', now(),
          'd0000000-0000-4000-8000-000000000007');
  insert into public.platform_admin_members (user_id, role, status)
  values ('d0000000-0000-4000-8000-000000000010', 'support', 'active')
  on conflict (user_id) do update set role = 'support', status = 'active';
  -- Companies registered before this transaction (the contract is over).
  update public.organizations set created_at = now() - interval '30 days'
  where id::text like 'c1c00000-%';
$$;

-- Module rows of company S (workspace c1c…021), written as administrator.
create or replace function pg_temp.module_rows() returns void
language sql as $$
  insert into public.crm_contacts (id, organization_id, workspace_id, name, created_by)
  values ('c1c00000-0000-4000-8000-0000000000c1', 'c1c00000-0000-4000-8000-000000000020',
          'c1c00000-0000-4000-8000-000000000021', 'Cliente fiel', 'd0000000-0000-4000-8000-000000000007');
  insert into public.channel_connections (organization_id, workspace_id, kind, name, encrypted_secrets, masked_secret, webhook_token_hash, created_by)
  values ('c1c00000-0000-4000-8000-000000000020', 'c1c00000-0000-4000-8000-000000000021', 'chatwoot', 'Chatwoot',
          'x', '****', repeat('a', 64), 'd0000000-0000-4000-8000-000000000007');
  insert into public.portfolio_items (organization_id, workspace_id, item_type, title, handle, created_by)
  values ('c1c00000-0000-4000-8000-000000000020', 'c1c00000-0000-4000-8000-000000000021', 'service', 'Pão', 'pao',
          'd0000000-0000-4000-8000-000000000007');
  insert into public.settings (scope, organization_id, workspace_id, key, value, updated_by)
  values ('workspace', 'c1c00000-0000-4000-8000-000000000020', 'c1c00000-0000-4000-8000-000000000021',
          'google_business.trigger', '"x"', 'd0000000-0000-4000-8000-000000000007');
  insert into public.ai_agents (id, kind, organization_id, workspace_id, created_by)
  values ('c1c00000-0000-4000-8000-0000000000a1', 'guid', 'c1c00000-0000-4000-8000-000000000020',
          'c1c00000-0000-4000-8000-000000000021', 'd0000000-0000-4000-8000-000000000007');
  insert into public.ai_conversations (kind, agent_id, organization_id, workspace_id, user_id, channel)
  values ('guid', 'c1c00000-0000-4000-8000-0000000000a1', 'c1c00000-0000-4000-8000-000000000020',
          'c1c00000-0000-4000-8000-000000000021', 'd0000000-0000-4000-8000-000000000007', 'test');
  insert into public.credentials (organization_id, workspace_id, provider, label, masked_value, encrypted_payload)
  values ('c1c00000-0000-4000-8000-000000000020', 'c1c00000-0000-4000-8000-000000000021', 'anthropic',
          'Chave do cliente', 'sk-****', 'cifrado');
$$;

-- Counts of the module rows the context sees.
create or replace function pg_temp.visible(p_table text) returns integer
language plpgsql as $$
declare v integer;
begin
  execute format('select count(*) from public.%I where workspace_id = %L', p_table,
                 'c1c00000-0000-4000-8000-000000000021') into v;
  return v;
end
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
-- Test 1: who may request; one pending request per company
-- ----------------------------------------------------------------------------
begin;
select pg_temp.fixture();
set local role app_runtime;
do $$
declare
  v_id uuid;
  v_owner uuid;
  v_count integer;
begin
  -- Support and finance of P cannot ask; Q cannot ask for P's company.
  perform pg_temp.ctx('d0000000-0000-4000-8000-000000000006', null, null, 'c1c00000-0000-4000-8000-000000000001');
  perform pg_temp.expect_error($q$select * from private.service_mode_request_create('c1c00000-0000-4000-8000-000000000020', 'partner')$q$, 'forbidden');
  perform pg_temp.ctx('d0000000-0000-4000-8000-000000000008', null, null, 'c1c00000-0000-4000-8000-000000000001');
  perform pg_temp.expect_error($q$select * from private.service_mode_request_create('c1c00000-0000-4000-8000-000000000020', 'partner')$q$, 'forbidden');
  perform pg_temp.ctx('d0000000-0000-4000-8000-000000000009', null, null, 'c1c00000-0000-4000-8000-000000000002');
  perform pg_temp.expect_error($q$select * from private.service_mode_request_create('c1c00000-0000-4000-8000-000000000020', 'partner')$q$, 'not_found');
  -- A partner cannot use the platform path.
  perform pg_temp.ctx('d0000000-0000-4000-8000-000000000004', null, null, 'c1c00000-0000-4000-8000-000000000001');
  perform pg_temp.expect_error($q$select * from private.service_mode_request_create('c1c00000-0000-4000-8000-000000000020', 'platform')$q$, 'forbidden');
  -- No owner yet.
  perform pg_temp.expect_error($q$select * from private.service_mode_request_create('c1c00000-0000-4000-8000-000000000030', 'partner')$q$, 'no_owner');

  -- The owner of P asks; the owner of S receives it, valid for 7 days.
  select request_id, recipient_user_id into v_id, v_owner
  from private.service_mode_request_create('c1c00000-0000-4000-8000-000000000020', 'partner');
  if v_id is null or v_owner <> 'd0000000-0000-4000-8000-000000000007' then
    raise exception 'request: not created for the company owner';
  end if;
  select count(*) into v_count from public.service_mode_requests
  where id = v_id and status = 'pending' and expires_at = now() + interval '7 days';
  if v_count <> 1 then
    raise exception 'request: partner does not read the pending request of 7 days';
  end if;
  -- A second one while the first is pending is refused.
  perform pg_temp.expect_error($q$select * from private.service_mode_request_create('c1c00000-0000-4000-8000-000000000020', 'partner')$q$, 'pending_exists');
  -- The token hash is never readable.
  begin
    perform token_hash from public.service_mode_requests;
    raise exception 'request: token_hash readable by app_runtime';
  exception when insufficient_privilege then null;
  end;
  -- Nobody writes the table directly.
  begin
    update public.service_mode_requests set status = 'approved' where id = v_id;
    raise exception 'request: direct update accepted';
  exception when insufficient_privilege then null;
  end;
  -- Partner Q does not see it.
  perform pg_temp.ctx('d0000000-0000-4000-8000-000000000009', null, null, 'c1c00000-0000-4000-8000-000000000002');
  select count(*) into v_count from public.service_mode_requests;
  if v_count <> 0 then
    raise exception 'request: another partner reads % requests', v_count;
  end if;
  -- The company reads it in its workspace.
  perform pg_temp.ctx('d0000000-0000-4000-8000-000000000005', 'c1c00000-0000-4000-8000-000000000021',
                      'c1c00000-0000-4000-8000-000000000020', 'c1c00000-0000-4000-8000-000000000001');
  select count(*) into v_count from public.service_mode_requests;
  if v_count <> 1 then
    raise exception 'request: the company reads % requests, expected 1', v_count;
  end if;
  -- The partner cancels; then may ask again.
  perform pg_temp.ctx('d0000000-0000-4000-8000-000000000004', null, null, 'c1c00000-0000-4000-8000-000000000001');
  if not private.service_mode_request_cancel(v_id, 'partner') then
    raise exception 'request: cancel failed';
  end if;
  perform private.service_mode_request_create('c1c00000-0000-4000-8000-000000000020', 'partner');
end
$$;
reset role;
do $$
begin
  if (select count(*) from public.audit_events
      where action in ('service_mode.request.created', 'service_mode.request.cancelled')
        and organization_id = 'c1c00000-0000-4000-8000-000000000020' and origin = 'partner') <> 3 then
    raise exception 'request: audit of created/cancelled missing';
  end if;
end
$$;
rollback;

-- ----------------------------------------------------------------------------
-- Test 2: GUIDU asks its direct customers only (partner zero)
-- ----------------------------------------------------------------------------
begin;
select pg_temp.fixture();
set local role app_runtime;
do $$
declare v_count integer;
begin
  perform pg_temp.ctx('d0000000-0000-4000-8000-000000000010', null, null, '00000000-0000-4000-8000-000000000000');
  perform pg_temp.expect_error($q$select * from private.service_mode_request_create('c1c00000-0000-4000-8000-000000000040', 'platform')$q$, 'forbidden');
  perform pg_temp.ctx('d0000000-0000-4000-8000-000000000003', null, null, '00000000-0000-4000-8000-000000000000');
  perform pg_temp.expect_error($q$select * from private.service_mode_request_create('c1c00000-0000-4000-8000-000000000020', 'platform')$q$, 'not_found');
  perform private.service_mode_request_create('c1c00000-0000-4000-8000-000000000040', 'platform');
  select count(*) into v_count from private.platform_service_modes()
  where organization_id = 'c1c00000-0000-4000-8000-000000000040' and request_status = 'pending' and mode = 'padrao';
  if v_count <> 1 then
    raise exception 'platform: direct customer request not listed';
  end if;
  select count(*) into v_count from private.platform_service_modes()
  where organization_id = 'c1c00000-0000-4000-8000-000000000020';
  if v_count <> 0 then
    raise exception 'platform: a partner company listed as direct';
  end if;
end
$$;
rollback;

-- ----------------------------------------------------------------------------
-- Test 3: the link is single use, by the host's partner; the worker writes
-- the token of the e-mail
-- ----------------------------------------------------------------------------
begin;
select pg_temp.fixture();
select pg_temp.module_rows();
set local role app_runtime;
select pg_temp.ctx('d0000000-0000-4000-8000-000000000004', null, null, 'c1c00000-0000-4000-8000-000000000001');
create temp table req on commit drop as
  select request_id, workspace_id from private.service_mode_request_create('c1c00000-0000-4000-8000-000000000020', 'partner');
reset role;
-- The event of the request, as emitEvent writes it (seal values are dummies).
insert into public.events (id, type, module, level, partner_id, organization_id, workspace_id, subject_type,
  subject_id, severity, audiences, route, data, idempotency_key, created_by, occurred_at, chain_key, seq,
  content_hash, key_version)
select 'c1c00000-0000-4000-8000-0000000000e1', 'service_mode.change_requested', 'service_modes', 'workspace',
  'c1c00000-0000-4000-8000-000000000001', 'c1c00000-0000-4000-8000-000000000020', workspace_id,
  'service_mode_request', request_id::text, 'attention', array['customer', 'partner'], 'explicit', '{}',
  'test:gb1c', 'd0000000-0000-4000-8000-000000000004', now(), 'ws:' || workspace_id::text, 1, repeat('0', 64), 'k1'
from req;
grant select on req to app_worker, app_runtime;
set local role app_worker;
do $$
declare
  v_user uuid;
  v_email text;
begin
  select user_id, email into v_user, v_email
  from private.service_mode_issue_link('c1c00000-0000-4000-8000-0000000000e1', repeat('b', 64));
  if v_user <> 'd0000000-0000-4000-8000-000000000007' or v_email <> 'dono@padaria.test' then
    raise exception 'link: issued to % <%>', v_user, v_email;
  end if;
  -- The worker reads nothing else of the request.
  begin
    perform 1 from public.service_mode_requests;
    raise exception 'link: worker reads requests';
  exception when insufficient_privilege then null;
  end;
end
$$;
reset role;
set local role app_runtime;
do $$
declare
  v_outcome text;
  v_status text;
  v_count integer;
begin
  -- Another partner's host does not know the token.
  perform pg_temp.ctx(null, null, null, 'c1c00000-0000-4000-8000-000000000002');
  select count(*) into v_count from private.service_mode_request_by_token(repeat('b', 64));
  if v_count <> 0 then
    raise exception 'link: read on another partner host';
  end if;
  select outcome into v_outcome from private.service_mode_request_decide(repeat('b', 64), null, 'approve', '203.0.113.7', 'UA');
  if v_outcome <> 'not_found' then
    raise exception 'link: decided on another partner host (%)', v_outcome;
  end if;
  -- The host of P shows and decides it, without a session.
  perform pg_temp.ctx(null, null, null, 'c1c00000-0000-4000-8000-000000000001');
  select status into v_status from private.service_mode_request_by_token(repeat('b', 64));
  if v_status <> 'pending' then
    raise exception 'link: status % before the decision', v_status;
  end if;
  select outcome into v_outcome from private.service_mode_request_decide(repeat('c', 64), null, 'approve', null, null);
  if v_outcome <> 'not_found' then
    raise exception 'link: unknown token accepted';
  end if;
  select outcome into v_outcome from private.service_mode_request_decide(repeat('b', 64), null, 'approve', '203.0.113.7', 'UA');
  if v_outcome <> 'approved' then
    raise exception 'link: approve answered %', v_outcome;
  end if;
  -- Single use.
  select outcome into v_outcome from private.service_mode_request_decide(repeat('b', 64), null, 'deny', '203.0.113.7', 'UA');
  if v_outcome <> 'already_decided' then
    raise exception 'link: second use answered %', v_outcome;
  end if;
end
$$;
reset role;
do $$
begin
  if not exists (
    select 1 from public.service_mode_requests r join req on req.request_id = r.id
    where r.status = 'approved' and r.decided_via = 'link' and r.decided_ip = '203.0.113.7'
      and r.decided_by = 'd0000000-0000-4000-8000-000000000007' and r.token_used_at is not null
      and r.decided_user_agent = 'UA'
  ) then
    raise exception 'link: proof of consent not kept';
  end if;
  if not exists (
    select 1 from public.organization_service_modes
    where organization_id = 'c1c00000-0000-4000-8000-000000000020' and mode = 'gerenciado' and source = 'request'
  ) then
    raise exception 'link: mode not changed';
  end if;
  if not exists (select 1 from public.audit_events where action = 'service_mode.request.approved'
                 and actor_user_id = 'd0000000-0000-4000-8000-000000000007') then
    raise exception 'link: approval not audited';
  end if;
end
$$;
rollback;

-- ----------------------------------------------------------------------------
-- Test 4: expiry, and the decision inside /app by the company owner only
-- ----------------------------------------------------------------------------
begin;
select pg_temp.fixture();
insert into public.service_mode_requests (id, organization_id, workspace_id, partner_id, requested_by, requested_via,
  recipient_user_id, token_hash, expires_at, created_at)
values
  ('c1c00000-0000-4000-8000-0000000000f1', 'c1c00000-0000-4000-8000-000000000020', 'c1c00000-0000-4000-8000-000000000021',
   'c1c00000-0000-4000-8000-000000000001', 'd0000000-0000-4000-8000-000000000004', 'partner',
   'd0000000-0000-4000-8000-000000000007', repeat('d', 64), now() - interval '1 day', now() - interval '8 days');
set local role app_runtime;
do $$
declare
  v_outcome text;
  v_status text;
  v_id uuid;
begin
  perform pg_temp.ctx(null, null, null, 'c1c00000-0000-4000-8000-000000000001');
  select status into v_status from private.service_mode_request_by_token(repeat('d', 64));
  if v_status <> 'expired' then
    raise exception 'expiry: link shows % past its date', v_status;
  end if;
  select outcome into v_outcome from private.service_mode_request_decide(repeat('d', 64), null, 'approve', null, null);
  if v_outcome <> 'already_decided' then
    raise exception 'expiry: an expired request answered %', v_outcome;
  end if;
  -- An expired pending request does not block a new one.
  perform pg_temp.ctx('d0000000-0000-4000-8000-000000000004', null, null, 'c1c00000-0000-4000-8000-000000000001');
  select request_id into v_id from private.service_mode_request_create('c1c00000-0000-4000-8000-000000000020', 'partner');
  -- The admin of the workspace (not the owner) cannot decide.
  perform pg_temp.ctx('d0000000-0000-4000-8000-000000000005', 'c1c00000-0000-4000-8000-000000000021',
                      'c1c00000-0000-4000-8000-000000000020', 'c1c00000-0000-4000-8000-000000000001');
  select outcome into v_outcome from private.service_mode_request_decide(null, v_id, 'approve', null, null);
  if v_outcome <> 'not_found' then
    raise exception 'app: the admin decided (%)', v_outcome;
  end if;
  -- The owner denies.
  perform pg_temp.ctx('d0000000-0000-4000-8000-000000000007', 'c1c00000-0000-4000-8000-000000000021',
                      'c1c00000-0000-4000-8000-000000000020', 'c1c00000-0000-4000-8000-000000000001');
  select outcome into v_outcome from private.service_mode_request_decide(null, v_id, 'deny', '198.51.100.2', 'UA');
  if v_outcome <> 'denied' then
    raise exception 'app: deny answered %', v_outcome;
  end if;
  if private.partner_manages_organization('c1c00000-0000-4000-8000-000000000020') then
    raise exception 'app: denied request made the company managed';
  end if;
end
$$;
rollback;

-- ----------------------------------------------------------------------------
-- Test 5: managed access in each module, never in padrao; the AI key never;
-- back to padrao cuts the access at once
-- ----------------------------------------------------------------------------
begin;
select pg_temp.fixture();
select pg_temp.module_rows();
set local role app_runtime;
do $$
declare
  t text;
  v_count integer;
begin
  -- padrao: the support of P sees nothing of S.
  perform pg_temp.ctx('d0000000-0000-4000-8000-000000000006', 'c1c00000-0000-4000-8000-000000000021',
                      'c1c00000-0000-4000-8000-000000000020', 'c1c00000-0000-4000-8000-000000000001');
  foreach t in array array['crm_contacts', 'channel_connections', 'portfolio_items', 'settings',
                           'ai_conversations', 'credentials'] loop
    if pg_temp.visible(t) <> 0 then
      raise exception '%: visible to the partner in padrao', t;
    end if;
  end loop;
  begin
    insert into public.crm_contacts (organization_id, workspace_id, name, created_by)
    values ('c1c00000-0000-4000-8000-000000000020', 'c1c00000-0000-4000-8000-000000000021', 'X',
            'd0000000-0000-4000-8000-000000000006');
    raise exception 'crm_contacts: partner wrote in padrao';
  exception when insufficient_privilege then null;
  end;
  -- The partner cannot make an existing company managed by itself.
  perform pg_temp.ctx('d0000000-0000-4000-8000-000000000004', null, null, 'c1c00000-0000-4000-8000-000000000001');
  begin
    insert into public.organization_service_modes (organization_id, partner_id, mode, set_by)
    values ('c1c00000-0000-4000-8000-000000000020', 'c1c00000-0000-4000-8000-000000000001', 'gerenciado',
            'd0000000-0000-4000-8000-000000000004');
    raise exception 'organization_service_modes: partner made an existing company managed';
  exception when insufficient_privilege then null;
  end;
end
$$;
reset role;
insert into public.organization_service_modes (organization_id, partner_id, mode, source)
values ('c1c00000-0000-4000-8000-000000000020', 'c1c00000-0000-4000-8000-000000000001', 'gerenciado', 'request');
set local role app_runtime;
do $$
declare
  t text;
  v_count integer;
begin
  perform pg_temp.ctx('d0000000-0000-4000-8000-000000000006', 'c1c00000-0000-4000-8000-000000000021',
                      'c1c00000-0000-4000-8000-000000000020', 'c1c00000-0000-4000-8000-000000000001');
  foreach t in array array['crm_contacts', 'channel_connections', 'portfolio_items', 'settings',
                           'ai_conversations', 'ai_agents'] loop
    if pg_temp.visible(t) <> 1 then
      raise exception '%: the managing partner does not see the row', t;
    end if;
  end loop;
  -- The AI key of the company stays out, read or write.
  if pg_temp.visible('credentials') <> 0 then
    raise exception 'credentials: the managing partner reads the AI key';
  end if;
  update public.credentials set label = 'trocada';
  get diagnostics v_count = row_count;
  if v_count <> 0 then
    raise exception 'credentials: the managing partner changed the AI key';
  end if;
  begin
    insert into public.credentials (organization_id, workspace_id, provider, label, masked_value, encrypted_payload)
    values ('c1c00000-0000-4000-8000-000000000020', 'c1c00000-0000-4000-8000-000000000021', 'openai', 'nova', 'x', 'x');
    raise exception 'credentials: the managing partner added a key';
  exception when insufficient_privilege then null;
  end;
  -- It writes in the modules, signing the rows.
  insert into public.crm_contacts (organization_id, workspace_id, name, created_by)
  values ('c1c00000-0000-4000-8000-000000000020', 'c1c00000-0000-4000-8000-000000000021', 'Lead novo',
          'd0000000-0000-4000-8000-000000000006');
  update public.channel_connections set name = 'Chatwoot da agência',
    updated_by = 'd0000000-0000-4000-8000-000000000006';
  get diagnostics v_count = row_count;
  if v_count <> 1 then
    raise exception 'channel_connections: managing partner did not update';
  end if;
  update public.ai_agents set config = '{"name":"Atendente"}',
    updated_by = 'd0000000-0000-4000-8000-000000000006',
    updated_by_partner_id = 'c1c00000-0000-4000-8000-000000000001'
  where id = 'c1c00000-0000-4000-8000-0000000000a1';
  get diagnostics v_count = row_count;
  if v_count <> 1 then
    raise exception 'ai_agents: managing partner did not update the GUIDS';
  end if;
  -- Signing for someone else is refused.
  begin
    insert into public.crm_contacts (organization_id, workspace_id, name, created_by)
    values ('c1c00000-0000-4000-8000-000000000020', 'c1c00000-0000-4000-8000-000000000021', 'X',
            'd0000000-0000-4000-8000-000000000007');
    raise exception 'crm_contacts: partner signed as the owner';
  exception when insufficient_privilege then null;
  end;
  -- Finance of P and the owner of Q stay out.
  perform pg_temp.ctx('d0000000-0000-4000-8000-000000000008', 'c1c00000-0000-4000-8000-000000000021',
                      'c1c00000-0000-4000-8000-000000000020', 'c1c00000-0000-4000-8000-000000000001');
  if pg_temp.visible('crm_contacts') <> 0 then
    raise exception 'crm_contacts: partner_finance reads a managed company';
  end if;
  perform pg_temp.ctx('d0000000-0000-4000-8000-000000000009', 'c1c00000-0000-4000-8000-000000000021',
                      'c1c00000-0000-4000-8000-000000000020', 'c1c00000-0000-4000-8000-000000000002');
  if pg_temp.visible('crm_contacts') <> 0 then
    raise exception 'crm_contacts: another partner reads a managed company';
  end if;

  -- The admin (not owner) cannot go back to padrao; the owner can.
  perform pg_temp.ctx('d0000000-0000-4000-8000-000000000005', 'c1c00000-0000-4000-8000-000000000021',
                      'c1c00000-0000-4000-8000-000000000020', 'c1c00000-0000-4000-8000-000000000001');
  update public.organization_service_modes set mode = 'padrao', source = 'customer', request_id = null,
    set_by = 'd0000000-0000-4000-8000-000000000005';
  get diagnostics v_count = row_count;
  if v_count <> 0 then
    raise exception 'organization_service_modes: the admin went back to padrao';
  end if;
  perform pg_temp.ctx('d0000000-0000-4000-8000-000000000007', 'c1c00000-0000-4000-8000-000000000021',
                      'c1c00000-0000-4000-8000-000000000020', 'c1c00000-0000-4000-8000-000000000001');
  begin
    update public.organization_service_modes set partner_id = 'c1c00000-0000-4000-8000-000000000002';
    raise exception 'organization_service_modes: the partner of the company changed';
  exception when insufficient_privilege then null;
  end;
  update public.organization_service_modes set mode = 'padrao', source = 'customer', request_id = null,
    set_by = 'd0000000-0000-4000-8000-000000000007';
  get diagnostics v_count = row_count;
  if v_count <> 1 then
    raise exception 'organization_service_modes: the owner did not go back to padrao';
  end if;
  -- In the same transaction, the managing team already sees nothing.
  perform pg_temp.ctx('d0000000-0000-4000-8000-000000000006', 'c1c00000-0000-4000-8000-000000000021',
                      'c1c00000-0000-4000-8000-000000000020', 'c1c00000-0000-4000-8000-000000000001');
  foreach t in array array['crm_contacts', 'channel_connections', 'portfolio_items', 'settings', 'ai_conversations'] loop
    if pg_temp.visible(t) <> 0 then
      raise exception '%: access survived the way back to padrao', t;
    end if;
  end loop;
  -- The partner can only end the managed service, never restart it.
  perform pg_temp.ctx('d0000000-0000-4000-8000-000000000004', null, null, 'c1c00000-0000-4000-8000-000000000001');
  begin
    update public.organization_service_modes set mode = 'gerenciado', source = 'partner',
      set_by = 'd0000000-0000-4000-8000-000000000004'
    where organization_id = 'c1c00000-0000-4000-8000-000000000020';
    raise exception 'organization_service_modes: partner switched back to gerenciado';
  exception when insufficient_privilege then null;
  end;
end
$$;
reset role;
do $$
begin
  -- Writes of the managing team are audited with origin partner.
  if (select count(*) from public.audit_events
      where origin = 'partner' and actor_user_id = 'd0000000-0000-4000-8000-000000000006'
        and action in ('managed.crm_contacts.insert', 'managed.channel_connections.update',
                       'managed.ai_agents.update')) <> 3 then
    raise exception 'audit: managing partner writes not audited';
  end if;
  -- The owner's own changes are not.
  if exists (select 1 from public.audit_events where origin = 'partner'
             and actor_user_id = 'd0000000-0000-4000-8000-000000000007') then
    raise exception 'audit: owner write audited as partner';
  end if;
end
$$;
rollback;

-- ----------------------------------------------------------------------------
-- Test 6: management clause in the first-access terms
-- ----------------------------------------------------------------------------
begin;
select pg_temp.fixture();
do $$
begin
  -- Every partner gets version 1 of the clause, with translations.
  if (select count(*) from public.partner_legal_documents
      where partner_id = 'c1c00000-0000-4000-8000-000000000001' and kind = 'management' and version = 1
        and requires_acceptance and body like '%PROVISÓRIO%') <> 1 then
    raise exception 'clause: not seeded for a new partner';
  end if;
  if (select count(*) from public.partner_legal_document_translations t
      join public.partner_legal_documents d on d.id = t.document_id
      where d.partner_id = 'c1c00000-0000-4000-8000-000000000001' and d.kind = 'management') <> 2 then
    raise exception 'clause: translations not seeded';
  end if;
end
$$;
insert into public.organization_service_modes (organization_id, partner_id, mode, source)
values ('c1c00000-0000-4000-8000-000000000020', 'c1c00000-0000-4000-8000-000000000001', 'gerenciado', 'registration');
set local role app_runtime;
do $$
begin
  perform pg_temp.ctx('d0000000-0000-4000-8000-000000000007', null, null, 'c1c00000-0000-4000-8000-000000000001');
  if not private.management_clause_required() then
    raise exception 'clause: owner of a contract-managed company not asked';
  end if;
  -- Another host's partner, or a non-owner member, are not asked.
  perform pg_temp.ctx('d0000000-0000-4000-8000-000000000007', null, null, 'c1c00000-0000-4000-8000-000000000002');
  if private.management_clause_required() then
    raise exception 'clause: asked on another partner host';
  end if;
  perform pg_temp.ctx('d0000000-0000-4000-8000-000000000005', null, null, 'c1c00000-0000-4000-8000-000000000001');
  if private.management_clause_required() then
    raise exception 'clause: a member who is not owner asked';
  end if;
end
$$;
reset role;
update public.organization_service_modes set source = 'request'
where organization_id = 'c1c00000-0000-4000-8000-000000000020';
set local role app_runtime;
do $$
begin
  perform pg_temp.ctx('d0000000-0000-4000-8000-000000000007', null, null, 'c1c00000-0000-4000-8000-000000000001');
  if private.management_clause_required() then
    raise exception 'clause: asked again after a consent by request';
  end if;
end
$$;
rollback;

-- ----------------------------------------------------------------------------
-- Test 7: events service_mode.* only for what the same person just did
-- ----------------------------------------------------------------------------
begin;
select pg_temp.fixture();
set local role app_runtime;
do $$
declare
  v_id uuid;
  v_ws uuid;
begin
  perform pg_temp.ctx('d0000000-0000-4000-8000-000000000004', null, null, 'c1c00000-0000-4000-8000-000000000001');
  select request_id, workspace_id into v_id, v_ws
  from private.service_mode_request_create('c1c00000-0000-4000-8000-000000000020', 'partner');
  if not private.service_mode_event_allowed('service_mode.change_requested', 'service_mode_request', v_id::text,
      'c1c00000-0000-4000-8000-000000000020', v_ws, 'c1c00000-0000-4000-8000-000000000001',
      'd0000000-0000-4000-8000-000000000004') then
    raise exception 'events: the request event refused';
  end if;
  if private.service_mode_event_allowed('service_mode.change_requested', 'service_mode_request', v_id::text,
      'c1c00000-0000-4000-8000-000000000020', v_ws, 'c1c00000-0000-4000-8000-000000000001',
      'd0000000-0000-4000-8000-000000000009') then
    raise exception 'events: someone else signed the request event';
  end if;
  if private.service_mode_event_allowed('service_mode.changed', 'service_mode_request', v_id::text,
      'c1c00000-0000-4000-8000-000000000020', v_ws, 'c1c00000-0000-4000-8000-000000000001',
      'd0000000-0000-4000-8000-000000000004') then
    raise exception 'events: a change event for an undecided request';
  end if;
end
$$;
rollback;
