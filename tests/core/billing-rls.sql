-- ============================================================================
-- SQL Billing RLS (ADR 0012, P5m; especificação de parceiros §3 and §11)
-- Tables: plans, plan_versions, split_rules, partner_plans,
--         partner_billing_profiles, subscriptions, payment_provider_events,
--         payments, and the checkout switch in partners
--
-- Executed as migration administrator. Each block prepares its fixtures as
-- administrator, switches to `app_runtime` with `set local role` and rolls
-- back. Fixtures: tests/core/seed.sql, membership-seed.sql, admin-seed.sql.
--   partner B b0000000-0000-4000-8000-000000000001 (per block); org B a…020
--   and workspace B a…021 are moved to partner B
--   userB a…032 owner of workspace B   a…033 admin of org B
--   d…004 partner_support of B   d…005 partner_finance of B
--   d…006 partner_admin of B     d…002 platform billing   d…003 platform owner
--   plan version 1 of "essencial": floor 10000, minimum share 3000
-- ============================================================================

create or replace function pg_temp.billing_fixture() returns void
language sql as $$
  insert into public.partners (id, slug, name)
  values ('b0000000-0000-4000-8000-000000000001', 'agencia-b', 'Agência B');
  insert into public.partner_members (partner_id, user_id, email, role) values
    ('b0000000-0000-4000-8000-000000000001', 'd0000000-0000-4000-8000-000000000004', 'suporte@b.test', 'partner_support'),
    ('b0000000-0000-4000-8000-000000000001', 'd0000000-0000-4000-8000-000000000005', 'fin@b.test', 'partner_finance'),
    ('b0000000-0000-4000-8000-000000000001', 'd0000000-0000-4000-8000-000000000006', 'admin@b.test', 'partner_admin');
  insert into public.platform_admin_members (user_id, role, status)
  values ('d0000000-0000-4000-8000-000000000002', 'billing', 'active');
  update public.organizations
  set partner_id = 'b0000000-0000-4000-8000-000000000001'
  where id = 'a0000000-0000-4000-8000-000000000020';
$$;

create or replace function pg_temp.plan_version() returns uuid
language sql as $$
  select id from public.plan_versions
  where plan_id = '00000000-0000-4000-8000-0000000000a1' and version = 1;
$$;

-- ----------------------------------------------------------------------------
-- Test 1: the catalog is read by everyone and written only by platform billing
-- ----------------------------------------------------------------------------
begin;
select pg_temp.billing_fixture();
insert into public.split_rules (partner_id, version, platform_percent_bp)
values ('b0000000-0000-4000-8000-000000000001', 1, 2500),
       ('00000000-0000-4000-8000-000000000000', 1, 2000);
select set_config('app.partner_id', 'b0000000-0000-4000-8000-000000000001', true);
set local role app_runtime;
do $$
begin
  -- A customer user reads plans and versions.
  perform set_config('app.user_id', 'a0000000-0000-4000-8000-000000000032', true);
  if (select count(*) from public.plan_versions) < 1 then
    raise exception 'billing: customer cannot read the catalog';
  end if;
  if (select count(*) from public.split_rules) <> 0 then
    raise exception 'billing: customer reads split rules';
  end if;
  begin
    insert into public.plans (key, name, created_by)
    values ('pirata', 'Pirata', 'a0000000-0000-4000-8000-000000000032');
    raise exception 'billing: customer created a plan';
  exception when insufficient_privilege then null;
  end;

  -- A partner member sees the default rule and its own, not another partner's.
  perform set_config('app.user_id', 'd0000000-0000-4000-8000-000000000005', true);
  if (select count(*) from public.split_rules) <> 2
     or exists (select 1 from public.split_rules where partner_id = '00000000-0000-4000-8000-000000000000') then
    raise exception 'billing: partner split rule visibility is wrong';
  end if;
  begin
    insert into public.split_rules (partner_id, version, platform_percent_bp, created_by)
    values ('b0000000-0000-4000-8000-000000000001', 2, 0, 'd0000000-0000-4000-8000-000000000005');
    raise exception 'billing: partner wrote its own split rule';
  exception when insufficient_privilege then null;
  end;

  -- Platform owner (operations would only read) and billing write the catalog.
  perform set_config('app.user_id', 'd0000000-0000-4000-8000-000000000002', true);
  insert into public.plan_versions
    (plan_id, version, min_price_cents, min_platform_share_cents, partner_base_price_cents, created_by)
  values ('00000000-0000-4000-8000-0000000000a1', 2, 12000, 3500, 3500, 'd0000000-0000-4000-8000-000000000002');
  begin
    insert into public.plan_versions
      (plan_id, version, min_price_cents, min_platform_share_cents, partner_base_price_cents, created_by)
    values ('00000000-0000-4000-8000-0000000000a1', 3, 1000, 3000, 3000, 'd0000000-0000-4000-8000-000000000002');
    raise exception 'billing: minimum share above the floor accepted';
  exception when check_violation then null;
  end;
  -- Versions are insert-only.
  begin
    update public.plan_versions set min_price_cents = 1 where version = 1;
    raise exception 'billing: plan version updated';
  exception when insufficient_privilege then null;
  end;
end
$$;
rollback;

-- ----------------------------------------------------------------------------
-- Test 2: partner plans respect the floor; only owner and finance write them
-- ----------------------------------------------------------------------------
begin;
select pg_temp.billing_fixture();
select set_config('app.partner_id', 'b0000000-0000-4000-8000-000000000001', true);
set local role app_runtime;
do $$
declare
  v_version uuid;
begin
  perform set_config('app.user_id', 'd0000000-0000-4000-8000-000000000005', true);
  v_version := pg_temp.plan_version();
  perform set_config('app.user_id', 'd0000000-0000-4000-8000-000000000005', true);
  insert into public.partner_plans (partner_id, plan_version_id, name, price_cents, created_by)
  values ('b0000000-0000-4000-8000-000000000001', v_version, 'Básico', 10000, 'd0000000-0000-4000-8000-000000000005');
  begin
    insert into public.partner_plans (partner_id, plan_version_id, name, price_cents, created_by)
    values ('b0000000-0000-4000-8000-000000000001', v_version, 'Barato', 9999, 'd0000000-0000-4000-8000-000000000005');
    raise exception 'billing: partner plan below the floor accepted';
  exception when insufficient_privilege then null;
  end;
  begin
    update public.partner_plans set price_cents = 5000 where name = 'Básico';
    raise exception 'billing: partner plan lowered below the floor';
  exception when insufficient_privilege then null;
  end;

  perform set_config('app.user_id', 'd0000000-0000-4000-8000-000000000006', true);
  begin
    insert into public.partner_plans (partner_id, plan_version_id, name, price_cents, created_by)
    values ('b0000000-0000-4000-8000-000000000001', v_version, 'Admin', 20000, 'd0000000-0000-4000-8000-000000000006');
    raise exception 'billing: partner_admin wrote a partner plan';
  exception when insufficient_privilege then null;
  end;

  -- Another partner sees nothing.
  perform set_config('app.partner_id', '00000000-0000-4000-8000-000000000000', true);
  perform set_config('app.user_id', 'a0000000-0000-4000-8000-000000000031', true);
  if (select count(*) from public.partner_plans) <> 0 then
    raise exception 'billing: partner plans visible to another partner';
  end if;
end
$$;
rollback;

-- ----------------------------------------------------------------------------
-- Test 3: subscriptions are born pending and follow the state machine
-- ----------------------------------------------------------------------------
begin;
select pg_temp.billing_fixture();
select set_config('app.partner_id', 'b0000000-0000-4000-8000-000000000001', true);
set local role app_runtime;
do $$
declare
  v_version uuid;
begin
  perform set_config('app.user_id', 'd0000000-0000-4000-8000-000000000005', true);
  v_version := pg_temp.plan_version();
  -- partner_admin registers customers, so it may open a pending subscription.
  perform set_config('app.user_id', 'd0000000-0000-4000-8000-000000000006', true);
  insert into public.subscriptions
    (id, partner_id, organization_id, plan_version_id, mode, payer, billing_interval, amount_cents, created_by)
  values ('f0000000-0000-4000-8000-000000000001', 'b0000000-0000-4000-8000-000000000001',
          'a0000000-0000-4000-8000-000000000020', v_version, 'partner_pays', 'partner', 'monthly', 3000,
          'd0000000-0000-4000-8000-000000000006');
  begin
    insert into public.subscriptions
      (partner_id, organization_id, plan_version_id, mode, payer, billing_interval, amount_cents, created_by, status)
    values ('b0000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000020', v_version,
            'partner_pays', 'partner', 'monthly', 3000, 'd0000000-0000-4000-8000-000000000006', 'active');
    raise exception 'billing: subscription born active';
  exception when insufficient_privilege then null;
  end;
  begin
    insert into public.subscriptions
      (partner_id, organization_id, plan_version_id, mode, payer, billing_interval, amount_cents, created_by)
    values ('b0000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000010', v_version,
            'partner_pays', 'partner', 'monthly', 3000, 'd0000000-0000-4000-8000-000000000006');
    raise exception 'billing: subscription for another partner''s company';
  exception when insufficient_privilege then null;
  end;
  -- partner_admin does not activate.
  update public.subscriptions set status = 'active' where id = 'f0000000-0000-4000-8000-000000000001';
  if found then raise exception 'billing: partner_admin activated a subscription'; end if;

  -- partner_support does not read subscriptions.
  perform set_config('app.user_id', 'd0000000-0000-4000-8000-000000000004', true);
  if (select count(*) from public.subscriptions) <> 0 then
    raise exception 'billing: partner_support reads subscriptions';
  end if;

  -- partner_finance activates within the state machine.
  perform set_config('app.user_id', 'd0000000-0000-4000-8000-000000000005', true);
  update public.subscriptions
  set status = 'active', current_period_start = '2026-10-01', current_period_end = '2026-11-01'
  where id = 'f0000000-0000-4000-8000-000000000001';
  if not found then raise exception 'billing: partner_finance could not activate'; end if;
  begin
    update public.subscriptions set amount_cents = 1 where id = 'f0000000-0000-4000-8000-000000000001';
    raise exception 'billing: subscription price changed';
  exception when check_violation then null;
  end;
  begin
    update public.subscriptions set current_period_end = '2026-10-15' where id = 'f0000000-0000-4000-8000-000000000001';
    raise exception 'billing: period moved backwards';
  exception when check_violation then null;
  end;
  update public.subscriptions set status = 'canceled', canceled_at = now()
  where id = 'f0000000-0000-4000-8000-000000000001';
  begin
    update public.subscriptions set status = 'active', canceled_at = null
    where id = 'f0000000-0000-4000-8000-000000000001';
    raise exception 'billing: canceled subscription reactivated';
  exception when check_violation then null;
  end;
end
$$;

-- The customer's owner and admin read it in their context; nobody else.
select set_config('app.workspace_id', 'a0000000-0000-4000-8000-000000000021', true),
       set_config('app.organization_id', 'a0000000-0000-4000-8000-000000000020', true);
do $$
begin
  perform set_config('app.user_id', 'a0000000-0000-4000-8000-000000000032', true);
  if (select count(*) from public.subscriptions) <> 1 then
    raise exception 'billing: customer owner cannot read the subscription';
  end if;
  perform set_config('app.user_id', 'a0000000-0000-4000-8000-000000000033', true);
  if (select count(*) from public.subscriptions) <> 1 then
    raise exception 'billing: customer company admin cannot read the subscription';
  end if;
  update public.subscriptions set status = 'active' where organization_id = 'a0000000-0000-4000-8000-000000000020';
  if found then raise exception 'billing: customer changed the subscription'; end if;
  perform set_config('app.user_id', 'a0000000-0000-4000-8000-000000000031', true);
  if (select count(*) from public.subscriptions) <> 0 then
    raise exception 'billing: outsider reads the subscription';
  end if;
end
$$;
rollback;

-- ----------------------------------------------------------------------------
-- Test 4: payments and provider events
-- ----------------------------------------------------------------------------
begin;
select pg_temp.billing_fixture();
insert into public.subscriptions
  (id, partner_id, organization_id, plan_version_id, mode, payer, billing_interval, amount_cents, created_by)
values ('f0000000-0000-4000-8000-000000000001', 'b0000000-0000-4000-8000-000000000001',
        'a0000000-0000-4000-8000-000000000020', pg_temp.plan_version(), 'partner_pays', 'partner', 'monthly', 3000,
        'd0000000-0000-4000-8000-000000000006');
select set_config('app.partner_id', 'b0000000-0000-4000-8000-000000000001', true);
set local role app_runtime;
do $$
begin
  perform set_config('app.user_id', 'd0000000-0000-4000-8000-000000000005', true);
  insert into public.payment_provider_events (id, provider, external_id, event_type, partner_id, recorded_by)
  values ('f0000000-0000-4000-8000-000000000011', 'manual', 'manual:k1', 'payment.paid',
          'b0000000-0000-4000-8000-000000000001', 'd0000000-0000-4000-8000-000000000005');
  -- A duplicated event is refused by the unique key (criterion 5).
  begin
    insert into public.payment_provider_events (provider, external_id, event_type, partner_id, recorded_by)
    values ('manual', 'manual:k1', 'payment.paid', 'b0000000-0000-4000-8000-000000000001',
            'd0000000-0000-4000-8000-000000000005');
    raise exception 'billing: duplicated provider event accepted';
  exception when unique_violation then null;
  end;
  begin
    insert into public.payment_provider_events (provider, external_id, event_type, partner_id, recorded_by)
    values ('manual', 'manual:k2', 'payment.refunded', 'b0000000-0000-4000-8000-000000000001',
            'd0000000-0000-4000-8000-000000000005');
    raise exception 'billing: partner recorded a refund event';
  exception when insufficient_privilege then null;
  end;

  -- A manual payment needs evidence and exact shares.
  begin
    insert into public.payments
      (partner_id, organization_id, subscription_id, provider, provider_event_id, method, amount_cents,
       platform_share_cents, partner_share_cents, period_start, period_end, paid_on, recorded_by)
    values ('b0000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000020',
            'f0000000-0000-4000-8000-000000000001', 'manual', 'f0000000-0000-4000-8000-000000000011', 'pix',
            3000, 3000, 0, '2026-10-01', '2026-11-01', '2026-10-05', 'd0000000-0000-4000-8000-000000000005');
    raise exception 'billing: manual payment without evidence';
  exception when check_violation then null;
  end;
  begin
    insert into public.payments
      (partner_id, organization_id, subscription_id, provider, provider_event_id, method, amount_cents,
       platform_share_cents, partner_share_cents, period_start, period_end, paid_on, evidence, evidence_mime, recorded_by)
    values ('b0000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000020',
            'f0000000-0000-4000-8000-000000000001', 'manual', 'f0000000-0000-4000-8000-000000000011', 'pix',
            3000, 2000, 0, '2026-10-01', '2026-11-01', '2026-10-05', '\x89504e47', 'image/png',
            'd0000000-0000-4000-8000-000000000005');
    raise exception 'billing: shares not adding up accepted';
  exception when check_violation then null;
  end;
  insert into public.payments
    (id, partner_id, organization_id, subscription_id, provider, provider_event_id, method, amount_cents,
     platform_share_cents, partner_share_cents, period_start, period_end, paid_on, evidence, evidence_mime, recorded_by)
  values ('f0000000-0000-4000-8000-000000000021', 'b0000000-0000-4000-8000-000000000001',
          'a0000000-0000-4000-8000-000000000020', 'f0000000-0000-4000-8000-000000000001', 'manual',
          'f0000000-0000-4000-8000-000000000011', 'pix', 3000, 3000, 0, '2026-10-01', '2026-11-01',
          '2026-10-05', '\x89504e47', 'image/png', 'd0000000-0000-4000-8000-000000000005');
  update public.payment_provider_events set status = 'processed', processed_at = now()
  where id = 'f0000000-0000-4000-8000-000000000011';
  if not found then raise exception 'billing: event could not be marked processed'; end if;
  update public.payment_provider_events set status = 'ignored'
  where id = 'f0000000-0000-4000-8000-000000000011';
  if found then raise exception 'billing: processed event changed again'; end if;

  -- Payments are insert-only.
  begin
    update public.payments set amount_cents = 1 where id = 'f0000000-0000-4000-8000-000000000021';
    raise exception 'billing: payment updated';
  exception when insufficient_privilege then null;
  end;
  begin
    delete from public.payments where id = 'f0000000-0000-4000-8000-000000000021';
    raise exception 'billing: payment deleted';
  exception when insufficient_privilege then null;
  end;

  -- partner_admin reads but does not record payments; partner_support reads nothing.
  perform set_config('app.user_id', 'd0000000-0000-4000-8000-000000000006', true);
  if (select count(*) from public.payments) <> 1 then
    raise exception 'billing: partner_admin cannot read payments';
  end if;
  begin
    insert into public.payment_provider_events (provider, external_id, event_type, partner_id, recorded_by)
    values ('manual', 'manual:k3', 'payment.paid', 'b0000000-0000-4000-8000-000000000001',
            'd0000000-0000-4000-8000-000000000006');
    raise exception 'billing: partner_admin recorded a payment event';
  exception when insufficient_privilege then null;
  end;
  perform set_config('app.user_id', 'd0000000-0000-4000-8000-000000000004', true);
  if (select count(*) from public.payments) + (select count(*) from public.payment_provider_events) <> 0 then
    raise exception 'billing: partner_support reads payments';
  end if;

  -- Platform billing refunds once, from the platform host (house partner).
  perform set_config('app.partner_id', '00000000-0000-4000-8000-000000000000', true);
  perform set_config('app.user_id', 'd0000000-0000-4000-8000-000000000002', true);
  insert into public.payment_provider_events (id, provider, external_id, event_type, partner_id, recorded_by)
  values ('f0000000-0000-4000-8000-000000000012', 'manual', 'refund:f0000000-0000-4000-8000-000000000021',
          'payment.refunded', 'b0000000-0000-4000-8000-000000000001', 'd0000000-0000-4000-8000-000000000002');
  insert into public.payments
    (partner_id, organization_id, subscription_id, kind, refund_of, provider, provider_event_id, method,
     amount_cents, platform_share_cents, partner_share_cents, paid_on, recorded_by)
  values ('b0000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000020',
          'f0000000-0000-4000-8000-000000000001', 'refund', 'f0000000-0000-4000-8000-000000000021', 'manual',
          'f0000000-0000-4000-8000-000000000012', 'pix', 3000, 3000, 0, '2026-10-06',
          'd0000000-0000-4000-8000-000000000002');
  if (select count(*) from public.payments) <> 2 then
    raise exception 'billing: platform cannot read payments of a partner';
  end if;
end
$$;

-- The customer never reads payments.
select set_config('app.partner_id', 'b0000000-0000-4000-8000-000000000001', true),
       set_config('app.workspace_id', 'a0000000-0000-4000-8000-000000000021', true),
       set_config('app.organization_id', 'a0000000-0000-4000-8000-000000000020', true),
       set_config('app.user_id', 'a0000000-0000-4000-8000-000000000032', true);
do $$
begin
  if (select count(*) from public.payments) + (select count(*) from public.payment_provider_events) <> 0 then
    raise exception 'billing: customer reads payments';
  end if;
end
$$;
rollback;

-- ----------------------------------------------------------------------------
-- Test 5: the checkout switch
-- ----------------------------------------------------------------------------
begin;
select pg_temp.billing_fixture();
select set_config('app.partner_id', 'b0000000-0000-4000-8000-000000000001', true);
set local role app_runtime;
do $$
begin
  -- partner_admin cannot flip it.
  perform set_config('app.user_id', 'd0000000-0000-4000-8000-000000000006', true);
  update public.partners set checkout_enabled = true where id = 'b0000000-0000-4000-8000-000000000001';
  if found then raise exception 'billing: partner_admin flipped the checkout switch'; end if;

  -- partner_finance flips only the switch.
  perform set_config('app.user_id', 'd0000000-0000-4000-8000-000000000005', true);
  update public.partners set checkout_enabled = true where id = 'b0000000-0000-4000-8000-000000000001';
  if not found then raise exception 'billing: partner_finance could not flip the switch'; end if;
  begin
    update public.partners set status = 'inactive' where id = 'b0000000-0000-4000-8000-000000000001';
    raise exception 'billing: partner member changed its status';
  exception when insufficient_privilege then null;
  end;
  begin
    update public.partners set checkout_blocked = false, checkout_enabled = false
    where id = 'b0000000-0000-4000-8000-000000000001';
    -- unchanged checkout_blocked is fine; now try to unblock
    update public.partners set checkout_blocked = true where id = 'b0000000-0000-4000-8000-000000000001';
    raise exception 'billing: partner member changed the platform block';
  exception when insufficient_privilege then null;
  end;
end
$$;

reset role;
update public.partners set checkout_blocked = true, checkout_enabled = false
where id = 'b0000000-0000-4000-8000-000000000001';
set local role app_runtime;
do $$
begin
  perform set_config('app.user_id', 'd0000000-0000-4000-8000-000000000005', true);
  begin
    update public.partners set checkout_enabled = true where id = 'b0000000-0000-4000-8000-000000000001';
    raise exception 'billing: switch turned on while blocked';
  exception when check_violation then null;
  end;
end
$$;
rollback;
