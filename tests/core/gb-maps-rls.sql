-- ============================================================================
-- SQL Saúde no Maps (GB1b): tenant, role, author, append-only measurements,
-- one starting point per unit, immutable identity and the F3e purge.
--   workspace A a…011 (org a…010): owner a…031, viewer a…033
--   workspace B a…021 (org a…020): owner a…032
-- ============================================================================

create or replace function pg_temp.ctx(p_user uuid, p_ws uuid, p_org uuid) returns void
language sql as $$
  select set_config('app.user_id', p_user::text, true),
         set_config('app.workspace_id', p_ws::text, true),
         set_config('app.organization_id', p_org::text, true);
$$;

begin;
-- Units of A and B, and a keyword of B (as the administrator).
insert into public.workspace_locations (id, organization_id, workspace_id, name, created_by) values
  ('9b1b0000-0000-4000-8000-0000000000a1', 'a0000000-0000-4000-8000-000000000010',
   'a0000000-0000-4000-8000-000000000011', 'Loja A', 'a0000000-0000-4000-8000-000000000031'),
  ('9b1b0000-0000-4000-8000-0000000000b1', 'a0000000-0000-4000-8000-000000000020',
   'a0000000-0000-4000-8000-000000000021', 'Loja B', 'a0000000-0000-4000-8000-000000000032');
insert into public.gb_maps_keywords (id, organization_id, workspace_id, location_id, keyword, source, created_by) values
  ('9b1b0000-0000-4000-8000-0000000000b2', 'a0000000-0000-4000-8000-000000000020',
   'a0000000-0000-4000-8000-000000000021', '9b1b0000-0000-4000-8000-0000000000b1', 'padaria', 'agent',
   'a0000000-0000-4000-8000-000000000032');

do $$
begin
  if has_table_privilege('anon', 'public.gb_maps_scans', 'select')
     or has_table_privilege('authenticated', 'public.gb_maps_keywords', 'insert')
     or has_table_privilege('authenticated', 'public.gb_maps_scan_results', 'select') then
    raise exception 'gb maps: anon or authenticated has a grant';
  end if;
  if not (select relforcerowsecurity from pg_class where oid = 'public.gb_maps_scans'::regclass)
     or not (select relforcerowsecurity from pg_class where oid = 'public.gb_maps_competitors'::regclass) then
    raise exception 'gb maps: RLS is not forced';
  end if;
end
$$;

set local role app_runtime;
do $$
declare
  v_keyword uuid;
  v_scan uuid;
begin
  -- The owner of A writes keywords, competitors and a measurement.
  perform pg_temp.ctx('a0000000-0000-4000-8000-000000000031', 'a0000000-0000-4000-8000-000000000011',
                      'a0000000-0000-4000-8000-000000000010');
  insert into public.gb_maps_keywords (organization_id, workspace_id, location_id, keyword, source, created_by)
  values ('a0000000-0000-4000-8000-000000000010', 'a0000000-0000-4000-8000-000000000011',
          '9b1b0000-0000-4000-8000-0000000000a1', 'Dentista', 'agent', 'a0000000-0000-4000-8000-000000000031')
  returning id into v_keyword;
  begin
    insert into public.gb_maps_keywords (organization_id, workspace_id, location_id, keyword, source, created_by)
    values ('a0000000-0000-4000-8000-000000000010', 'a0000000-0000-4000-8000-000000000011',
            '9b1b0000-0000-4000-8000-0000000000a1', '  dentista ', 'user', 'a0000000-0000-4000-8000-000000000031');
    raise exception 'gb maps: duplicated keyword accepted';
  exception when unique_violation then null;
  end;
  update public.gb_maps_keywords set status = 'paused', updated_by = 'a0000000-0000-4000-8000-000000000031'
  where id = v_keyword;
  if not found then raise exception 'gb maps: owner could not pause a keyword'; end if;
  begin
    update public.gb_maps_keywords set keyword = 'outra', updated_by = 'a0000000-0000-4000-8000-000000000031'
    where id = v_keyword;
    raise exception 'gb maps: keyword text changed';
  exception when check_violation then null;
  end;
  begin
    update public.gb_maps_keywords set status = 'active', updated_by = 'a0000000-0000-4000-8000-000000000033'
    where id = v_keyword;
    raise exception 'gb maps: edit signed by someone else';
  exception when insufficient_privilege then null;
  end;

  insert into public.gb_maps_competitors (organization_id, workspace_id, location_id, place_id, source, created_by)
  values ('a0000000-0000-4000-8000-000000000010', 'a0000000-0000-4000-8000-000000000011',
          '9b1b0000-0000-4000-8000-0000000000a1', 'ChIJ-rival_1', 'agent', 'a0000000-0000-4000-8000-000000000031');
  begin
    insert into public.gb_maps_competitors (organization_id, workspace_id, location_id, place_id, source, created_by)
    values ('a0000000-0000-4000-8000-000000000010', 'a0000000-0000-4000-8000-000000000011',
            '9b1b0000-0000-4000-8000-0000000000a1', 'not a place id!', 'user', 'a0000000-0000-4000-8000-000000000031');
    raise exception 'gb maps: invalid place id accepted';
  exception when check_violation then null;
  end;

  insert into public.gb_maps_scans (organization_id, workspace_id, location_id, is_baseline, grid_size, radius_m,
                                    keyword_count, score, provider, api_calls, cost_estimate_micros, created_by)
  values ('a0000000-0000-4000-8000-000000000010', 'a0000000-0000-4000-8000-000000000011',
          '9b1b0000-0000-4000-8000-0000000000a1', true, 7, 5000, 1, 42, 'fake', 49, 29400,
          'a0000000-0000-4000-8000-000000000031')
  returning id into v_scan;
  insert into public.gb_maps_scan_results (organization_id, workspace_id, scan_id, keyword_id, keyword, ranks, solv,
                                           average_rank, found_points, total_points)
  values ('a0000000-0000-4000-8000-000000000010', 'a0000000-0000-4000-8000-000000000011', v_scan, v_keyword,
          'dentista', '[[1,2,3,4,5,6,7]]', 6.12, 4, 7, 49);

  -- One starting point per unit; grids are odd; measurements are append-only.
  begin
    insert into public.gb_maps_scans (organization_id, workspace_id, location_id, is_baseline, grid_size, radius_m,
                                      keyword_count, provider, created_by)
    values ('a0000000-0000-4000-8000-000000000010', 'a0000000-0000-4000-8000-000000000011',
            '9b1b0000-0000-4000-8000-0000000000a1', true, 7, 5000, 1, 'fake', 'a0000000-0000-4000-8000-000000000031');
    raise exception 'gb maps: second starting point accepted';
  exception when unique_violation then null;
  end;
  begin
    insert into public.gb_maps_scans (organization_id, workspace_id, location_id, grid_size, radius_m,
                                      keyword_count, provider, created_by)
    values ('a0000000-0000-4000-8000-000000000010', 'a0000000-0000-4000-8000-000000000011',
            '9b1b0000-0000-4000-8000-0000000000a1', 6, 5000, 1, 'fake', 'a0000000-0000-4000-8000-000000000031');
    raise exception 'gb maps: even grid accepted';
  exception when check_violation then null;
  end;
  begin
    update public.gb_maps_scans set score = 99 where id = v_scan;
    raise exception 'gb maps: measurement edited';
  exception when insufficient_privilege then null;
  end;
  begin
    delete from public.gb_maps_scan_results where scan_id = v_scan;
    raise exception 'gb maps: measurement result deleted';
  exception when insufficient_privilege then null;
  end;
  begin
    insert into public.gb_maps_scans (organization_id, workspace_id, location_id, grid_size, radius_m,
                                      keyword_count, provider, created_by)
    values ('a0000000-0000-4000-8000-000000000010', 'a0000000-0000-4000-8000-000000000011',
            '9b1b0000-0000-4000-8000-0000000000a1', 7, 5000, 1, 'fake', 'a0000000-0000-4000-8000-000000000033');
    raise exception 'gb maps: measurement signed by someone else';
  exception when insufficient_privilege then null;
  end;

  -- Nothing of workspace B is visible or reachable from A.
  if exists (select 1 from public.gb_maps_keywords where id = '9b1b0000-0000-4000-8000-0000000000b2') then
    raise exception 'gb maps: keyword of another workspace visible';
  end if;
  begin
    insert into public.gb_maps_keywords (organization_id, workspace_id, location_id, keyword, source, created_by)
    values ('a0000000-0000-4000-8000-000000000020', 'a0000000-0000-4000-8000-000000000021',
            '9b1b0000-0000-4000-8000-0000000000b1', 'intruso', 'user', 'a0000000-0000-4000-8000-000000000031');
    raise exception 'gb maps: keyword created in another workspace';
  exception when insufficient_privilege then null;
  end;
  begin
    -- A unit of B under the workspace of A: the foreign key refuses it.
    insert into public.gb_maps_keywords (organization_id, workspace_id, location_id, keyword, source, created_by)
    values ('a0000000-0000-4000-8000-000000000010', 'a0000000-0000-4000-8000-000000000011',
            '9b1b0000-0000-4000-8000-0000000000b1', 'cruzado', 'user', 'a0000000-0000-4000-8000-000000000031');
    raise exception 'gb maps: unit of another workspace accepted';
  exception when foreign_key_violation then null;
  end;
  begin
    -- A keyword of B in a result of A: the foreign key refuses it.
    insert into public.gb_maps_scan_results (organization_id, workspace_id, scan_id, keyword_id, keyword, ranks, solv,
                                             found_points, total_points)
    values ('a0000000-0000-4000-8000-000000000010', 'a0000000-0000-4000-8000-000000000011', v_scan,
            '9b1b0000-0000-4000-8000-0000000000b2', 'padaria', '[]', 0, 0, 49);
    raise exception 'gb maps: keyword of another workspace in a result';
  exception when foreign_key_violation then null;
  end;

  -- The viewer reads but does not write.
  perform pg_temp.ctx('a0000000-0000-4000-8000-000000000033', 'a0000000-0000-4000-8000-000000000011',
                      'a0000000-0000-4000-8000-000000000010');
  if (select count(*) from public.gb_maps_scans) <> 1
     or (select count(*) from public.gb_maps_scan_results) <> 1
     or (select count(*) from public.gb_maps_keywords) <> 1
     or (select count(*) from public.gb_maps_competitors) <> 1 then
    raise exception 'gb maps: viewer cannot read the maps data';
  end if;
  begin
    insert into public.gb_maps_competitors (organization_id, workspace_id, location_id, place_id, source, created_by)
    values ('a0000000-0000-4000-8000-000000000010', 'a0000000-0000-4000-8000-000000000011',
            '9b1b0000-0000-4000-8000-0000000000a1', 'ChIJviewer', 'user', 'a0000000-0000-4000-8000-000000000033');
    raise exception 'gb maps: viewer marked a competitor';
  exception when insufficient_privilege then null;
  end;
  begin
    insert into public.gb_maps_scans (organization_id, workspace_id, location_id, grid_size, radius_m,
                                      keyword_count, provider, created_by)
    values ('a0000000-0000-4000-8000-000000000010', 'a0000000-0000-4000-8000-000000000011',
            '9b1b0000-0000-4000-8000-0000000000a1', 7, 5000, 1, 'fake', 'a0000000-0000-4000-8000-000000000033');
    raise exception 'gb maps: viewer recorded a measurement';
  exception when insufficient_privilege then null;
  end;
  update public.gb_maps_keywords set status = 'active', updated_by = 'a0000000-0000-4000-8000-000000000033';
  if found then raise exception 'gb maps: viewer edited a keyword'; end if;
end
$$;
reset role;

-- The worker purges only workspaces past their grace period (F3e).
set local role app_worker;
do $$
begin
  delete from public.gb_maps_scan_results;
  delete from public.gb_maps_keywords;
  if found then raise exception 'gb maps: worker purged an active workspace'; end if;
end
$$;
reset role;
rollback;
