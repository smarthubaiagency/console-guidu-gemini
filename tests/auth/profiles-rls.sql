-- SMA-98: policy proof for public.profiles.
-- Execute with psql as the migration administrator; every mutation is rolled
-- back. Fixtures are the synthetic identities in tests/auth/seed.sql.

-- An identity sees only its own profile.
begin;
set local role app_runtime;
select set_config('app.user_id', '30000000-0000-4000-8000-000000000001', true);
do $$
begin
  if (select array_agg(id order by id) from public.profiles)
     is distinct from array['30000000-0000-4000-8000-000000000001'::uuid] then
    raise exception 'profiles: identity A saw rows other than its own';
  end if;
end
$$;
rollback;

-- No context denies.
begin;
set local role app_runtime;
do $$
begin
  if (select count(*) from public.profiles) <> 0 then
    raise exception 'profiles: missing context exposed rows';
  end if;
end
$$;
rollback;

-- Malformed context denies.
begin;
set local role app_runtime;
select set_config('app.user_id', 'not-a-uuid', true);
do $$
begin
  if (select count(*) from public.profiles) <> 0 then
    raise exception 'profiles: invalid context exposed rows';
  end if;
end
$$;
rollback;

-- An identity updates its own row and nobody else's.
begin;
set local role app_runtime;
select set_config('app.user_id', '30000000-0000-4000-8000-000000000001', true);
do $$
declare
  affected integer;
begin
  update public.profiles set full_name = 'Renamed by A'
   where id = '30000000-0000-4000-8000-000000000001';
  get diagnostics affected = row_count;
  if affected <> 1 then
    raise exception 'profiles: identity A could not update its own row';
  end if;

  update public.profiles set full_name = 'Hijacked'
   where id = '30000000-0000-4000-8000-000000000002';
  get diagnostics affected = row_count;
  if affected <> 0 then
    raise exception 'profiles: identity A updated identity B';
  end if;
end
$$;
rollback;

-- A blocked identity cannot write its own row: revocation holds in the
-- database even if an application path forgets to check the status.
begin;
set local role app_runtime;
select set_config('app.user_id', '30000000-0000-4000-8000-000000000003', true);
do $$
declare
  affected integer;
begin
  update public.profiles set full_name = 'Blocked write'
   where id = '30000000-0000-4000-8000-000000000003';
  get diagnostics affected = row_count;
  if affected <> 0 then
    raise exception 'profiles: blocked identity updated its own row';
  end if;
end
$$;
rollback;

-- An identity cannot create a profile for somebody else.
begin;
set local role app_runtime;
select set_config('app.user_id', '30000000-0000-4000-8000-000000000001', true);
do $$
begin
  begin
    insert into public.profiles (id, full_name)
    values ('30000000-0000-4000-8000-000000000009', 'Forged');
    raise exception 'profiles: insert for another identity was accepted';
  exception
    when insufficient_privilege then null;
  end;
end
$$;
rollback;

-- D1: the Data API stays closed for this table.
do $$
begin
  if exists (
    select 1
    from information_schema.role_table_grants
    where table_schema = 'public'
      and table_name = 'profiles'
      and grantee in ('anon', 'authenticated', 'public')
  ) then
    raise exception 'profiles: anon/authenticated hold grants on the table';
  end if;
end
$$;

-- RLS is on and forced, so the owner cannot read around the policies either.
do $$
declare
  enabled boolean;
  forced boolean;
begin
  select relrowsecurity, relforcerowsecurity
    into enabled, forced
    from pg_class
   where oid = 'public.profiles'::regclass;

  if not enabled or not forced then
    raise exception 'profiles: row level security is not enabled and forced';
  end if;
end
$$;

-- Contract with F1.2 (SMA-97): SMA-98 reuses the shared `private` helper
-- schema and must never stand up a parallel one (SMA-139/SMA-131 finding 1).
do $$
begin
  if exists (select 1 from pg_namespace where nspname = 'app_private') then
    raise exception 'profiles: a parallel app_private schema exists alongside private';
  end if;

  if not exists (select 1 from pg_namespace where nspname = 'private') then
    raise exception 'profiles: the shared private helper schema is missing';
  end if;
end
$$;

-- Exactly one policy per action: two differently-named permissive policies
-- for the same command combine with OR and silently undo the status gate.
do $$
declare
  per_action record;
begin
  for per_action in
    select cmd, count(*) as policy_count
    from pg_policies
    where schemaname = 'public' and tablename = 'profiles'
    group by cmd
  loop
    if per_action.policy_count <> 1 then
      raise exception 'profiles: % command has % policies, expected exactly 1',
        per_action.cmd, per_action.policy_count;
    end if;
  end loop;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'profiles' and cmd = 'SELECT'
  ) then
    raise exception 'profiles: missing the select policy';
  end if;
end
$$;
