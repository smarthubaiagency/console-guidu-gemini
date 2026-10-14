-- ============================================================================
-- SQL Plans and limits (CF4): public.quota_ceilings and the guards of
-- plan_versions.limits
--
-- Executed as migration administrator. Each block prepares its fixtures as
-- administrator, switches to `app_runtime` with `set local role` and rolls
-- back. Fixtures: tests/core/seed.sql, membership-seed.sql, admin-seed.sql.
--   d…003 platform owner   d…009 platform operations (per block)
--   a…032 customer user (no platform role)
--   plan "essencial" 00000000-0000-4000-8000-0000000000a1, version 1
-- ============================================================================

-- ----------------------------------------------------------------------------
-- Test 1: ceilings are read by every signed-in context and written only by
-- the platform billing managers (owner and billing)
-- ----------------------------------------------------------------------------
begin;
insert into public.platform_admin_members (user_id, role, status)
values ('d0000000-0000-4000-8000-000000000009', 'operations', 'active')
on conflict (user_id) do update set role = 'operations', status = 'active';
insert into public.quota_ceilings (quota_key, ceiling) values ('core.seats', 50);
set local role app_runtime;
do $$
begin
  -- Without a user, nothing.
  if (select count(*) from public.quota_ceilings) <> 0 then
    raise exception 'cf4: anonymous context reads ceilings';
  end if;

  -- A customer reads the ceilings but cannot write them.
  perform set_config('app.user_id', 'a0000000-0000-4000-8000-000000000032', true);
  if (select count(*) from public.quota_ceilings where quota_key = 'core.seats') <> 1 then
    raise exception 'cf4: signed-in user cannot read ceilings';
  end if;
  begin
    insert into public.quota_ceilings (quota_key, ceiling, updated_by)
    values ('core.public_domains', 3, 'a0000000-0000-4000-8000-000000000032');
    raise exception 'cf4: customer wrote a ceiling';
  exception when insufficient_privilege then null;
  end;

  -- Platform operations reads billing but does not manage it.
  perform set_config('app.user_id', 'd0000000-0000-4000-8000-000000000009', true);
  begin
    insert into public.quota_ceilings (quota_key, ceiling, updated_by)
    values ('core.public_domains', 3, 'd0000000-0000-4000-8000-000000000009');
    raise exception 'cf4: operations wrote a ceiling';
  exception when insufficient_privilege then null;
  end;
  update public.quota_ceilings set ceiling = 1, updated_by = 'd0000000-0000-4000-8000-000000000009'
  where quota_key = 'core.seats';
  if (select ceiling from public.quota_ceilings where quota_key = 'core.seats') <> 50 then
    raise exception 'cf4: operations changed a ceiling';
  end if;

  -- The owner writes, in its own name only.
  perform set_config('app.user_id', 'd0000000-0000-4000-8000-000000000003', true);
  begin
    insert into public.quota_ceilings (quota_key, ceiling, updated_by)
    values ('core.public_domains', 3, 'a0000000-0000-4000-8000-000000000032');
    raise exception 'cf4: ceiling written in another name';
  exception when insufficient_privilege then null;
  end;
  insert into public.quota_ceilings (quota_key, ceiling, updated_by)
  values ('core.public_domains', 3, 'd0000000-0000-4000-8000-000000000003');
  update public.quota_ceilings set ceiling = 40, updated_by = 'd0000000-0000-4000-8000-000000000003'
  where quota_key = 'core.seats';
  if (select ceiling from public.quota_ceilings where quota_key = 'core.seats') <> 40 then
    raise exception 'cf4: owner could not change a ceiling';
  end if;
  -- The key never changes.
  begin
    update public.quota_ceilings set quota_key = 'core.storage_gb' where quota_key = 'core.seats';
    raise exception 'cf4: ceiling key changed';
  exception when insufficient_privilege then null;
  end;
  delete from public.quota_ceilings where quota_key = 'core.public_domains';
  if exists (select 1 from public.quota_ceilings where quota_key = 'core.public_domains') then
    raise exception 'cf4: owner could not remove a ceiling';
  end if;
end
$$;
reset role;
-- Bounds and key format.
do $$
begin
  begin
    insert into public.quota_ceilings (quota_key, ceiling) values ('core.trial_days', -1);
    raise exception 'cf4: negative ceiling accepted';
  exception when check_violation then null;
  end;
  begin
    insert into public.quota_ceilings (quota_key, ceiling) values ('core.trial_days', 1000001);
    raise exception 'cf4: ceiling above the bound accepted';
  exception when check_violation then null;
  end;
  begin
    insert into public.quota_ceilings (quota_key, ceiling) values ('Core seats', 1);
    raise exception 'cf4: malformed key accepted';
  exception when check_violation then null;
  end;
end
$$;
rollback;

-- ----------------------------------------------------------------------------
-- Test 2: a plan version stays within the ceilings; "sem limite" (null)
-- only where no ceiling exists; values are whole numbers
-- ----------------------------------------------------------------------------
begin;
insert into public.quota_ceilings (quota_key, ceiling) values ('core.public_domains', 3);
set local role app_runtime;
do $$
begin
  perform set_config('app.user_id', 'd0000000-0000-4000-8000-000000000003', true);
  begin
    insert into public.plan_versions
      (plan_id, version, min_price_cents, min_platform_share_cents, partner_base_price_cents,
       limits, created_by)
    values ('00000000-0000-4000-8000-0000000000a1', 2, 10000, 3000, 3000,
            '{"core.public_domains": 4}', 'd0000000-0000-4000-8000-000000000003');
    raise exception 'cf4: plan value above the ceiling accepted';
  exception when check_violation then null;
  end;
  begin
    insert into public.plan_versions
      (plan_id, version, min_price_cents, min_platform_share_cents, partner_base_price_cents,
       limits, created_by)
    values ('00000000-0000-4000-8000-0000000000a1', 2, 10000, 3000, 3000,
            '{"core.public_domains": null}', 'd0000000-0000-4000-8000-000000000003');
    raise exception 'cf4: unlimited accepted under a ceiling';
  exception when check_violation then null;
  end;
  begin
    insert into public.plan_versions
      (plan_id, version, min_price_cents, min_platform_share_cents, partner_base_price_cents,
       limits, created_by)
    values ('00000000-0000-4000-8000-0000000000a1', 2, 10000, 3000, 3000,
            '{"core.seats": 2.5}', 'd0000000-0000-4000-8000-000000000003');
    raise exception 'cf4: fractional plan value accepted';
  exception when check_violation then null;
  end;
  begin
    insert into public.plan_versions
      (plan_id, version, min_price_cents, min_platform_share_cents, partner_base_price_cents,
       limits, created_by)
    values ('00000000-0000-4000-8000-0000000000a1', 2, 10000, 3000, 3000,
            '{"core.seats": "10"}', 'd0000000-0000-4000-8000-000000000003');
    raise exception 'cf4: text plan value accepted';
  exception when check_violation then null;
  end;
  begin
    insert into public.plan_versions
      (plan_id, version, min_price_cents, min_platform_share_cents, partner_base_price_cents,
       limits, created_by)
    values ('00000000-0000-4000-8000-0000000000a1', 2, 10000, 3000, 3000,
            '{"core.seats": -1}', 'd0000000-0000-4000-8000-000000000003');
    raise exception 'cf4: negative plan value accepted';
  exception when check_violation then null;
  end;

  -- At the ceiling, and "sem limite" where there is none.
  insert into public.plan_versions
    (plan_id, version, min_price_cents, min_platform_share_cents, partner_base_price_cents,
     limits, created_by)
  values ('00000000-0000-4000-8000-0000000000a1', 2, 10000, 3000, 3000,
          '{"core.public_domains": 3, "core.storage_gb": null}',
          'd0000000-0000-4000-8000-000000000003');
  if (select limits -> 'core.storage_gb' from public.plan_versions
      where plan_id = '00000000-0000-4000-8000-0000000000a1' and version = 2) <> 'null'::jsonb then
    raise exception 'cf4: unlimited plan value not stored as null';
  end if;
end
$$;
rollback;

-- ----------------------------------------------------------------------------
-- Test 3: a ceiling never goes below the current version of an active plan;
-- retired plans and older versions do not hold it
-- ----------------------------------------------------------------------------
begin;
insert into public.plan_versions
  (plan_id, version, min_price_cents, min_platform_share_cents, partner_base_price_cents, limits)
values ('00000000-0000-4000-8000-0000000000a1', 2, 10000, 3000, 3000,
        '{"core.public_domains": 5, "core.storage_gb": null}');
set local role app_runtime;
do $$
begin
  perform set_config('app.user_id', 'd0000000-0000-4000-8000-000000000003', true);
  begin
    insert into public.quota_ceilings (quota_key, ceiling, updated_by)
    values ('core.public_domains', 4, 'd0000000-0000-4000-8000-000000000003');
    raise exception 'cf4: ceiling below a plan on sale accepted';
  exception when check_violation then null;
  end;
  begin
    insert into public.quota_ceilings (quota_key, ceiling, updated_by)
    values ('core.storage_gb', 100, 'd0000000-0000-4000-8000-000000000003');
    raise exception 'cf4: ceiling under an unlimited plan accepted';
  exception when check_violation then null;
  end;
  insert into public.quota_ceilings (quota_key, ceiling, updated_by)
  values ('core.public_domains', 5, 'd0000000-0000-4000-8000-000000000003');
  begin
    update public.quota_ceilings set ceiling = 2, updated_by = 'd0000000-0000-4000-8000-000000000003'
    where quota_key = 'core.public_domains';
    raise exception 'cf4: ceiling lowered below a plan on sale';
  exception when check_violation then null;
  end;
end
$$;
reset role;
-- A newer version within the lower value frees the ceiling.
insert into public.plan_versions
  (plan_id, version, min_price_cents, min_platform_share_cents, partner_base_price_cents, limits)
values ('00000000-0000-4000-8000-0000000000a1', 3, 10000, 3000, 3000, '{"core.public_domains": 1}');
set local role app_runtime;
do $$
begin
  perform set_config('app.user_id', 'd0000000-0000-4000-8000-000000000003', true);
  update public.quota_ceilings set ceiling = 2, updated_by = 'd0000000-0000-4000-8000-000000000003'
  where quota_key = 'core.public_domains';
  if (select ceiling from public.quota_ceilings where quota_key = 'core.public_domains') <> 2 then
    raise exception 'cf4: ceiling not lowered after a new version';
  end if;
end
$$;
reset role;
-- A retired plan does not hold the ceiling.
update public.plans set status = 'retired' where id = '00000000-0000-4000-8000-0000000000a1';
set local role app_runtime;
do $$
begin
  perform set_config('app.user_id', 'd0000000-0000-4000-8000-000000000003', true);
  update public.quota_ceilings set ceiling = 0, updated_by = 'd0000000-0000-4000-8000-000000000003'
  where quota_key = 'core.public_domains';
  if (select ceiling from public.quota_ceilings where quota_key = 'core.public_domains') <> 0 then
    raise exception 'cf4: retired plan held the ceiling';
  end if;
end
$$;
rollback;
