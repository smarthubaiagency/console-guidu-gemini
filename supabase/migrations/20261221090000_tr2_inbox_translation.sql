-- ============================================================================
-- Migration: 20261221090000_tr2_inbox_translation.sql
-- Module: TR2 — translation of the messages that arrive in the Inbox
--         (docs/modules/inbox/plano-tr2-in5a.md; docs/modules/inbox/traducao.md)
--
-- Maintenance Rationale:
-- 1. The key of Google Cloud Translation (Basic, v2) is a credential of the
--    workspace vault, of its own kind (`google_translate`): encrypted, shown
--    masked, never in the configuration. The AI keys stay where they are.
-- 2. `inbox_message_translations` keeps, per message (`event_id`) and team
--    language, the translation shown to the team in the Inbox: never in the
--    room (the contact is a member and would see any event put there, ADR
--    0023 rule 6). Only the translation is kept; the original stays on
--    Synapse. `direction` is `inbound` now; the TR3 adds `outbound`.
--    `status`: pending (job queued), done, failed (both engines failed; the
--    job tries again). `primary_error` keeps why the main engine failed
--    (key, quota, timeout, refusal, error): the notices of a failing key.
-- 3. Whoever has a level in the Inbox reads them (`inbox_my_level()`); only
--    the worker writes:
--    - the processing of the Application Service (app_worker) enqueues the
--      job `inbox.translate-message` with the pending row, through
--      `private.inbox_translation_enqueue` (translation on, the message in
--      a language other than the team's). The job runs as the person who
--      saved the Inbox settings, like the GUIDS turn (IN6);
--    - the job writes its result through `private.inbox_translation_record`,
--      which requires its own run (`running`, of that event, requested by
--      the context person): the web runtime cannot write a translation.
-- 4. Deleting the room or the workspace deletes the translations (foreign
--    keys with cascade; the purge of the WS1 deletes them before the rooms).
-- Owner app_migrations, ENABLE + FORCE RLS, no grants to anon/authenticated.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. The Google Translate key in the workspace vault
-- ----------------------------------------------------------------------------
alter table public.credentials drop constraint credentials_provider_check;
alter table public.credentials add constraint credentials_provider_check
  check (provider in ('openai', 'anthropic', 'gemini', 'openrouter', 'google_translate'));

-- ----------------------------------------------------------------------------
-- 2. Translations
-- ----------------------------------------------------------------------------
create table public.inbox_message_translations (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  workspace_id    uuid not null,
  room_id         text not null references public.matrix_rooms(room_id) on delete cascade,
  event_id        text not null check (length(event_id) between 2 and 255),
  direction       text not null default 'inbound' check (direction in ('inbound', 'outbound')),
  source_locale   text check (source_locale is null or source_locale in ('pt-BR', 'en', 'es')),
  target_locale   text not null check (target_locale in ('pt-BR', 'en', 'es')),
  status          text not null default 'pending' check (status in ('pending', 'done', 'failed')),
  translated_text text check (translated_text is null or length(translated_text) between 1 and 8000),
  engine          text check (engine is null or engine in ('ai', 'google')),
  model           text check (model is null or length(model) between 1 and 120),
  fallback        boolean not null default false,
  primary_error   text check (primary_error is null or primary_error in ('key', 'quota', 'timeout', 'refusal', 'error')),
  attempts        integer not null default 0 check (attempts between 0 and 20),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  constraint inbox_message_translations_event_target unique (event_id, target_locale),
  constraint inbox_message_translations_done
    check ((status = 'done') = (translated_text is not null and engine is not null)),
  constraint fk_inbox_message_translations_workspace
    foreign key (workspace_id, organization_id)
    references public.workspaces(id, organization_id) on delete cascade
);

create index inbox_message_translations_room_idx on public.inbox_message_translations (room_id);
create index inbox_message_translations_workspace_idx
  on public.inbox_message_translations (workspace_id, updated_at desc);

alter table public.inbox_message_translations owner to app_migrations;
revoke all on public.inbox_message_translations from public, anon, authenticated;
alter table public.inbox_message_translations enable row level security;
alter table public.inbox_message_translations force row level security;

create trigger inbox_message_translations_touch_updated_at
  before update on public.inbox_message_translations
  for each row execute function private.touch_updated_at();

-- The worker (purge of the WS1, bookkeeping) sees every row.
create policy inbox_message_translations_worker on public.inbox_message_translations
  for all to app_worker using (true) with check (true);
grant select, insert, update, delete on public.inbox_message_translations to app_worker;

-- Whoever has a level in the Inbox of the context workspace reads.
create policy inbox_message_translations_select on public.inbox_message_translations
  for select to app_runtime
  using (
    workspace_id = private.context_uuid('app.workspace_id')
    and organization_id = private.context_uuid('app.organization_id')
    and (select private.inbox_my_level()) is not null
  );
grant select on public.inbox_message_translations to app_runtime;

-- ----------------------------------------------------------------------------
-- 3. Enqueue and record (owner app_rls_helper)
-- ----------------------------------------------------------------------------
-- `app.inbox_translation` opens to the helper only what the two functions
-- below read and write; each sets and restores it.
create policy workspace_modules_inbox_translation on public.workspace_modules
  for select to app_rls_helper
  using (current_setting('app.inbox_translation', true) = 'on' and module_key = 'inbox');
create policy matrix_rooms_inbox_translation on public.matrix_rooms
  for select to app_rls_helper
  using (current_setting('app.inbox_translation', true) = 'on');
create policy workspaces_inbox_translation on public.workspaces
  for select to app_rls_helper
  using (current_setting('app.inbox_translation', true) = 'on');
create policy inbox_message_translations_helper on public.inbox_message_translations
  for all to app_rls_helper
  using (current_setting('app.inbox_translation', true) = 'on')
  with check (current_setting('app.inbox_translation', true) = 'on');
create policy job_runs_inbox_translation_select on public.job_runs
  for select to app_rls_helper
  using (current_setting('app.inbox_translation', true) = 'on' and kind = 'inbox.translate-message');
create policy job_runs_inbox_translation_insert on public.job_runs
  for insert to app_rls_helper
  with check (
    current_setting('app.inbox_translation', true) = 'on'
    and kind = 'inbox.translate-message'
    and scope = 'workspace'
    and status = 'pending'
    and attempts = 0
  );

grant select (organization_id, contact_locale) on public.matrix_rooms to app_rls_helper;
grant select (organization_id, requested_by) on public.job_runs to app_rls_helper;
grant select, insert, update, delete on public.inbox_message_translations to app_rls_helper;

-- The team's language: the workspace's default, among the three of the
-- pilot (the same rule as `contactLocaleOf`, src/core/matrix/locale.ts).
create function private.inbox_team_locale(p_default text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case
    when p_default like 'en%' then 'en'
    when p_default like 'es%' then 'es'
    else 'pt-BR'
  end;
$$;
alter function private.inbox_team_locale(text) owner to app_migrations;
revoke execute on function private.inbox_team_locale(text) from public, anon, authenticated;
grant execute on function private.inbox_team_locale(text) to app_rls_helper, app_runtime, app_worker;

-- A text message of the contact or of the GUIDS was processed (as
-- app_worker): with the translation of the Inbox on, an active room and
-- workspace, and the message in a language other than the team's (the one
-- guessed from it, else the contact's), the pending row and the run of
-- `inbox.translate-message` go in, as the person who saved the Inbox
-- settings. The payload has only the room and the event, never the text.
-- Returns the run, or null when nothing is translated.
create function private.inbox_translation_enqueue(p_room_id text, p_event_id text, p_locale text)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_previous text := current_setting('app.inbox_translation', true);
  v_room record;
  v_workspace record;
  v_module record;
  v_team text;
  v_source text;
  v_run uuid;
begin
  if p_event_id is null or length(p_event_id) not between 2 and 255 then
    return null;
  end if;
  perform set_config('app.inbox_translation', 'on', true);
  select room.workspace_id, room.organization_id, room.state, room.contact_locale
    into v_room
  from public.matrix_rooms room where room.room_id = p_room_id;
  if v_room.workspace_id is null or v_room.state <> 'active' then
    perform set_config('app.inbox_translation', coalesce(v_previous, ''), true);
    return null;
  end if;
  select workspace.status, workspace.default_locale into v_workspace
  from public.workspaces workspace where workspace.id = v_room.workspace_id;
  select module.status, module.config, module.updated_by into v_module
  from public.workspace_modules module
  where module.workspace_id = v_room.workspace_id and module.module_key = 'inbox';
  v_team := private.inbox_team_locale(v_workspace.default_locale);
  v_source := case when p_locale in ('pt-BR', 'en', 'es') then p_locale else v_room.contact_locale end;
  if v_workspace.status is distinct from 'active'
     or v_module.status is distinct from 'enabled'
     or v_module.updated_by is null
     or jsonb_typeof(v_module.config->'translation') is distinct from 'object'
     or (v_module.config->'translation'->>'enabled') is distinct from 'true'
     or v_source is null
     or v_source = v_team then
    perform set_config('app.inbox_translation', coalesce(v_previous, ''), true);
    return null;
  end if;
  insert into public.inbox_message_translations
    (organization_id, workspace_id, room_id, event_id, direction, source_locale, target_locale, status)
  values
    (v_room.organization_id, v_room.workspace_id, p_room_id, p_event_id, 'inbound', v_source, v_team, 'pending')
  on conflict (event_id, target_locale) do nothing;
  if not found then
    -- Already translated or queued.
    perform set_config('app.inbox_translation', coalesce(v_previous, ''), true);
    return null;
  end if;
  insert into public.job_runs
    (kind, scope, organization_id, workspace_id, requested_by, payload,
     idempotency_key, max_attempts)
  values
    ('inbox.translate-message', 'workspace', v_room.organization_id, v_room.workspace_id,
     v_module.updated_by, jsonb_build_object('roomId', p_room_id, 'eventId', p_event_id),
     left('translate:' || v_team || ':' || p_event_id, 200), 3)
  on conflict do nothing
  returning id into v_run;
  if v_run is null then
    -- The run already exists: the pending row would stay without a job.
    delete from public.inbox_message_translations
     where event_id = p_event_id and target_locale = v_team and status = 'pending';
  end if;
  perform set_config('app.inbox_translation', coalesce(v_previous, ''), true);
  return v_run;
end;
$$;

-- The result of a run of `inbox.translate-message` (as app_runtime, the
-- person the job runs as). Only the run itself writes: running, of this
-- event, of the context workspace and requested by the context person.
-- `p_status`: done (the text and the engine), failed (both engines
-- failed; counts an attempt) or skipped (nothing to translate: the
-- pending row goes).
create function private.inbox_translation_record(
  p_run_id uuid,
  p_event_id text,
  p_status text,
  p_source_locale text,
  p_text text,
  p_engine text,
  p_model text,
  p_fallback boolean,
  p_primary_error text
)
returns boolean
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_previous text := current_setting('app.inbox_translation', true);
  v_run record;
  v_changed integer;
begin
  if p_status not in ('done', 'failed', 'skipped') then
    raise exception 'inbox_translation_record: invalid status' using errcode = 'invalid_parameter_value';
  end if;
  perform set_config('app.inbox_translation', 'on', true);
  select run.workspace_id, run.organization_id, run.payload into v_run
  from public.job_runs run
  where run.id = p_run_id
    and run.kind = 'inbox.translate-message'
    and run.status = 'running'
    and run.workspace_id = private.context_uuid('app.workspace_id')
    and run.organization_id = private.context_uuid('app.organization_id')
    and run.requested_by = private.context_uuid('app.user_id')
    and run.payload->>'eventId' = p_event_id;
  if v_run.workspace_id is null then
    perform set_config('app.inbox_translation', coalesce(v_previous, ''), true);
    raise exception 'inbox_translation_record: not a run of this event' using errcode = 'insufficient_privilege';
  end if;
  if p_status = 'skipped' then
    delete from public.inbox_message_translations t
    where t.event_id = p_event_id and t.workspace_id = v_run.workspace_id and t.status = 'pending';
    get diagnostics v_changed = row_count;
  else
    update public.inbox_message_translations t
    set status = p_status,
        source_locale = coalesce(case when p_source_locale in ('pt-BR', 'en', 'es') then p_source_locale end,
                                 t.source_locale),
        translated_text = case when p_status = 'done' then p_text end,
        engine = case when p_status = 'done' then p_engine end,
        model = case when p_status = 'done' then p_model end,
        fallback = coalesce(p_fallback, false),
        primary_error = p_primary_error,
        attempts = least(t.attempts + 1, 20)
    where t.event_id = p_event_id
      and t.workspace_id = v_run.workspace_id
      and t.room_id = v_run.payload->>'roomId'
      and t.direction = 'inbound';
    get diagnostics v_changed = row_count;
  end if;
  perform set_config('app.inbox_translation', coalesce(v_previous, ''), true);
  return v_changed > 0;
end;
$$;

revoke execute on function private.inbox_translation_enqueue(text, text, text) from public, anon, authenticated;
revoke execute on function private.inbox_translation_record(uuid, text, text, text, text, text, text, boolean, text)
  from public, anon, authenticated;
grant execute on function private.inbox_translation_enqueue(text, text, text) to app_worker;
grant execute on function private.inbox_translation_record(uuid, text, text, text, text, text, text, boolean, text)
  to app_runtime;
alter function private.inbox_translation_enqueue(text, text, text) owner to app_rls_helper;
alter function private.inbox_translation_record(uuid, text, text, text, text, text, text, boolean, text)
  owner to app_rls_helper;
