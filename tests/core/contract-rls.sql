-- ============================================================================
-- SQL Contract of a company (F3b): private.organization_contract and
-- plan_versions.limits
--
-- Executed as migration administrator; each block rolls back.
--   org A a…010 / workspace A a…011: userA a…031 owner; d…008 is made a
--   plain workspace viewer per block (no company role)
--   userB a…032 owner of org B only
-- ============================================================================

create or replace function pg_temp.essencial_v1() returns uuid
language sql as $$
  select id from public.plan_versions
  where plan_id = '00000000-0000-4000-8000-0000000000a1' and version = 1;
$$;

-- ----------------------------------------------------------------------------
-- Test 1: legacy (no subscription), open, canceled; members only
-- ----------------------------------------------------------------------------
begin;
insert into public.plan_versions
  (id, plan_id, version, module_keys, min_price_cents, min_platform_share_cents,
   partner_base_price_cents, limits)
values ('f3b00000-0000-4000-8000-000000000002', '00000000-0000-4000-8000-0000000000a1', 2,
        '{hello-world}', 10000, 3000, 3000, '{"hello-world.records": 3, "core.seats": 7}');
insert into public.workspace_members (workspace_id, organization_id, user_id, role, status)
values ('a0000000-0000-4000-8000-000000000011', 'a0000000-0000-4000-8000-000000000010',
        'd0000000-0000-4000-8000-000000000008', 'viewer', 'active');
set local role app_runtime;
do $$
begin
  perform set_config('app.user_id', 'd0000000-0000-4000-8000-000000000008', true);
  if exists (select 1 from private.organization_contract('a0000000-0000-4000-8000-000000000010')) then
    raise exception 'contract: company without subscription is not legacy';
  end if;
end
$$;
reset role;
insert into public.subscriptions
  (id, partner_id, organization_id, plan_version_id, mode, payer, billing_interval, amount_cents, status, canceled_at)
values ('f3b00000-0000-4000-8000-000000000011', '00000000-0000-4000-8000-000000000000',
        'a0000000-0000-4000-8000-000000000010', pg_temp.essencial_v1(), 'partner_pays', 'partner',
        'monthly', 3000, 'canceled', now() - interval '1 day');
set local role app_runtime;
do $$
declare
  v_status text;
begin
  perform set_config('app.user_id', 'd0000000-0000-4000-8000-000000000008', true);
  select status into v_status from private.organization_contract('a0000000-0000-4000-8000-000000000010');
  if v_status is distinct from 'canceled' then
    raise exception 'contract: only canceled subscription must read canceled, got %', v_status;
  end if;
end
$$;
reset role;
insert into public.subscriptions
  (id, partner_id, organization_id, plan_version_id, mode, payer, billing_interval, amount_cents, status)
values ('f3b00000-0000-4000-8000-000000000012', '00000000-0000-4000-8000-000000000000',
        'a0000000-0000-4000-8000-000000000010', 'f3b00000-0000-4000-8000-000000000002', 'partner_pays',
        'partner', 'monthly', 3000, 'suspended');
set local role app_runtime;
do $$
declare
  v record;
begin
  -- A viewer, who cannot read subscriptions, reads the contract.
  perform set_config('app.user_id', 'd0000000-0000-4000-8000-000000000008', true);
  perform set_config('app.workspace_id', 'a0000000-0000-4000-8000-000000000011', true);
  perform set_config('app.organization_id', 'a0000000-0000-4000-8000-000000000010', true);
  if (select count(*) from public.subscriptions) <> 0 then
    raise exception 'contract: viewer reads subscriptions directly';
  end if;
  select * into v from private.organization_contract('a0000000-0000-4000-8000-000000000010');
  if v.status is distinct from 'suspended' or v.plan_version <> 2
     or v.module_keys <> '{hello-world}' or (v.limits ->> 'core.seats')::int <> 7 then
    raise exception 'contract: open subscription not preferred: %', row_to_json(v);
  end if;

  -- Someone outside the company reads nothing.
  perform set_config('app.user_id', 'a0000000-0000-4000-8000-000000000032', true);
  if exists (select 1 from private.organization_contract('a0000000-0000-4000-8000-000000000010')) then
    raise exception 'contract: outsider reads the contract';
  end if;
end
$$;
rollback;

-- ----------------------------------------------------------------------------
-- Test 2: limits are an object of bounded size; versions stay insert-only
-- ----------------------------------------------------------------------------
begin;
do $$
begin
  begin
    insert into public.plan_versions
      (plan_id, version, min_price_cents, min_platform_share_cents, partner_base_price_cents, limits)
    values ('00000000-0000-4000-8000-0000000000a1', 9, 0, 0, 0, '[1,2]');
    raise exception 'contract: limits accepted a non-object';
  exception when check_violation then null;
  end;
end
$$;
set local role app_runtime;
do $$
begin
  perform set_config('app.user_id', 'd0000000-0000-4000-8000-000000000003', true);
  begin
    update public.plan_versions set limits = '{"core.seats": 1}' where version = 1;
    raise exception 'contract: plan version limits updated';
  exception when insufficient_privilege then null;
  end;
end
$$;
rollback;
