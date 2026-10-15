-- ============================================================================
-- SQL gateway and analytics (CF7): payment_gateways, payment_webhook_events,
-- the webhook functions, the gateway history and the analytics reader.
--   platform owner d…003; billing d…010, operations d…009 and support d…008
--   (per block); customer a…032; partner b7…0c7 with its admin d…006
-- Each block prepares its fixtures as administrator, switches role with
-- `set local role` and rolls back.
-- ============================================================================

create or replace function pg_temp.ctx(p_user uuid, p_partner uuid default null)
returns void
language sql as $$
  select set_config('app.user_id', coalesce(p_user::text, ''), true),
         set_config('app.principal_type', 'user', true),
         set_config('app.workspace_id', '', true),
         set_config('app.organization_id', '', true),
         set_config('app.partner_id', coalesce(p_partner::text, ''), true);
$$;

create or replace function pg_temp.fixture() returns void
language sql as $$
  insert into public.platform_admin_members (user_id, role, status) values
    ('d0000000-0000-4000-8000-000000000010', 'billing', 'active'),
    ('d0000000-0000-4000-8000-000000000009', 'operations', 'active'),
    ('d0000000-0000-4000-8000-000000000008', 'support', 'active');
  insert into public.partners (id, slug, name) values
    ('b7000000-0000-4000-8000-0000000000c7', 'agencia-cf7', 'Agência CF7'),
    ('b7000000-0000-4000-8000-0000000000c8', 'outra-cf7', 'Outra CF7');
  insert into public.partner_members (partner_id, user_id, email, role) values
    ('b7000000-0000-4000-8000-0000000000c7', 'd0000000-0000-4000-8000-000000000006', 'admin@cf7.test', 'partner_admin');
  insert into public.payment_gateways
    (provider, enabled, is_default, mode, secret_key_masked, secret_key_encrypted,
     webhook_secret_masked, webhook_secret_encrypted, updated_by)
  values ('stripe', true, true, 'test', 'sk_test_...abcd', '{"enc":1}',
          'whsec_...abcd', '{"enc":2}', 'd0000000-0000-4000-8000-000000000003');
  insert into public.payment_webhook_events
    (provider, event_id, event_type, livemode, raw_body, status, attempts, last_error, processed_at)
  values
    ('stripe', 'evt_cf7_done', 'invoice.paid', false, '{}', 'processed', 1, null, now()),
    ('stripe', 'evt_cf7_failed', 'invoice.paid', true, '{}', 'failed', 1, 'mode_mismatch', null);
$$;

-- ----------------------------------------------------------------------------
-- Test 1: only platform billing (owner, billing) reads and writes the
-- gateway; operations, support, partners and customers see nothing.
-- ----------------------------------------------------------------------------
begin;
select pg_temp.fixture();
set local role app_runtime;
do $$
declare
  v_user uuid;
begin
  foreach v_user in array array[
    'd0000000-0000-4000-8000-000000000003'::uuid,
    'd0000000-0000-4000-8000-000000000010'::uuid
  ] loop
    perform pg_temp.ctx(v_user);
    if (select count(*) from public.payment_gateways) <> 1 then
      raise exception 'gateway: % cannot read it', v_user;
    end if;
    if (select count(*) from public.payment_webhook_events) <> 2 then
      raise exception 'gateway: % cannot read the events', v_user;
    end if;
    update public.payment_gateways set mode = 'test', updated_by = v_user;
    if not found then raise exception 'gateway: % cannot update it', v_user; end if;
  end loop;

  foreach v_user in array array[
    'd0000000-0000-4000-8000-000000000009'::uuid,
    'd0000000-0000-4000-8000-000000000008'::uuid,
    'a0000000-0000-4000-8000-000000000032'::uuid,
    'd0000000-0000-4000-8000-000000000006'::uuid
  ] loop
    perform pg_temp.ctx(v_user, 'b7000000-0000-4000-8000-0000000000c7');
    if exists (select 1 from public.payment_gateways)
       or exists (select 1 from public.payment_webhook_events) then
      raise exception 'gateway: % reads it', v_user;
    end if;
    update public.payment_gateways set enabled = false, updated_by = v_user;
    if found then raise exception 'gateway: % updated it', v_user; end if;
    update public.payment_webhook_events set status = 'processed', processed_at = now()
    where event_id = 'evt_cf7_failed';
    if found then raise exception 'gateway: % reprocessed an event', v_user; end if;
  end loop;

  -- Writes repeat who writes.
  perform pg_temp.ctx('d0000000-0000-4000-8000-000000000010');
  begin
    update public.payment_gateways set mode = 'test', updated_by = 'd0000000-0000-4000-8000-000000000003';
    raise exception 'gateway: billing wrote as someone else';
  exception when insufficient_privilege then null;
  end;
end $$;
rollback;

-- ----------------------------------------------------------------------------
-- Test 2: events are never inserted directly; reprocessing changes only a
-- failed event; the raw body and the event id never change.
-- ----------------------------------------------------------------------------
begin;
select pg_temp.fixture();
set local role app_runtime;
do $$
begin
  perform pg_temp.ctx('d0000000-0000-4000-8000-000000000010');
  begin
    insert into public.payment_webhook_events (provider, event_id, event_type, livemode, raw_body)
    values ('stripe', 'evt_cf7_forged', 'invoice.paid', false, '{}');
    raise exception 'events: billing inserted an event';
  exception when insufficient_privilege then null;
  end;

  update public.payment_webhook_events set status = 'failed', attempts = 9
  where event_id = 'evt_cf7_done';
  if found then raise exception 'events: a processed event changed'; end if;

  update public.payment_webhook_events
  set status = 'processed', attempts = 2, last_error = null, processed_at = now()
  where event_id = 'evt_cf7_failed';
  if not found then raise exception 'events: billing could not reprocess'; end if;

  begin
    update public.payment_webhook_events set raw_body = '{"x":1}';
    raise exception 'events: the raw body changed';
  exception when insufficient_privilege then null;
  end;
  begin
    delete from public.payment_webhook_events;
    raise exception 'events: billing deleted events';
  exception when insufficient_privilege then null;
  end;
end $$;
rollback;

-- ----------------------------------------------------------------------------
-- Test 3: the webhook functions, without identity. The secret comes only
-- from an enabled gateway; an event is stored once; the mark changes only
-- what is not processed yet.
-- ----------------------------------------------------------------------------
begin;
select pg_temp.fixture();
set local role app_runtime;
do $$
declare
  v_row record;
  v_id uuid;
begin
  perform pg_temp.ctx(null);
  select * into v_row from private.payment_webhook_secret('stripe');
  if v_row.webhook_secret_encrypted is distinct from '{"enc":2}' or v_row.mode <> 'test' then
    raise exception 'payment_webhook_secret: wrong row %', v_row;
  end if;
  if exists (select 1 from private.payment_webhook_secret('iugu')) then
    raise exception 'payment_webhook_secret: unknown provider answered';
  end if;
  -- The flag does not leak outside the function.
  if exists (select 1 from public.payment_gateways) then
    raise exception 'payment_webhook_secret: table readable after the call';
  end if;

  select * into v_row from private.payment_webhook_receive('stripe', 'evt_cf7_new', 'invoice.paid', false, false, '{"id":"evt_cf7_new"}');
  if not v_row.inserted or v_row.status <> 'received' then
    raise exception 'payment_webhook_receive: first call %', v_row;
  end if;
  v_id := v_row.id;
  select * into v_row from private.payment_webhook_receive('stripe', 'evt_cf7_new', 'invoice.paid', false, false, '{"id":"other"}');
  if v_row.inserted or v_row.id <> v_id then
    raise exception 'payment_webhook_receive: duplicate stored %', v_row;
  end if;

  if not private.payment_webhook_finish(v_id, null) then
    raise exception 'payment_webhook_finish: did not mark';
  end if;
  if private.payment_webhook_finish(v_id, 'late_error') then
    raise exception 'payment_webhook_finish: changed a processed event';
  end if;
  if exists (select 1 from public.payment_webhook_events) then
    raise exception 'payment_webhook_receive: events readable without identity';
  end if;
end $$;
reset role;
do $$
begin
  if (select count(*) from public.payment_webhook_events where event_id = 'evt_cf7_new'
        and status = 'processed' and attempts = 1 and raw_body = '{"id":"evt_cf7_new"}'
        and processing_ms is not null) <> 1 then
    raise exception 'payment_webhook_receive: stored row is wrong';
  end if;
end $$;

-- Off: no secret, so the webhook refuses everything.
update public.payment_gateways set is_default = false, enabled = false;
set local role app_runtime;
do $$
begin
  if exists (select 1 from private.payment_webhook_secret('stripe')) then
    raise exception 'payment_webhook_secret: a disabled gateway answered';
  end if;
end $$;
rollback;

-- ----------------------------------------------------------------------------
-- Test 4: the constraints: on needs both credentials, the default must be
-- on, one default only, Stripe only, a short error code only.
-- ----------------------------------------------------------------------------
begin;
do $$
begin
  begin
    insert into public.payment_gateways (provider, enabled, updated_by)
    values ('stripe', true, 'd0000000-0000-4000-8000-000000000003');
    raise exception 'constraints: on without credentials';
  exception when check_violation then null;
  end;
  begin
    insert into public.payment_gateways (provider, is_default, updated_by)
    values ('stripe', true, 'd0000000-0000-4000-8000-000000000003');
    raise exception 'constraints: default while off';
  exception when check_violation then null;
  end;
  begin
    insert into public.payment_gateways (provider, updated_by)
    values ('iugu', 'd0000000-0000-4000-8000-000000000003');
    raise exception 'constraints: a provider outside this step';
  exception when check_violation then null;
  end;
  begin
    insert into public.payment_webhook_events (provider, event_id, event_type, livemode, raw_body, status, last_error)
    values ('stripe', 'evt_x', 'invoice.paid', false, '{}', 'failed', 'Customer maria@x.com failed');
    raise exception 'constraints: free text in the error';
  exception when check_violation then null;
  end;
end $$;
rollback;

-- ----------------------------------------------------------------------------
-- Test 5: functions are security definer of app_rls_helper, and neither
-- anon, authenticated nor the worker call them.
-- ----------------------------------------------------------------------------
do $$
declare
  v_name text;
begin
  foreach v_name in array array[
    'payment_webhook_secret', 'payment_webhook_receive', 'payment_webhook_finish',
    'payment_gateway_history', 'analytics_settings'
  ] loop
    if not exists (
      select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'private' and p.proname = v_name
        and p.prosecdef and pg_get_userbyid(p.proowner) = 'app_rls_helper'
    ) then
      raise exception '%: not a security definer of app_rls_helper', v_name;
    end if;
  end loop;
end $$;

begin;
set local role authenticated;
do $$
begin
  perform private.payment_webhook_secret('stripe');
  raise exception 'payment_webhook_secret: authenticated called it';
exception when insufficient_privilege then null;
end $$;
reset role;
set local role anon;
do $$
begin
  perform private.analytics_settings(null);
  raise exception 'analytics_settings: anon called it';
exception when insufficient_privilege then null;
end $$;
reset role;
set local role app_worker;
do $$
begin
  perform private.payment_webhook_receive('stripe', 'evt_w', 'x', false, false, '{}');
  raise exception 'payment_webhook_receive: worker called it';
exception when insufficient_privilege then null;
end $$;
rollback;

-- ----------------------------------------------------------------------------
-- Test 6: the gateway history shows only gateway audit rows, to owner and
-- billing.
-- ----------------------------------------------------------------------------
begin;
select pg_temp.fixture();
insert into public.audit_events (action, resource_type, result, origin, actor_principal_type, actor_user_id)
values
  ('platform.billing.gateway.settings', 'payment_gateway', 'success', 'admin', 'user', 'd0000000-0000-4000-8000-000000000010'),
  ('platform.settings.save', 'settings', 'success', 'admin', 'user', 'd0000000-0000-4000-8000-000000000003');
set local role app_runtime;
do $$
begin
  perform pg_temp.ctx('d0000000-0000-4000-8000-000000000010');
  if (select count(*) from private.payment_gateway_history(50)) < 1
     or exists (select 1 from private.payment_gateway_history(50)
                where action not like 'platform.billing.gateway.%') then
    raise exception 'payment_gateway_history: wrong rows for billing';
  end if;
  perform pg_temp.ctx('d0000000-0000-4000-8000-000000000009');
  if exists (select 1 from private.payment_gateway_history(50)) then
    raise exception 'payment_gateway_history: operations reads it';
  end if;
  perform pg_temp.ctx('a0000000-0000-4000-8000-000000000032');
  if exists (select 1 from private.payment_gateway_history(50)) then
    raise exception 'payment_gateway_history: a customer reads it';
  end if;
end $$;
rollback;

-- ----------------------------------------------------------------------------
-- Test 7: before sign-in, only the `analytics.*` rows of the platform and of
-- the host's partner.
-- ----------------------------------------------------------------------------
begin;
select pg_temp.fixture();
insert into public.settings (scope, key, value, locked, updated_by) values
  ('platform', 'analytics.enabled', 'true', false, 'd0000000-0000-4000-8000-000000000003'),
  ('platform', 'region.currency', '"USD"', false, 'd0000000-0000-4000-8000-000000000003');
insert into public.settings (scope, partner_id, key, value, locked, updated_by) values
  ('partner', 'b7000000-0000-4000-8000-0000000000c7', 'analytics.partner_site_id', '"painel.cf7.test"', false,
   'd0000000-0000-4000-8000-000000000006'),
  ('partner', 'b7000000-0000-4000-8000-0000000000c8', 'analytics.partner_site_id', '"outra.cf7.test"', false,
   'd0000000-0000-4000-8000-000000000006');
set local role app_runtime;
do $$
declare
  v_rows text;
begin
  perform pg_temp.ctx(null);
  select string_agg(scope || ':' || key, ',' order by scope, key) into v_rows
  from private.analytics_settings('b7000000-0000-4000-8000-0000000000c7');
  if v_rows is distinct from 'partner:analytics.partner_site_id,platform:analytics.enabled' then
    raise exception 'analytics_settings: partner rows are %', v_rows;
  end if;
  select string_agg(scope || ':' || key, ',' order by scope, key) into v_rows
  from private.analytics_settings(null);
  if v_rows is distinct from 'platform:analytics.enabled' then
    raise exception 'analytics_settings: platform rows are %', v_rows;
  end if;
  if exists (select 1 from public.settings) then
    raise exception 'analytics_settings: a visitor reads the table';
  end if;
end $$;
rollback;
