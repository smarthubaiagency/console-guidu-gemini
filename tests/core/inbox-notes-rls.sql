-- ============================================================================
-- SQL IN5a: private notes of the Inbox (inbox_notes).
--   workspace A a…011 (org a…010): owner a…031 (reads only), viewer a…033
--   workspace B a…021 (org a…020): owner a…032
-- Fixtures add two Attendants (…e5, …e6) to A, one room in A and one in B.
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
  values
    ('1a5a0000-0000-4000-8000-0000000000e5', 'in5a-ana@test.guidu.co', '', now(), '{}', '{}', now(), now()),
    ('1a5a0000-0000-4000-8000-0000000000e6', 'in5a-bruno@test.guidu.co', '', now(), '{}', '{}', now(), now());
  insert into public.profiles (id, full_name, status)
  values
    ('1a5a0000-0000-4000-8000-0000000000e5', 'Ana Atendente', 'active'),
    ('1a5a0000-0000-4000-8000-0000000000e6', 'Bruno Atendente', 'active');
  insert into public.organization_members (organization_id, user_id, role, status)
  values
    ('a0000000-0000-4000-8000-000000000010', '1a5a0000-0000-4000-8000-0000000000e5', 'member', 'active'),
    ('a0000000-0000-4000-8000-000000000010', '1a5a0000-0000-4000-8000-0000000000e6', 'member', 'active');
  insert into public.workspace_members (workspace_id, organization_id, user_id, role, status)
  values
    ('a0000000-0000-4000-8000-000000000011', 'a0000000-0000-4000-8000-000000000010',
     '1a5a0000-0000-4000-8000-0000000000e5', 'attendant', 'active'),
    ('a0000000-0000-4000-8000-000000000011', 'a0000000-0000-4000-8000-000000000010',
     '1a5a0000-0000-4000-8000-0000000000e6', 'attendant', 'active');
  insert into public.matrix_rooms (id, organization_id, workspace_id, room_id, origin, state)
  values
    ('1a5a0000-0000-4000-8000-0000000000a1', 'a0000000-0000-4000-8000-000000000010',
     'a0000000-0000-4000-8000-000000000011', '!in5a-a', 'matrix', 'active'),
    ('1a5a0000-0000-4000-8000-0000000000b1', 'a0000000-0000-4000-8000-000000000020',
     'a0000000-0000-4000-8000-000000000021', '!in5a-b', 'matrix', 'active');
  -- A note of Bruno in A and one in B (as administrator).
  insert into public.inbox_notes (id, organization_id, workspace_id, room_id, user_id, body)
  values
    ('1a5a0000-0000-4000-8000-0000000000c1', 'a0000000-0000-4000-8000-000000000010',
     'a0000000-0000-4000-8000-000000000011', '!in5a-a', '1a5a0000-0000-4000-8000-0000000000e6',
     'Nota do Bruno'),
    ('1a5a0000-0000-4000-8000-0000000000c2', 'a0000000-0000-4000-8000-000000000020',
     'a0000000-0000-4000-8000-000000000021', '!in5a-b', 'a0000000-0000-4000-8000-000000000032',
     'Nota de B');
$$;

-- ----------------------------------------------------------------------------
-- Test 1: the text of a note — 1 to 4000 characters; a deleted one keeps none
-- ----------------------------------------------------------------------------
begin;
select pg_temp.fixture();
do $$
begin
  begin
    insert into public.inbox_notes (organization_id, workspace_id, room_id, user_id, body)
    values ('a0000000-0000-4000-8000-000000000010', 'a0000000-0000-4000-8000-000000000011',
            '!in5a-a', '1a5a0000-0000-4000-8000-0000000000e5', '   ');
    raise exception 'in5a: an empty note was kept';
  exception when check_violation then null;
  end;
  begin
    insert into public.inbox_notes (organization_id, workspace_id, room_id, user_id, body)
    values ('a0000000-0000-4000-8000-000000000010', 'a0000000-0000-4000-8000-000000000011',
            '!in5a-a', '1a5a0000-0000-4000-8000-0000000000e5', repeat('a', 4001));
    raise exception 'in5a: a note over 4000 characters was kept';
  exception when check_violation then null;
  end;
  begin
    update public.inbox_notes set deleted_at = now()
    where id = '1a5a0000-0000-4000-8000-0000000000c1';
    raise exception 'in5a: a deleted note kept its text';
  exception when check_violation then null;
  end;
end
$$;
rollback;

-- ----------------------------------------------------------------------------
-- Test 2: who reads and who writes
-- ----------------------------------------------------------------------------
begin;
select pg_temp.fixture();
set local role app_runtime;
do $$
begin
  -- Ana (Attendant of A) writes in a room of A, as herself.
  perform pg_temp.ctx('1a5a0000-0000-4000-8000-0000000000e5', 'a0000000-0000-4000-8000-000000000011',
                      'a0000000-0000-4000-8000-000000000010');
  insert into public.inbox_notes (organization_id, workspace_id, room_id, user_id, body)
  values ('a0000000-0000-4000-8000-000000000010', 'a0000000-0000-4000-8000-000000000011',
          '!in5a-a', '1a5a0000-0000-4000-8000-0000000000e5', 'Cliente prefere WhatsApp à tarde');
  if (select count(*) from public.inbox_notes) <> 2 then
    raise exception 'in5a: the attendant sees only the notes of A';
  end if;
  -- Never as someone else.
  begin
    insert into public.inbox_notes (organization_id, workspace_id, room_id, user_id, body)
    values ('a0000000-0000-4000-8000-000000000010', 'a0000000-0000-4000-8000-000000000011',
            '!in5a-a', '1a5a0000-0000-4000-8000-0000000000e6', 'Em nome do Bruno');
    raise exception 'in5a: a note was written in the name of another';
  exception when insufficient_privilege then null;
  end;
  -- Never in a room of B.
  begin
    insert into public.inbox_notes (organization_id, workspace_id, room_id, user_id, body)
    values ('a0000000-0000-4000-8000-000000000010', 'a0000000-0000-4000-8000-000000000011',
            '!in5a-b', '1a5a0000-0000-4000-8000-0000000000e5', 'Na sala de B');
    raise exception 'in5a: a note was written in a room of B';
  exception when insufficient_privilege then null;
  end;
  -- Never already edited or deleted.
  begin
    insert into public.inbox_notes (organization_id, workspace_id, room_id, user_id, body, edited_at)
    values ('a0000000-0000-4000-8000-000000000010', 'a0000000-0000-4000-8000-000000000011',
            '!in5a-a', '1a5a0000-0000-4000-8000-0000000000e5', 'Já editada', now());
    raise exception 'in5a: the console stamped a new note as edited';
  exception when insufficient_privilege then null;
  end;

  -- The owner of A only reads: sees the notes, writes none.
  perform pg_temp.ctx('a0000000-0000-4000-8000-000000000031', 'a0000000-0000-4000-8000-000000000011',
                      'a0000000-0000-4000-8000-000000000010');
  if (select count(*) from public.inbox_notes) <> 2 then
    raise exception 'in5a: the owner does not read the notes of A';
  end if;
  begin
    insert into public.inbox_notes (organization_id, workspace_id, room_id, user_id, body)
    values ('a0000000-0000-4000-8000-000000000010', 'a0000000-0000-4000-8000-000000000011',
            '!in5a-a', 'a0000000-0000-4000-8000-000000000031', 'Do dono');
    raise exception 'in5a: who only reads wrote a note';
  exception when insufficient_privilege then null;
  end;

  -- The viewer has no level in the Inbox: reads nothing.
  perform pg_temp.ctx('a0000000-0000-4000-8000-000000000033', 'a0000000-0000-4000-8000-000000000011',
                      'a0000000-0000-4000-8000-000000000010');
  if exists (select 1 from public.inbox_notes) then
    raise exception 'in5a: a viewer reads the notes';
  end if;

  -- The owner of B sees only the note of B.
  perform pg_temp.ctx('a0000000-0000-4000-8000-000000000032', 'a0000000-0000-4000-8000-000000000021',
                      'a0000000-0000-4000-8000-000000000020');
  if (select count(*) from public.inbox_notes) <> 1
     or not exists (select 1 from public.inbox_notes where room_id = '!in5a-b') then
    raise exception 'in5a: the notes cross workspaces';
  end if;
end
$$;
rollback;

-- ----------------------------------------------------------------------------
-- Test 3: only the author edits and deletes (softly) a live note
-- ----------------------------------------------------------------------------
begin;
select pg_temp.fixture();
set local role app_runtime;
do $$
declare
  v_count integer;
begin
  -- Ana cannot edit nor delete the note of Bruno.
  perform pg_temp.ctx('1a5a0000-0000-4000-8000-0000000000e5', 'a0000000-0000-4000-8000-000000000011',
                      'a0000000-0000-4000-8000-000000000010');
  update public.inbox_notes set body = 'Mudada pela Ana', edited_at = now()
  where id = '1a5a0000-0000-4000-8000-0000000000c1';
  get diagnostics v_count = row_count;
  if v_count <> 0 then
    raise exception 'in5a: the note of another was edited';
  end if;
  -- Nobody deletes a row from the web.
  begin
    delete from public.inbox_notes where id = '1a5a0000-0000-4000-8000-0000000000c1';
    raise exception 'in5a: a note was deleted for good from the web';
  exception when insufficient_privilege then null;
  end;

  -- Bruno edits his note, then deletes it (softly).
  perform pg_temp.ctx('1a5a0000-0000-4000-8000-0000000000e6', 'a0000000-0000-4000-8000-000000000011',
                      'a0000000-0000-4000-8000-000000000010');
  update public.inbox_notes set body = 'Nota do Bruno, corrigida', edited_at = now()
  where id = '1a5a0000-0000-4000-8000-0000000000c1';
  get diagnostics v_count = row_count;
  if v_count <> 1 then
    raise exception 'in5a: the author could not edit the note';
  end if;
  -- Only the text and the stamps.
  begin
    update public.inbox_notes set room_id = '!in5a-b'
    where id = '1a5a0000-0000-4000-8000-0000000000c1';
    raise exception 'in5a: a note moved to another room';
  exception when insufficient_privilege then null;
  end;
  update public.inbox_notes set body = '', deleted_at = now()
  where id = '1a5a0000-0000-4000-8000-0000000000c1';
  get diagnostics v_count = row_count;
  if v_count <> 1 then
    raise exception 'in5a: the author could not delete the note';
  end if;
  -- A deleted note stays deleted.
  update public.inbox_notes set body = 'De volta', deleted_at = null
  where id = '1a5a0000-0000-4000-8000-0000000000c1';
  get diagnostics v_count = row_count;
  if v_count <> 0 then
    raise exception 'in5a: a deleted note came back';
  end if;
  if not exists (
    select 1 from public.inbox_notes
    where id = '1a5a0000-0000-4000-8000-0000000000c1' and deleted_at is not null and body = ''
  ) then
    raise exception 'in5a: the deleted note is not shown as deleted';
  end if;
end
$$;
rollback;

-- An author who stops answering (unmarked) no longer edits.
begin;
select pg_temp.fixture();
update public.workspace_members set role = 'viewer'
where user_id = '1a5a0000-0000-4000-8000-0000000000e6';
set local role app_runtime;
do $$
declare
  v_count integer;
begin
  perform pg_temp.ctx('1a5a0000-0000-4000-8000-0000000000e6', 'a0000000-0000-4000-8000-000000000011',
                      'a0000000-0000-4000-8000-000000000010');
  update public.inbox_notes set body = 'Ainda posso?', edited_at = now()
  where id = '1a5a0000-0000-4000-8000-0000000000c1';
  get diagnostics v_count = row_count;
  if v_count <> 0 then
    raise exception 'in5a: who no longer answers edited a note';
  end if;
end
$$;
rollback;

-- ----------------------------------------------------------------------------
-- Test 4: the names of the authors, for who has a level only
-- ----------------------------------------------------------------------------
begin;
select pg_temp.fixture();
set local role app_runtime;
do $$
begin
  perform pg_temp.ctx('a0000000-0000-4000-8000-000000000031', 'a0000000-0000-4000-8000-000000000011',
                      'a0000000-0000-4000-8000-000000000010');
  if (select count(*) from private.inbox_note_authors()) <> 1
     or (select full_name from private.inbox_note_authors()) <> 'Bruno Atendente' then
    raise exception 'in5a: the owner does not see the name of the author';
  end if;
  perform pg_temp.ctx('a0000000-0000-4000-8000-000000000033', 'a0000000-0000-4000-8000-000000000011',
                      'a0000000-0000-4000-8000-000000000010');
  if exists (select 1 from private.inbox_note_authors()) then
    raise exception 'in5a: a viewer reads the names of the authors';
  end if;
  if current_setting('app.matrix_lookup', true) = 'on' then
    raise exception 'in5a: the lookup flag stayed on';
  end if;
end
$$;
rollback;

-- ----------------------------------------------------------------------------
-- Test 5: deleting the room or the workspace deletes the notes
-- ----------------------------------------------------------------------------
begin;
select pg_temp.fixture();
delete from public.matrix_rooms where room_id = '!in5a-a';
do $$
begin
  if exists (select 1 from public.inbox_notes where room_id = '!in5a-a') then
    raise exception 'in5a: the notes outlived their room';
  end if;
end
$$;
rollback;

begin;
select pg_temp.fixture();
set local role app_worker;
delete from public.inbox_notes where workspace_id = 'a0000000-0000-4000-8000-000000000021';
do $$
begin
  if exists (select 1 from public.inbox_notes where workspace_id = 'a0000000-0000-4000-8000-000000000021') then
    raise exception 'in5a: the worker could not purge the notes';
  end if;
end
$$;
rollback;
