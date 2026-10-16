-- ============================================================================
-- SQL da auditoria da plataforma (AUD1): `private.platform_audit_events`,
-- `private.is_billing_audit_action` e a política
-- `audit_events_platform_audit_helper_select`.
--   plataforma: d…003 owner, d…001 operations, d…002 billing, d…005 support,
--     d…007 operations inativo (por bloco)
--   parceiro B b7…015 (por bloco): d…006 partner_admin, d…004 partner_support;
--     a org B a…020 passa para o parceiro B
--   cliente: a…031 (owner da org A)
-- Os eventos do teste ficam em 01/01/2001, longe dos demais, e o período
-- isola o cursor. Cada bloco prepara os dados como administrador, troca para
-- `app_runtime` com `set local role` e desfaz tudo no fim.
-- ============================================================================

create or replace function pg_temp.ctx(p_user uuid, p_partner uuid default null)
returns void
language sql as $$
  select set_config('app.user_id', p_user::text, true),
         set_config('app.principal_type', 'user', true),
         set_config('app.workspace_id', '', true),
         set_config('app.organization_id', '', true),
         set_config('app.partner_id', coalesce(p_partner::text, ''), true);
$$;

-- Ids dos eventos do teste devolvidos por uma chamada, em ordem.
create or replace function pg_temp.ids(
  p_partner uuid default null,
  p_org uuid default null,
  p_ws uuid default null,
  p_prefix text default null,
  p_result text default null,
  p_origin text default null,
  p_actor uuid default null,
  p_from timestamptz default null,
  p_to timestamptz default null
)
returns text
language sql as $$
  select coalesce(string_agg(right(e.id::text, 2), ',' order by e.id), '')
  from private.platform_audit_events(
    p_partner, p_org, p_ws, p_prefix, p_result, p_origin, p_actor,
    p_from, p_to, null, null, 200
  ) e
  where e.id::text like 'c6000000-%';
$$;

create or replace function pg_temp.fixture() returns void
language sql as $$
  insert into public.partners (id, slug, name) values
    ('b7000000-0000-4000-8000-000000000015', 'agencia-aud1', 'Agência AUD1'),
    ('b7000000-0000-4000-8000-000000000016', 'outra-aud1', 'Outra AUD1');
  insert into public.partner_members (partner_id, user_id, email, role) values
    ('b7000000-0000-4000-8000-000000000015', 'd0000000-0000-4000-8000-000000000006', 'admin@aud1.test', 'partner_admin'),
    ('b7000000-0000-4000-8000-000000000015', 'd0000000-0000-4000-8000-000000000004', 'sup@aud1.test', 'partner_support');
  insert into public.platform_admin_members (user_id, role, status) values
    ('d0000000-0000-4000-8000-000000000001', 'operations', 'active'),
    ('d0000000-0000-4000-8000-000000000002', 'billing', 'active'),
    ('d0000000-0000-4000-8000-000000000005', 'support', 'active'),
    ('d0000000-0000-4000-8000-000000000007', 'operations', 'inactive')
  on conflict (user_id) do update set role = excluded.role, status = excluded.status;
  update public.organizations set partner_id = 'b7000000-0000-4000-8000-000000000015'
  where id = 'a0000000-0000-4000-8000-000000000020';

  insert into public.audit_events
    (id, occurred_at, actor_user_id, actor_principal_type, origin, action,
     resource_type, result, metadata, organization_id, workspace_id)
  values
    ('c6000000-0000-4000-8000-000000000001', '2001-01-01 11:59:00+00', 'd0000000-0000-4000-8000-000000000003',
     'user', 'admin', 'billing.plan.create', 'plan', 'success', '{"name": "Pro"}', null, null),
    ('c6000000-0000-4000-8000-000000000002', '2001-01-01 11:58:00+00', 'd0000000-0000-4000-8000-000000000006',
     'user', 'admin', 'partner.payment.record', 'payment', 'success',
     '{"partnerId": "b7000000-0000-4000-8000-000000000015"}', null, null),
    ('c6000000-0000-4000-8000-000000000003', '2001-01-01 11:57:00+00', 'a0000000-0000-4000-8000-000000000032',
     'user', 'app', 'workspace_members.role_changed', 'workspace_member', 'success', '{"role": "admin"}',
     'a0000000-0000-4000-8000-000000000020', 'a0000000-0000-4000-8000-000000000021'),
    ('c6000000-0000-4000-8000-000000000004', '2001-01-01 11:56:00+00', 'a0000000-0000-4000-8000-000000000031',
     'user', 'app', 'crm.contact.create', 'crm_contact', 'error', '{}',
     'a0000000-0000-4000-8000-000000000010', 'a0000000-0000-4000-8000-000000000011'),
    ('c6000000-0000-4000-8000-000000000005', '2001-01-01 11:55:00+00', null,
     'api_key', 'api', 'auth.sign_in', 'session', 'success',
     '{"partnerId": "b7000000-0000-4000-8000-000000000016"}', null, null),
    ('c6000000-0000-4000-8000-000000000006', '2001-01-01 11:54:00+00', 'd0000000-0000-4000-8000-000000000003',
     'user', 'admin', 'platform.billing.gateway.settings', 'payment_gateway', 'denied', '{}', null, null),
    ('c6000000-0000-4000-8000-000000000007', '2001-01-01 11:53:00+00', null,
     'service', 'worker', 'billingx.plan.create', 'plan', 'success', '{}', null, null),
    -- Two events at the same instant: the cursor breaks the tie by id.
    ('c6000000-0000-4000-8000-000000000008', '2001-01-01 11:52:00+00', null,
     'service', 'worker', 'billing.subscription.status', 'subscription', 'success', '{}', null, null),
    ('c6000000-0000-4000-8000-000000000009', '2001-01-01 11:52:00+00', null,
     'service', 'worker', 'job.retry', 'job', 'success', '{}', null, null);
$$;

-- ----------------------------------------------------------------------------
-- Test 1: owner, operations and support read the whole trail
-- ----------------------------------------------------------------------------
begin;
select pg_temp.fixture();
set local role app_runtime;
do $$
declare
  v_row record;
begin
  perform pg_temp.ctx('d0000000-0000-4000-8000-000000000003');
  if pg_temp.ids() is distinct from '01,02,03,04,05,06,07,08,09' then
    raise exception 'platform_audit_events: owner got %', pg_temp.ids();
  end if;

  -- Partner of the event: the metadata first, the company otherwise.
  select * into v_row
  from private.platform_audit_events(null, null, null, null, null, null, null,
       null, null, null, null, 200) e
  where e.id = 'c6000000-0000-4000-8000-000000000003';
  if v_row.partner_id is distinct from 'b7000000-0000-4000-8000-000000000015' then
    raise exception 'platform_audit_events: partner of the company missing (%)', v_row.partner_id;
  end if;
  if not v_row.is_security then
    raise exception 'platform_audit_events: role change not flagged as security';
  end if;
  if v_row.metadata ->> 'role' is distinct from 'admin' then
    raise exception 'platform_audit_events: metadata missing for the owner';
  end if;

  select * into v_row
  from private.platform_audit_events(null, null, null, null, null, null, null,
       null, null, null, null, 200) e
  where e.id = 'c6000000-0000-4000-8000-000000000002';
  if v_row.partner_id is distinct from 'b7000000-0000-4000-8000-000000000015' or v_row.is_security then
    raise exception 'platform_audit_events: partner of the metadata or security flag wrong';
  end if;

  select * into v_row
  from private.platform_audit_events(null, null, null, null, null, null, null,
       null, null, null, null, 200) e
  where e.id = 'c6000000-0000-4000-8000-000000000004';
  -- Org A stays with the house partner (the organizations default).
  if v_row.partner_id is null or v_row.partner_id = 'b7000000-0000-4000-8000-000000000015' then
    raise exception 'platform_audit_events: company of the house partner got %', v_row.partner_id;
  end if;

  perform pg_temp.ctx('d0000000-0000-4000-8000-000000000001');
  if pg_temp.ids() is distinct from '01,02,03,04,05,06,07,08,09' then
    raise exception 'platform_audit_events: operations got %', pg_temp.ids();
  end if;

  perform pg_temp.ctx('d0000000-0000-4000-8000-000000000005');
  if pg_temp.ids() is distinct from '01,02,03,04,05,06,07,08,09' then
    raise exception 'platform_audit_events: support got %', pg_temp.ids();
  end if;
end $$;
rollback;

-- ----------------------------------------------------------------------------
-- Test 2: billing reads only the billing actions
-- ----------------------------------------------------------------------------
begin;
select pg_temp.fixture();
set local role app_runtime;
do $$
begin
  perform pg_temp.ctx('d0000000-0000-4000-8000-000000000002');
  -- billing.*, partner.payment.*, platform.billing.*; never billingx.* nor
  -- the security, CRM or job events.
  if pg_temp.ids() is distinct from '01,02,06,08' then
    raise exception 'platform_audit_events: billing got %', pg_temp.ids();
  end if;
  -- A filter never widens the slice.
  if pg_temp.ids(p_prefix => 'crm.') <> '' then
    raise exception 'platform_audit_events: billing reads CRM events by prefix';
  end if;
  if pg_temp.ids(p_org => 'a0000000-0000-4000-8000-000000000020') <> '' then
    raise exception 'platform_audit_events: billing reads a company event';
  end if;

  -- The rule itself.
  if not (private.is_billing_audit_action('billing.terms.update')
          and private.is_billing_audit_action('platform.billing.gateway.reprocess')
          and private.is_billing_audit_action('partner.billing.plan.create')
          and private.is_billing_audit_action('partner.billing.profile.save')
          and private.is_billing_audit_action('partner.payment.record')
          and private.is_billing_audit_action('partner.subscription.start')
          and private.is_billing_audit_action('partner.checkout.toggle')) then
    raise exception 'is_billing_audit_action: a billing action left out';
  end if;
  if private.is_billing_audit_action('billingx.plan')
     or private.is_billing_audit_action('auth.sign_in')
     or private.is_billing_audit_action('partner.brand.update')
     or private.is_billing_audit_action('platform.settings.save') then
    raise exception 'is_billing_audit_action: a non-billing action passed';
  end if;
end $$;
rollback;

-- ----------------------------------------------------------------------------
-- Test 3: filters
-- ----------------------------------------------------------------------------
begin;
select pg_temp.fixture();
set local role app_runtime;
do $$
begin
  perform pg_temp.ctx('d0000000-0000-4000-8000-000000000003');
  if pg_temp.ids(p_partner => 'b7000000-0000-4000-8000-000000000015') <> '02,03' then
    raise exception 'filter partner: %', pg_temp.ids(p_partner => 'b7000000-0000-4000-8000-000000000015');
  end if;
  if pg_temp.ids(p_partner => 'b7000000-0000-4000-8000-000000000016') <> '05' then
    raise exception 'filter partner (metadata): %', pg_temp.ids(p_partner => 'b7000000-0000-4000-8000-000000000016');
  end if;
  if pg_temp.ids(p_org => 'a0000000-0000-4000-8000-000000000020') <> '03' then
    raise exception 'filter company';
  end if;
  if pg_temp.ids(p_ws => 'a0000000-0000-4000-8000-000000000011') <> '04' then
    raise exception 'filter workspace';
  end if;
  if pg_temp.ids(p_prefix => 'billing.') <> '01,08' then
    raise exception 'filter action prefix: %', pg_temp.ids(p_prefix => 'billing.');
  end if;
  if pg_temp.ids(p_prefix => 'billing') <> '01,07,08' then
    raise exception 'filter action prefix without dot: %', pg_temp.ids(p_prefix => 'billing');
  end if;
  -- `%` and `_` are plain text in the prefix.
  if pg_temp.ids(p_prefix => '%') <> '' or pg_temp.ids(p_prefix => 'b_lling') <> '' then
    raise exception 'filter action prefix: wildcard honoured';
  end if;
  if pg_temp.ids(p_prefix => '') <> '01,02,03,04,05,06,07,08,09' then
    raise exception 'filter action prefix: empty prefix filters';
  end if;
  if pg_temp.ids(p_result => 'error') <> '04' or pg_temp.ids(p_result => 'denied') <> '06' then
    raise exception 'filter result';
  end if;
  if pg_temp.ids(p_origin => 'api') <> '05' or pg_temp.ids(p_origin => 'worker') <> '07,08,09' then
    raise exception 'filter origin';
  end if;
  if pg_temp.ids(p_actor => 'a0000000-0000-4000-8000-000000000031') <> '04' then
    raise exception 'filter actor';
  end if;
  -- Period: from inclusive, to exclusive.
  if pg_temp.ids(p_from => '2001-01-01 11:56:00+00', p_to => '2001-01-01 11:58:00+00') <> '03,04' then
    raise exception 'filter period: %',
      pg_temp.ids(p_from => '2001-01-01 11:56:00+00', p_to => '2001-01-01 11:58:00+00');
  end if;
  -- Filters combine.
  if pg_temp.ids(p_partner => 'b7000000-0000-4000-8000-000000000015', p_origin => 'app') <> '03' then
    raise exception 'filters do not combine';
  end if;
end $$;
rollback;

-- ----------------------------------------------------------------------------
-- Test 4: cursor and limit
-- ----------------------------------------------------------------------------
begin;
select pg_temp.fixture();
set local role app_runtime;
do $$
declare
  v_at timestamptz := null;
  v_id uuid := null;
  v_seen text := '';
  v_row record;
  v_pages integer := 0;
begin
  perform pg_temp.ctx('d0000000-0000-4000-8000-000000000003');
  -- One row per page: every event once, newest first, the tie by id desc.
  loop
    select e.id, e.occurred_at into v_row
    from private.platform_audit_events(null, null, null, null, null, null, null,
         '2001-01-01 00:00:00+00', '2001-01-02 00:00:00+00', v_at, v_id, 1) e;
    exit when not found;
    v_pages := v_pages + 1;
    exit when v_pages > 20;
    v_seen := v_seen || right(v_row.id::text, 2) || ',';
    v_at := v_row.occurred_at;
    v_id := v_row.id;
  end loop;
  if v_seen is distinct from '01,02,03,04,05,06,07,09,08,' then
    raise exception 'cursor walk: %', v_seen;
  end if;

  -- Pages of three cover the same rows.
  if (select string_agg(right(e.id::text, 2), ',' order by e.occurred_at desc, e.id desc)
      from private.platform_audit_events(null, null, null, null, null, null, null,
           '2001-01-01 00:00:00+00', '2001-01-02 00:00:00+00',
           '2001-01-01 11:57:00+00', 'c6000000-0000-4000-8000-000000000003', 3) e)
     <> '04,05,06' then
    raise exception 'cursor page of three wrong';
  end if;

  -- The limit is kept between 1 and 200.
  if (select count(*) from private.platform_audit_events(null, null, null, null, null, null, null,
      '2001-01-01 00:00:00+00', '2001-01-02 00:00:00+00', null, null, 0)) <> 1 then
    raise exception 'limit: zero not raised to one';
  end if;
  if (select count(*) from private.platform_audit_events(null, null, null, null, null, null, null,
      '2001-01-01 00:00:00+00', '2001-01-02 00:00:00+00', null, null, 4)) <> 4 then
    raise exception 'limit ignored';
  end if;
end $$;
rollback;

-- ----------------------------------------------------------------------------
-- Test 5: partners, customers and inactive members read nothing; the table
-- stays without direct reads
-- ----------------------------------------------------------------------------
begin;
select pg_temp.fixture();
set local role app_runtime;
do $$
begin
  perform pg_temp.ctx('d0000000-0000-4000-8000-000000000006', 'b7000000-0000-4000-8000-000000000015');
  if exists (select 1 from private.platform_audit_events(null, null, null, null, null, null, null,
             null, null, null, null, 200)) then
    raise exception 'platform_audit_events: partner admin reads the trail';
  end if;
  perform pg_temp.ctx('d0000000-0000-4000-8000-000000000004', 'b7000000-0000-4000-8000-000000000015');
  if exists (select 1 from private.platform_audit_events(null, null, null, null, null, null, null,
             null, null, null, null, 200)) then
    raise exception 'platform_audit_events: partner support reads the trail';
  end if;
  perform pg_temp.ctx('a0000000-0000-4000-8000-000000000031');
  if exists (select 1 from private.platform_audit_events(null, null, null, null, null, null, null,
             null, null, null, null, 200)) then
    raise exception 'platform_audit_events: a customer reads the trail';
  end if;
  perform pg_temp.ctx('d0000000-0000-4000-8000-000000000007');
  if exists (select 1 from private.platform_audit_events(null, null, null, null, null, null, null,
             null, null, null, null, 200)) then
    raise exception 'platform_audit_events: an inactive platform member reads the trail';
  end if;
  perform set_config('app.user_id', '', true);
  if exists (select 1 from private.platform_audit_events(null, null, null, null, null, null, null,
             null, null, null, null, 200)) then
    raise exception 'platform_audit_events: no user reads the trail';
  end if;

  perform pg_temp.ctx('d0000000-0000-4000-8000-000000000003');
  begin
    perform 1 from public.audit_events;
    raise exception 'audit_events: app_runtime reads the table';
  exception when insufficient_privilege then null;
  end;
end $$;
rollback;

-- ----------------------------------------------------------------------------
-- Test 6: owner, flags and real grants of the functions
-- ----------------------------------------------------------------------------
do $$
declare
  v_fn oid := 'private.platform_audit_events(uuid, uuid, uuid, text, text, text, uuid, timestamptz, timestamptz, timestamptz, uuid, integer)'::regprocedure;
  v_rule oid := 'private.is_billing_audit_action(text)'::regprocedure;
  v_role text;
begin
  if pg_get_userbyid((select proowner from pg_proc where oid = v_fn)) <> 'app_rls_helper' then
    raise exception 'platform_audit_events: owner is not app_rls_helper';
  end if;
  if not (select prosecdef from pg_proc where oid = v_fn) then
    raise exception 'platform_audit_events: not security definer';
  end if;
  if not exists (select 1 from pg_proc where oid = v_fn and proconfig @> array['search_path=""']) then
    raise exception 'platform_audit_events: search_path is not empty';
  end if;
  if not has_function_privilege('app_runtime', v_fn, 'EXECUTE') then
    raise exception 'platform_audit_events: app_runtime cannot execute';
  end if;
  foreach v_role in array array['anon', 'authenticated', 'app_worker'] loop
    if exists (select 1 from pg_roles where rolname = v_role)
       and has_function_privilege(v_role, v_fn, 'EXECUTE') then
      raise exception 'platform_audit_events: % can execute', v_role;
    end if;
  end loop;
  if exists (select 1 from pg_proc p, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
             where p.oid = v_fn and a.grantee = 0) then
    raise exception 'platform_audit_events: PUBLIC can execute';
  end if;

  if pg_get_userbyid((select proowner from pg_proc where oid = v_rule)) <> 'app_migrations' then
    raise exception 'is_billing_audit_action: owner is not app_migrations';
  end if;
  if (select prosecdef from pg_proc where oid = v_rule) then
    raise exception 'is_billing_audit_action: must not be security definer';
  end if;
  if not has_function_privilege('app_rls_helper', v_rule, 'EXECUTE') then
    raise exception 'is_billing_audit_action: app_rls_helper cannot execute';
  end if;
  if exists (select 1 from pg_proc p, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
             where p.oid = v_rule and a.grantee = 0) then
    raise exception 'is_billing_audit_action: PUBLIC can execute';
  end if;

  if not exists (select 1 from pg_policies
                 where schemaname = 'public' and tablename = 'audit_events'
                   and policyname = 'audit_events_platform_audit_helper_select'
                   and cmd = 'SELECT' and roles = array['app_rls_helper']::name[]) then
    raise exception 'audit_events_platform_audit_helper_select: missing or not limited to app_rls_helper';
  end if;
  if has_table_privilege('app_runtime', 'public.audit_events', 'SELECT') then
    raise exception 'audit_events: app_runtime has SELECT';
  end if;
end $$;
