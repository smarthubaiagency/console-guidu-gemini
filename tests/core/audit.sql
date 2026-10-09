-- ============================================================================
-- SQL Audit Trail Verification (Spec §6, §16, §20, §24 AC14 & ADR 0009)
-- Module: Append-Only Audit Events Security & RLS Contract
--
-- Executed as migration administrator (or test runner) with transaction rollbacks.
-- Context is switched to `app_runtime` under `set local role app_runtime`.
-- Every mutation is rolled back; all checks use count(*) and raise exceptions on failure.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- Test 1: app_runtime executa INSERT válido dentro do contexto
-- ----------------------------------------------------------------------------
begin;
set local role app_runtime;
select set_config('app.user_id', 'a0000000-0000-4000-8000-000000000031', true);
select set_config('app.workspace_id', 'a0000000-0000-4000-8000-000000000011', true);
select set_config('app.organization_id', 'a0000000-0000-4000-8000-000000000010', true);

do $$
declare
  v_inserted integer := 0;
begin
  insert into public.audit_events (
    organization_id,
    workspace_id,
    actor_user_id,
    actor_principal_type,
    origin,
    action,
    resource_type,
    resource_id,
    result,
    metadata
  ) values (
    'a0000000-0000-4000-8000-000000000010'::uuid,
    'a0000000-0000-4000-8000-000000000011'::uuid,
    'a0000000-0000-4000-8000-000000000031'::uuid,
    'user',
    'app',
    'credentials.created',
    'credential',
    'c0000000-0000-4000-8000-000000000001',
    'success',
    '{"provider": "openai", "purpose": "chat", "maskedValue": "sk-...1234"}'::jsonb
  );
  get diagnostics v_inserted = row_count;

  if v_inserted <> 1 then
    raise exception 'Test 1 failed: app_runtime não conseguiu inserir evento válido de auditoria';
  end if;
end;
$$;
rollback;

-- ----------------------------------------------------------------------------
-- Test 2: app_runtime não tem privilégio de SELECT (falha esperada)
-- ----------------------------------------------------------------------------
begin;
set local role app_runtime;
select set_config('app.user_id', 'a0000000-0000-4000-8000-000000000031', true);

do $$
declare
  v_err boolean := false;
begin
  begin
    perform count(*) from public.audit_events;
  exception
    when insufficient_privilege then
      v_err := true;
  end;

  if not v_err then
    raise exception 'Test 2 failed: app_runtime conseguiu executar SELECT em public.audit_events!';
  end if;
end;
$$;
rollback;

-- ----------------------------------------------------------------------------
-- Test 3: app_runtime não tem privilégio de UPDATE (falha esperada)
-- ----------------------------------------------------------------------------
begin;
set local role app_runtime;
select set_config('app.user_id', 'a0000000-0000-4000-8000-000000000031', true);

do $$
declare
  v_err boolean := false;
begin
  begin
    update public.audit_events set action = 'tampered' where true;
  exception
    when insufficient_privilege then
      v_err := true;
  end;

  if not v_err then
    raise exception 'Test 3 failed: app_runtime conseguiu executar UPDATE em public.audit_events!';
  end if;
end;
$$;
rollback;

-- ----------------------------------------------------------------------------
-- Test 4: app_runtime não tem privilégio de DELETE (falha esperada)
-- ----------------------------------------------------------------------------
begin;
set local role app_runtime;
select set_config('app.user_id', 'a0000000-0000-4000-8000-000000000031', true);

do $$
declare
  v_err boolean := false;
begin
  begin
    delete from public.audit_events where true;
  exception
    when insufficient_privilege then
      v_err := true;
  end;

  if not v_err then
    raise exception 'Test 4 failed: app_runtime conseguiu executar DELETE em public.audit_events!';
  end if;
end;
$$;
rollback;

-- ----------------------------------------------------------------------------
-- Test 5: UPDATE como app_migrations também falha devido ao trigger append-only (§20)
-- ----------------------------------------------------------------------------
begin;
do $$
declare
  v_id uuid;
  v_err boolean := false;
begin
  insert into public.audit_events (
    organization_id,
    workspace_id,
    actor_user_id,
    actor_principal_type,
    origin,
    action,
    resource_type,
    result
  ) values (
    'a0000000-0000-4000-8000-000000000010'::uuid,
    'a0000000-0000-4000-8000-000000000011'::uuid,
    'a0000000-0000-4000-8000-000000000031'::uuid,
    'user',
    'app',
    'test.mutation',
    'test_resource',
    'success'
  ) returning id into v_id;

  begin
    update public.audit_events
    set action = 'tampered'
    where id = v_id;
  exception
    when others then
      if sqlerrm like '%audit_events is append-only%' then
        v_err := true;
      end if;
  end;

  if not v_err then
    raise exception 'Test 5 failed: UPDATE como app_migrations não foi bloqueado pelo trigger append-only!';
  end if;
end;
$$;
rollback;

-- ----------------------------------------------------------------------------
-- Test 6: DELETE como app_migrations também falha devido ao trigger append-only (§20)
-- ----------------------------------------------------------------------------
begin;
do $$
declare
  v_id uuid;
  v_err boolean := false;
begin
  insert into public.audit_events (
    organization_id,
    workspace_id,
    actor_user_id,
    actor_principal_type,
    origin,
    action,
    resource_type,
    result
  ) values (
    'a0000000-0000-4000-8000-000000000010'::uuid,
    'a0000000-0000-4000-8000-000000000011'::uuid,
    'a0000000-0000-4000-8000-000000000031'::uuid,
    'user',
    'app',
    'test.deletion',
    'test_resource',
    'success'
  ) returning id into v_id;

  begin
    delete from public.audit_events where id = v_id;
  exception
    when others then
      if sqlerrm like '%audit_events is append-only%' then
        v_err := true;
      end if;
  end;

  if not v_err then
    raise exception 'Test 6 failed: DELETE como app_migrations não foi bloqueado pelo trigger append-only!';
  end if;
end;
$$;
rollback;

-- ----------------------------------------------------------------------------
-- Test 7: INSERT com actor_user_id diferente do contexto falha (policy with check)
-- ----------------------------------------------------------------------------
begin;
set local role app_runtime;
select set_config('app.user_id', 'a0000000-0000-4000-8000-000000000031', true);
select set_config('app.workspace_id', 'a0000000-0000-4000-8000-000000000011', true);
select set_config('app.organization_id', 'a0000000-0000-4000-8000-000000000010', true);

do $$
declare
  v_err boolean := false;
begin
  begin
    insert into public.audit_events (
      organization_id,
      workspace_id,
      actor_user_id,
      actor_principal_type,
      origin,
      action,
      resource_type,
      result
    ) values (
      'a0000000-0000-4000-8000-000000000010'::uuid,
      'a0000000-0000-4000-8000-000000000011'::uuid,
      -- Forging user B (32) while context is user A (31)
      'a0000000-0000-4000-8000-000000000032'::uuid,
      'user',
      'app',
      'credentials.created',
      'credential',
      'success'
    );
  exception
    when others then
      v_err := true;
  end;

  if not v_err then
    raise exception 'Test 7 failed: INSERT com actor_user_id forjado não foi bloqueado pela policy!';
  end if;
end;
$$;
rollback;

-- ----------------------------------------------------------------------------
-- Test 8: INSERT com workspace fora do contexto falha (policy with check)
-- ----------------------------------------------------------------------------
begin;
set local role app_runtime;
select set_config('app.user_id', 'a0000000-0000-4000-8000-000000000031', true);
select set_config('app.workspace_id', 'a0000000-0000-4000-8000-000000000011', true);
select set_config('app.organization_id', 'a0000000-0000-4000-8000-000000000010', true);

do $$
declare
  v_err boolean := false;
begin
  begin
    insert into public.audit_events (
      organization_id,
      workspace_id,
      actor_user_id,
      actor_principal_type,
      origin,
      action,
      resource_type,
      result
    ) values (
      'a0000000-0000-4000-8000-000000000010'::uuid,
      -- Forging workspace B (21) while context is workspace A (11)
      'a0000000-0000-4000-8000-000000000021'::uuid,
      'a0000000-0000-4000-8000-000000000031'::uuid,
      'user',
      'app',
      'credentials.created',
      'credential',
      'success'
    );
  exception
    when others then
      v_err := true;
  end;

  if not v_err then
    raise exception 'Test 8 failed: INSERT com workspace_id fora do contexto não foi bloqueado pela policy!';
  end if;
end;
$$;
rollback;

-- ----------------------------------------------------------------------------
-- Test 9: INSERT com occurred_at no passado distante falha (policy with check)
-- ----------------------------------------------------------------------------
begin;
set local role app_runtime;
select set_config('app.user_id', 'a0000000-0000-4000-8000-000000000031', true);
select set_config('app.workspace_id', 'a0000000-0000-4000-8000-000000000011', true);
select set_config('app.organization_id', 'a0000000-0000-4000-8000-000000000010', true);

do $$
declare
  v_err boolean := false;
begin
  begin
    insert into public.audit_events (
      occurred_at,
      organization_id,
      workspace_id,
      actor_user_id,
      actor_principal_type,
      origin,
      action,
      resource_type,
      result
    ) values (
      -- Forging timestamp 1 hour ago
      now() - interval '1 hour',
      'a0000000-0000-4000-8000-000000000010'::uuid,
      'a0000000-0000-4000-8000-000000000011'::uuid,
      'a0000000-0000-4000-8000-000000000031'::uuid,
      'user',
      'app',
      'credentials.created',
      'credential',
      'success'
    );
  exception
    when others then
      v_err := true;
  end;

  if not v_err then
    raise exception 'Test 9 failed: INSERT com occurred_at retrógrado não foi bloqueado pela policy!';
  end if;
end;
$$;
rollback;
