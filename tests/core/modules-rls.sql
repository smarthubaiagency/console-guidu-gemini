-- ============================================================================
-- SQL Module State & Reference Module RLS (ADRs 0001, 0005, 0006; Adendo §9)
-- Tables: platform_modules, workspace_modules, hello_world_records
--
-- Executed as migration administrator. Each block switches to `app_runtime`
-- with `set local role`, runs its checks with count(*) and rolls back.
-- Fixtures: tests/core/seed.sql and tests/core/admin-seed.sql.
--   userA  a…031 owner of workspace A      userB a…032 owner of workspace B
--   viewer a…033 viewer of workspace A     admin d…003 platform owner
-- ============================================================================

-- ----------------------------------------------------------------------------
-- Test 1: workspace_modules — owner writes, viewer cannot, B sees nothing
-- ----------------------------------------------------------------------------
begin;
select set_config('app.user_id', 'a0000000-0000-4000-8000-000000000031', true),
       set_config('app.workspace_id', 'a0000000-0000-4000-8000-000000000011', true),
       set_config('app.organization_id', 'a0000000-0000-4000-8000-000000000010', true),
       set_config('app.principal_type', 'user', true);
set local role app_runtime;

insert into public.workspace_modules (workspace_id, organization_id, module_key, status, updated_by)
values ('a0000000-0000-4000-8000-000000000011', 'a0000000-0000-4000-8000-000000000010',
        'hello-world', 'enabled', 'a0000000-0000-4000-8000-000000000031');

do $$
declare
  v_count integer;
  v_denied boolean := false;
begin
  select count(*) into v_count from public.workspace_modules;
  if v_count <> 1 then
    raise exception 'Test 1a failed: owner A should see 1 workspace_modules row, saw %', v_count;
  end if;

  -- Forged updated_by is refused.
  begin
    insert into public.workspace_modules (workspace_id, organization_id, module_key, status, updated_by)
    values ('a0000000-0000-4000-8000-000000000011', 'a0000000-0000-4000-8000-000000000010',
            'catalog', 'enabled', 'a0000000-0000-4000-8000-000000000033');
  exception when insufficient_privilege then v_denied := true;
  end;
  if not v_denied then
    raise exception 'Test 1b failed: workspace_modules accepted a forged updated_by';
  end if;
end;
$$;

-- Viewer of A: reads but cannot write.
select set_config('app.user_id', 'a0000000-0000-4000-8000-000000000033', true);
do $$
declare
  v_count integer;
  v_denied boolean := false;
begin
  select count(*) into v_count from public.workspace_modules;
  if v_count <> 1 then
    raise exception 'Test 1c failed: viewer A should read 1 row, saw %', v_count;
  end if;

  begin
    insert into public.workspace_modules (workspace_id, organization_id, module_key, status, updated_by)
    values ('a0000000-0000-4000-8000-000000000011', 'a0000000-0000-4000-8000-000000000010',
            'catalog', 'enabled', 'a0000000-0000-4000-8000-000000000033');
  exception when insufficient_privilege then v_denied := true;
  end;
  if not v_denied then
    raise exception 'Test 1d failed: viewer A enabled a module';
  end if;

  update public.workspace_modules
     set status = 'disabled', updated_by = 'a0000000-0000-4000-8000-000000000033'
   where module_key = 'hello-world';
  get diagnostics v_count = row_count;
  if v_count <> 0 then
    raise exception 'Test 1e failed: viewer A disabled a module';
  end if;
end;
$$;

-- Owner of B pointed at A, then in B: sees nothing of A.
select set_config('app.user_id', 'a0000000-0000-4000-8000-000000000032', true);
do $$
declare
  v_count integer;
begin
  select count(*) into v_count from public.workspace_modules;
  if v_count <> 0 then
    raise exception 'Test 1f failed: owner B pointed at A saw % rows', v_count;
  end if;
end;
$$;
rollback;

-- ----------------------------------------------------------------------------
-- Test 2: hello_world_records — editor+ insert, no forgery, no update, isolation
-- ----------------------------------------------------------------------------
begin;
select set_config('app.user_id', 'a0000000-0000-4000-8000-000000000031', true),
       set_config('app.workspace_id', 'a0000000-0000-4000-8000-000000000011', true),
       set_config('app.organization_id', 'a0000000-0000-4000-8000-000000000010', true),
       set_config('app.principal_type', 'user', true);
set local role app_runtime;

insert into public.hello_world_records (workspace_id, organization_id, title, created_by)
values ('a0000000-0000-4000-8000-000000000011', 'a0000000-0000-4000-8000-000000000010',
        'Registro A', 'a0000000-0000-4000-8000-000000000031');

do $$
declare
  v_count integer;
  v_denied boolean := false;
begin
  begin
    insert into public.hello_world_records (workspace_id, organization_id, title, created_by)
    values ('a0000000-0000-4000-8000-000000000011', 'a0000000-0000-4000-8000-000000000010',
            'Forjado', 'a0000000-0000-4000-8000-000000000033');
  exception when insufficient_privilege then v_denied := true;
  end;
  if not v_denied then
    raise exception 'Test 2a failed: hello_world_records accepted a forged created_by';
  end if;

  v_denied := false;
  begin
    update public.hello_world_records set title = 'x';
  exception when insufficient_privilege then v_denied := true;
  end;
  if not v_denied then
    raise exception 'Test 2b failed: hello_world_records is updatable by app_runtime';
  end if;
end;
$$;

select set_config('app.user_id', 'a0000000-0000-4000-8000-000000000033', true);
do $$
declare
  v_count integer;
  v_denied boolean := false;
begin
  select count(*) into v_count from public.hello_world_records;
  if v_count <> 1 then
    raise exception 'Test 2c failed: viewer A should read 1 record, saw %', v_count;
  end if;

  begin
    insert into public.hello_world_records (workspace_id, organization_id, title, created_by)
    values ('a0000000-0000-4000-8000-000000000011', 'a0000000-0000-4000-8000-000000000010',
            'Viewer', 'a0000000-0000-4000-8000-000000000033');
  exception when insufficient_privilege then v_denied := true;
  end;
  if not v_denied then
    raise exception 'Test 2d failed: viewer A created a record';
  end if;
end;
$$;

select set_config('app.user_id', 'a0000000-0000-4000-8000-000000000032', true),
       set_config('app.workspace_id', 'a0000000-0000-4000-8000-000000000021', true),
       set_config('app.organization_id', 'a0000000-0000-4000-8000-000000000020', true);
do $$
declare
  v_count integer;
begin
  select count(*) into v_count from public.hello_world_records;
  if v_count <> 0 then
    raise exception 'Test 2e failed: owner B saw % records of A', v_count;
  end if;
end;
$$;
rollback;

-- ----------------------------------------------------------------------------
-- Test 3: platform_modules — only platform owner/operations write; no context reads nothing
-- ----------------------------------------------------------------------------
begin;
select set_config('app.user_id', 'd0000000-0000-4000-8000-000000000003', true),
       set_config('app.principal_type', 'user', true);
set local role app_runtime;

insert into public.platform_modules (module_key, availability, updated_by)
values ('hello-world', 'maintenance', 'd0000000-0000-4000-8000-000000000003');

select set_config('app.user_id', 'a0000000-0000-4000-8000-000000000031', true);
do $$
declare
  v_count integer;
  v_denied boolean := false;
begin
  select count(*) into v_count from public.platform_modules where availability = 'maintenance';
  if v_count <> 1 then
    raise exception 'Test 3a failed: workspace user should read global state, saw %', v_count;
  end if;

  update public.platform_modules
     set availability = 'enabled', updated_by = 'a0000000-0000-4000-8000-000000000031';
  get diagnostics v_count = row_count;
  if v_count <> 0 then
    raise exception 'Test 3b failed: workspace owner changed global module state';
  end if;

  begin
    insert into public.platform_modules (module_key, availability, updated_by)
    values ('catalog', 'disabled', 'a0000000-0000-4000-8000-000000000031');
  exception when insufficient_privilege then v_denied := true;
  end;
  if not v_denied then
    raise exception 'Test 3c failed: workspace owner inserted global module state';
  end if;
end;
$$;

select set_config('app.user_id', '', true);
do $$
declare
  v_count integer;
begin
  select count(*) into v_count from public.platform_modules;
  if v_count <> 0 then
    raise exception 'Test 3d failed: no context read % global rows', v_count;
  end if;
end;
$$;
rollback;

-- ----------------------------------------------------------------------------
-- Test 4: catalog invariants — FORCE RLS and no Data API grants
-- ----------------------------------------------------------------------------
do $$
declare
  v_count integer;
begin
  select count(*) into v_count
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public'
     and c.relname in ('platform_modules', 'workspace_modules', 'hello_world_records')
     and c.relrowsecurity and c.relforcerowsecurity;
  if v_count <> 3 then
    raise exception 'Test 4a failed: expected FORCE RLS on 3 module tables, found %', v_count;
  end if;

  select count(*) into v_count
    from information_schema.role_table_grants
   where table_schema = 'public'
     and table_name in ('platform_modules', 'workspace_modules', 'hello_world_records')
     and grantee in ('anon', 'authenticated');
  if v_count <> 0 then
    raise exception 'Test 4b failed: % anon/authenticated grants on module tables', v_count;
  end if;
end;
$$;

select 'modules-rls.sql: all checks passed' as result;
