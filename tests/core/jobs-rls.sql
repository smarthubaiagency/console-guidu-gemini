-- ============================================================================
-- SQL Jobs RLS and queue privileges (ADR 0002, F3a)
-- Objects: schema pgboss (owned by app_worker), public.job_runs, app_worker
--
-- Executed as migration administrator. Each block switches to the role under
-- test with `set local role` and rolls back. Fixtures: tests/core/seed.sql.
--   userA a…031 owner of workspace A a…011 (org a…010)
--   a…033 viewer of workspace A          userB a…032 owner of workspace B a…021
-- ============================================================================

-- ----------------------------------------------------------------------------
-- Test 1: the queue belongs to the worker; the web runtime cannot reach it
-- ----------------------------------------------------------------------------
do $$
begin
  if has_schema_privilege('app_runtime', 'pgboss', 'USAGE') then
    raise exception 'jobs: app_runtime has usage on the queue schema';
  end if;
  if exists (
    select 1 from information_schema.role_table_grants
    where table_schema = 'pgboss' and grantee in ('app_runtime', 'anon', 'authenticated', 'PUBLIC')
  ) then
    raise exception 'jobs: queue tables granted outside app_worker';
  end if;
  if exists (select 1 from pg_tables where schemaname = 'pgboss' and tableowner <> 'app_worker') then
    raise exception 'jobs: queue table not owned by app_worker';
  end if;
  if (select rolsuper or rolbypassrls or rolinherit or rolcreaterole from pg_roles where rolname = 'app_worker') then
    raise exception 'jobs: app_worker must be NOSUPERUSER NOBYPASSRLS NOINHERIT NOCREATEROLE';
  end if;
  if not pg_has_role('app_worker', 'app_runtime', 'SET') or pg_has_role('app_worker', 'app_runtime', 'USAGE') then
    raise exception 'jobs: app_worker must SET ROLE app_runtime without inheriting it';
  end if;
  if pg_has_role('app_runtime', 'app_worker', 'MEMBER') then
    raise exception 'jobs: app_runtime must never become app_worker';
  end if;
end
$$;

-- With its own role the worker reads the queue and only the columns
-- platform jobs need (F3c); everything else stays closed.
begin;
set local role app_worker;
do $$
begin
  begin
    perform count(*) from public.profiles;
    raise exception 'jobs: app_worker reads profiles';
  exception when insufficient_privilege then null;
  end;
  begin
    perform max(max_seats) from public.organizations;
    raise exception 'jobs: app_worker reads organization columns beyond the name';
  exception when insufficient_privilege then null;
  end;
  begin
    -- The purge (F3e) sees only workspace_id, never the content.
    perform title from public.hello_world_records;
    raise exception 'jobs: app_worker reads module data';
  exception when insufficient_privilege then null;
  end;
  perform count(*) from pgboss.queue;
end
$$;
rollback;

-- ----------------------------------------------------------------------------
-- Test 2: members enqueue pending runs in their workspace only
-- ----------------------------------------------------------------------------
begin;
select set_config('app.user_id', 'a0000000-0000-4000-8000-000000000031', true),
       set_config('app.workspace_id', 'a0000000-0000-4000-8000-000000000011', true),
       set_config('app.organization_id', 'a0000000-0000-4000-8000-000000000010', true);
set local role app_runtime;
do $$
begin
  insert into public.job_runs (kind, organization_id, workspace_id, requested_by, idempotency_key)
  values ('hello-world.create-record', 'a0000000-0000-4000-8000-000000000010',
          'a0000000-0000-4000-8000-000000000011', 'a0000000-0000-4000-8000-000000000031', 'k1');
  begin
    insert into public.job_runs (kind, organization_id, workspace_id, requested_by, idempotency_key, status)
    values ('hello-world.create-record', 'a0000000-0000-4000-8000-000000000010',
            'a0000000-0000-4000-8000-000000000011', 'a0000000-0000-4000-8000-000000000031', 'k2', 'succeeded');
    raise exception 'jobs: run created already succeeded';
  exception when insufficient_privilege then null;
  end;
  begin
    insert into public.job_runs (kind, organization_id, workspace_id, requested_by, idempotency_key)
    values ('hello-world.create-record', 'a0000000-0000-4000-8000-000000000020',
            'a0000000-0000-4000-8000-000000000021', 'a0000000-0000-4000-8000-000000000031', 'k3');
    raise exception 'jobs: run created for another workspace';
  exception when insufficient_privilege then null;
  end;
  begin
    insert into public.job_runs (kind, organization_id, workspace_id, requested_by, idempotency_key)
    values ('hello-world.create-record', 'a0000000-0000-4000-8000-000000000010',
            'a0000000-0000-4000-8000-000000000011', 'a0000000-0000-4000-8000-000000000032', 'k4');
    raise exception 'jobs: run created on behalf of another user';
  exception when insufficient_privilege then null;
  end;
  begin
    insert into public.job_runs (kind, scope, idempotency_key, requested_by)
    values ('billing.daily', 'platform', 'k5', 'a0000000-0000-4000-8000-000000000031');
    raise exception 'jobs: web runtime created a platform run';
  exception when insufficient_privilege or check_violation then null;
  end;
  -- Same kind and key: one run only.
  begin
    insert into public.job_runs (kind, organization_id, workspace_id, requested_by, idempotency_key)
    values ('hello-world.create-record', 'a0000000-0000-4000-8000-000000000010',
            'a0000000-0000-4000-8000-000000000011', 'a0000000-0000-4000-8000-000000000031', 'k1');
    raise exception 'jobs: duplicated idempotency key accepted';
  exception when unique_violation then null;
  end;

  -- The viewer reads; userB of another workspace does not.
  perform set_config('app.user_id', 'a0000000-0000-4000-8000-000000000033', true);
  if (select count(*) from public.job_runs) <> 1 then
    raise exception 'jobs: workspace viewer cannot read runs';
  end if;
  perform set_config('app.user_id', 'a0000000-0000-4000-8000-000000000032', true);
  if (select count(*) from public.job_runs) <> 0 then
    raise exception 'jobs: runs visible outside the workspace';
  end if;
end
$$;
rollback;

-- ----------------------------------------------------------------------------
-- Test 3: retry by owner/admin, only failed -> pending, only retry columns
-- ----------------------------------------------------------------------------
begin;
insert into public.job_runs (id, kind, organization_id, workspace_id, requested_by, idempotency_key, status, attempts, last_error)
values ('f3000000-0000-4000-8000-000000000001', 'hello-world.create-record', 'a0000000-0000-4000-8000-000000000010',
        'a0000000-0000-4000-8000-000000000011', 'a0000000-0000-4000-8000-000000000031', 'r1', 'failed', 3, 'boom'),
       ('f3000000-0000-4000-8000-000000000002', 'hello-world.create-record', 'a0000000-0000-4000-8000-000000000010',
        'a0000000-0000-4000-8000-000000000011', 'a0000000-0000-4000-8000-000000000031', 'r2', 'succeeded', 1, null);
select set_config('app.workspace_id', 'a0000000-0000-4000-8000-000000000011', true),
       set_config('app.organization_id', 'a0000000-0000-4000-8000-000000000010', true);
set local role app_runtime;
do $$
begin
  -- The viewer cannot retry.
  perform set_config('app.user_id', 'a0000000-0000-4000-8000-000000000033', true);
  update public.job_runs set status = 'pending', attempts = 0 where id = 'f3000000-0000-4000-8000-000000000001';
  if found then raise exception 'jobs: viewer retried a run'; end if;

  perform set_config('app.user_id', 'a0000000-0000-4000-8000-000000000031', true);
  begin
    update public.job_runs set status = 'pending', attempts = 0, payload = '{"x":1}'
    where id = 'f3000000-0000-4000-8000-000000000001';
    raise exception 'jobs: retry changed the payload';
  exception when insufficient_privilege then null;
  end;
  update public.job_runs set status = 'pending', attempts = 0, last_error = null, run_after = now()
  where id = 'f3000000-0000-4000-8000-000000000001';
  if not found then raise exception 'jobs: owner could not retry'; end if;
  update public.job_runs set status = 'pending', attempts = 0 where id = 'f3000000-0000-4000-8000-000000000002';
  if found then raise exception 'jobs: succeeded run retried'; end if;
  update public.job_runs set status = 'succeeded' where id = 'f3000000-0000-4000-8000-000000000001';
  if found then raise exception 'jobs: web runtime completed a run'; end if;
end
$$;
rollback;

-- ----------------------------------------------------------------------------
-- Test 4: the worker keeps the bookkeeping of any run
-- ----------------------------------------------------------------------------
begin;
insert into public.job_runs (id, kind, organization_id, workspace_id, requested_by, idempotency_key)
values ('f3000000-0000-4000-8000-000000000003', 'hello-world.create-record', 'a0000000-0000-4000-8000-000000000020',
        'a0000000-0000-4000-8000-000000000021', 'a0000000-0000-4000-8000-000000000032', 'w1');
set local role app_worker;
do $$
begin
  update public.job_runs set status = 'queued', dispatched_at = now() where id = 'f3000000-0000-4000-8000-000000000003';
  if not found then raise exception 'jobs: worker could not dispatch'; end if;
  insert into public.job_runs (kind, scope, idempotency_key)
  values ('billing.daily', 'platform', '2026-10-13');
  begin
    insert into public.job_runs (kind, scope, idempotency_key, status)
    values ('billing.daily', 'platform', '2026-10-14', 'succeeded');
    raise exception 'jobs: worker created a finished run';
  exception when insufficient_privilege then null;
  end;
  -- Deletes only by purge of a deleted workspace or enabled retention (F3e).
  delete from public.job_runs;
  if found then raise exception 'jobs: worker deleted runs'; end if;
end
$$;
rollback;
