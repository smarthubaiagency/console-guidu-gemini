-- ============================================================================
-- SQL API Keys & MCP Token Authentication Verification (ADR 0009, Spec §15, §17.3)
-- Module: Platform API Keys Check Constraints, RLS and Secure Lookup
--
-- Executed as migration administrator (or test runner) with transaction rollbacks.
-- Context is switched to `app_runtime` under `set local role app_runtime`.
-- Every mutation is rolled back; all checks use count(*) and raise exceptions on failure.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- Test 1: Check constraint api_keys_scopes_catalog_check
-- ----------------------------------------------------------------------------
begin;
select set_config('app.user_id', 'a0000000-0000-4000-8000-000000000031', true);
select set_config('app.workspace_id', 'a0000000-0000-4000-8000-000000000011', true);
select set_config('app.organization_id', 'a0000000-0000-4000-8000-000000000010', true);

-- 1a: Rejeita escopo legado 'read'
do $$
declare
  v_err boolean := false;
begin
  begin
    insert into public.api_keys (
      organization_id, workspace_id, user_id, name, prefix, key_hash, scopes, status, expires_at
    ) values (
      'a0000000-0000-4000-8000-000000000010'::uuid,
      'a0000000-0000-4000-8000-000000000011'::uuid,
      'a0000000-0000-4000-8000-000000000031'::uuid,
      'Test Legacy Scope',
      'gdu_live_test1a',
      'hash_test_1a_invalid_legacy',
      array['read']::text[],
      'active',
      now() + interval '30 days'
    );
  exception
    when check_violation then
      v_err := true;
  end;

  if not v_err then
    raise exception 'Test 1a failed: api_keys_scopes_catalog_check permitiu escopo legado read';
  end if;
end;
$$;

-- 1b: Rejeita escopo administrativo 'admin:customers:read'
do $$
declare
  v_err boolean := false;
begin
  begin
    insert into public.api_keys (
      organization_id, workspace_id, user_id, name, prefix, key_hash, scopes, status, expires_at
    ) values (
      'a0000000-0000-4000-8000-000000000010'::uuid,
      'a0000000-0000-4000-8000-000000000011'::uuid,
      'a0000000-0000-4000-8000-000000000031'::uuid,
      'Test Admin Scope',
      'gdu_live_test1b',
      'hash_test_1b_invalid_admin',
      array['admin:customers:read']::text[],
      'active',
      now() + interval '30 days'
    );
  exception
    when check_violation then
      v_err := true;
  end;

  if not v_err then
    raise exception 'Test 1b failed: api_keys_scopes_catalog_check permitiu escopo admin:*';
  end if;
end;
$$;

-- 1c: Rejeita escopo de execução F4 'operations:execute'
do $$
declare
  v_err boolean := false;
begin
  begin
    insert into public.api_keys (
      organization_id, workspace_id, user_id, name, prefix, key_hash, scopes, status, expires_at
    ) values (
      'a0000000-0000-4000-8000-000000000010'::uuid,
      'a0000000-0000-4000-8000-000000000011'::uuid,
      'a0000000-0000-4000-8000-000000000031'::uuid,
      'Test Operations Execute',
      'gdu_live_test1c',
      'hash_test_1c_invalid_operations',
      array['operations:execute']::text[],
      'active',
      now() + interval '30 days'
    );
  exception
    when check_violation then
      v_err := true;
  end;

  if not v_err then
    raise exception 'Test 1c failed: api_keys_scopes_catalog_check permitiu operations:execute';
  end if;
end;
$$;

-- 1d: Rejeita cardinalidade zero (array vazio)
do $$
declare
  v_err boolean := false;
begin
  begin
    insert into public.api_keys (
      organization_id, workspace_id, user_id, name, prefix, key_hash, scopes, status, expires_at
    ) values (
      'a0000000-0000-4000-8000-000000000010'::uuid,
      'a0000000-0000-4000-8000-000000000011'::uuid,
      'a0000000-0000-4000-8000-000000000031'::uuid,
      'Test Empty Scopes',
      'gdu_live_test1d',
      'hash_test_1d_empty_scopes',
      array[]::text[],
      'active',
      now() + interval '30 days'
    );
  exception
    when check_violation then
      v_err := true;
  end;

  if not v_err then
    raise exception 'Test 1d failed: api_keys_scopes_catalog_check permitiu array de escopos vazio';
  end if;
end;
$$;

-- 1e: Permite escopos padrão válidos (workspace:read, modules:read)
do $$
declare
  v_inserted integer := 0;
begin
  insert into public.api_keys (
    organization_id, workspace_id, user_id, name, prefix, key_hash, scopes, status, expires_at
  ) values (
    'a0000000-0000-4000-8000-000000000010'::uuid,
    'a0000000-0000-4000-8000-000000000011'::uuid,
    'a0000000-0000-4000-8000-000000000031'::uuid,
    'Test Valid Default Scopes',
    'gdu_live_test1e',
    'hash_test_1e_valid_default',
    array['workspace:read', 'modules:read']::text[],
    'active',
    now() + interval '30 days'
  );
  get diagnostics v_inserted = row_count;

  if v_inserted <> 1 then
    raise exception 'Test 1e failed: insert com escopos padrão válidos falhou';
  end if;
end;
$$;

-- 1f: Permite os 6 escopos válidos do catálogo §17.3
do $$
declare
  v_inserted integer := 0;
begin
  insert into public.api_keys (
    organization_id, workspace_id, user_id, name, prefix, key_hash, scopes, status, expires_at
  ) values (
    'a0000000-0000-4000-8000-000000000010'::uuid,
    'a0000000-0000-4000-8000-000000000011'::uuid,
    'a0000000-0000-4000-8000-000000000031'::uuid,
    'Test All Valid Scopes',
    'gdu_live_test1f',
    'hash_test_1f_all_valid',
    array[
      'workspace:read',
      'modules:read',
      'usage:read',
      'executions:read',
      'members:read',
      'proposals:write'
    ]::text[],
    'active',
    now() + interval '30 days'
  );
  get diagnostics v_inserted = row_count;

  if v_inserted <> 1 then
    raise exception 'Test 1f failed: insert com todos os escopos permitidos da §17.3 falhou';
  end if;
end;
$$;

rollback;

-- ----------------------------------------------------------------------------
-- Test 2: Check constraint api_keys_expires_at_check
-- ----------------------------------------------------------------------------
begin;
select set_config('app.user_id', 'a0000000-0000-4000-8000-000000000031', true);
select set_config('app.workspace_id', 'a0000000-0000-4000-8000-000000000011', true);
select set_config('app.organization_id', 'a0000000-0000-4000-8000-000000000010', true);

-- 2a: Rejeita expiração > 365 dias
do $$
declare
  v_err boolean := false;
begin
  begin
    insert into public.api_keys (
      organization_id, workspace_id, user_id, name, prefix, key_hash, scopes, status, created_at, expires_at
    ) values (
      'a0000000-0000-4000-8000-000000000010'::uuid,
      'a0000000-0000-4000-8000-000000000011'::uuid,
      'a0000000-0000-4000-8000-000000000031'::uuid,
      'Test Over 365 Days',
      'gdu_live_test2a',
      'hash_test_2a_over_365',
      array['workspace:read']::text[],
      'active',
      now(),
      now() + interval '366 days'
    );
  exception
    when check_violation then
      v_err := true;
  end;

  if not v_err then
    raise exception 'Test 2a failed: api_keys_expires_at_check permitiu expiração > 365 dias';
  end if;
end;
$$;

-- 2b: Rejeita expiração igual a created_at
do $$
declare
  v_err boolean := false;
  v_now timestamptz := now();
begin
  begin
    insert into public.api_keys (
      organization_id, workspace_id, user_id, name, prefix, key_hash, scopes, status, created_at, expires_at
    ) values (
      'a0000000-0000-4000-8000-000000000010'::uuid,
      'a0000000-0000-4000-8000-000000000011'::uuid,
      'a0000000-0000-4000-8000-000000000031'::uuid,
      'Test Equals Created At',
      'gdu_live_test2b',
      'hash_test_2b_equals_created_at',
      array['workspace:read']::text[],
      'active',
      v_now,
      v_now
    );
  exception
    when check_violation then
      v_err := true;
  end;

  if not v_err then
    raise exception 'Test 2b failed: api_keys_expires_at_check permitiu expires_at = created_at';
  end if;
end;
$$;

-- 2c: Rejeita expiração anterior a created_at
do $$
declare
  v_err boolean := false;
  v_now timestamptz := now();
begin
  begin
    insert into public.api_keys (
      organization_id, workspace_id, user_id, name, prefix, key_hash, scopes, status, created_at, expires_at
    ) values (
      'a0000000-0000-4000-8000-000000000010'::uuid,
      'a0000000-0000-4000-8000-000000000011'::uuid,
      'a0000000-0000-4000-8000-000000000031'::uuid,
      'Test Before Created At',
      'gdu_live_test2c',
      'hash_test_2c_before_created_at',
      array['workspace:read']::text[],
      'active',
      v_now,
      v_now - interval '1 day'
    );
  exception
    when check_violation then
      v_err := true;
  end;

  if not v_err then
    raise exception 'Test 2c failed: api_keys_expires_at_check permitiu expires_at < created_at';
  end if;
end;
$$;

-- 2d: Permite expiração exatamente em created_at + 365 days
do $$
declare
  v_inserted integer := 0;
  v_now timestamptz := now();
begin
  insert into public.api_keys (
    organization_id, workspace_id, user_id, name, prefix, key_hash, scopes, status, created_at, expires_at
  ) values (
    'a0000000-0000-4000-8000-000000000010'::uuid,
    'a0000000-0000-4000-8000-000000000011'::uuid,
    'a0000000-0000-4000-8000-000000000031'::uuid,
    'Test Exactly 365 Days',
    'gdu_live_test2d',
    'hash_test_2d_exact_365',
    array['workspace:read']::text[],
    'active',
    v_now,
    v_now + interval '365 days'
  );
  get diagnostics v_inserted = row_count;

  if v_inserted <> 1 then
    raise exception 'Test 2d failed: insert com expires_at = created_at + 365 days falhou';
  end if;
end;
$$;

rollback;

-- ----------------------------------------------------------------------------
-- Test 3: private.resolve_api_key(p_key_hash) comportamento e isolamento
-- ----------------------------------------------------------------------------
begin;

-- Cria duas chaves de teste
alter table public.api_keys no force row level security;
alter table public.api_keys disable row level security;

insert into public.api_keys (
  id, organization_id, workspace_id, user_id, name, prefix, key_hash, scopes, status, expires_at
) values (
  'c0000000-0000-4000-8000-000000000001'::uuid,
  'a0000000-0000-4000-8000-000000000010'::uuid,
  'a0000000-0000-4000-8000-000000000011'::uuid,
  'a0000000-0000-4000-8000-000000000031'::uuid,
  'Key Resolver Test 1',
  'gdu_live_test3_1',
  'hash_adr0009_test_resolve_target',
  array['workspace:read', 'modules:read']::text[],
  'active',
  now() + interval '30 days'
), (
  'c0000000-0000-4000-8000-000000000002'::uuid,
  'a0000000-0000-4000-8000-000000000020'::uuid,
  'a0000000-0000-4000-8000-000000000021'::uuid,
  'a0000000-0000-4000-8000-000000000032'::uuid,
  'Key Resolver Test 2',
  'gdu_live_test3_2',
  'hash_adr0009_test_resolve_other',
  array['workspace:read', 'members:read']::text[],
  'active',
  now() + interval '60 days'
);

alter table public.api_keys enable row level security;
alter table public.api_keys force row level security;

-- Transiciona para app_runtime SEM nenhum contexto prévio de workspace/org
select set_config('app.user_id', '', true);
select set_config('app.workspace_id', '', true);
select set_config('app.organization_id', '', true);
set local role app_runtime;

-- 3a: Busca por hash válido retorna exatamente 1 linha correspondente
do $$
declare
  v_rec record;
  v_count integer := 0;
begin
  for v_rec in select * from private.resolve_api_key('hash_adr0009_test_resolve_target') loop
    v_count := v_count + 1;
    if v_rec.id <> 'c0000000-0000-4000-8000-000000000001'::uuid then
      raise exception 'Test 3a failed: ID retornado incorreto (%)', v_rec.id;
    end if;
    if v_rec.workspace_id <> 'a0000000-0000-4000-8000-000000000011'::uuid then
      raise exception 'Test 3a failed: workspace_id incorreto (%)', v_rec.workspace_id;
    end if;
    if v_rec.scopes <> array['workspace:read', 'modules:read']::text[] then
      raise exception 'Test 3a failed: scopes incorretos (%)', v_rec.scopes;
    end if;
    if v_rec.status <> 'active' then
      raise exception 'Test 3a failed: status incorreto (%)', v_rec.status;
    end if;
  end loop;

  if v_count <> 1 then
    raise exception 'Test 3a failed: esperado 1 registro para hash válido, obtido %', v_count;
  end if;
end;
$$;

-- 3b: Busca por hash inexistente retorna exatamente 0 linhas
do $$
declare
  v_count integer;
begin
  select count(*) into v_count
  from private.resolve_api_key('hash_that_does_not_exist_999999');

  if v_count <> 0 then
    raise exception 'Test 3b failed: hash inexistente retornou % linhas, esperado 0', v_count;
  end if;
end;
$$;

-- 3c: Busca por hash nulo ou string vazia retorna 0 linhas
do $$
declare
  v_count_null integer;
  v_count_empty integer;
begin
  select count(*) into v_count_null
  from private.resolve_api_key(null);

  select count(*) into v_count_empty
  from private.resolve_api_key('');

  if v_count_null <> 0 or v_count_empty <> 0 then
    raise exception 'Test 3c failed: hash nulo ou vazio retornou linhas (null: %, empty: %)',
      v_count_null, v_count_empty;
  end if;
end;
$$;

rollback;

-- ----------------------------------------------------------------------------
-- Test 4: app_runtime não consegue ler public.api_keys via SELECT direto sem contexto
-- ----------------------------------------------------------------------------
begin;

-- Cria uma chave no banco
alter table public.api_keys no force row level security;
alter table public.api_keys disable row level security;

insert into public.api_keys (
  id, organization_id, workspace_id, user_id, name, prefix, key_hash, scopes, status, expires_at
) values (
  'c0000000-0000-4000-8000-000000000003'::uuid,
  'a0000000-0000-4000-8000-000000000010'::uuid,
  'a0000000-0000-4000-8000-000000000011'::uuid,
  'a0000000-0000-4000-8000-000000000031'::uuid,
  'Direct Select Key',
  'gdu_live_test4',
  'hash_adr0009_direct_select_probe',
  array['workspace:read']::text[],
  'active',
  now() + interval '30 days'
);

alter table public.api_keys enable row level security;
alter table public.api_keys force row level security;

-- Transiciona para app_runtime SEM contexto de workspace
select set_config('app.user_id', '', true);
select set_config('app.workspace_id', '', true);
select set_config('app.organization_id', '', true);
set local role app_runtime;

-- 4a: SELECT direto sem contexto retorna 0 linhas (RLS bloqueia totalmente)
do $$
declare
  v_count integer;
begin
  select count(*) into v_count from public.api_keys;

  if v_count <> 0 then
    raise exception 'Test 4a failed: app_runtime conseguiu ler % chaves sem contexto de workspace!', v_count;
  end if;
end;
$$;

-- 4b: SELECT direto filtrando pelo key_hash sem contexto também retorna 0 linhas
do $$
declare
  v_count integer;
begin
  select count(*) into v_count
  from public.api_keys
  where key_hash = 'hash_adr0009_direct_select_probe';

  if v_count <> 0 then
    raise exception 'Test 4b failed: app_runtime conseguiu ler chave por hash sem contexto de workspace via SELECT direto!';
  end if;
end;
$$;

-- 4c: Chamada a private.resolve_api_key funciona e retorna a linha desejada
do $$
declare
  v_count integer;
begin
  select count(*) into v_count
  from private.resolve_api_key('hash_adr0009_direct_select_probe');

  if v_count <> 1 then
    raise exception 'Test 4c failed: resolve_api_key deveria retornar 1 linha para o hash sob app_runtime, obtido %', v_count;
  end if;
end;
$$;

rollback;

-- ----------------------------------------------------------------------------
-- Test 5: Propriedades de segurança, dono e privilégios das funções e tabelas
-- ----------------------------------------------------------------------------
do $$
declare
  v_func_owner text;
  v_is_secdef boolean;
  v_tbl_owner text;
  v_rls_enabled boolean;
  v_rls_forced boolean;
  v_can_app_runtime_exec boolean;
  v_can_anon_exec boolean;
  v_can_auth_exec boolean;
begin
  -- 5a: Owner de private.resolve_api_key deve ser app_rls_helper
  select r.rolname, p.prosecdef
  into v_func_owner, v_is_secdef
  from pg_proc p
  join pg_roles r on r.oid = p.proowner
  where p.proname = 'resolve_api_key'
    and p.pronamespace = 'private'::regnamespace;

  if v_func_owner <> 'app_rls_helper' then
    raise exception 'Test 5a failed: dono de private.resolve_api_key é %, esperado app_rls_helper', v_func_owner;
  end if;

  if not v_is_secdef then
    raise exception 'Test 5a failed: private.resolve_api_key não é SECURITY DEFINER';
  end if;

  -- 5b: Execução de private.resolve_api_key concedida a app_runtime, revogada de anon e authenticated
  v_can_app_runtime_exec := has_function_privilege('app_runtime', 'private.resolve_api_key(text)', 'execute');
  v_can_anon_exec := has_function_privilege('anon', 'private.resolve_api_key(text)', 'execute');
  v_can_auth_exec := has_function_privilege('authenticated', 'private.resolve_api_key(text)', 'execute');

  if not v_can_app_runtime_exec then
    raise exception 'Test 5b failed: app_runtime não tem privilégio EXECUTE em private.resolve_api_key';
  end if;

  if v_can_anon_exec then
    raise exception 'Test 5b failed: anon tem privilégio EXECUTE em private.resolve_api_key';
  end if;

  if v_can_auth_exec then
    raise exception 'Test 5b failed: authenticated tem privilégio EXECUTE em private.resolve_api_key';
  end if;

  -- 5c: Tabela public.api_keys pertence a app_migrations com RLS forçada
  select r.rolname, c.relrowsecurity, c.relforcerowsecurity
  into v_tbl_owner, v_rls_enabled, v_rls_forced
  from pg_class c
  join pg_roles r on r.oid = c.relowner
  where c.relname = 'api_keys'
    and c.relnamespace = 'public'::regnamespace;

  if v_tbl_owner <> 'app_migrations' then
    raise exception 'Test 5c failed: dono de public.api_keys é %, esperado app_migrations', v_tbl_owner;
  end if;

  if not v_rls_enabled or not v_rls_forced then
    raise exception 'Test 5c failed: public.api_keys sem RLS habilitada (%) ou forçada (%)',
      v_rls_enabled, v_rls_forced;
  end if;
end;
$$;
