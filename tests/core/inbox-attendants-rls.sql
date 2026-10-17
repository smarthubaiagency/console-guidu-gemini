-- ============================================================================
-- SQL IN4a: the attendant mark of the Inbox and the level of each person.
--   workspace A a…011 (org a…010): owner a…031, viewer a…033
--   workspace B a…021 (org a…020): owner a…032
-- Fixtures add an editor (…e4) and an Attendant (…e5) to A. Each block
-- prepares as administrator, switches role with `set local role` and rolls
-- back.
-- ============================================================================

create or replace function pg_temp.ctx(p_user uuid, p_ws uuid, p_org uuid)
returns void
language sql as $$
  select set_config('app.user_id', coalesce(p_user::text, ''), true),
         set_config('app.workspace_id', coalesce(p_ws::text, ''), true),
         set_config('app.organization_id', coalesce(p_org::text, ''), true),
         set_config('app.partner_id', '', true);
$$;

create or replace function pg_temp.fixture() returns void
language sql as $$
  insert into auth.users (id, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
  values
    ('1a400000-0000-4000-8000-0000000000e4', 'in4a-editor@test.guidu.co', '', now(), '{}', '{}', now(), now()),
    ('1a400000-0000-4000-8000-0000000000e5', 'in4a-attendant@test.guidu.co', '', now(), '{}', '{}', now(), now());
  insert into public.profiles (id, full_name, status)
  values
    ('1a400000-0000-4000-8000-0000000000e4', 'Editor IN4a', 'active'),
    ('1a400000-0000-4000-8000-0000000000e5', 'Atendente IN4a', 'active');
  insert into public.organization_members (organization_id, user_id, role, status)
  values
    ('a0000000-0000-4000-8000-000000000010', '1a400000-0000-4000-8000-0000000000e4', 'member', 'active'),
    ('a0000000-0000-4000-8000-000000000010', '1a400000-0000-4000-8000-0000000000e5', 'member', 'active');
  insert into public.workspace_members (workspace_id, organization_id, user_id, role, status)
  values
    ('a0000000-0000-4000-8000-000000000011', 'a0000000-0000-4000-8000-000000000010',
     '1a400000-0000-4000-8000-0000000000e4', 'editor', 'active'),
    ('a0000000-0000-4000-8000-000000000011', 'a0000000-0000-4000-8000-000000000010',
     '1a400000-0000-4000-8000-0000000000e5', 'attendant', 'active');
  insert into public.matrix_rooms (id, organization_id, workspace_id, room_id, origin, state)
  values ('1a400000-0000-4000-8000-0000000000a1', 'a0000000-0000-4000-8000-000000000010',
          'a0000000-0000-4000-8000-000000000011', '!in4a-sala-a', 'matrix', 'active');
  insert into public.matrix_workspace_addresses (workspace_id, organization_id, localpart, mxid, state)
  values ('a0000000-0000-4000-8000-000000000011', 'a0000000-0000-4000-8000-000000000010',
          '_guidu_w_abcdefghijklmnop', '@_guidu_w_abcdefghijklmnop:matrix.test', 'active');
$$;

-- ----------------------------------------------------------------------------
-- Test 1: the level follows the role and the mark
-- ----------------------------------------------------------------------------
begin;
do $$
begin
  if private.matrix_access('attendant', false) is distinct from 'reply'
     or private.matrix_access('owner', false) is distinct from 'read'
     or private.matrix_access('admin', true) is distinct from 'reply'
     or private.matrix_access('editor', false) is not null
     or private.matrix_access('editor', true) is distinct from 'reply'
     or private.matrix_access('viewer', true) is not null then
    raise exception 'in4a: matrix_access does not follow the decision of 17/10/2026';
  end if;
end
$$;
select pg_temp.fixture();
set local role app_worker;
do $$
declare
  v_levels jsonb;
begin
  select jsonb_object_agg(user_id::text, coalesce(access, '-'))
  into v_levels
  from private.matrix_workspace_access('a0000000-0000-4000-8000-000000000011');
  if v_levels->>'a0000000-0000-4000-8000-000000000031' <> 'read'
     or v_levels->>'a0000000-0000-4000-8000-000000000033' <> '-'
     or v_levels->>'1a400000-0000-4000-8000-0000000000e4' <> '-'
     or v_levels->>'1a400000-0000-4000-8000-0000000000e5' <> 'reply' then
    raise exception 'in4a: unexpected levels in A: %', v_levels;
  end if;
  if (select name from private.matrix_workspace_info('a0000000-0000-4000-8000-000000000011')) is null then
    raise exception 'in4a: the worker reads the name of a workspace';
  end if;
end
$$;
reset role;
insert into public.inbox_attendants (workspace_id, organization_id, user_id)
values
  ('a0000000-0000-4000-8000-000000000011', 'a0000000-0000-4000-8000-000000000010', 'a0000000-0000-4000-8000-000000000031'),
  ('a0000000-0000-4000-8000-000000000011', 'a0000000-0000-4000-8000-000000000010', '1a400000-0000-4000-8000-0000000000e4');
set local role app_worker;
do $$
begin
  if exists (
    select 1 from private.matrix_workspace_access('a0000000-0000-4000-8000-000000000011')
    where user_id in ('a0000000-0000-4000-8000-000000000031', '1a400000-0000-4000-8000-0000000000e4')
      and access is distinct from 'reply'
  ) then
    raise exception 'in4a: a marked owner or editor answers';
  end if;
  if (select access from private.matrix_user_access('1a400000-0000-4000-8000-0000000000e4')
      where workspace_id = 'a0000000-0000-4000-8000-000000000011') is distinct from 'reply' then
    raise exception 'in4a: matrix_user_access misses the mark';
  end if;
end
$$;
rollback;

-- ----------------------------------------------------------------------------
-- Test 2: rooms and the address are read by who has a level
-- ----------------------------------------------------------------------------
begin;
select pg_temp.fixture();
set local role app_runtime;
do $$
begin
  -- Owner (read level) and the Attendant read the room and the address.
  perform pg_temp.ctx('a0000000-0000-4000-8000-000000000031', 'a0000000-0000-4000-8000-000000000011',
                      'a0000000-0000-4000-8000-000000000010');
  if (select count(*) from public.matrix_rooms) <> 1
     or (select count(*) from public.matrix_workspace_addresses) <> 1
     or private.inbox_my_level() is distinct from 'read'
     or not private.inbox_my_manages() then
    raise exception 'in4a: the owner reads the Inbox of A and manages it';
  end if;
  perform pg_temp.ctx('1a400000-0000-4000-8000-0000000000e5', 'a0000000-0000-4000-8000-000000000011',
                      'a0000000-0000-4000-8000-000000000010');
  if (select count(*) from public.matrix_rooms) <> 1
     or private.inbox_my_level() is distinct from 'reply'
     or private.inbox_my_manages() then
    raise exception 'in4a: the Attendant answers and does not manage';
  end if;
  -- An unmarked editor does not open the Inbox.
  perform pg_temp.ctx('1a400000-0000-4000-8000-0000000000e4', 'a0000000-0000-4000-8000-000000000011',
                      'a0000000-0000-4000-8000-000000000010');
  if exists (select 1 from public.matrix_rooms)
     or exists (select 1 from public.matrix_workspace_addresses)
     or private.inbox_my_level() is not null then
    raise exception 'in4a: an unmarked editor reads the Inbox';
  end if;
  -- The web never writes an address.
  begin
    insert into public.matrix_workspace_addresses (workspace_id, organization_id, localpart, mxid)
    values ('a0000000-0000-4000-8000-000000000021', 'a0000000-0000-4000-8000-000000000020',
            '_guidu_w_bbbbbbbbbbbbbbbb', '@_guidu_w_bbbbbbbbbbbbbbbb:matrix.test');
    raise exception 'in4a: app_runtime created an address';
  exception when insufficient_privilege then null;
  end;
end
$$;
rollback;

-- ----------------------------------------------------------------------------
-- Test 3: only a manager marks, and only owners, admins and editors
-- ----------------------------------------------------------------------------
begin;
select pg_temp.fixture();
set local role app_runtime;
do $$
begin
  perform pg_temp.ctx('a0000000-0000-4000-8000-000000000031', 'a0000000-0000-4000-8000-000000000011',
                      'a0000000-0000-4000-8000-000000000010');
  insert into public.inbox_attendants (workspace_id, organization_id, user_id, created_by)
  values ('a0000000-0000-4000-8000-000000000011', 'a0000000-0000-4000-8000-000000000010',
          '1a400000-0000-4000-8000-0000000000e4', 'a0000000-0000-4000-8000-000000000031');
  if private.inbox_my_level() is distinct from 'read' then
    raise exception 'in4a: marking someone else changed the owner';
  end if;

  -- The viewer cannot be marked.
  begin
    insert into public.inbox_attendants (workspace_id, organization_id, user_id, created_by)
    values ('a0000000-0000-4000-8000-000000000011', 'a0000000-0000-4000-8000-000000000010',
            'a0000000-0000-4000-8000-000000000033', 'a0000000-0000-4000-8000-000000000031');
    raise exception 'in4a: a viewer was marked';
  exception when insufficient_privilege then null;
  end;

  -- created_by is the person of the context.
  begin
    insert into public.inbox_attendants (workspace_id, organization_id, user_id, created_by)
    values ('a0000000-0000-4000-8000-000000000011', 'a0000000-0000-4000-8000-000000000010',
            'a0000000-0000-4000-8000-000000000031', '1a400000-0000-4000-8000-0000000000e4');
    raise exception 'in4a: a mark was signed by someone else';
  exception when insufficient_privilege then null;
  end;

  -- Owner of A pointed at B.
  perform pg_temp.ctx('a0000000-0000-4000-8000-000000000031', 'a0000000-0000-4000-8000-000000000021',
                      'a0000000-0000-4000-8000-000000000020');
  begin
    insert into public.inbox_attendants (workspace_id, organization_id, user_id, created_by)
    values ('a0000000-0000-4000-8000-000000000021', 'a0000000-0000-4000-8000-000000000020',
            'a0000000-0000-4000-8000-000000000032', 'a0000000-0000-4000-8000-000000000031');
    raise exception 'in4a: owner of A marked someone in B';
  exception when insufficient_privilege then null;
  end;

  -- The marked editor now reads the room, sees its own mark and not others'.
  perform pg_temp.ctx('1a400000-0000-4000-8000-0000000000e4', 'a0000000-0000-4000-8000-000000000011',
                      'a0000000-0000-4000-8000-000000000010');
  if (select count(*) from public.matrix_rooms) <> 1
     or private.inbox_my_level() is distinct from 'reply'
     or (select count(*) from public.inbox_attendants) <> 1 then
    raise exception 'in4a: the marked editor answers and sees only their mark';
  end if;

  -- The editor marks nobody and removes no mark.
  begin
    insert into public.inbox_attendants (workspace_id, organization_id, user_id, created_by)
    values ('a0000000-0000-4000-8000-000000000011', 'a0000000-0000-4000-8000-000000000010',
            'a0000000-0000-4000-8000-000000000031', '1a400000-0000-4000-8000-0000000000e4');
    raise exception 'in4a: an editor marked someone';
  exception when insufficient_privilege then null;
  end;
  delete from public.inbox_attendants;
  if not found then
    null;
  else
    raise exception 'in4a: an editor removed a mark';
  end if;

  -- The owner removes it.
  perform pg_temp.ctx('a0000000-0000-4000-8000-000000000031', 'a0000000-0000-4000-8000-000000000011',
                      'a0000000-0000-4000-8000-000000000010');
  delete from public.inbox_attendants where user_id = '1a400000-0000-4000-8000-0000000000e4';
  if not found then
    raise exception 'in4a: the owner could not remove the mark';
  end if;
end
$$;
rollback;

-- ----------------------------------------------------------------------------
-- Test 4: the account of a person with a level; none without
-- ----------------------------------------------------------------------------
begin;
select pg_temp.fixture();
set local role app_runtime;
do $$
begin
  perform pg_temp.ctx('1a400000-0000-4000-8000-0000000000e4', null, null);
  if private.matrix_my_eligible() then
    raise exception 'in4a: an unmarked editor may have an account';
  end if;
  perform pg_temp.ctx('a0000000-0000-4000-8000-000000000031', null, null);
  if not private.matrix_my_eligible() then
    raise exception 'in4a: the owner (read level) may have an account';
  end if;
end
$$;
rollback;
