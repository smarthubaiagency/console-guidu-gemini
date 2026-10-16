-- ============================================================================
-- SQL RLS verification (AT1): workspace role Atendente (`attendant`)
--
-- Fixture (rolled back with each test): user ...a1 is a company `member` of
-- Organization A and the Attendant of Workspace A (seed.sql). It enters only
-- the dashboard and the Inbox, so the database must:
--   1. accept the role in workspace_members and invitations;
--   2. keep it out of every write that lists roles and out of its own
--      escalation;
--   3. hide BYOK credentials and refuse API keys (migration AT1, item 3);
--   4. still let it read its workspace, like any active member (dashboard).
-- ============================================================================

-- ----------------------------------------------------------------------------
-- Test 1: the role exists in the check constraints; unknown roles do not
-- ----------------------------------------------------------------------------
begin;
insert into auth.users (id, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values ('a0000000-0000-4000-8000-0000000000a1', 'user-attendant@test.guidu.co', '', now(), '{}', '{}', now(), now());
insert into public.profiles (id, full_name, status)
values ('a0000000-0000-4000-8000-0000000000a1', 'User Attendant', 'active');
insert into public.organization_members (organization_id, user_id, role, status)
values ('a0000000-0000-4000-8000-000000000010', 'a0000000-0000-4000-8000-0000000000a1', 'member', 'active');
insert into public.workspace_members (workspace_id, organization_id, user_id, role, status)
values ('a0000000-0000-4000-8000-000000000011', 'a0000000-0000-4000-8000-000000000010', 'a0000000-0000-4000-8000-0000000000a1', 'attendant', 'active');

insert into public.invitations (organization_id, workspace_id, email, role, token_hash, invited_by_user_id, expires_at)
values (
  'a0000000-0000-4000-8000-000000000010',
  'a0000000-0000-4000-8000-000000000011',
  'new-attendant@test.guidu.co',
  'attendant',
  repeat('a', 64),
  'a0000000-0000-4000-8000-000000000031',
  now() + interval '1 day'
);

do $$
declare
  v_caught boolean := false;
begin
  begin
    update public.workspace_members
       set role = 'agent'
     where user_id = 'a0000000-0000-4000-8000-0000000000a1'::uuid;
  exception
    when check_violation then
      v_caught := true;
  end;
  if not v_caught then
    raise exception 'Test 1 failed: workspace_members aceitou um papel desconhecido';
  end if;
end;
$$;
rollback;

-- ----------------------------------------------------------------------------
-- Test 2: the Attendant writes nothing in membership and cannot escalate
-- ----------------------------------------------------------------------------
begin;
insert into auth.users (id, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values ('a0000000-0000-4000-8000-0000000000a1', 'user-attendant@test.guidu.co', '', now(), '{}', '{}', now(), now());
insert into public.profiles (id, full_name, status)
values ('a0000000-0000-4000-8000-0000000000a1', 'User Attendant', 'active');
insert into public.organization_members (organization_id, user_id, role, status)
values ('a0000000-0000-4000-8000-000000000010', 'a0000000-0000-4000-8000-0000000000a1', 'member', 'active');
insert into public.workspace_members (workspace_id, organization_id, user_id, role, status)
values ('a0000000-0000-4000-8000-000000000011', 'a0000000-0000-4000-8000-000000000010', 'a0000000-0000-4000-8000-0000000000a1', 'attendant', 'active');

set local role app_runtime;
select set_config('app.user_id', 'a0000000-0000-4000-8000-0000000000a1', true);
select set_config('app.workspace_id', 'a0000000-0000-4000-8000-000000000011', true);
select set_config('app.organization_id', 'a0000000-0000-4000-8000-000000000010', true);

do $$
declare
  v_caught boolean := false;
begin
  if private.current_workspace_role() is distinct from 'attendant' then
    raise exception 'Test 2 failed: current_workspace_role() não devolveu attendant';
  end if;

  -- Own role: the update policy admits only owner/admin, and the trigger
  -- ranks the Attendant lowest; either way the role must not change.
  begin
    update public.workspace_members
       set role = 'viewer'
     where workspace_id = 'a0000000-0000-4000-8000-000000000011'::uuid
       and user_id = 'a0000000-0000-4000-8000-0000000000a1'::uuid;
  exception
    when others then
      null;
  end;
  if (select role from public.workspace_members
       where workspace_id = 'a0000000-0000-4000-8000-000000000011'::uuid
         and user_id = 'a0000000-0000-4000-8000-0000000000a1'::uuid) <> 'attendant' then
    raise exception 'Test 2 failed: o Atendente trocou o próprio papel';
  end if;

  -- Adding a member is owner/admin only.
  begin
    insert into public.workspace_members (workspace_id, organization_id, user_id, role, status)
    values (
      'a0000000-0000-4000-8000-000000000011',
      'a0000000-0000-4000-8000-000000000010',
      'a0000000-0000-4000-8000-000000000034',
      'attendant',
      'active'
    );
  exception
    when insufficient_privilege then
      v_caught := true;
  end;
  if not v_caught then
    raise exception 'Test 2 failed: o Atendente adicionou um membro ao workspace';
  end if;

  -- Workspace settings and modules are written by owner/admin only.
  v_caught := false;
  begin
    insert into public.workspace_modules (workspace_id, organization_id, module_key, status)
    values (
      'a0000000-0000-4000-8000-000000000011',
      'a0000000-0000-4000-8000-000000000010',
      'hello-world',
      'enabled'
    );
  exception
    when insufficient_privilege then
      v_caught := true;
  end;
  if not v_caught then
    raise exception 'Test 2 failed: o Atendente habilitou um módulo';
  end if;
end;
$$;
rollback;

-- ----------------------------------------------------------------------------
-- Test 3: no BYOK credential and no API key for the Attendant; the viewer
-- keeps what it had
-- ----------------------------------------------------------------------------
begin;
insert into auth.users (id, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values ('a0000000-0000-4000-8000-0000000000a1', 'user-attendant@test.guidu.co', '', now(), '{}', '{}', now(), now());
insert into public.profiles (id, full_name, status)
values ('a0000000-0000-4000-8000-0000000000a1', 'User Attendant', 'active');
insert into public.organization_members (organization_id, user_id, role, status)
values ('a0000000-0000-4000-8000-000000000010', 'a0000000-0000-4000-8000-0000000000a1', 'member', 'active');
insert into public.workspace_members (workspace_id, organization_id, user_id, role, status)
values ('a0000000-0000-4000-8000-000000000011', 'a0000000-0000-4000-8000-000000000010', 'a0000000-0000-4000-8000-0000000000a1', 'attendant', 'active');
insert into public.credentials (organization_id, workspace_id, provider, label, masked_value, encrypted_payload)
values (
  'a0000000-0000-4000-8000-000000000010',
  'a0000000-0000-4000-8000-000000000011',
  'openai',
  'AT1 credential',
  'sk-...abcd',
  'v1:ciphertext'
);
-- User 36 is a pure viewer of Workspace A (company role lowered to member).
update public.organization_members
   set role = 'member'
 where organization_id = 'a0000000-0000-4000-8000-000000000010'::uuid
   and user_id = 'a0000000-0000-4000-8000-000000000036'::uuid;
update public.profiles
   set status = 'active'
 where id = 'a0000000-0000-4000-8000-000000000036'::uuid;

set local role app_runtime;
select set_config('app.workspace_id', 'a0000000-0000-4000-8000-000000000011', true);
select set_config('app.organization_id', 'a0000000-0000-4000-8000-000000000010', true);

select set_config('app.user_id', 'a0000000-0000-4000-8000-0000000000a1', true);
do $$
declare
  v_caught boolean := false;
begin
  if (select count(*) from public.credentials) <> 0 then
    raise exception 'Test 3 failed: o Atendente leu credenciais BYOK';
  end if;

  begin
    insert into public.api_keys (organization_id, workspace_id, user_id, name, prefix, key_hash, scopes, expires_at)
    values (
      'a0000000-0000-4000-8000-000000000010',
      'a0000000-0000-4000-8000-000000000011',
      'a0000000-0000-4000-8000-0000000000a1',
      'AT1 key',
      'gdu_at1',
      repeat('b', 64),
      array['workspace:read'],
      now() + interval '30 days'
    );
  exception
    when insufficient_privilege then
      v_caught := true;
  end;
  if not v_caught then
    raise exception 'Test 3 failed: o Atendente criou uma chave de API';
  end if;
end;
$$;

select set_config('app.user_id', 'a0000000-0000-4000-8000-000000000036', true);
do $$
begin
  if (select count(*) from public.credentials) <> 1 then
    raise exception 'Test 3 failed: o viewer deixou de ver a credencial mascarada';
  end if;
end;
$$;
rollback;

-- ----------------------------------------------------------------------------
-- Test 4: the Attendant still reads its workspace (dashboard), not others
-- ----------------------------------------------------------------------------
begin;
insert into auth.users (id, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values ('a0000000-0000-4000-8000-0000000000a1', 'user-attendant@test.guidu.co', '', now(), '{}', '{}', now(), now());
insert into public.profiles (id, full_name, status)
values ('a0000000-0000-4000-8000-0000000000a1', 'User Attendant', 'active');
insert into public.organization_members (organization_id, user_id, role, status)
values ('a0000000-0000-4000-8000-000000000010', 'a0000000-0000-4000-8000-0000000000a1', 'member', 'active');
insert into public.workspace_members (workspace_id, organization_id, user_id, role, status)
values ('a0000000-0000-4000-8000-000000000011', 'a0000000-0000-4000-8000-000000000010', 'a0000000-0000-4000-8000-0000000000a1', 'attendant', 'active');

set local role app_runtime;
select set_config('app.user_id', 'a0000000-0000-4000-8000-0000000000a1', true);
select set_config('app.workspace_id', 'a0000000-0000-4000-8000-000000000011', true);
select set_config('app.organization_id', 'a0000000-0000-4000-8000-000000000010', true);

do $$
begin
  if (select count(*) from public.workspaces) <> 1 then
    raise exception 'Test 4 failed: o Atendente deveria ver só o próprio workspace';
  end if;
  if (select count(*) from public.workspaces
       where id = 'a0000000-0000-4000-8000-000000000021'::uuid) <> 0 then
    raise exception 'Test 4 failed: o Atendente viu o workspace de outra empresa';
  end if;
end;
$$;
rollback;
