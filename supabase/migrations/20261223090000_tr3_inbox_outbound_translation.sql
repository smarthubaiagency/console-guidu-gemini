-- ============================================================================
-- Migration: 20261223090000_tr3_inbox_outbound_translation.sql
-- Module: TR3 — the team's answer with a translated preview
--         (docs/architecture/plano-tr3-gf2.md; docs/modules/inbox/traducao.md §5.2)
--
-- Maintenance Rationale:
-- 1. The attendant writes in the team's language, sees the preview in the
--    contact's language and sends it from the browser (matrix-js-sdk); the
--    room gets only the sent text. The original stays here, tied to the
--    `event_id` Synapse gave, and never goes to the room (ADR 0023, rule 6).
-- 2. `inbox_message_translations` already has `direction = 'outbound'`. Two
--    columns come: `source_text` (the team's original; only `outbound`
--    rows have it) and `edited` (the attendant changed the preview before
--    sending). For an `outbound` row `translated_text` is the text that was
--    sent, `source_locale` the team's language and `target_locale` the
--    contact's. The policies of the table do not change: who has a level in
--    the Inbox reads; the web has no insert, update or delete on it.
-- 3. The web records its own sending only through
--    `private.inbox_translation_record_outbound`, which requires: level
--    `reply` in the Inbox of the context workspace, an active room of that
--    workspace and an `event_id` with no registration yet. The server checks
--    before calling it, reading the event on Synapse as the core, that the
--    sender is the Matrix account of the person and that the body is the
--    text that was sent (src/modules/inbox/server/outbound-translation.ts).
-- 4. The job of the TR2 only writes `inbound` rows: nothing changes there.
-- Owner app_migrations, ENABLE + FORCE RLS already on the table, no grants
-- to anon/authenticated.
-- ============================================================================

alter table public.inbox_message_translations
  add column source_text text
    check (source_text is null or length(source_text) between 1 and 8000),
  add column edited boolean not null default false;

-- Only a sent answer has the original of the team and the "edited" mark.
alter table public.inbox_message_translations
  add constraint inbox_message_translations_outbound_source
    check ((direction = 'outbound') = (source_text is not null)),
  add constraint inbox_message_translations_outbound_edited
    check (not edited or direction = 'outbound');

-- ----------------------------------------------------------------------------
-- The web records its own sending (owner app_rls_helper)
-- ----------------------------------------------------------------------------
-- The room and the module tables are opened to the helper by the policies of
-- the TR2 (`app.inbox_translation = 'on'`), set and restored here; the columns
-- it reads were granted to the helper by the IN6 and the TR2.

-- Returns true when the row was written, false when the event already has a
-- registration. Raises insufficient_privilege without the level, the context
-- or the room, and invalid_parameter_value for an invalid argument.
create function private.inbox_translation_record_outbound(
  p_room_id text,
  p_event_id text,
  p_source_text text,
  p_sent_text text,
  p_source_locale text,
  p_target_locale text,
  p_engine text,
  p_model text,
  p_fallback boolean,
  p_edited boolean
)
returns boolean
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_previous text := current_setting('app.inbox_translation', true);
  v_workspace uuid := private.context_uuid('app.workspace_id');
  v_organization uuid := private.context_uuid('app.organization_id');
  v_room record;
  v_written integer;
begin
  if p_event_id is null or length(p_event_id) not between 2 and 255
     or p_source_text is null or length(p_source_text) not between 1 and 8000
     or p_sent_text is null or length(p_sent_text) not between 1 and 8000
     or p_source_locale is null or p_source_locale not in ('pt-BR', 'en', 'es')
     or p_target_locale is null or p_target_locale not in ('pt-BR', 'en', 'es')
     or p_source_locale = p_target_locale
     or p_engine is null or p_engine not in ('ai', 'google')
     or (p_model is not null and length(p_model) not between 1 and 120) then
    raise exception 'inbox_translation_record_outbound: invalid argument'
      using errcode = 'invalid_parameter_value';
  end if;
  if v_workspace is null or v_organization is null
     or private.inbox_my_level() is distinct from 'reply' then
    raise exception 'inbox_translation_record_outbound: not allowed' using errcode = 'insufficient_privilege';
  end if;
  perform set_config('app.inbox_translation', 'on', true);
  select room.workspace_id, room.organization_id into v_room
  from public.matrix_rooms room
  where room.room_id = p_room_id
    and room.workspace_id = v_workspace
    and room.organization_id = v_organization
    and room.state = 'active';
  if v_room.workspace_id is null then
    perform set_config('app.inbox_translation', coalesce(v_previous, ''), true);
    raise exception 'inbox_translation_record_outbound: not a room of this workspace'
      using errcode = 'insufficient_privilege';
  end if;
  if exists (
    select 1 from public.inbox_message_translations t where t.event_id = p_event_id
  ) then
    perform set_config('app.inbox_translation', coalesce(v_previous, ''), true);
    return false;
  end if;
  insert into public.inbox_message_translations
    (organization_id, workspace_id, room_id, event_id, direction, source_locale, target_locale,
     status, translated_text, source_text, engine, model, fallback, edited)
  values
    (v_room.organization_id, v_room.workspace_id, p_room_id, p_event_id, 'outbound',
     p_source_locale, p_target_locale, 'done', p_sent_text, p_source_text, p_engine, p_model,
     coalesce(p_fallback, false), coalesce(p_edited, false))
  on conflict (event_id, target_locale) do nothing;
  get diagnostics v_written = row_count;
  perform set_config('app.inbox_translation', coalesce(v_previous, ''), true);
  return v_written > 0;
end;
$$;

revoke execute on function private.inbox_translation_record_outbound(
  text, text, text, text, text, text, text, text, boolean, boolean
) from public, anon, authenticated;
grant execute on function private.inbox_translation_record_outbound(
  text, text, text, text, text, text, text, text, boolean, boolean
) to app_runtime;
alter function private.inbox_translation_record_outbound(
  text, text, text, text, text, text, text, text, boolean, boolean
) owner to app_rls_helper;
