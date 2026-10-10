-- ============================================================================
-- SQL Billing automation (F3c): billing_settings, notification_deliveries,
-- payout_reports and what platform jobs may do as app_worker
--
-- Executed as migration administrator; each block rolls back.
--   partner B b0000000-0000-4000-8000-000000000001 (per block), org B a…020
--   d…005 partner_finance of B   d…002 platform billing   a…031 outsider
-- ============================================================================

create or replace function pg_temp.automation_fixture() returns void
language sql as $$
  insert into public.partners (id, slug, name)
  values ('b0000000-0000-4000-8000-000000000001', 'agencia-b', 'Agência B');
  insert into public.partner_members (partner_id, user_id, email, role) values
    ('b0000000-0000-4000-8000-000000000001', 'd0000000-0000-4000-8000-000000000005', 'fin@b.test', 'partner_finance');
  insert into public.partner_billing_profiles (partner_id, legal_name, tax_id, billing_email)
  values ('b0000000-0000-4000-8000-000000000001', 'Agência B Ltda', '11222333000181', 'cobranca@b.test');
  insert into public.platform_admin_members (user_id, role, status)
  values ('d0000000-0000-4000-8000-000000000002', 'billing', 'active');
  update public.organizations set partner_id = 'b0000000-0000-4000-8000-000000000001'
  where id = 'a0000000-0000-4000-8000-000000000020';
  insert into public.subscriptions
    (id, partner_id, organization_id, plan_version_id, mode, payer, billing_interval, amount_cents,
     status, current_period_start, current_period_end)
  select 'f3c00000-0000-4000-8000-000000000001', 'b0000000-0000-4000-8000-000000000001',
         'a0000000-0000-4000-8000-000000000020', id, 'partner_pays', 'partner', 'monthly', 3000,
         'active', '2026-09-01', '2026-10-01'
  from public.plan_versions where plan_id = '00000000-0000-4000-8000-0000000000a1' and version = 1;
$$;

-- ----------------------------------------------------------------------------
-- Test 1: platform jobs move subscriptions only into arrears and suspension
-- ----------------------------------------------------------------------------
begin;
select pg_temp.automation_fixture();
set local role app_worker;
do $$
begin
  update public.subscriptions set status = 'past_due' where id = 'f3c00000-0000-4000-8000-000000000001';
  if not found then raise exception 'automation: worker could not mark arrears'; end if;
  update public.subscriptions set status = 'suspended' where id = 'f3c00000-0000-4000-8000-000000000001';
  if not found then raise exception 'automation: worker could not suspend'; end if;
  -- Suspended is not a status the worker updates from.
  update public.subscriptions set status = 'past_due' where id = 'f3c00000-0000-4000-8000-000000000001';
  if found then raise exception 'automation: worker changed a suspended subscription'; end if;
end
$$;
rollback;

begin;
select pg_temp.automation_fixture();
set local role app_worker;
do $$
begin
  begin
    update public.subscriptions set status = 'canceled', canceled_at = now()
    where id = 'f3c00000-0000-4000-8000-000000000001';
    raise exception 'automation: worker canceled a subscription';
  exception when insufficient_privilege then null;
  end;
  begin
    update public.subscriptions set status = 'past_due', amount_cents = 1
    where id = 'f3c00000-0000-4000-8000-000000000001';
    raise exception 'automation: worker changed the price';
  exception when check_violation then null;
  end;
end
$$;
rollback;

-- ----------------------------------------------------------------------------
-- Test 2: the worker reads only the columns notices and reports need
-- ----------------------------------------------------------------------------
begin;
select pg_temp.automation_fixture();
set local role app_worker;
do $$
begin
  perform name from public.partners where id = 'b0000000-0000-4000-8000-000000000001';
  perform billing_email from public.partner_billing_profiles;
  perform amount_cents, paid_on from public.payments;
  begin
    perform checkout_enabled from public.partners;
    raise exception 'automation: worker reads partner settings';
  exception when insufficient_privilege then null;
  end;
  begin
    perform tax_id from public.partner_billing_profiles;
    raise exception 'automation: worker reads the tax id';
  exception when insufficient_privilege then null;
  end;
  begin
    perform evidence from public.payments;
    raise exception 'automation: worker reads payment evidence';
  exception when insufficient_privilege then null;
  end;
  begin
    perform user_id from public.partner_members;
    raise exception 'automation: worker reads member ids';
  exception when insufficient_privilege then null;
  end;
end
$$;
rollback;

-- ----------------------------------------------------------------------------
-- Test 3: settings, deliveries and reports for people
-- ----------------------------------------------------------------------------
begin;
select pg_temp.automation_fixture();
insert into public.notification_deliveries
  (partner_id, event_type, recipient_email, subject, idempotency_key, status)
values ('b0000000-0000-4000-8000-000000000001', 'billing.subscription.past_due', 'cobranca@b.test',
        'Aviso', 'k1', 'pending');
insert into public.payout_reports
  (partner_id, period_start, period_end, payments_count, received_cents, refunded_cents,
   platform_net_cents, partner_net_cents)
values ('b0000000-0000-4000-8000-000000000001', '2026-09-01', '2026-10-01', 1, 3000, 0, 3000, 0);
select set_config('app.partner_id', 'b0000000-0000-4000-8000-000000000001', true);
set local role app_runtime;
do $$
begin
  -- partner_finance reads its partner's settings, notices and reports.
  perform set_config('app.user_id', 'd0000000-0000-4000-8000-000000000005', true);
  if (select count(*) from public.billing_settings) <> 1
     or (select count(*) from public.notification_deliveries) <> 1
     or (select count(*) from public.payout_reports) <> 1 then
    raise exception 'automation: partner cannot read its billing records';
  end if;
  update public.billing_settings set suspend_after_days = 1;
  if found then raise exception 'automation: partner changed the billing terms'; end if;
  begin
    insert into public.notification_deliveries
      (partner_id, event_type, recipient_email, subject, idempotency_key)
    values ('b0000000-0000-4000-8000-000000000001', 'billing.x', 'a@b.test', 'x', 'k2');
    raise exception 'automation: web runtime wrote a delivery';
  exception when insufficient_privilege then null;
  end;

  -- An outsider reads nothing; platform billing edits the terms.
  perform set_config('app.user_id', 'a0000000-0000-4000-8000-000000000031', true);
  if (select count(*) from public.notification_deliveries) + (select count(*) from public.payout_reports)
     + (select count(*) from public.billing_settings) <> 0 then
    raise exception 'automation: outsider reads billing records';
  end if;
  perform set_config('app.partner_id', '00000000-0000-4000-8000-000000000000', true);
  perform set_config('app.user_id', 'd0000000-0000-4000-8000-000000000002', true);
  update public.billing_settings
  set suspend_after_days = 10, provisional = false, updated_by = 'd0000000-0000-4000-8000-000000000002';
  if not found then raise exception 'automation: platform billing could not edit the terms'; end if;
end
$$;

-- The worker settles a pending delivery once.
reset role;
set local role app_worker;
do $$
begin
  update public.notification_deliveries set status = 'skipped', reason = 'no_provider' where idempotency_key = 'k1';
  if not found then raise exception 'automation: worker could not settle a delivery'; end if;
  update public.notification_deliveries set status = 'sent' where idempotency_key = 'k1';
  if found then raise exception 'automation: settled delivery changed again'; end if;
end
$$;
rollback;

-- ----------------------------------------------------------------------------
-- Test 4: the worker audits as a service, never as a person or workspace
-- ----------------------------------------------------------------------------
begin;
set local role app_worker;
do $$
begin
  insert into public.audit_events
    (actor_principal_type, origin, action, resource_type, resource_id, result)
  values ('service', 'worker', 'billing.subscription.status', 'subscription', 'x', 'success');
  begin
    insert into public.audit_events
      (actor_principal_type, actor_user_id, origin, action, resource_type, result)
    values ('user', 'd0000000-0000-4000-8000-000000000002', 'worker', 'x.y', 'subscription', 'success');
    raise exception 'automation: worker audited as a person';
  exception when insufficient_privilege then null;
  end;
  begin
    insert into public.audit_events
      (actor_principal_type, origin, action, resource_type, result, occurred_at)
    values ('service', 'worker', 'x.y', 'subscription', 'success', now() - interval '1 day');
    raise exception 'automation: worker backdated an audit event';
  exception when insufficient_privilege then null;
  end;
end
$$;
rollback;
