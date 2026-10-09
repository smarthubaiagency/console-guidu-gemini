-- ============================================================================
-- SQL Invariants Verification (ADR 0001, ADR 0002, ADR 0008, ADR 0010)
-- Executed with psql as migration administrator in CI and post-migration validation.
-- Every check uses count(*) and raises an exception on failure.
-- ============================================================================

-- Invariante 1: Toda tabela no schema public deve ter RLS habilitada e forçada
do $$
declare
  v_count integer;
  insecure_tables text;
begin
  select count(*), coalesce(string_agg(c.relname, ', '), '')
  into v_count, insecure_tables
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public'
    and c.relkind = 'r'
    and (not c.relrowsecurity or not c.relforcerowsecurity);

  if v_count > 0 then
    raise exception 'Invariante violada: % tabela(s) no schema public sem RLS forçada: %',
      v_count, insecure_tables;
  end if;
end
$$;

-- Invariante 2: anon e authenticated não possuem privilégios em tabelas do schema public
do $$
declare
  v_count integer;
  leak_summary text;
begin
  select count(*), coalesce(string_agg(format('%s on %s to %s', privilege_type, table_name, grantee), '; '), '')
  into v_count, leak_summary
  from information_schema.role_table_grants
  where table_schema = 'public'
    and grantee in ('anon', 'authenticated');

  if v_count > 0 then
    raise exception 'Invariante violada: papeis anon/authenticated possuem privilégios em public (%): %',
      v_count, leak_summary;
  end if;
end
$$;

-- Invariante 3: app_runtime não possui privilégios fora de public e private
-- (tabelas, sequences e funções; ignorando schemas de sistema do PostgreSQL/Supabase)
do $$
declare
  v_table_grants integer;
  v_usage_grants integer;
  v_routine_grants integer;
  leak_details text;
begin
  -- 3.1 Tabelas fora de public e private
  select count(*), coalesce(string_agg(format('%s on %s.%s', privilege_type, table_schema, table_name), '; '), '')
  into v_table_grants, leak_details
  from information_schema.role_table_grants
  where grantee = 'app_runtime'
    and table_schema not in ('public', 'private', 'pg_catalog', 'information_schema');

  if v_table_grants > 0 then
    raise exception 'Invariante violada: app_runtime possui privilégios de tabela fora de public/private (%): %',
      v_table_grants, leak_details;
  end if;

  -- 3.2 Usages (sequences e types) fora de public e private
  select count(*), coalesce(string_agg(format('%s on %s %s.%s', privilege_type, object_type, object_schema, object_name), '; '), '')
  into v_usage_grants, leak_details
  from information_schema.role_usage_grants
  where grantee = 'app_runtime'
    and object_schema not in ('public', 'private', 'pg_catalog', 'information_schema');

  if v_usage_grants > 0 then
    raise exception 'Invariante violada: app_runtime possui privilégios de usage fora de public/private (%): %',
      v_usage_grants, leak_details;
  end if;

  -- 3.3 Rotinas (funções/procedimentos) fora de public e private
  select count(*), coalesce(string_agg(format('EXECUTE on %s.%s', routine_schema, routine_name), '; '), '')
  into v_routine_grants, leak_details
  from information_schema.role_routine_grants
  where grantee = 'app_runtime'
    and routine_schema not in ('public', 'private', 'pg_catalog', 'information_schema');

  if v_routine_grants > 0 then
    raise exception 'Invariante violada: app_runtime possui privilégios de rotina fora de public/private (%): %',
      v_routine_grants, leak_details;
  end if;
end
$$;

-- Invariante 4: Schema sma94_jobs e extensão pgmq não existem
do $$
declare
  v_schema_count integer;
  v_ext_count integer;
begin
  select count(*) into v_schema_count
  from pg_namespace
  where nspname = 'sma94_jobs';

  if v_schema_count > 0 then
    raise exception 'Invariante violada: schema residual de spike sma94_jobs ainda existe no banco';
  end if;

  select count(*) into v_ext_count
  from pg_extension
  where extname = 'pgmq';

  if v_ext_count > 0 then
    raise exception 'Invariante violada: extensao pgmq ainda existe no banco';
  end if;
end
$$;

-- Invariante 5: app_runtime continua NOSUPERUSER, NOBYPASSRLS e sem propriedade de tabelas
do $$
declare
  v_super boolean;
  v_bypass boolean;
  v_owned_tables integer;
  owned_list text;
begin
  select rolsuper, rolbypassrls
  into v_super, v_bypass
  from pg_roles
  where rolname = 'app_runtime';

  if v_super then
    raise exception 'Invariante violada: papel app_runtime possui SUPERUSER';
  end if;

  if v_bypass then
    raise exception 'Invariante violada: papel app_runtime possui BYPASSRLS';
  end if;

  select count(*), coalesce(string_agg(c.relname, ', '), '')
  into v_owned_tables, owned_list
  from pg_class c
  join pg_roles r on r.oid = c.relowner
  where r.rolname = 'app_runtime'
    and c.relkind in ('r', 'v', 'm', 'p');

  if v_owned_tables > 0 then
    raise exception 'Invariante violada: app_runtime é proprietário de tabelas (%): %',
      v_owned_tables, owned_list;
  end if;
end
$$;
