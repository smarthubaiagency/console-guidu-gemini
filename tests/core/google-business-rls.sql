-- ============================================================================
-- SQL Google Meu Negócio (GB1a): service modes, the partner_manages_organization
-- helper, units of a managed company and the gb_* tables.
--   partner P b1a…001: d…004 partner_owner, d…006 partner_support,
--     d…008 partner_finance; partner Q b1a…002: d…009 partner_owner
--   company M b1a…010 (partner P, gerenciado): workspace b1a…011, owner d…005
--   company S b1a…020 (partner P, padrao): workspace b1a…021, owner d…007
--   company A a…010 (house partner, no mode row): workspace a…011, owner a…031,
--     viewer a…033
-- Each block prepares its fixtures as administrator, switches to
-- `app_runtime` with `set local role` and rolls back.
-- ============================================================================

create or replace function pg_temp.ctx(p_user uuid, p_ws uuid, p_org uuid, p_partner uuid default null)
returns void
language sql as $$
  select set_config('app.user_id', p_user::text, true),
         set_config('app.principal_type', 'user', true),
         set_config('app.grant_id', '', true),
         set_config('app.workspace_id', coalesce(p_ws::text, ''), true),
         set_config('app.organization_id', coalesce(p_org::text, ''), true),
         set_config('app.partner_id', coalesce(p_partner::text, ''), true);
$$;

create or replace function pg_temp.fixture() returns void
language sql as $$
  insert into public.partners (id, slug, name) values
    ('b1a00000-0000-4000-8000-000000000001', 'agencia-gb1a', 'Agência GB1a'),
    ('b1a00000-0000-4000-8000-000000000002', 'outra-gb1a', 'Outra GB1a');
  insert into public.partner_members (partner_id, user_id, email, role) values
    ('b1a00000-0000-4000-8000-000000000001', 'd0000000-0000-4000-8000-000000000004', 'owner@gb1a.test', 'partner_owner'),
    ('b1a00000-0000-4000-8000-000000000001', 'd0000000-0000-4000-8000-000000000006', 'sup@gb1a.test', 'partner_support'),
    ('b1a00000-0000-4000-8000-000000000001', 'd0000000-0000-4000-8000-000000000008', 'fin@gb1a.test', 'partner_finance'),
    ('b1a00000-0000-4000-8000-000000000002', 'd0000000-0000-4000-8000-000000000009', 'owner@outra.test', 'partner_owner');
  insert into public.organizations (id, name, status, partner_id) values
    ('b1a00000-0000-4000-8000-000000000010', 'Gerenciada', 'active', 'b1a00000-0000-4000-8000-000000000001'),
    ('b1a00000-0000-4000-8000-000000000020', 'Padrão', 'active', 'b1a00000-0000-4000-8000-000000000001');
  insert into public.workspaces (id, organization_id, slug, name, status) values
    ('b1a00000-0000-4000-8000-000000000011', 'b1a00000-0000-4000-8000-000000000010', 'gb1a-gerenciada', 'Gerenciada', 'active'),
    ('b1a00000-0000-4000-8000-000000000021', 'b1a00000-0000-4000-8000-000000000020', 'gb1a-padrao', 'Padrão', 'active');
  insert into public.organization_members (organization_id, user_id, role, status) values
    ('b1a00000-0000-4000-8000-000000000010', 'd0000000-0000-4000-8000-000000000005', 'owner', 'active'),
    ('b1a00000-0000-4000-8000-000000000020', 'd0000000-0000-4000-8000-000000000007', 'owner', 'active');
  insert into public.workspace_members (workspace_id, organization_id, user_id, role, status) values
    ('b1a00000-0000-4000-8000-000000000011', 'b1a00000-0000-4000-8000-000000000010', 'd0000000-0000-4000-8000-000000000005', 'owner', 'active'),
    ('b1a00000-0000-4000-8000-000000000021', 'b1a00000-0000-4000-8000-000000000020', 'd0000000-0000-4000-8000-000000000007', 'owner', 'active');
  insert into public.organization_service_modes (organization_id, partner_id, mode) values
    ('b1a00000-0000-4000-8000-000000000010', 'b1a00000-0000-4000-8000-000000000001', 'gerenciado'),
    ('b1a00000-0000-4000-8000-000000000020', 'b1a00000-0000-4000-8000-000000000001', 'padrao');
$$;

-- Fixture rows of a ficha in a workspace, as administrator.
create or replace function pg_temp.ficha(p_ws uuid, p_org uuid, p_owner uuid, p_unit uuid, p_loc uuid)
returns void
language sql as $$
  insert into public.workspace_locations (id, organization_id, workspace_id, name, created_by)
  values (p_unit, p_org, p_ws, 'Unidade', p_owner);
  insert into public.gb_locations (id, organization_id, workspace_id, unit_id, provider, external_id, name, created_by)
  values (p_loc, p_org, p_ws, p_unit, 'fake', 'loc-' || p_loc::text, 'Ficha', p_owner);
  insert into public.gb_snapshots (gb_location_id, organization_id, workspace_id, kind, data, created_by)
  values (p_loc, p_org, p_ws, 'initial', '{"name":"Ficha"}', p_owner);
  insert into public.gb_analysis_runs (gb_location_id, organization_id, workspace_id, analysis_key, area, phase, created_by)
  values (p_loc, p_org, p_ws, 'info-checklist', 'info', 'blocking', p_owner);
  insert into public.gb_area_settings (gb_location_id, organization_id, workspace_id, area, enabled, autonomy, updated_by)
  values (p_loc, p_org, p_ws, 'reviews', true, 'approval', p_owner);
$$;

-- ----------------------------------------------------------------------------
-- Test 1: the helper answers only for the managing partner's team
-- ----------------------------------------------------------------------------
begin;
select pg_temp.fixture();
set local role app_runtime;
do $$
begin
  -- Partner owner and support of P manage M, not S (padrão) nor A (other partner).
  perform pg_temp.ctx('d0000000-0000-4000-8000-000000000004', null, null, 'b1a00000-0000-4000-8000-000000000001');
  if not private.partner_manages_organization('b1a00000-0000-4000-8000-000000000010') then
    raise exception 'partner_manages_organization: owner of P does not manage M';
  end if;
  if private.partner_manages_organization('b1a00000-0000-4000-8000-000000000020') then
    raise exception 'partner_manages_organization: a padrão company counts as managed';
  end if;
  if private.partner_manages_organization('a0000000-0000-4000-8000-000000000010') then
    raise exception 'partner_manages_organization: a company of another partner counts';
  end if;
  perform pg_temp.ctx('d0000000-0000-4000-8000-000000000006', null, null, 'b1a00000-0000-4000-8000-000000000001');
  if not private.partner_manages_organization('b1a00000-0000-4000-8000-000000000010') then
    raise exception 'partner_manages_organization: support of P does not manage M';
  end if;
  -- Finance does not operate; another partner's owner neither, even naming P.
  perform pg_temp.ctx('d0000000-0000-4000-8000-000000000008', null, null, 'b1a00000-0000-4000-8000-000000000001');
  if private.partner_manages_organization('b1a00000-0000-4000-8000-000000000010') then
    raise exception 'partner_manages_organization: partner_finance manages';
  end if;
  perform pg_temp.ctx('d0000000-0000-4000-8000-000000000009', null, null, 'b1a00000-0000-4000-8000-000000000001');
  if private.partner_manages_organization('b1a00000-0000-4000-8000-000000000010') then
    raise exception 'partner_manages_organization: a member of another partner manages';
  end if;
  perform pg_temp.ctx('d0000000-0000-4000-8000-000000000009', null, null, 'b1a00000-0000-4000-8000-000000000002');
  if private.partner_manages_organization('b1a00000-0000-4000-8000-000000000010') then
    raise exception 'partner_manages_organization: the wrong partner manages';
  end if;
  -- The company's own owner is not a partner.
  perform pg_temp.ctx('d0000000-0000-4000-8000-000000000005', 'b1a00000-0000-4000-8000-000000000011',
                      'b1a00000-0000-4000-8000-000000000010', 'b1a00000-0000-4000-8000-000000000001');
  if private.partner_manages_organization('b1a00000-0000-4000-8000-000000000010') then
    raise exception 'partner_manages_organization: the customer counts as partner';
  end if;
end
$$;
rollback;

-- ----------------------------------------------------------------------------
-- Test 2: service modes are set by the partner's owner/admin and read by
-- the partner and the company
-- ----------------------------------------------------------------------------
begin;
select pg_temp.fixture();
insert into public.organizations (id, name, status, partner_id)
values ('b1a00000-0000-4000-8000-000000000030', 'Nova', 'active', 'b1a00000-0000-4000-8000-000000000001');
set local role app_runtime;
do $$
declare
  v_count integer;
begin
  -- Support cannot set it.
  perform pg_temp.ctx('d0000000-0000-4000-8000-000000000006', null, null, 'b1a00000-0000-4000-8000-000000000001');
  begin
    insert into public.organization_service_modes (organization_id, partner_id, mode, set_by)
    values ('b1a00000-0000-4000-8000-000000000030', 'b1a00000-0000-4000-8000-000000000001', 'gerenciado',
            'd0000000-0000-4000-8000-000000000006');
    raise exception 'organization_service_modes: support set a mode';
  exception when insufficient_privilege then null;
  end;
  -- Another partner cannot set it for P's company.
  perform pg_temp.ctx('d0000000-0000-4000-8000-000000000009', null, null, 'b1a00000-0000-4000-8000-000000000002');
  begin
    insert into public.organization_service_modes (organization_id, partner_id, mode, set_by)
    values ('b1a00000-0000-4000-8000-000000000030', 'b1a00000-0000-4000-8000-000000000002', 'gerenciado',
            'd0000000-0000-4000-8000-000000000009');
    raise exception 'organization_service_modes: another partner set a mode';
  exception when insufficient_privilege then null;
  end;
  -- The owner of P sets it, signing the row.
  perform pg_temp.ctx('d0000000-0000-4000-8000-000000000004', null, null, 'b1a00000-0000-4000-8000-000000000001');
  insert into public.organization_service_modes (organization_id, partner_id, mode, set_by)
  values ('b1a00000-0000-4000-8000-000000000030', 'b1a00000-0000-4000-8000-000000000001', 'gerenciado',
          'd0000000-0000-4000-8000-000000000004');
  select count(*) into v_count from public.organization_service_modes;
  if v_count <> 3 then
    raise exception 'organization_service_modes: partner reads % rows, expected 3', v_count;
  end if;
  -- The company of S reads its own mode only.
  perform pg_temp.ctx('d0000000-0000-4000-8000-000000000007', 'b1a00000-0000-4000-8000-000000000021',
                      'b1a00000-0000-4000-8000-000000000020', 'b1a00000-0000-4000-8000-000000000001');
  select count(*) into v_count from public.organization_service_modes;
  if v_count <> 1 then
    raise exception 'organization_service_modes: the company reads % rows, expected 1', v_count;
  end if;
  -- And cannot change it.
  update public.organization_service_modes set mode = 'gerenciado',
    set_by = 'd0000000-0000-4000-8000-000000000007';
  get diagnostics v_count = row_count;
  if v_count <> 0 then
    raise exception 'organization_service_modes: the company changed its mode';
  end if;
end
$$;
rollback;

-- ----------------------------------------------------------------------------
-- Test 3: units and gb_* rows of a managed company are open to the managing
-- partner; a padrão company is not
-- ----------------------------------------------------------------------------
begin;
select pg_temp.fixture();
select pg_temp.ficha('b1a00000-0000-4000-8000-000000000011', 'b1a00000-0000-4000-8000-000000000010',
                     'd0000000-0000-4000-8000-000000000005', 'b1a00000-0000-4000-8000-0000000000a1',
                     'b1a00000-0000-4000-8000-0000000000b1');
select pg_temp.ficha('b1a00000-0000-4000-8000-000000000021', 'b1a00000-0000-4000-8000-000000000020',
                     'd0000000-0000-4000-8000-000000000007', 'b1a00000-0000-4000-8000-0000000000a2',
                     'b1a00000-0000-4000-8000-0000000000b2');
set local role app_runtime;
do $$
declare
  v_count integer;
  t text;
begin
  -- Managed: the support of P reads every gb_* table and the unit.
  perform pg_temp.ctx('d0000000-0000-4000-8000-000000000006', 'b1a00000-0000-4000-8000-000000000011',
                      'b1a00000-0000-4000-8000-000000000010', 'b1a00000-0000-4000-8000-000000000001');
  foreach t in array array['workspace_locations', 'gb_locations', 'gb_snapshots', 'gb_analysis_runs', 'gb_area_settings'] loop
    execute format('select count(*) from public.%I', t) into v_count;
    if v_count <> 1 then
      raise exception '%: managing partner reads % rows, expected 1', t, v_count;
    end if;
  end loop;
  select count(*) into v_count from public.workspaces where id = 'b1a00000-0000-4000-8000-000000000011';
  if v_count <> 1 then
    raise exception 'workspaces: managing partner does not see the managed workspace';
  end if;

  -- It creates a unit and a ficha there, signing them.
  insert into public.workspace_locations (organization_id, workspace_id, name, created_by)
  values ('b1a00000-0000-4000-8000-000000000010', 'b1a00000-0000-4000-8000-000000000011', 'Filial',
          'd0000000-0000-4000-8000-000000000006');
  insert into public.gb_locations (organization_id, workspace_id, provider, external_id, name, created_by)
  values ('b1a00000-0000-4000-8000-000000000010', 'b1a00000-0000-4000-8000-000000000011', 'fake', 'nova',
          'Filial', 'd0000000-0000-4000-8000-000000000006');
  -- It approves an area.
  update public.gb_area_settings
  set approved_at = now(), approved_by = 'd0000000-0000-4000-8000-000000000006',
      updated_by = 'd0000000-0000-4000-8000-000000000006';
  get diagnostics v_count = row_count;
  if v_count <> 1 then
    raise exception 'gb_area_settings: managing partner did not approve';
  end if;
  -- Signing for someone else is refused.
  begin
    insert into public.gb_locations (organization_id, workspace_id, provider, external_id, name, created_by)
    values ('b1a00000-0000-4000-8000-000000000010', 'b1a00000-0000-4000-8000-000000000011', 'fake', 'forjada',
            'X', 'd0000000-0000-4000-8000-000000000005');
    raise exception 'gb_locations: partner signed as the customer';
  exception when insufficient_privilege then null;
  end;

  -- Padrão: the same partner sees nothing and writes nothing.
  perform pg_temp.ctx('d0000000-0000-4000-8000-000000000004', 'b1a00000-0000-4000-8000-000000000021',
                      'b1a00000-0000-4000-8000-000000000020', 'b1a00000-0000-4000-8000-000000000001');
  foreach t in array array['workspace_locations', 'gb_locations', 'gb_snapshots', 'gb_analysis_runs', 'gb_area_settings'] loop
    execute format('select count(*) from public.%I', t) into v_count;
    if v_count <> 0 then
      raise exception '%: partner reads % rows of a padrão company', t, v_count;
    end if;
  end loop;
  select count(*) into v_count from public.workspaces where id = 'b1a00000-0000-4000-8000-000000000021';
  if v_count <> 0 then
    raise exception 'workspaces: partner sees a padrão workspace';
  end if;
  begin
    insert into public.workspace_locations (organization_id, workspace_id, name, created_by)
    values ('b1a00000-0000-4000-8000-000000000020', 'b1a00000-0000-4000-8000-000000000021', 'Intrusa',
            'd0000000-0000-4000-8000-000000000004');
    raise exception 'workspace_locations: partner created a unit in a padrão company';
  exception when insufficient_privilege then null;
  end;
  begin
    insert into public.gb_locations (organization_id, workspace_id, provider, external_id, name, created_by)
    values ('b1a00000-0000-4000-8000-000000000020', 'b1a00000-0000-4000-8000-000000000021', 'fake', 'intrusa',
            'X', 'd0000000-0000-4000-8000-000000000004');
    raise exception 'gb_locations: partner created a ficha in a padrão company';
  exception when insufficient_privilege then null;
  end;

  -- Finance of P does not reach even the managed company.
  perform pg_temp.ctx('d0000000-0000-4000-8000-000000000008', 'b1a00000-0000-4000-8000-000000000011',
                      'b1a00000-0000-4000-8000-000000000010', 'b1a00000-0000-4000-8000-000000000001');
  select count(*) into v_count from public.gb_locations;
  if v_count <> 0 then
    raise exception 'gb_locations: partner_finance reads a managed ficha';
  end if;

  -- Padrão: the company's owner reads and writes its own rows.
  perform pg_temp.ctx('d0000000-0000-4000-8000-000000000007', 'b1a00000-0000-4000-8000-000000000021',
                      'b1a00000-0000-4000-8000-000000000020', 'b1a00000-0000-4000-8000-000000000001');
  select count(*) into v_count from public.gb_analysis_runs;
  if v_count <> 1 then
    raise exception 'gb_analysis_runs: owner reads % rows, expected 1', v_count;
  end if;
  update public.gb_analysis_runs set status = 'done', updated_by = 'd0000000-0000-4000-8000-000000000007';
  get diagnostics v_count = row_count;
  if v_count <> 1 then
    raise exception 'gb_analysis_runs: owner did not update the result';
  end if;
end
$$;
rollback;

-- ----------------------------------------------------------------------------
-- Test 4: members read, only owner and admin write; tenants are isolated;
-- snapshots are append only; the unit and the first review are immutable
-- ----------------------------------------------------------------------------
begin;
select pg_temp.fixture();
select pg_temp.ficha('a0000000-0000-4000-8000-000000000011', 'a0000000-0000-4000-8000-000000000010',
                     'a0000000-0000-4000-8000-000000000031', 'b1a00000-0000-4000-8000-0000000000a3',
                     'b1a00000-0000-4000-8000-0000000000b3');
set local role app_runtime;
do $$
declare
  v_count integer;
begin
  -- The viewer of A reads but does not write.
  perform pg_temp.ctx('a0000000-0000-4000-8000-000000000033', 'a0000000-0000-4000-8000-000000000011',
                      'a0000000-0000-4000-8000-000000000010');
  select count(*) into v_count from public.gb_locations;
  if v_count <> 1 then
    raise exception 'gb_locations: viewer reads % rows, expected 1', v_count;
  end if;
  update public.gb_area_settings set enabled = false, updated_by = 'a0000000-0000-4000-8000-000000000033';
  get diagnostics v_count = row_count;
  if v_count <> 0 then
    raise exception 'gb_area_settings: viewer changed an area';
  end if;
  begin
    insert into public.gb_snapshots (gb_location_id, organization_id, workspace_id, kind, data, created_by)
    values ('b1a00000-0000-4000-8000-0000000000b3', 'a0000000-0000-4000-8000-000000000010',
            'a0000000-0000-4000-8000-000000000011', 'approved', '{}', 'a0000000-0000-4000-8000-000000000033');
    raise exception 'gb_snapshots: viewer wrote a version';
  exception when insufficient_privilege then null;
  end;

  -- Workspace B sees nothing of A.
  perform pg_temp.ctx('a0000000-0000-4000-8000-000000000032', 'a0000000-0000-4000-8000-000000000021',
                      'a0000000-0000-4000-8000-000000000020');
  select count(*) into v_count from public.gb_snapshots;
  if v_count <> 0 then
    raise exception 'gb_snapshots: workspace B reads A';
  end if;

  -- The owner of A: no update nor delete on snapshots.
  perform pg_temp.ctx('a0000000-0000-4000-8000-000000000031', 'a0000000-0000-4000-8000-000000000011',
                      'a0000000-0000-4000-8000-000000000010');
  begin
    update public.gb_snapshots set data = '{}';
    raise exception 'gb_snapshots: a version was changed';
  exception when insufficient_privilege then null;
  end;
  begin
    delete from public.gb_snapshots;
    raise exception 'gb_snapshots: a version was deleted';
  exception when insufficient_privilege then null;
  end;
  -- A second initial version is refused.
  begin
    insert into public.gb_snapshots (gb_location_id, organization_id, workspace_id, kind, data, created_by)
    values ('b1a00000-0000-4000-8000-0000000000b3', 'a0000000-0000-4000-8000-000000000010',
            'a0000000-0000-4000-8000-000000000011', 'initial', '{}', 'a0000000-0000-4000-8000-000000000031');
    raise exception 'gb_snapshots: two initial versions';
  exception when unique_violation then null;
  end;
  -- The unit of a ficha never changes.
  begin
    update public.gb_locations set unit_id = null, updated_by = 'a0000000-0000-4000-8000-000000000031';
    raise exception 'gb_locations: unit changed';
  exception when check_violation then null;
  end;
  -- The first review is signed by its author, and then immutable.
  begin
    update public.gb_locations
    set reviewed_at = now(), reviewed_by = 'a0000000-0000-4000-8000-000000000033',
        updated_by = 'a0000000-0000-4000-8000-000000000031';
    raise exception 'gb_locations: review signed for someone else';
  exception when check_violation then null;
  end;
  update public.gb_locations
  set reviewed_at = now(), reviewed_by = 'a0000000-0000-4000-8000-000000000031',
      updated_by = 'a0000000-0000-4000-8000-000000000031';
  begin
    update public.gb_locations
    set reviewed_at = now() + interval '1 day', updated_by = 'a0000000-0000-4000-8000-000000000031';
    raise exception 'gb_locations: first review rewritten';
  exception when check_violation then null;
  end;
  -- No grants to anon/authenticated (checked as administrator below).
end
$$;
rollback;

-- ----------------------------------------------------------------------------
-- Test 5: background analyses: the managing partner queues only the
-- module's jobs, in a managed workspace
-- ----------------------------------------------------------------------------
begin;
select pg_temp.fixture();
set local role app_runtime;
do $$
declare
  v_count integer;
begin
  perform pg_temp.ctx('d0000000-0000-4000-8000-000000000004', 'b1a00000-0000-4000-8000-000000000011',
                      'b1a00000-0000-4000-8000-000000000010', 'b1a00000-0000-4000-8000-000000000001');
  insert into public.job_runs (kind, scope, partner_id, organization_id, workspace_id, requested_by, payload, idempotency_key)
  values ('google-business.background-analyses', 'workspace', 'b1a00000-0000-4000-8000-000000000001',
          'b1a00000-0000-4000-8000-000000000010', 'b1a00000-0000-4000-8000-000000000011',
          'd0000000-0000-4000-8000-000000000004', '{}', 'gb1a-test-1');
  select count(*) into v_count from public.job_runs where idempotency_key = 'gb1a-test-1';
  if v_count <> 1 then
    raise exception 'job_runs: managing partner does not see its run';
  end if;
  begin
    insert into public.job_runs (kind, scope, partner_id, organization_id, workspace_id, requested_by, payload, idempotency_key)
    values ('hello-world.create-record', 'workspace', 'b1a00000-0000-4000-8000-000000000001',
            'b1a00000-0000-4000-8000-000000000010', 'b1a00000-0000-4000-8000-000000000011',
            'd0000000-0000-4000-8000-000000000004', '{}', 'gb1a-test-2');
    raise exception 'job_runs: partner queued a job of another module';
  exception when insufficient_privilege then null;
  end;
  perform pg_temp.ctx('d0000000-0000-4000-8000-000000000004', 'b1a00000-0000-4000-8000-000000000021',
                      'b1a00000-0000-4000-8000-000000000020', 'b1a00000-0000-4000-8000-000000000001');
  begin
    insert into public.job_runs (kind, scope, partner_id, organization_id, workspace_id, requested_by, payload, idempotency_key)
    values ('google-business.background-analyses', 'workspace', 'b1a00000-0000-4000-8000-000000000001',
            'b1a00000-0000-4000-8000-000000000020', 'b1a00000-0000-4000-8000-000000000021',
            'd0000000-0000-4000-8000-000000000004', '{}', 'gb1a-test-3');
    raise exception 'job_runs: partner queued in a padrão company';
  exception when insufficient_privilege then null;
  end;
end
$$;
rollback;

-- ----------------------------------------------------------------------------
-- Test 6: FORCE RLS and no grants to anon/authenticated on the new tables
-- ----------------------------------------------------------------------------
do $$
declare
  t text;
  v_force boolean;
begin
  foreach t in array array['organization_service_modes', 'gb_locations', 'gb_snapshots', 'gb_analysis_runs', 'gb_area_settings'] loop
    select relforcerowsecurity into v_force from pg_class where oid = ('public.' || t)::regclass;
    if not v_force then
      raise exception '%: FORCE RLS is off', t;
    end if;
    if has_table_privilege('anon', 'public.' || t, 'select')
       or has_table_privilege('authenticated', 'public.' || t, 'select') then
      raise exception '%: anon or authenticated can read', t;
    end if;
  end loop;
  if has_function_privilege('anon', 'private.partner_manages_organization(uuid)', 'execute') then
    raise exception 'partner_manages_organization: anon may execute';
  end if;
end
$$;
