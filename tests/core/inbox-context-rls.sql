-- ============================================================================
-- SQL IN4b: message marks, labels and the CRM contact of a conversation.
--   workspace A a…011 (org a…010): owner a…031, viewer a…033
--   workspace B a…021 (org a…020): owner a…032
-- Fixtures add an Attendant (…e5) to A and one room in A and one in B.
-- Each block prepares as administrator, switches role and rolls back.
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
  values ('1a4b0000-0000-4000-8000-0000000000e5', 'in4b-attendant@test.guidu.co', '', now(), '{}', '{}', now(), now());
  insert into public.profiles (id, full_name, status)
  values ('1a4b0000-0000-4000-8000-0000000000e5', 'Atendente IN4b', 'active');
  insert into public.organization_members (organization_id, user_id, role, status)
  values ('a0000000-0000-4000-8000-000000000010', '1a4b0000-0000-4000-8000-0000000000e5', 'member', 'active');
  insert into public.workspace_members (workspace_id, organization_id, user_id, role, status)
  values ('a0000000-0000-4000-8000-000000000011', 'a0000000-0000-4000-8000-000000000010',
          '1a4b0000-0000-4000-8000-0000000000e5', 'attendant', 'active');
  insert into public.matrix_rooms (id, organization_id, workspace_id, room_id, origin, state)
  values
    ('1a4b0000-0000-4000-8000-0000000000a1', 'a0000000-0000-4000-8000-000000000010',
     'a0000000-0000-4000-8000-000000000011', '!in4b-a', 'matrix', 'active'),
    ('1a4b0000-0000-4000-8000-0000000000b1', 'a0000000-0000-4000-8000-000000000020',
     'a0000000-0000-4000-8000-000000000021', '!in4b-b', 'matrix', 'active');
  insert into public.inbox_labels (id, organization_id, workspace_id, name)
  values
    ('1a4b0000-0000-4000-8000-0000000000c1', 'a0000000-0000-4000-8000-000000000010',
     'a0000000-0000-4000-8000-000000000011', 'Orçamento'),
    ('1a4b0000-0000-4000-8000-0000000000c2', 'a0000000-0000-4000-8000-000000000020',
     'a0000000-0000-4000-8000-000000000021', 'Outro workspace');
$$;

-- ----------------------------------------------------------------------------
-- Test 1: a message is a mark, never its text
-- ----------------------------------------------------------------------------
begin;
do $$
begin
  begin
    insert into public.matrix_events (event_id, txn_id, room_id, type, sender, content)
    values ('$in4b-body', 't', '!x', 'm.room.message', '@c:matrix.test', '{"body":"segredo"}');
    raise exception 'in4b: a message body was stored';
  exception when check_violation then null;
  end;
  insert into public.matrix_events (event_id, txn_id, room_id, type, sender, content)
  values ('$in4b-mark', 't', '!x', 'm.room.message', '@c:matrix.test', '{"msgtype":"m.text"}');
end
$$;
rollback;

-- ----------------------------------------------------------------------------
-- Test 2: the label catalog is the managers'; labels on rooms, who answers
-- ----------------------------------------------------------------------------
begin;
select pg_temp.fixture();
set local role app_runtime;
do $$
begin
  -- The owner (manager) creates a label; the Attendant cannot.
  perform pg_temp.ctx('a0000000-0000-4000-8000-000000000031', 'a0000000-0000-4000-8000-000000000011',
                      'a0000000-0000-4000-8000-000000000010');
  insert into public.inbox_labels (organization_id, workspace_id, name, created_by)
  values ('a0000000-0000-4000-8000-000000000010', 'a0000000-0000-4000-8000-000000000011',
          'Urgente', 'a0000000-0000-4000-8000-000000000031');
  if (select count(*) from public.inbox_labels) <> 2 then
    raise exception 'in4b: the owner sees only the labels of A';
  end if;
  -- The owner is not an attendant: it puts no label on a conversation.
  begin
    insert into public.inbox_room_labels (room_id, label_id, organization_id, workspace_id, created_by)
    values ('!in4b-a', '1a4b0000-0000-4000-8000-0000000000c1', 'a0000000-0000-4000-8000-000000000010',
            'a0000000-0000-4000-8000-000000000011', 'a0000000-0000-4000-8000-000000000031');
    raise exception 'in4b: a reader put a label';
  exception when insufficient_privilege then null;
  end;

  perform pg_temp.ctx('1a4b0000-0000-4000-8000-0000000000e5', 'a0000000-0000-4000-8000-000000000011',
                      'a0000000-0000-4000-8000-000000000010');
  begin
    insert into public.inbox_labels (organization_id, workspace_id, name, created_by)
    values ('a0000000-0000-4000-8000-000000000010', 'a0000000-0000-4000-8000-000000000011',
            'Do atendente', '1a4b0000-0000-4000-8000-0000000000e5');
    raise exception 'in4b: an attendant created a label';
  exception when insufficient_privilege then null;
  end;
  -- The Attendant labels the room of A, not the room of B.
  insert into public.inbox_room_labels (room_id, label_id, organization_id, workspace_id, created_by)
  values ('!in4b-a', '1a4b0000-0000-4000-8000-0000000000c1', 'a0000000-0000-4000-8000-000000000010',
          'a0000000-0000-4000-8000-000000000011', '1a4b0000-0000-4000-8000-0000000000e5');
  begin
    insert into public.inbox_room_labels (room_id, label_id, organization_id, workspace_id, created_by)
    values ('!in4b-b', '1a4b0000-0000-4000-8000-0000000000c1', 'a0000000-0000-4000-8000-000000000010',
            'a0000000-0000-4000-8000-000000000011', '1a4b0000-0000-4000-8000-0000000000e5');
    raise exception 'in4b: a room of B was labeled from A';
  exception when insufficient_privilege then null;
  end;

  -- The viewer reads nothing.
  perform pg_temp.ctx('a0000000-0000-4000-8000-000000000033', 'a0000000-0000-4000-8000-000000000011',
                      'a0000000-0000-4000-8000-000000000010');
  if exists (select 1 from public.inbox_labels) or exists (select 1 from public.inbox_room_labels) then
    raise exception 'in4b: a viewer reads the labels';
  end if;
end
$$;
rollback;

-- ----------------------------------------------------------------------------
-- Test 3: the contact of a conversation is a contact of the same workspace
-- ----------------------------------------------------------------------------
begin;
select pg_temp.fixture();
insert into public.crm_contacts (id, organization_id, workspace_id, name, created_by)
values
  ('1a4b0000-0000-4000-8000-0000000000d1', 'a0000000-0000-4000-8000-000000000010',
   'a0000000-0000-4000-8000-000000000011', 'Maria', 'a0000000-0000-4000-8000-000000000031'),
  ('1a4b0000-0000-4000-8000-0000000000d2', 'a0000000-0000-4000-8000-000000000020',
   'a0000000-0000-4000-8000-000000000021', 'Contato de B', 'a0000000-0000-4000-8000-000000000032');
insert into public.inbox_conversations (room_id, organization_id, workspace_id, contact_state)
values ('!in4b-a', 'a0000000-0000-4000-8000-000000000010', 'a0000000-0000-4000-8000-000000000011', 'pending');
set local role app_runtime;
do $$
begin
  perform pg_temp.ctx('1a4b0000-0000-4000-8000-0000000000e5', 'a0000000-0000-4000-8000-000000000011',
                      'a0000000-0000-4000-8000-000000000010');
  update public.inbox_conversations
  set contact_id = '1a4b0000-0000-4000-8000-0000000000d1', contact_state = 'linked'
  where room_id = '!in4b-a';
  if not found then
    raise exception 'in4b: the attendant could not link the contact';
  end if;
  begin
    update public.inbox_conversations
    set contact_id = '1a4b0000-0000-4000-8000-0000000000d2'
    where room_id = '!in4b-a';
    raise exception 'in4b: a contact of B was linked in A';
  exception when insufficient_privilege then null;
  end;
end
$$;
rollback;
