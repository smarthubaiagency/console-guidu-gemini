-- ============================================================================
-- SQL Operations (F3d): worker_heartbeats and queue_metrics
--
-- Executed as migration administrator; each block rolls back.
--   d…002 platform role set per block   a…031 customer (no platform role)
-- ============================================================================

-- ----------------------------------------------------------------------------
-- Test 1: the worker publishes heartbeats and metrics, within its limits
-- ----------------------------------------------------------------------------
begin;
set local role app_worker;
do $$
begin
  insert into public.worker_heartbeats (instance_name, started_at, concurrency, queues)
  values ('w-test', now(), 4, 3);
  update public.worker_heartbeats set last_seen_at = now(), status = 'stopped' where instance_name = 'w-test';
  if not found then raise exception 'operations: worker could not refresh its heartbeat'; end if;

  insert into public.queue_metrics
    (instance_name, kind, pending, queued, running, succeeded_24h, failed_24h, skipped_24h,
     boss_waiting, boss_active)
  values ('w-test', 'billing.payout-report', 0, 0, 0, 1, 0, 0, 0, 0);
  begin
    insert into public.queue_metrics
      (captured_at, instance_name, kind, pending, queued, running, succeeded_24h, failed_24h,
       skipped_24h, boss_waiting, boss_active)
    values (now() - interval '1 day', 'w-test', 'billing.payout-report', 0, 0, 0, 0, 0, 0, 0, 0);
    raise exception 'operations: worker backdated a snapshot';
  exception when insufficient_privilege then null;
  end;
  -- Recent snapshots are kept; the retention deletes only old ones.
  delete from public.queue_metrics where instance_name = 'w-test';
  if found then raise exception 'operations: worker deleted a recent snapshot'; end if;
end
$$;
rollback;

-- ----------------------------------------------------------------------------
-- Test 2: only owner, operations and support read them
-- ----------------------------------------------------------------------------
begin;
insert into public.worker_heartbeats (instance_name, started_at, concurrency, queues)
values ('w-test', now(), 4, 3);
insert into public.queue_metrics
  (instance_name, kind, pending, queued, running, succeeded_24h, failed_24h, skipped_24h,
   boss_waiting, boss_active)
values ('w-test', 'billing.payout-report', 0, 0, 0, 1, 0, 0, 0, 0);
insert into public.platform_admin_members (user_id, role, status)
values ('d0000000-0000-4000-8000-000000000002', 'support', 'active')
on conflict (user_id) do update set role = 'support', status = 'active';
set local role app_runtime;
do $$
begin
  perform set_config('app.user_id', 'd0000000-0000-4000-8000-000000000002', true);
  if (select count(*) from public.worker_heartbeats) <> 1
     or (select count(*) from public.queue_metrics) <> 1 then
    raise exception 'operations: support cannot read operations';
  end if;
  begin
    insert into public.worker_heartbeats (instance_name, started_at, concurrency, queues)
    values ('w-web', now(), 1, 1);
    raise exception 'operations: web runtime wrote a heartbeat';
  exception when insufficient_privilege then null;
  end;
  begin
    delete from public.queue_metrics;
    raise exception 'operations: web runtime deleted metrics';
  exception when insufficient_privilege then null;
  end;

  perform set_config('app.user_id', 'a0000000-0000-4000-8000-000000000031', true);
  if (select count(*) from public.worker_heartbeats) + (select count(*) from public.queue_metrics) <> 0 then
    raise exception 'operations: a customer reads operations';
  end if;
end
$$;
reset role;
update public.platform_admin_members set role = 'billing'
where user_id = 'd0000000-0000-4000-8000-000000000002';
set local role app_runtime;
do $$
begin
  perform set_config('app.user_id', 'd0000000-0000-4000-8000-000000000002', true);
  if (select count(*) from public.worker_heartbeats) + (select count(*) from public.queue_metrics) <> 0 then
    raise exception 'operations: platform billing reads operations';
  end if;
end
$$;
rollback;
