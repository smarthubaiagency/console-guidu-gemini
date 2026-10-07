-- Execute with psql as the hosted `postgres` migration administrator.
-- Every mutation is rolled back; fixtures are the synthetic rows in seed.sql.

begin;
set local role app_runtime;
select set_config('app.user_id', '10000000-0000-4000-8000-000000000003', true);
select set_config('app.workspace_id', '10000000-0000-4000-8000-000000000002', true);
select set_config('app.organization_id', '10000000-0000-4000-8000-000000000001', true);
do $$
begin
  if (select array_agg(id order by id) from public.spike_notes)
     is distinct from array['10000000-0000-4000-8000-000000000004'::uuid] then
    raise exception 'AC01: workspace A saw unexpected notes';
  end if;
end
$$;
rollback;

begin;
set local role app_runtime;
do $$
begin
  if (select count(*) from public.spike_notes) <> 0 then
    raise exception 'AC02: missing context exposed rows';
  end if;
end
$$;
rollback;

begin;
set local role app_runtime;
select set_config('app.user_id', 'malformed', true);
select set_config('app.workspace_id', 'malformed', true);
select set_config('app.organization_id', 'malformed', true);
do $$
begin
  if (select count(*) from public.spike_notes) <> 0 then
    raise exception 'AC02: invalid context exposed rows';
  end if;
end
$$;
rollback;

