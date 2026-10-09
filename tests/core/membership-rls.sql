-- ============================================================================
-- SQL RLS & Database Invariant Verification (C08)
-- Module: Membership, RBAC, Credentials & API Keys RLS Boundaries
--
-- Executed as migration administrator (or test runner) with transaction rollbacks.
-- Context is switched to `app_runtime` under `set local role app_runtime`.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- Test 1: viewer não faz UPDATE do próprio papel para owner (exceção esperada)
-- ----------------------------------------------------------------------------
begin;
-- User 33 is viewer in workspace A, but admin in org A in seed.sql.
-- Demote org role to 'member' so actor is pure viewer with no org admin privilege.
update public.organization_members
set role = 'member'
where organization_id = 'a0000000-0000-4000-8000-000000000010'::uuid
  and user_id = 'a0000000-0000-4000-8000-000000000033'::uuid;

set local role app_runtime;
select set_config('app.user_id', 'a0000000-0000-4000-8000-000000000033', true);
select set_config('app.workspace_id', 'a0000000-0000-4000-8000-000000000011', true);
select set_config('app.organization_id', 'a0000000-0000-4000-8000-000000000010', true);

do $$
declare
  v_updated integer := 0;
  v_err boolean := false;
begin
  begin
    update public.workspace_members
    set role = 'owner'
    where workspace_id = 'a0000000-0000-4000-8000-000000000011'::uuid
      and user_id = 'a0000000-0000-4000-8000-000000000033'::uuid;
    get diagnostics v_updated = row_count;
  exception
    when others then
      v_err := true;
  end;

  if not v_err and v_updated > 0 then
    raise exception 'Test 1 failed: viewer foi capaz de atualizar seu papel para owner!';
  end if;

  if (select role from public.workspace_members where user_id = 'a0000000-0000-4000-8000-000000000033'::uuid) = 'owner' then
    raise exception 'Test 1 failed: viewer se tornou owner!';
  end if;
end;
$$;
rollback;

-- Also test: an admin attempting to elevate own role to owner
begin;
set local role app_runtime;
-- User 33 is Org Admin in Org A, viewer in Workspace A in seed.sql
select set_config('app.user_id', 'a0000000-0000-4000-8000-000000000033', true);
select set_config('app.workspace_id', 'a0000000-0000-4000-8000-000000000011', true);
select set_config('app.organization_id', 'a0000000-0000-4000-8000-000000000010', true);

do $$
declare
  v_caught boolean := false;
begin
  begin
    update public.workspace_members
    set role = 'owner'
    where workspace_id = 'a0000000-0000-4000-8000-000000000011'::uuid
      and user_id = 'a0000000-0000-4000-8000-000000000033'::uuid;
  exception
    when sqlstate 'P0001' then
      v_caught := true;
  end;

  if not v_caught then
    raise exception 'Test 1b failed: trigger nao bloqueou auto-escalonamento de papel para owner!';
  end if;
end;
$$;
rollback;

-- ----------------------------------------------------------------------------
-- Test 2: viewer não insere outro membro
-- ----------------------------------------------------------------------------
begin;
update public.organization_members
set role = 'member'
where organization_id = 'a0000000-0000-4000-8000-000000000010'::uuid
  and user_id = 'a0000000-0000-4000-8000-000000000033'::uuid;

set local role app_runtime;
select set_config('app.user_id', 'a0000000-0000-4000-8000-000000000033', true);
select set_config('app.workspace_id', 'a0000000-0000-4000-8000-000000000011', true);
select set_config('app.organization_id', 'a0000000-0000-4000-8000-000000000010', true);

do $$
declare
  v_failed boolean := false;
begin
  begin
    insert into public.workspace_members (workspace_id, organization_id, user_id, role, status)
    values (
      'a0000000-0000-4000-8000-000000000011'::uuid,
      'a0000000-0000-4000-8000-000000000010'::uuid,
      'a0000000-0000-4000-8000-000000000034'::uuid,
      'viewer',
      'active'
    );
  exception
    when others then
      v_failed := true;
  end;

  if not v_failed then
    raise exception 'Test 2 failed: viewer conseguiu inserir outro membro!';
  end if;
end;
$$;
rollback;

-- ----------------------------------------------------------------------------
-- Test 3: editor não remove outro membro; pode remover a si mesmo, se não for o último owner
-- ----------------------------------------------------------------------------
begin;
-- Add user 34 as editor in workspace A and member in org A
update public.organization_members
set role = 'member'
where organization_id = 'a0000000-0000-4000-8000-000000000010'::uuid
  and user_id = 'a0000000-0000-4000-8000-000000000034'::uuid;

insert into public.workspace_members (workspace_id, organization_id, user_id, role, status)
values (
  'a0000000-0000-4000-8000-000000000011'::uuid,
  'a0000000-0000-4000-8000-000000000010'::uuid,
  'a0000000-0000-4000-8000-000000000034'::uuid,
  'editor',
  'active'
);

set local role app_runtime;
select set_config('app.user_id', 'a0000000-0000-4000-8000-000000000034', true);
select set_config('app.workspace_id', 'a0000000-0000-4000-8000-000000000011', true);
select set_config('app.organization_id', 'a0000000-0000-4000-8000-000000000010', true);

do $$
declare
  v_del_count integer;
begin
  -- 3a: Editor tenta remover User 33 (outro membro) -> RLS filtra e deve remover 0 linhas
  delete from public.workspace_members
  where workspace_id = 'a0000000-0000-4000-8000-000000000011'::uuid
    and user_id = 'a0000000-0000-4000-8000-000000000033'::uuid;
  get diagnostics v_del_count = row_count;

  if v_del_count > 0 then
    raise exception 'Test 3a failed: editor conseguiu remover outro membro!';
  end if;

  -- 3b: Editor remove a si mesmo -> permitido por RLS (user_id = app.user_id)
  delete from public.workspace_members
  where workspace_id = 'a0000000-0000-4000-8000-000000000011'::uuid
    and user_id = 'a0000000-0000-4000-8000-000000000034'::uuid;
  get diagnostics v_del_count = row_count;

  if v_del_count <> 1 then
    raise exception 'Test 3b failed: editor nao conseguiu remover a si mesmo! (removidas: %)', v_del_count;
  end if;
end;
$$;
rollback;

-- ----------------------------------------------------------------------------
-- Test 4: último owner do workspace não é removido nem rebaixado
-- ----------------------------------------------------------------------------
begin;
set local role app_runtime;
-- User 31 is the sole owner of Workspace A
select set_config('app.user_id', 'a0000000-0000-4000-8000-000000000031', true);
select set_config('app.workspace_id', 'a0000000-0000-4000-8000-000000000011', true);
select set_config('app.organization_id', 'a0000000-0000-4000-8000-000000000010', true);

do $$
declare
  v_caught_del boolean := false;
  v_caught_upd boolean := false;
begin
  -- 4a: Remover o ultimo owner
  begin
    delete from public.workspace_members
    where workspace_id = 'a0000000-0000-4000-8000-000000000011'::uuid
      and user_id = 'a0000000-0000-4000-8000-000000000031'::uuid;
  exception
    when sqlstate 'P0001' then
      v_caught_del := true;
  end;

  if not v_caught_del then
    raise exception 'Test 4a failed: trigger nao impediu remocao do ultimo owner!';
  end if;

  -- 4b: Rebaixar o ultimo owner para admin
  begin
    update public.workspace_members
    set role = 'admin'
    where workspace_id = 'a0000000-0000-4000-8000-000000000011'::uuid
      and user_id = 'a0000000-0000-4000-8000-000000000031'::uuid;
  exception
    when sqlstate 'P0001' then
      v_caught_upd := true;
  end;

  if not v_caught_upd then
    raise exception 'Test 4b failed: trigger nao impediu rebaixamento do ultimo owner!';
  end if;
end;
$$;
rollback;

-- ----------------------------------------------------------------------------
-- Test 5: auto-inserção sem convite é negada; com convite válido e papel diferente do convite, negada; com convite válido e mesmo papel, aceita
-- ----------------------------------------------------------------------------
begin;
-- Create invitation for user 34 to workspace A with role 'editor'
insert into public.invitations (
  id, organization_id, workspace_id, email, role, token_hash, invited_by_user_id, status, expires_at
) values (
  'e0000000-0000-4000-8000-000000000001'::uuid,
  'a0000000-0000-4000-8000-000000000010'::uuid,
  'a0000000-0000-4000-8000-000000000011'::uuid,
  'user-invite-test@test.guidu.co',
  'editor',
  'valid_test_token_hash_456',
  'a0000000-0000-4000-8000-000000000031'::uuid,
  'pending',
  now() + interval '1 day'
);

-- Demote User 34 in org so not an org admin
update public.organization_members
set role = 'member'
where organization_id = 'a0000000-0000-4000-8000-000000000010'::uuid
  and user_id = 'a0000000-0000-4000-8000-000000000034'::uuid;

set local role app_runtime;
select set_config('app.user_id', 'a0000000-0000-4000-8000-000000000034', true);
select set_config('app.workspace_id', 'a0000000-0000-4000-8000-000000000011', true);
select set_config('app.organization_id', 'a0000000-0000-4000-8000-000000000010', true);

-- 5a: Sem convite (token_hash vazio/nulo) -> negada
do $$
declare
  v_err boolean := false;
begin
  perform set_config('app.invitation_token_hash', '', true);
  begin
    insert into public.workspace_members (workspace_id, organization_id, user_id, role, status)
    values (
      'a0000000-0000-4000-8000-000000000011'::uuid,
      'a0000000-0000-4000-8000-000000000010'::uuid,
      'a0000000-0000-4000-8000-000000000034'::uuid,
      'editor',
      'active'
    );
  exception
    when others then
      v_err := true;
  end;

  if not v_err then
    raise exception 'Test 5a failed: auto-insercao sem convite foi aceita!';
  end if;
end;
$$;

-- 5b: Com convite valido mas papel diferente ('viewer' ao inves de 'editor') -> negada
do $$
declare
  v_err boolean := false;
begin
  perform set_config('app.invitation_token_hash', 'valid_test_token_hash_456', true);
  begin
    insert into public.workspace_members (workspace_id, organization_id, user_id, role, status)
    values (
      'a0000000-0000-4000-8000-000000000011'::uuid,
      'a0000000-0000-4000-8000-000000000010'::uuid,
      'a0000000-0000-4000-8000-000000000034'::uuid,
      'viewer',
      'active'
    );
  exception
    when others then
      v_err := true;
  end;

  if not v_err then
    raise exception 'Test 5b failed: auto-insercao com papel divergente do convite foi aceita!';
  end if;
end;
$$;

-- 5c: Com convite valido e mesmo papel ('editor') -> aceita
do $$
declare
  v_ins_count integer;
begin
  perform set_config('app.invitation_token_hash', 'valid_test_token_hash_456', true);
  insert into public.workspace_members (workspace_id, organization_id, user_id, role, status)
  values (
    'a0000000-0000-4000-8000-000000000011'::uuid,
    'a0000000-0000-4000-8000-000000000010'::uuid,
    'a0000000-0000-4000-8000-000000000034'::uuid,
    'editor',
    'active'
  );
  get diagnostics v_ins_count = row_count;

  if v_ins_count <> 1 then
    raise exception 'Test 5c failed: auto-insercao com convite valido e mesmo papel falhou!';
  end if;
end;
$$;
rollback;

-- ----------------------------------------------------------------------------
-- Test 6: viewer não insere credencial; admin insere
-- ----------------------------------------------------------------------------
begin;
-- Ensure User 33 is pure viewer (member in org A, viewer in ws A)
update public.organization_members
set role = 'member'
where organization_id = 'a0000000-0000-4000-8000-000000000010'::uuid
  and user_id = 'a0000000-0000-4000-8000-000000000033'::uuid;

set local role app_runtime;
select set_config('app.user_id', 'a0000000-0000-4000-8000-000000000033', true);
select set_config('app.workspace_id', 'a0000000-0000-4000-8000-000000000011', true);
select set_config('app.organization_id', 'a0000000-0000-4000-8000-000000000010', true);

-- 6a: Viewer tenta inserir credencial -> negada por RLS
do $$
declare
  v_err boolean := false;
begin
  begin
    insert into public.credentials (
      organization_id, workspace_id, provider, label, masked_value, encrypted_payload
    ) values (
      'a0000000-0000-4000-8000-000000000010'::uuid,
      'a0000000-0000-4000-8000-000000000011'::uuid,
      'openai',
      'Viewer Insecure Credential',
      'sk-...test',
      '{"iv":"abc","data":"def","tag":"ghi"}'
    );
  exception
    when others then
      v_err := true;
  end;

  if not v_err then
    raise exception 'Test 6a failed: viewer conseguiu inserir credencial!';
  end if;
end;
$$;

-- 6b: Admin (User 31, owner/admin) insere credencial -> aceita
select set_config('app.user_id', 'a0000000-0000-4000-8000-000000000031', true);

do $$
declare
  v_ins_count integer;
begin
  insert into public.credentials (
    organization_id, workspace_id, provider, label, masked_value, encrypted_payload
  ) values (
    'a0000000-0000-4000-8000-000000000010'::uuid,
    'a0000000-0000-4000-8000-000000000011'::uuid,
    'openai',
    'Admin Valid Credential',
    'sk-...test',
    '{"iv":"abc","data":"def","tag":"ghi"}'
  );
  get diagnostics v_ins_count = row_count;

  if v_ins_count <> 1 then
    raise exception 'Test 6b failed: admin nao conseguiu inserir credencial!';
  end if;
end;
$$;
rollback;

-- ----------------------------------------------------------------------------
-- Test 7: membro não revoga a chave de outro; admin revoga
-- ----------------------------------------------------------------------------
begin;
-- User 31 creates an API key belonging to User 33
insert into public.api_keys (
  id, organization_id, workspace_id, user_id, name, prefix, key_hash, expires_at, status
) values (
  'c0000000-0000-4000-8000-000000000099'::uuid,
  'a0000000-0000-4000-8000-000000000010'::uuid,
  'a0000000-0000-4000-8000-000000000011'::uuid,
  'a0000000-0000-4000-8000-000000000033'::uuid,
  'User 33 Key',
  'gdu_test',
  'hash_key_user_33_test',
  now() + interval '30 days',
  'active'
);

-- Demote User 34 to regular member in workspace A and org A
update public.organization_members
set role = 'member'
where organization_id = 'a0000000-0000-4000-8000-000000000010'::uuid
  and user_id = 'a0000000-0000-4000-8000-000000000034'::uuid;

insert into public.workspace_members (workspace_id, organization_id, user_id, role, status)
values (
  'a0000000-0000-4000-8000-000000000011'::uuid,
  'a0000000-0000-4000-8000-000000000010'::uuid,
  'a0000000-0000-4000-8000-000000000034'::uuid,
  'viewer',
  'active'
);

set local role app_runtime;
select set_config('app.user_id', 'a0000000-0000-4000-8000-000000000034', true);
select set_config('app.workspace_id', 'a0000000-0000-4000-8000-000000000011', true);
select set_config('app.organization_id', 'a0000000-0000-4000-8000-000000000010', true);

-- 7a: Membro User 34 tenta revogar a chave de User 33 -> RLS nao seleciona a linha (0 afetadas)
do $$
declare
  v_upd_count integer;
begin
  update public.api_keys
  set status = 'revoked'
  where id = 'c0000000-0000-4000-8000-000000000099'::uuid;
  get diagnostics v_upd_count = row_count;

  if v_upd_count > 0 then
    raise exception 'Test 7a failed: membro conseguiu revogar a chave de outro!';
  end if;
end;
$$;

-- 7b: Admin (User 31) revoga a chave de User 33 -> RLS permite (1 afetada)
select set_config('app.user_id', 'a0000000-0000-4000-8000-000000000031', true);

do $$
declare
  v_upd_count integer;
begin
  update public.api_keys
  set status = 'revoked'
  where id = 'c0000000-0000-4000-8000-000000000099'::uuid;
  get diagnostics v_upd_count = row_count;

  if v_upd_count <> 1 then
    raise exception 'Test 7b failed: admin nao conseguiu revogar a chave de outro membro! (afetadas: %)', v_upd_count;
  end if;
end;
$$;
rollback;
