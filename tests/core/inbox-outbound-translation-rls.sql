-- ============================================================================
-- SQL TR3: the team's answer with a translated preview (outbound rows).
--   workspace A a…011 (org a…010): owner a…031 (reads only), viewer a…033
--   workspace B a…021 (org a…020): owner a…032
-- Fixtures add an Attendant (…e6) to A, the Inbox of A with the translation
-- on, a room of the contact in Spanish in A and a room in B. Each block
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
  values ('3e300000-0000-4000-8000-0000000000e6', 'tr3-attendant@test.guidu.co', '', now(), '{}', '{}', now(), now());
  insert into public.profiles (id, full_name, status)
  values ('3e300000-0000-4000-8000-0000000000e6', 'Atendente TR3', 'active');
  insert into public.organization_members (organization_id, user_id, role, status)
  values ('a0000000-0000-4000-8000-000000000010', '3e300000-0000-4000-8000-0000000000e6', 'member', 'active');
  insert into public.workspace_members (workspace_id, organization_id, user_id, role, status)
  values ('a0000000-0000-4000-8000-000000000011', 'a0000000-0000-4000-8000-000000000010',
          '3e300000-0000-4000-8000-0000000000e6', 'attendant', 'active');
  insert into public.workspace_modules (organization_id, workspace_id, module_key, status, updated_by, config)
  values
    ('a0000000-0000-4000-8000-000000000010', 'a0000000-0000-4000-8000-000000000011', 'inbox', 'enabled',
     'a0000000-0000-4000-8000-000000000031',
     '{"translation": {"enabled": true, "primary": "google", "fallback": null, "glossary": []}}'),
    ('a0000000-0000-4000-8000-000000000020', 'a0000000-0000-4000-8000-000000000021', 'inbox', 'enabled',
     'a0000000-0000-4000-8000-000000000032', '{}')
  on conflict (workspace_id, module_key) do update
    set status = 'enabled', updated_by = excluded.updated_by, config = excluded.config;
  insert into public.matrix_rooms (id, organization_id, workspace_id, room_id, origin, state, status,
                                   contact_locale, contact_locale_source, contact_locale_confidence)
  values
    ('3e300000-0000-4000-8000-0000000000b1', 'a0000000-0000-4000-8000-000000000010',
     'a0000000-0000-4000-8000-000000000011', '!tr3-espanhol', 'matrix', 'active', 'open', 'es', 'detected', 0.9),
    ('3e300000-0000-4000-8000-0000000000b2', 'a0000000-0000-4000-8000-000000000020',
     'a0000000-0000-4000-8000-000000000021', '!tr3-sala-b', 'matrix', 'active', 'open', 'es', 'detected', 0.9);
$$;

-- ----------------------------------------------------------------------------
-- Test 1: the Attendant records the sending; once per event; who reads
-- ----------------------------------------------------------------------------
begin;
select pg_temp.fixture();
set local role app_runtime;
do $$
declare
  v_row record;
begin
  perform pg_temp.ctx('3e300000-0000-4000-8000-0000000000e6', 'a0000000-0000-4000-8000-000000000011',
                      'a0000000-0000-4000-8000-000000000010');
  if not private.inbox_translation_record_outbound(
       '!tr3-espanhol', '$tr3-1', 'Temos quarto para duas pessoas.', 'Tenemos habitación para dos personas.',
       'pt-BR', 'es', 'ai', 'gpt-5-nano', false, true) then
    raise exception 'tr3: the sending was not recorded';
  end if;
  -- Once per event: the second call writes nothing.
  if private.inbox_translation_record_outbound(
       '!tr3-espanhol', '$tr3-1', 'Outro texto.', 'Otro texto.', 'pt-BR', 'es', 'google', null, true, false) then
    raise exception 'tr3: an event was recorded twice';
  end if;
  if coalesce(current_setting('app.inbox_translation', true), '') <> '' then
    raise exception 'tr3: app.inbox_translation leaked';
  end if;
  select * into v_row from public.inbox_message_translations where event_id = '$tr3-1';
  if v_row.direction <> 'outbound' or v_row.status <> 'done'
     or v_row.source_text <> 'Temos quarto para duas pessoas.'
     or v_row.translated_text <> 'Tenemos habitación para dos personas.'
     or v_row.source_locale <> 'pt-BR' or v_row.target_locale <> 'es'
     or v_row.engine <> 'ai' or v_row.model <> 'gpt-5-nano'
     or v_row.fallback or not v_row.edited
     or v_row.workspace_id <> 'a0000000-0000-4000-8000-000000000011'
     or v_row.organization_id <> 'a0000000-0000-4000-8000-000000000010' then
    raise exception 'tr3: unexpected row %', row_to_json(v_row);
  end if;
  -- The Attendant reads it.
  if (select count(*) from public.inbox_message_translations where direction = 'outbound') <> 1 then
    raise exception 'tr3: the Attendant does not read the outbound row';
  end if;
  -- The owner (reads only) reads it, and the viewer (no level) and B do not.
  perform pg_temp.ctx('a0000000-0000-4000-8000-000000000031', 'a0000000-0000-4000-8000-000000000011',
                      'a0000000-0000-4000-8000-000000000010');
  if (select count(*) from public.inbox_message_translations where direction = 'outbound') <> 1 then
    raise exception 'tr3: the owner does not read the outbound row';
  end if;
  perform pg_temp.ctx('a0000000-0000-4000-8000-000000000033', 'a0000000-0000-4000-8000-000000000011',
                      'a0000000-0000-4000-8000-000000000010');
  if exists (select 1 from public.inbox_message_translations) then
    raise exception 'tr3: the viewer reads the outbound row';
  end if;
  perform pg_temp.ctx('a0000000-0000-4000-8000-000000000032', 'a0000000-0000-4000-8000-000000000021',
                      'a0000000-0000-4000-8000-000000000020');
  if exists (select 1 from public.inbox_message_translations) then
    raise exception 'tr3: B reads the outbound row of A';
  end if;
  perform pg_temp.ctx(null, null, null);
  if exists (select 1 from public.inbox_message_translations) then
    raise exception 'tr3: the outbound row was read without the app context';
  end if;
end
$$;
rollback;

-- ----------------------------------------------------------------------------
-- Test 2: who may not record
-- ----------------------------------------------------------------------------
begin;
select pg_temp.fixture();
set local role app_runtime;
do $$
begin
  -- The owner only reads (level `read`): not allowed.
  perform pg_temp.ctx('a0000000-0000-4000-8000-000000000031', 'a0000000-0000-4000-8000-000000000011',
                      'a0000000-0000-4000-8000-000000000010');
  begin
    perform private.inbox_translation_record_outbound(
      '!tr3-espanhol', '$tr3-2', 'Olá.', 'Hola.', 'pt-BR', 'es', 'ai', null, false, false);
    raise exception 'tr3: someone who only reads recorded a sending';
  exception when insufficient_privilege then null;
  end;
  -- Someone without a level.
  perform pg_temp.ctx('a0000000-0000-4000-8000-000000000033', 'a0000000-0000-4000-8000-000000000011',
                      'a0000000-0000-4000-8000-000000000010');
  begin
    perform private.inbox_translation_record_outbound(
      '!tr3-espanhol', '$tr3-2', 'Olá.', 'Hola.', 'pt-BR', 'es', 'ai', null, false, false);
    raise exception 'tr3: someone without a level recorded a sending';
  exception when insufficient_privilege then null;
  end;
  -- No context at all.
  perform pg_temp.ctx(null, null, null);
  begin
    perform private.inbox_translation_record_outbound(
      '!tr3-espanhol', '$tr3-2', 'Olá.', 'Hola.', 'pt-BR', 'es', 'ai', null, false, false);
    raise exception 'tr3: a sending was recorded without the app context';
  exception when insufficient_privilege then null;
  end;
  -- The Attendant of A, in a room of B or in an unknown one.
  perform pg_temp.ctx('3e300000-0000-4000-8000-0000000000e6', 'a0000000-0000-4000-8000-000000000011',
                      'a0000000-0000-4000-8000-000000000010');
  begin
    perform private.inbox_translation_record_outbound(
      '!tr3-sala-b', '$tr3-2', 'Olá.', 'Hola.', 'pt-BR', 'es', 'ai', null, false, false);
    raise exception 'tr3: a sending was recorded in a room of another workspace';
  exception when insufficient_privilege then null;
  end;
  begin
    perform private.inbox_translation_record_outbound(
      '!desconhecida', '$tr3-2', 'Olá.', 'Hola.', 'pt-BR', 'es', 'ai', null, false, false);
    raise exception 'tr3: a sending was recorded in an unknown room';
  exception when insufficient_privilege then null;
  end;
  -- Invalid arguments.
  begin
    perform private.inbox_translation_record_outbound(
      '!tr3-espanhol', '$tr3-2', 'Olá.', 'Hola.', 'es', 'es', 'ai', null, false, false);
    raise exception 'tr3: the same language on both sides';
  exception when invalid_parameter_value then null;
  end;
  begin
    perform private.inbox_translation_record_outbound(
      '!tr3-espanhol', '$tr3-2', 'Olá.', 'Hola.', 'pt-BR', 'fr', 'ai', null, false, false);
    raise exception 'tr3: an unknown language';
  exception when invalid_parameter_value then null;
  end;
  begin
    perform private.inbox_translation_record_outbound(
      '!tr3-espanhol', '$tr3-2', 'Olá.', 'Hola.', 'pt-BR', 'es', 'deepl', null, false, false);
    raise exception 'tr3: an unknown engine';
  exception when invalid_parameter_value then null;
  end;
  begin
    perform private.inbox_translation_record_outbound(
      '!tr3-espanhol', '$tr3-2', '', 'Hola.', 'pt-BR', 'es', 'ai', null, false, false);
    raise exception 'tr3: an empty original';
  exception when invalid_parameter_value then null;
  end;
  if coalesce(current_setting('app.inbox_translation', true), '') <> '' then
    raise exception 'tr3: app.inbox_translation leaked';
  end if;
end
$$;
reset role;
do $$
begin
  if exists (select 1 from public.inbox_message_translations) then
    raise exception 'tr3: a refused sending left a row';
  end if;
end
$$;
rollback;

-- An event that already has a registration (the TR2 translation of an
-- inbound message) is not recorded again as a sending.
begin;
select pg_temp.fixture();
insert into public.inbox_message_translations
  (organization_id, workspace_id, room_id, event_id, direction, source_locale, target_locale, status)
values ('a0000000-0000-4000-8000-000000000010', 'a0000000-0000-4000-8000-000000000011',
        '!tr3-espanhol', '$tr3-in', 'inbound', 'es', 'pt-BR', 'pending');
set local role app_runtime;
do $$
begin
  perform pg_temp.ctx('3e300000-0000-4000-8000-0000000000e6', 'a0000000-0000-4000-8000-000000000011',
                      'a0000000-0000-4000-8000-000000000010');
  if private.inbox_translation_record_outbound(
       '!tr3-espanhol', '$tr3-in', 'Olá.', 'Hola.', 'pt-BR', 'es', 'ai', null, false, false) then
    raise exception 'tr3: an event with a registration was recorded again';
  end if;
end
$$;
rollback;

-- ----------------------------------------------------------------------------
-- Test 3: the web has no direct write; the constraints of the columns
-- ----------------------------------------------------------------------------
begin;
select pg_temp.fixture();
set local role app_runtime;
do $$
begin
  perform pg_temp.ctx('3e300000-0000-4000-8000-0000000000e6', 'a0000000-0000-4000-8000-000000000011',
                      'a0000000-0000-4000-8000-000000000010');
  begin
    insert into public.inbox_message_translations
      (organization_id, workspace_id, room_id, event_id, direction, source_locale, target_locale,
       status, translated_text, source_text, engine)
    values ('a0000000-0000-4000-8000-000000000010', 'a0000000-0000-4000-8000-000000000011',
            '!tr3-espanhol', '$tr3-x', 'outbound', 'pt-BR', 'es', 'done', 'Hola.', 'Olá.', 'ai');
    raise exception 'tr3: the web inserted an outbound row directly';
  exception when insufficient_privilege then null;
  end;
  if not private.inbox_translation_record_outbound(
       '!tr3-espanhol', '$tr3-3', 'Olá.', 'Hola.', 'pt-BR', 'es', 'ai', null, false, false) then
    raise exception 'tr3: the sending was not recorded';
  end if;
  begin
    update public.inbox_message_translations set translated_text = 'Falso.' where event_id = '$tr3-3';
    raise exception 'tr3: the web changed an outbound row';
  exception when insufficient_privilege then null;
  end;
  begin
    delete from public.inbox_message_translations where event_id = '$tr3-3';
    raise exception 'tr3: the web deleted an outbound row';
  exception when insufficient_privilege then null;
  end;
end
$$;
reset role;
do $$
begin
  -- An outbound row has the original; an inbound one does not, nor "edited".
  begin
    insert into public.inbox_message_translations
      (organization_id, workspace_id, room_id, event_id, direction, target_locale, status, translated_text, engine)
    values ('a0000000-0000-4000-8000-000000000010', 'a0000000-0000-4000-8000-000000000011',
            '!tr3-espanhol', '$tr3-y', 'outbound', 'es', 'done', 'Hola.', 'ai');
    raise exception 'tr3: an outbound row without the original';
  exception when check_violation then null;
  end;
  begin
    insert into public.inbox_message_translations
      (organization_id, workspace_id, room_id, event_id, direction, target_locale, status, source_text)
    values ('a0000000-0000-4000-8000-000000000010', 'a0000000-0000-4000-8000-000000000011',
            '!tr3-espanhol', '$tr3-z', 'inbound', 'pt-BR', 'pending', 'Olá.');
    raise exception 'tr3: an inbound row with an original of the team';
  exception when check_violation then null;
  end;
  begin
    insert into public.inbox_message_translations
      (organization_id, workspace_id, room_id, event_id, direction, target_locale, status, edited)
    values ('a0000000-0000-4000-8000-000000000010', 'a0000000-0000-4000-8000-000000000011',
            '!tr3-espanhol', '$tr3-w', 'inbound', 'pt-BR', 'pending', true);
    raise exception 'tr3: an inbound row marked as edited';
  exception when check_violation then null;
  end;
end
$$;
rollback;

-- ----------------------------------------------------------------------------
-- Test 4: deleting the room deletes the outbound rows; grants of the function
-- ----------------------------------------------------------------------------
begin;
select pg_temp.fixture();
set local role app_runtime;
do $$
begin
  perform pg_temp.ctx('3e300000-0000-4000-8000-0000000000e6', 'a0000000-0000-4000-8000-000000000011',
                      'a0000000-0000-4000-8000-000000000010');
  perform private.inbox_translation_record_outbound(
    '!tr3-espanhol', '$tr3-4', 'Olá.', 'Hola.', 'pt-BR', 'es', 'google', null, true, false);
end
$$;
reset role;
delete from public.matrix_rooms where room_id = '!tr3-espanhol';
do $$
begin
  if exists (select 1 from public.inbox_message_translations) then
    raise exception 'tr3: the outbound rows outlived the room';
  end if;
end
$$;
rollback;

do $$
declare
  v_signature text :=
    'private.inbox_translation_record_outbound(text, text, text, text, text, text, text, text, boolean, boolean)';
begin
  if has_function_privilege('anon', v_signature, 'execute')
     or has_function_privilege('authenticated', v_signature, 'execute') then
    raise exception 'tr3: the function is open to anon or authenticated';
  end if;
  if not has_function_privilege('app_runtime', v_signature, 'execute') then
    raise exception 'tr3: the web cannot call the function';
  end if;
  if has_function_privilege('app_worker', v_signature, 'execute') then
    raise exception 'tr3: the worker may record a sending of the web';
  end if;
  if not (select relrowsecurity and relforcerowsecurity from pg_class
          where oid = 'public.inbox_message_translations'::regclass) then
    raise exception 'tr3: translations without forced RLS';
  end if;
  if has_table_privilege('app_runtime', 'public.inbox_message_translations', 'insert')
     or has_table_privilege('app_runtime', 'public.inbox_message_translations', 'update')
     or has_table_privilege('app_runtime', 'public.inbox_message_translations', 'delete') then
    raise exception 'tr3: the web writes the translations directly';
  end if;
end
$$;
