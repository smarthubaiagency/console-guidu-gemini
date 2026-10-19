-- ============================================================================
-- Migration: 20261220090000_tr1_contact_locale.sql
-- Module: TR1 — the contact's language (docs/architecture/plano-gf1-tr1.md;
--         docs/modules/inbox/traducao.md)
--
-- Maintenance Rationale:
-- 1. Each conversation knows the contact's language: Portuguese, English or
--    Spanish (the pilot's three), null while unknown or another language.
--    The route of the Application Service guesses it from the consumer's
--    message, in memory, and keeps only the guess in the reduced event (the
--    text never reaches the database, ADR 0023); the worker writes it here
--    as it processes the event. `contact_locale_confidence` keeps how sure
--    the guess was.
-- 2. Whoever answers in the Inbox corrects it (`manual`); a manual language
--    is never changed by a later detection. The source `browser` waits for
--    the guidu.chat.
-- 3. The correction goes through the console (app_runtime): an update grant
--    on these three columns only, and a policy for a room of the context
--    workspace when the person answers there (`inbox_my_level() = 'reply'`).
--    The worker keeps its own policy (IN3).
-- 4. A message event keeps only its marks: the kind and, now, the guessed
--    language. Any other key (the text above all) is refused.
-- Owner app_migrations, ENABLE + FORCE RLS, no grants to anon/authenticated.
-- ============================================================================

alter table public.matrix_rooms
  add column contact_locale text
    check (contact_locale is null or contact_locale in ('pt-BR', 'en', 'es')),
  add column contact_locale_source text
    check (contact_locale_source is null or contact_locale_source in ('detected', 'manual', 'browser')),
  add column contact_locale_confidence real
    check (contact_locale_confidence is null or contact_locale_confidence between 0 and 1),
  add constraint matrix_rooms_contact_locale_source
    check ((contact_locale is null) = (contact_locale_source is null));

grant update (contact_locale, contact_locale_source, contact_locale_confidence)
  on public.matrix_rooms to app_runtime;

create policy matrix_rooms_contact_locale on public.matrix_rooms
  for update to app_runtime
  using (
    state = 'active'
    and workspace_id = private.context_uuid('app.workspace_id')
    and organization_id = private.context_uuid('app.organization_id')
    and private.inbox_my_level() = 'reply'
  )
  with check (
    state = 'active'
    and workspace_id = private.context_uuid('app.workspace_id')
    and organization_id = private.context_uuid('app.organization_id')
    and private.inbox_my_level() = 'reply'
    and contact_locale_source = 'manual'
  );

alter table public.matrix_events drop constraint matrix_events_message_without_body;
alter table public.matrix_events
  add constraint matrix_events_message_marks_only
  check (
    type <> 'm.room.message'
    or (
      (content - array['msgtype', 'locale', 'locale_confidence']) = '{}'::jsonb
      and (not content ? 'locale' or content->>'locale' in ('pt-BR', 'en', 'es'))
    )
  );
