-- ============================================================================
-- SQL maintenance window (CF5c): `public.platform_maintenance` and
-- `private.maintenance_state()`.
--   platform: d…003 owner, d…004 operations, d…005 support, d…002 billing
--   d…006: a user without a platform role
-- Each block prepares its fixtures as administrator, switches to
-- `app_runtime` (or `app_worker`) with `set local role` and rolls back.
-- ============================================================================

create or replace function pg_temp.ctx(p_user uuid)
returns void
language sql as $$
  select set_config('app.user_id', p_user::text, true),
         set_config('app.principal_type', 'user', true),
         set_config('app.workspace_id', '', true),
         set_config('app.organization_id', '', true),
         set_config('app.partner_id', '', true);
$$;

create or replace function pg_temp.fixture() returns void
language sql as $$
  delete from public.platform_maintenance;
  insert into public.platform_admin_members (user_id, role, status) values
    ('d0000000-0000-4000-8000-000000000002', 'billing', 'active'),
    ('d0000000-0000-4000-8000-000000000004', 'operations', 'active'),
    ('d0000000-0000-4000-8000-000000000005', 'support', 'active')
  on conflict (user_id) do update set role = excluded.role, status = 'active';
$$;

-- ----------------------------------------------------------------------------
-- Test 1: owner and operations write the window; support reads it
-- ----------------------------------------------------------------------------
begin;
select pg_temp.fixture();
set local role app_runtime;
do $$
begin
  perform pg_temp.ctx('d0000000-0000-4000-8000-000000000003');
  insert into public.platform_maintenance (enabled, mode, updated_by)
  values (true, 'maintenance', 'd0000000-0000-4000-8000-000000000003');

  perform pg_temp.ctx('d0000000-0000-4000-8000-000000000004');
  update public.platform_maintenance
  set mode = 'read_only', message_pt_br = 'Volta às 23h.',
      updated_by = 'd0000000-0000-4000-8000-000000000004';
  if not found then raise exception 'platform_maintenance: operations could not edit'; end if;

  -- One row only.
  begin
    insert into public.platform_maintenance (enabled, updated_by)
    values (false, 'd0000000-0000-4000-8000-000000000004');
    raise exception 'platform_maintenance: a second row was written';
  exception when unique_violation then null;
  end;
  begin
    insert into public.platform_maintenance (id, enabled, updated_by)
    values (false, false, 'd0000000-0000-4000-8000-000000000004');
    raise exception 'platform_maintenance: a row with id false was written';
  exception when check_violation then null;
  end;

  -- Signed as someone else, never.
  begin
    update public.platform_maintenance
    set updated_by = 'd0000000-0000-4000-8000-000000000003';
    raise exception 'platform_maintenance: signed as someone else';
  exception when insufficient_privilege then null;
  end;

  -- Nobody deletes it: turning off is an update.
  begin
    delete from public.platform_maintenance;
    raise exception 'platform_maintenance: deleted by app_runtime';
  exception when insufficient_privilege then null;
  end;

  -- Support reads, never writes.
  perform pg_temp.ctx('d0000000-0000-4000-8000-000000000005');
  if not exists (select 1 from public.platform_maintenance) then
    raise exception 'platform_maintenance: support does not read the window';
  end if;
  update public.platform_maintenance
  set enabled = false, updated_by = 'd0000000-0000-4000-8000-000000000005';
  if found then raise exception 'platform_maintenance: support changed the window'; end if;

  -- Billing and a user without a platform role neither read nor write.
  perform pg_temp.ctx('d0000000-0000-4000-8000-000000000002');
  if exists (select 1 from public.platform_maintenance) then
    raise exception 'platform_maintenance: billing reads the window';
  end if;
  update public.platform_maintenance
  set enabled = false, updated_by = 'd0000000-0000-4000-8000-000000000002';
  if found then raise exception 'platform_maintenance: billing changed the window'; end if;

  perform pg_temp.ctx('d0000000-0000-4000-8000-000000000006');
  if exists (select 1 from public.platform_maintenance) then
    raise exception 'platform_maintenance: a plain user reads the window';
  end if;
end $$;
rollback;

-- ----------------------------------------------------------------------------
-- Test 2: the table refuses a bad mode, an end before the start and an
-- empty or long message; without a platform role nobody inserts
-- ----------------------------------------------------------------------------
begin;
select pg_temp.fixture();
set local role app_runtime;
do $$
begin
  perform pg_temp.ctx('d0000000-0000-4000-8000-000000000006');
  begin
    insert into public.platform_maintenance (enabled, updated_by)
    values (true, 'd0000000-0000-4000-8000-000000000006');
    raise exception 'platform_maintenance: a plain user turned maintenance on';
  exception when insufficient_privilege then null;
  end;

  perform pg_temp.ctx('d0000000-0000-4000-8000-000000000003');
  begin
    insert into public.platform_maintenance (enabled, mode, updated_by)
    values (true, 'closed', 'd0000000-0000-4000-8000-000000000003');
    raise exception 'platform_maintenance: unknown mode accepted';
  exception when check_violation then null;
  end;
  begin
    insert into public.platform_maintenance (enabled, starts_at, ends_at, updated_by)
    values (true, now(), now() - interval '1 hour', 'd0000000-0000-4000-8000-000000000003');
    raise exception 'platform_maintenance: end before start accepted';
  exception when check_violation then null;
  end;
  begin
    insert into public.platform_maintenance (enabled, message_en, updated_by)
    values (true, '   ', 'd0000000-0000-4000-8000-000000000003');
    raise exception 'platform_maintenance: blank message accepted';
  exception when check_violation then null;
  end;
  begin
    insert into public.platform_maintenance (enabled, message_es, updated_by)
    values (true, repeat('x', 501), 'd0000000-0000-4000-8000-000000000003');
    raise exception 'platform_maintenance: message over 500 characters accepted';
  exception when check_violation then null;
  end;
end $$;
rollback;

-- ----------------------------------------------------------------------------
-- Test 3: the state needs no context, answers only for a window on and not
-- over, and the worker reads it too
-- ----------------------------------------------------------------------------
begin;
select pg_temp.fixture();
insert into public.platform_maintenance
  (enabled, mode, starts_at, ends_at, message_pt_br, updated_by)
values
  (true, 'read_only', now() + interval '2 hours', now() + interval '3 hours',
   'Volta logo.', 'd0000000-0000-4000-8000-000000000003');
set local role app_runtime;
do $$
declare
  v_mode text;
  v_message text;
begin
  -- No context at all: the state is the same for everybody.
  perform set_config('app.user_id', '', true);
  select mode, message_pt_br into v_mode, v_message from private.maintenance_state();
  if v_mode is distinct from 'read_only' or v_message is distinct from 'Volta logo.' then
    raise exception 'maintenance_state: scheduled window not returned (%, %)', v_mode, v_message;
  end if;
  -- And it never shows who changed it.
  if pg_get_function_result('private.maintenance_state()'::regprocedure) like '%updated_by%' then
    raise exception 'maintenance_state: exposes updated_by';
  end if;
end $$;
reset role;

-- Off or over: nothing.
update public.platform_maintenance set enabled = false;
set local role app_runtime;
do $$
begin
  if exists (select 1 from private.maintenance_state()) then
    raise exception 'maintenance_state: window off still returned';
  end if;
end $$;
reset role;
update public.platform_maintenance
set enabled = true, starts_at = now() - interval '2 hours', ends_at = now() - interval '1 hour';
set local role app_worker;
do $$
begin
  if exists (select 1 from private.maintenance_state()) then
    raise exception 'maintenance_state: window over still returned';
  end if;
end $$;
reset role;
update public.platform_maintenance set ends_at = null;
set local role app_worker;
do $$
begin
  if not exists (select 1 from private.maintenance_state() where mode = 'read_only') then
    raise exception 'maintenance_state: the worker does not see the window';
  end if;
  -- The worker never reads the table itself.
  begin
    perform 1 from public.platform_maintenance;
    raise exception 'platform_maintenance: app_worker reads the table';
  exception when insufficient_privilege then null;
  end;
end $$;
rollback;

-- ----------------------------------------------------------------------------
-- Test 4: anon and authenticated reach neither the table nor the state
-- ----------------------------------------------------------------------------
do $$
begin
  if has_table_privilege('anon', 'public.platform_maintenance', 'select')
     or has_table_privilege('authenticated', 'public.platform_maintenance', 'select') then
    raise exception 'platform_maintenance: anon/authenticated can read';
  end if;
  if has_function_privilege('anon', 'private.maintenance_state()', 'execute')
     or has_function_privilege('authenticated', 'private.maintenance_state()', 'execute') then
    raise exception 'maintenance_state: anon/authenticated can execute';
  end if;
end $$;
