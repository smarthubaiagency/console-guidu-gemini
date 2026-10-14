-- ============================================================================
-- SQL settings cascade (CF1): `public.settings` and `private.settings_cascade()`.
--   platform: d…003 owner, d…002 billing (per block)
--   partner B b7…001 (per block): d…006 partner_admin, d…004 partner_support;
--     org B a…020 and workspace B a…021 move to partner B
--   workspace A a…011 (org a…010, house partner): owner a…031, viewer a…033
--   workspace B a…021 (org a…020): owner a…032
-- Each block prepares its fixtures as administrator, switches to
-- `app_runtime` with `set local role` and rolls back.
-- ============================================================================

create or replace function pg_temp.ctx(p_user uuid, p_ws uuid, p_org uuid, p_partner uuid default null)
returns void
language sql as $$
  select set_config('app.user_id', p_user::text, true),
         set_config('app.workspace_id', coalesce(p_ws::text, ''), true),
         set_config('app.organization_id', coalesce(p_org::text, ''), true),
         set_config('app.partner_id', coalesce(p_partner::text, ''), true);
$$;

create or replace function pg_temp.fixture() returns void
language sql as $$
  insert into public.partners (id, slug, name)
  values ('b7000000-0000-4000-8000-000000000001', 'agencia-cf1', 'Agência CF1');
  insert into public.partner_members (partner_id, user_id, email, role) values
    ('b7000000-0000-4000-8000-000000000001', 'd0000000-0000-4000-8000-000000000006', 'admin@cf1.test', 'partner_admin'),
    ('b7000000-0000-4000-8000-000000000001', 'd0000000-0000-4000-8000-000000000004', 'sup@cf1.test', 'partner_support');
  insert into public.platform_admin_members (user_id, role, status)
  values ('d0000000-0000-4000-8000-000000000002', 'billing', 'active')
  on conflict (user_id) do update set role = 'billing', status = 'active';
  update public.organizations set partner_id = 'b7000000-0000-4000-8000-000000000001'
  where id = 'a0000000-0000-4000-8000-000000000020';
$$;

-- ----------------------------------------------------------------------------
-- Test 1: platform values are written by platform owner and operations only
-- ----------------------------------------------------------------------------
begin;
select pg_temp.fixture();
set local role app_runtime;
do $$
begin
  perform pg_temp.ctx('d0000000-0000-4000-8000-000000000003', null, null);
  insert into public.settings (scope, key, value, locked, updated_by)
  values ('platform', 'region.currency', '"USD"', true, 'd0000000-0000-4000-8000-000000000003');
  update public.settings set value = '"EUR"' where scope = 'platform' and key = 'region.currency';
  if not found then raise exception 'settings: platform owner could not edit'; end if;

  -- The scope never changes after the insert.
  begin
    update public.settings set scope = 'partner' where scope = 'platform';
    raise exception 'settings: scope changed';
  exception when insufficient_privilege then null;
  end;

  -- Platform billing is not a manager.
  perform pg_temp.ctx('d0000000-0000-4000-8000-000000000002', null, null);
  begin
    insert into public.settings (scope, key, value, updated_by)
    values ('platform', 'region.timezone', '"UTC"', 'd0000000-0000-4000-8000-000000000002');
    raise exception 'settings: platform billing wrote a value';
  exception when insufficient_privilege then null;
  end;
  update public.settings set value = '"BRL"' where scope = 'platform';
  if found then raise exception 'settings: platform billing edited a value'; end if;

  -- A customer never reads the table, only the cascade.
  perform pg_temp.ctx('a0000000-0000-4000-8000-000000000033', 'a0000000-0000-4000-8000-000000000011',
                      'a0000000-0000-4000-8000-000000000010');
  if exists (select 1 from public.settings) then
    raise exception 'settings: customer reads the platform rows';
  end if;
  if (select value from private.settings_cascade() where key = 'region.currency') <> '"EUR"' then
    raise exception 'settings: cascade misses the platform value';
  end if;
end $$;
rollback;

-- ----------------------------------------------------------------------------
-- Test 2: partner values are written by its owner and admin only
-- ----------------------------------------------------------------------------
begin;
select pg_temp.fixture();
set local role app_runtime;
do $$
begin
  perform pg_temp.ctx('d0000000-0000-4000-8000-000000000006', null, null,
                      'b7000000-0000-4000-8000-000000000001');
  insert into public.settings (scope, partner_id, key, value, locked, updated_by)
  values ('partner', 'b7000000-0000-4000-8000-000000000001', 'region.timezone',
          '"America/Manaus"', true, 'd0000000-0000-4000-8000-000000000006');

  -- Another partner's value, or one signed as someone else, is refused.
  begin
    insert into public.settings (scope, partner_id, key, value, updated_by)
    values ('partner', '00000000-0000-4000-8000-000000000000', 'region.timezone', '"UTC"',
            'd0000000-0000-4000-8000-000000000006');
    raise exception 'settings: value of another partner written';
  exception when insufficient_privilege then null;
  end;
  begin
    update public.settings set updated_by = 'd0000000-0000-4000-8000-000000000004';
    raise exception 'settings: signed as someone else';
  exception when insufficient_privilege then null;
  end;

  -- Support reads the partner's values but does not change them.
  perform pg_temp.ctx('d0000000-0000-4000-8000-000000000004', null, null,
                      'b7000000-0000-4000-8000-000000000001');
  if (select count(*) from public.settings) <> 1 then
    raise exception 'settings: partner support cannot read';
  end if;
  delete from public.settings;
  if found then raise exception 'settings: partner support deleted a value'; end if;
  begin
    insert into public.settings (scope, partner_id, key, value, updated_by)
    values ('partner', 'b7000000-0000-4000-8000-000000000001', 'region.currency', '"USD"',
            'd0000000-0000-4000-8000-000000000004');
    raise exception 'settings: partner support wrote a value';
  exception when insufficient_privilege then null;
  end;
end $$;
rollback;

-- ----------------------------------------------------------------------------
-- Test 3: workspace values are written by its owner and admin, never locked
-- ----------------------------------------------------------------------------
begin;
select pg_temp.fixture();
set local role app_runtime;
do $$
begin
  perform pg_temp.ctx('a0000000-0000-4000-8000-000000000031', 'a0000000-0000-4000-8000-000000000011',
                      'a0000000-0000-4000-8000-000000000010');
  insert into public.settings (scope, organization_id, workspace_id, key, value, updated_by)
  values ('workspace', 'a0000000-0000-4000-8000-000000000010', 'a0000000-0000-4000-8000-000000000011',
          'region.currency', '"USD"', 'a0000000-0000-4000-8000-000000000031');
  begin
    update public.settings set locked = true where scope = 'workspace';
    raise exception 'settings: workspace value locked';
  exception when check_violation then null;
  end;
  begin
    insert into public.settings (scope, organization_id, workspace_id, key, value, updated_by)
    values ('workspace', 'a0000000-0000-4000-8000-000000000020', 'a0000000-0000-4000-8000-000000000021',
            'region.currency', '"USD"', 'a0000000-0000-4000-8000-000000000031');
    raise exception 'settings: value of another workspace written';
  exception when insufficient_privilege then null;
  end;

  -- The viewer reads it but does not change it.
  perform pg_temp.ctx('a0000000-0000-4000-8000-000000000033', 'a0000000-0000-4000-8000-000000000011',
                      'a0000000-0000-4000-8000-000000000010');
  if (select count(*) from public.settings) <> 1 then
    raise exception 'settings: workspace viewer cannot read';
  end if;
  update public.settings set value = '"EUR"';
  if found then raise exception 'settings: workspace viewer edited a value'; end if;

  -- Workspace B sees nothing of workspace A.
  perform pg_temp.ctx('a0000000-0000-4000-8000-000000000032', 'a0000000-0000-4000-8000-000000000021',
                      'a0000000-0000-4000-8000-000000000020');
  if exists (select 1 from public.settings)
     or exists (select 1 from private.settings_cascade()) then
    raise exception 'settings: workspace B reads the values of workspace A';
  end if;
end $$;
rollback;

-- ----------------------------------------------------------------------------
-- Test 4: the cascade returns the platform, the context's partner and the
-- context's workspace, and nothing of others
-- ----------------------------------------------------------------------------
begin;
select pg_temp.fixture();
insert into public.settings (scope, key, value, updated_by) values
  ('platform', 'region.currency', '"BRL"', 'd0000000-0000-4000-8000-000000000003');
insert into public.settings (scope, partner_id, key, value, updated_by) values
  ('partner', 'b7000000-0000-4000-8000-000000000001', 'region.currency', '"USD"',
   'd0000000-0000-4000-8000-000000000006'),
  ('partner', '00000000-0000-4000-8000-000000000000', 'region.currency', '"EUR"',
   'd0000000-0000-4000-8000-000000000003');
insert into public.settings (scope, organization_id, workspace_id, key, value, updated_by) values
  ('workspace', 'a0000000-0000-4000-8000-000000000020', 'a0000000-0000-4000-8000-000000000021',
   'region.timezone', '"UTC"', 'a0000000-0000-4000-8000-000000000032'),
  ('workspace', 'a0000000-0000-4000-8000-000000000010', 'a0000000-0000-4000-8000-000000000011',
   'region.timezone', '"America/Recife"', 'a0000000-0000-4000-8000-000000000031');
set local role app_runtime;
do $$
declare
  rows text;
begin
  perform pg_temp.ctx('a0000000-0000-4000-8000-000000000032', 'a0000000-0000-4000-8000-000000000021',
                      'a0000000-0000-4000-8000-000000000020');
  select string_agg(scope || ':' || (value #>> '{}'), ',' order by scope)
  into rows from private.settings_cascade();
  if rows is distinct from 'partner:USD,platform:BRL,workspace:UTC' then
    raise exception 'settings: workspace B cascade is %', rows;
  end if;

  -- The partner console sees the platform and its own partner.
  perform pg_temp.ctx('d0000000-0000-4000-8000-000000000004', null, null,
                      'b7000000-0000-4000-8000-000000000001');
  select string_agg(scope || ':' || (value #>> '{}'), ',' order by scope)
  into rows from private.settings_cascade();
  if rows is distinct from 'partner:USD,platform:BRL' then
    raise exception 'settings: partner cascade is %', rows;
  end if;

  -- Someone outside the workspace gets only the platform.
  perform pg_temp.ctx('a0000000-0000-4000-8000-000000000031', 'a0000000-0000-4000-8000-000000000021',
                      'a0000000-0000-4000-8000-000000000020');
  select string_agg(scope || ':' || (value #>> '{}'), ',' order by scope)
  into rows from private.settings_cascade();
  if rows is distinct from 'platform:BRL' then
    raise exception 'settings: outsider cascade is %', rows;
  end if;
end $$;
rollback;

-- ----------------------------------------------------------------------------
-- Test 5 (CF3a): `private.email_settings(partner)` gives the dashboard and
-- the worker the `email.*` rows of the platform and of that partner only.
-- ----------------------------------------------------------------------------
begin;
select pg_temp.fixture();
insert into public.partners (id, slug, name)
values ('b7000000-0000-4000-8000-000000000002', 'outra-cf3a', 'Outra CF3a');
insert into public.settings (scope, key, value, locked, updated_by) values
  ('platform', 'email.from_name', '"GUIDU"', false, 'd0000000-0000-4000-8000-000000000003'),
  ('platform', 'region.currency', '"USD"', false, 'd0000000-0000-4000-8000-000000000003');
insert into public.settings (scope, partner_id, key, value, locked, updated_by) values
  ('partner', 'b7000000-0000-4000-8000-000000000001', 'email.reply_to', '"ajuda@cf1.test"', false,
   'd0000000-0000-4000-8000-000000000006'),
  ('partner', 'b7000000-0000-4000-8000-000000000001', 'region.timezone', '"UTC"', false,
   'd0000000-0000-4000-8000-000000000006'),
  ('partner', 'b7000000-0000-4000-8000-000000000002', 'email.from_name', '"Outra"', false,
   'd0000000-0000-4000-8000-000000000006');

set local role app_runtime;
do $$
declare
  rows text;
begin
  -- A request with no context at all (an invitation on the platform host).
  perform pg_temp.ctx('a0000000-0000-4000-8000-000000000033', null, null);
  select string_agg(scope || ':' || key || '=' || (value #>> '{}'), ',' order by scope, key)
    into rows
    from private.email_settings('b7000000-0000-4000-8000-000000000001');
  if rows is distinct from 'partner:email.reply_to=ajuda@cf1.test,platform:email.from_name=GUIDU' then
    raise exception 'email_settings: partner rows are %', rows;
  end if;
  select string_agg(scope || ':' || key, ',' order by scope, key)
    into rows from private.email_settings(null);
  if rows is distinct from 'platform:email.from_name' then
    raise exception 'email_settings: platform rows are %', rows;
  end if;
  -- The table itself stays closed.
  if exists (select 1 from public.settings) then
    raise exception 'email_settings: customer reads the table';
  end if;
end $$;
reset role;

set local role app_worker;
do $$
begin
  if (select count(*) from private.email_settings('b7000000-0000-4000-8000-000000000002')) <> 2 then
    raise exception 'email_settings: worker misses the rows';
  end if;
end $$;
reset role;

set local role authenticated;
do $$
begin
  perform private.email_settings(null);
  raise exception 'email_settings: authenticated called it';
exception when insufficient_privilege then null;
end $$;
rollback;
