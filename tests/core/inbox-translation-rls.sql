-- ============================================================================
-- SQL TR2: translation of the messages of the Inbox.
--   workspace A a…011 (org a…010): owner a…031, viewer a…033
--   workspace B a…021 (org a…020): owner a…032
-- Fixtures add an Attendant (…e5) to A, the Inbox of A with the translation
-- on (saved by the owner), the Inbox of B without it, a room of the contact
-- in Spanish in A and a room in B. Each block prepares as administrator,
-- switches role with `set local role` and rolls back.
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
  values ('2e200000-0000-4000-8000-0000000000e5', 'tr2-attendant@test.guidu.co', '', now(), '{}', '{}', now(), now());
  insert into public.profiles (id, full_name, status)
  values ('2e200000-0000-4000-8000-0000000000e5', 'Atendente TR2', 'active');
  insert into public.organization_members (organization_id, user_id, role, status)
  values ('a0000000-0000-4000-8000-000000000010', '2e200000-0000-4000-8000-0000000000e5', 'member', 'active');
  insert into public.workspace_members (workspace_id, organization_id, user_id, role, status)
  values ('a0000000-0000-4000-8000-000000000011', 'a0000000-0000-4000-8000-000000000010',
          '2e200000-0000-4000-8000-0000000000e5', 'attendant', 'active');
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
    ('2e200000-0000-4000-8000-0000000000b1', 'a0000000-0000-4000-8000-000000000010',
     'a0000000-0000-4000-8000-000000000011', '!tr2-espanhol', 'matrix', 'active', 'open', 'es', 'detected', 0.9),
    ('2e200000-0000-4000-8000-0000000000b2', 'a0000000-0000-4000-8000-000000000010',
     'a0000000-0000-4000-8000-000000000011', '!tr2-sem-idioma', 'matrix', 'active', 'open', null, null, null),
    ('2e200000-0000-4000-8000-0000000000b3', 'a0000000-0000-4000-8000-000000000020',
     'a0000000-0000-4000-8000-000000000021', '!tr2-sala-b', 'matrix', 'active', 'open', 'es', 'detected', 0.9);
$$;

-- ----------------------------------------------------------------------------
-- Test 1: the worker enqueues one run per message in another language
-- ----------------------------------------------------------------------------
begin;
select pg_temp.fixture();
set local role app_worker;
do $$
declare
  v_first uuid;
begin
  v_first := private.inbox_translation_enqueue('!tr2-espanhol', '$tr2-1', 'es');
  if v_first is null then
    raise exception 'tr2: a Spanish message was not enqueued';
  end if;
  if private.inbox_translation_enqueue('!tr2-espanhol', '$tr2-1', 'es') is not null then
    raise exception 'tr2: the same message enqueued twice';
  end if;
  -- Without a guess, the contact's language decides.
  if private.inbox_translation_enqueue('!tr2-espanhol', '$tr2-2', null) is null then
    raise exception 'tr2: the contact''s language did not decide';
  end if;
  -- The team's language (the workspace's, pt-BR here) is not translated.
  if private.inbox_translation_enqueue('!tr2-espanhol', '$tr2-3', 'pt-BR') is not null then
    raise exception 'tr2: a message in the team''s language was enqueued';
  end if;
  -- Unknown language: nothing.
  if private.inbox_translation_enqueue('!tr2-sem-idioma', '$tr2-4', null) is not null then
    raise exception 'tr2: a message of unknown language was enqueued';
  end if;
  -- Translation off in B; unknown rooms.
  if private.inbox_translation_enqueue('!tr2-sala-b', '$tr2-5', 'es') is not null then
    raise exception 'tr2: B has the translation off';
  end if;
  if private.inbox_translation_enqueue('!desconhecida', '$tr2-6', 'es') is not null then
    raise exception 'tr2: an unknown room was enqueued';
  end if;
  if coalesce(current_setting('app.inbox_translation', true), '') <> '' then
    raise exception 'tr2: app.inbox_translation leaked';
  end if;
end
$$;
reset role;
do $$
declare
  v_run record;
begin
  if (select count(*) from public.job_runs where kind = 'inbox.translate-message') <> 2 then
    raise exception 'tr2: expected two runs';
  end if;
  select * into v_run from public.job_runs
  where kind = 'inbox.translate-message' and payload->>'eventId' = '$tr2-1';
  if v_run.scope <> 'workspace'
     or v_run.requested_by <> 'a0000000-0000-4000-8000-000000000031'
     or v_run.workspace_id <> 'a0000000-0000-4000-8000-000000000011'
     or v_run.payload <> jsonb_build_object('roomId', '!tr2-espanhol', 'eventId', '$tr2-1')
     or v_run.max_attempts <> 3 then
    raise exception 'tr2: unexpected run %', row_to_json(v_run);
  end if;
  if (select count(*) from public.inbox_message_translations
      where status = 'pending' and source_locale = 'es' and target_locale = 'pt-BR'
        and direction = 'inbound' and translated_text is null) <> 2 then
    raise exception 'tr2: the pending rows were not written';
  end if;
end
$$;
rollback;

-- With the workspace in English, a message in English is not translated
-- and one in Portuguese goes to English.
begin;
select pg_temp.fixture();
update public.workspaces set default_locale = 'en' where id = 'a0000000-0000-4000-8000-000000000011';
set local role app_worker;
do $$
begin
  if private.inbox_translation_enqueue('!tr2-espanhol', '$tr2-en', 'en') is not null then
    raise exception 'tr2: English in an English workspace';
  end if;
  if private.inbox_translation_enqueue('!tr2-espanhol', '$tr2-pt', 'pt-BR') is null then
    raise exception 'tr2: Portuguese in an English workspace';
  end if;
  if (select target_locale from public.inbox_message_translations where event_id = '$tr2-pt') <> 'en' then
    raise exception 'tr2: the target is the workspace''s language';
  end if;
end
$$;
rollback;

-- The web may not enqueue nor write a translation.
begin;
select pg_temp.fixture();
set local role app_runtime;
do $$
begin
  perform pg_temp.ctx('a0000000-0000-4000-8000-000000000031', 'a0000000-0000-4000-8000-000000000011',
                      'a0000000-0000-4000-8000-000000000010');
  begin
    perform private.inbox_translation_enqueue('!tr2-espanhol', '$tr2-1', 'es');
    raise exception 'tr2: the web enqueued a translation';
  exception when insufficient_privilege then null;
  end;
  begin
    insert into public.inbox_message_translations
      (organization_id, workspace_id, room_id, event_id, target_locale, status, translated_text, engine)
    values ('a0000000-0000-4000-8000-000000000010', 'a0000000-0000-4000-8000-000000000011',
            '!tr2-espanhol', '$tr2-x', 'pt-BR', 'done', 'falso', 'ai');
    raise exception 'tr2: the web wrote a translation';
  exception when insufficient_privilege then null;
  end;
end
$$;
rollback;

-- ----------------------------------------------------------------------------
-- Test 2: only the run of the event records it; who reads
-- ----------------------------------------------------------------------------
begin;
select pg_temp.fixture();
set local role app_worker;
select private.inbox_translation_enqueue('!tr2-espanhol', '$tr2-1', 'es');
reset role;
-- An unrelated run of the same kind, for another event.
insert into public.job_runs (kind, scope, organization_id, workspace_id, requested_by, payload, idempotency_key, status)
values ('inbox.translate-message', 'workspace', 'a0000000-0000-4000-8000-000000000010',
        'a0000000-0000-4000-8000-000000000011', 'a0000000-0000-4000-8000-000000000031',
        '{"roomId": "!tr2-espanhol", "eventId": "$outro"}', 'tr2-outro', 'running');
set local role app_runtime;
do $$
declare
  v_run uuid := (select id from public.job_runs where kind = 'inbox.translate-message'
                 and payload->>'eventId' = '$tr2-1');
  v_other uuid := (select id from public.job_runs where idempotency_key = 'tr2-outro');
begin
  perform pg_temp.ctx('a0000000-0000-4000-8000-000000000031', 'a0000000-0000-4000-8000-000000000011',
                      'a0000000-0000-4000-8000-000000000010');
  -- Still pending: not running yet.
  begin
    perform private.inbox_translation_record(v_run, '$tr2-1', 'done', 'es', 'Olá', 'google', null, false, null);
    raise exception 'tr2: a run that is not running recorded';
  exception when insufficient_privilege then null;
  end;
  -- Another run, even running, does not record this event.
  begin
    perform private.inbox_translation_record(v_other, '$tr2-1', 'done', 'es', 'Olá', 'google', null, false, null);
    raise exception 'tr2: another run recorded the event';
  exception when insufficient_privilege then null;
  end;
end
$$;
reset role;
update public.job_runs set status = 'running'
where kind = 'inbox.translate-message' and payload->>'eventId' = '$tr2-1';
set local role app_runtime;
do $$
declare
  v_run uuid := (select id from public.job_runs where kind = 'inbox.translate-message'
                 and payload->>'eventId' = '$tr2-1');
  v_row record;
begin
  -- Another person, with the right run, does not record it.
  perform pg_temp.ctx('2e200000-0000-4000-8000-0000000000e5', 'a0000000-0000-4000-8000-000000000011',
                      'a0000000-0000-4000-8000-000000000010');
  begin
    perform private.inbox_translation_record(v_run, '$tr2-1', 'done', 'es', 'Olá', 'google', null, false, null);
    raise exception 'tr2: someone else recorded the run';
  exception when insufficient_privilege then null;
  end;
  -- The person of the run: a failure, then the translation by the fallback.
  perform pg_temp.ctx('a0000000-0000-4000-8000-000000000031', 'a0000000-0000-4000-8000-000000000011',
                      'a0000000-0000-4000-8000-000000000010');
  if not private.inbox_translation_record(v_run, '$tr2-1', 'failed', 'es', null, null, null, false, 'quota') then
    raise exception 'tr2: the failure was not recorded';
  end if;
  if not private.inbox_translation_record(v_run, '$tr2-1', 'done', 'es', 'Olá, quero um quarto.', 'google', null, true, 'key') then
    raise exception 'tr2: the translation was not recorded';
  end if;
  select * into v_row from public.inbox_message_translations where event_id = '$tr2-1';
  if v_row.status <> 'done' or v_row.translated_text <> 'Olá, quero um quarto.' or v_row.engine <> 'google'
     or not v_row.fallback or v_row.primary_error <> 'key' or v_row.attempts <> 2 then
    raise exception 'tr2: unexpected translation %', row_to_json(v_row);
  end if;
  -- The web never changes it directly.
  begin
    update public.inbox_message_translations set translated_text = 'outro' where event_id = '$tr2-1';
    raise exception 'tr2: the web changed a translation';
  exception when insufficient_privilege then null;
  end;

  -- The Attendant reads it; the viewer (no level) and B do not.
  perform pg_temp.ctx('2e200000-0000-4000-8000-0000000000e5', 'a0000000-0000-4000-8000-000000000011',
                      'a0000000-0000-4000-8000-000000000010');
  if (select count(*) from public.inbox_message_translations) <> 1 then
    raise exception 'tr2: the Attendant does not read the translation';
  end if;
  perform pg_temp.ctx('a0000000-0000-4000-8000-000000000033', 'a0000000-0000-4000-8000-000000000011',
                      'a0000000-0000-4000-8000-000000000010');
  if exists (select 1 from public.inbox_message_translations) then
    raise exception 'tr2: the viewer reads the translations';
  end if;
  perform pg_temp.ctx('a0000000-0000-4000-8000-000000000032', 'a0000000-0000-4000-8000-000000000021',
                      'a0000000-0000-4000-8000-000000000020');
  if exists (select 1 from public.inbox_message_translations) then
    raise exception 'tr2: B reads the translations of A';
  end if;
  -- A short message: the pending row goes.
  perform pg_temp.ctx('a0000000-0000-4000-8000-000000000031', 'a0000000-0000-4000-8000-000000000011',
                      'a0000000-0000-4000-8000-000000000010');
  begin
    perform private.inbox_translation_record(v_run, '$tr2-1', 'other', null, null, null, null, false, null);
    raise exception 'tr2: an unknown status';
  exception when invalid_parameter_value then null;
  end;
end
$$;
reset role;
-- A done row is not removed by a skip; a pending one is.
update public.inbox_message_translations set status = 'pending', translated_text = null, engine = null
where event_id = '$tr2-1';
set local role app_runtime;
do $$
declare
  v_run uuid := (select id from public.job_runs where kind = 'inbox.translate-message'
                 and payload->>'eventId' = '$tr2-1');
begin
  perform pg_temp.ctx('a0000000-0000-4000-8000-000000000031', 'a0000000-0000-4000-8000-000000000011',
                      'a0000000-0000-4000-8000-000000000010');
  if not private.inbox_translation_record(v_run, '$tr2-1', 'skipped', null, null, null, null, false, null) then
    raise exception 'tr2: the skip did not remove the pending row';
  end if;
end
$$;
reset role;
do $$
begin
  if exists (select 1 from public.inbox_message_translations where event_id = '$tr2-1') then
    raise exception 'tr2: the pending row stayed';
  end if;
end
$$;
rollback;

-- ----------------------------------------------------------------------------
-- Test 3: deleting the room deletes its translations; the Google key
-- ----------------------------------------------------------------------------
begin;
select pg_temp.fixture();
set local role app_worker;
select private.inbox_translation_enqueue('!tr2-espanhol', '$tr2-1', 'es');
reset role;
delete from public.matrix_rooms where room_id = '!tr2-espanhol';
do $$
begin
  if exists (select 1 from public.inbox_message_translations) then
    raise exception 'tr2: the translations outlived the room';
  end if;
end
$$;
-- The vault takes a Google Translate key; another provider stays refused.
insert into public.credentials (organization_id, workspace_id, provider, label, masked_value, encrypted_payload)
values ('a0000000-0000-4000-8000-000000000010', 'a0000000-0000-4000-8000-000000000011',
        'google_translate', 'Google Translate', 'AIza…1234', 'cifrado');
do $$
begin
  insert into public.credentials (organization_id, workspace_id, provider, label, masked_value, encrypted_payload)
  values ('a0000000-0000-4000-8000-000000000010', 'a0000000-0000-4000-8000-000000000011',
          'deepl', 'DeepL', 'x…1', 'cifrado');
  raise exception 'tr2: an unknown provider in the vault';
exception when check_violation then null;
end
$$;
rollback;

-- Without the `app.*` context, the web reads no translation (AC02).
begin;
select pg_temp.fixture();
insert into public.inbox_message_translations
  (organization_id, workspace_id, room_id, event_id, direction, source_locale, target_locale, status)
values ('a0000000-0000-4000-8000-000000000010', 'a0000000-0000-4000-8000-000000000011',
        '!tr2-espanhol', '$tr2-semctx', 'inbound', 'es', 'pt-BR', 'pending');
set local role app_runtime;
do $$
begin
  perform pg_temp.ctx(null, null, null);
  if (select count(*) from public.inbox_message_translations) <> 0 then
    raise exception 'tr2: translations read without the app context';
  end if;
end
$$;
rollback;

-- ----------------------------------------------------------------------------
-- Test 4: no grants to anon and authenticated; RLS forced
-- ----------------------------------------------------------------------------
do $$
begin
  if has_table_privilege('anon', 'public.inbox_message_translations', 'select')
     or has_table_privilege('authenticated', 'public.inbox_message_translations', 'select') then
    raise exception 'tr2: the translations are open to anon or authenticated';
  end if;
  if not (select relrowsecurity and relforcerowsecurity from pg_class
          where oid = 'public.inbox_message_translations'::regclass) then
    raise exception 'tr2: translations without forced RLS';
  end if;
  if has_function_privilege('app_runtime', 'private.inbox_translation_enqueue(text, text, text)', 'execute') then
    raise exception 'tr2: the web may enqueue translations';
  end if;
end
$$;
