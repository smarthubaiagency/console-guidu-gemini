-- ============================================================================
-- I6 — Machine translation of the dashboard texts and legal documents
--      (ADR 0013, plano-i18n §6)
--
-- 1. The web asks for a run by inserting a platform `job_runs` row (outbox,
--    F3a) in the transaction of the action:
--    - `i18n.translate-texts` by the platform owner/operations
--      (platform.languages.manage), for an existing language;
--    - `legal.translate-document` by the publishers of the document's
--      partner (same rule as publishing a version: platform owner/operations
--      or partner owner/admin, partner of the request context), for a
--      version of that partner.
--    Always `pending`, no attempts, requested by the context user, who is
--    also the `requestedBy` of the payload. Partner publishers read the
--    legal runs of their partner (status on the legal settings); platform
--    admins already read every run (F3a).
-- 2. The worker (app_worker) runs both jobs as platform jobs and reaches
--    only what they need:
--    - reads the languages (code, name, status) and, while a texts run of a
--      language is running, the keys already edited in it;
--    - while a document run is running, reads that version and the
--      languages it is already translated into;
--    - INSERTs translations with origin `machine` and no author
--      (`updated_by` is not even granted: the requester is in the run and
--      in the audit). No UPDATE or DELETE: an existing row, manual or
--      machine, is never overwritten (the job uses ON CONFLICT DO NOTHING).
--    The "running run" condition narrows the worker to the work it was
--    asked for; it is defence in depth, not a boundary against a
--    compromised worker (which manages job_runs).
-- 3. The dashboard caches texts for 30 s per process; the worker does not
--    clear that cache, so machine texts show up within 30 s.
-- Plain policies and column grants only; no new functions. Owner
-- app_migrations; the tables keep ENABLE + FORCE RLS.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Web runtime: ask for a run and follow it
-- ----------------------------------------------------------------------------
create policy job_runs_machine_translation_insert on public.job_runs
  for insert to app_runtime
  with check (
    scope = 'platform'
    and status = 'pending'
    and attempts = 0
    and workspace_id is null
    and organization_id is null
    and requested_by = private.context_uuid('app.user_id')
    and payload ->> 'requestedBy' = requested_by::text
    and (
      (
        kind = 'i18n.translate-texts'
        and partner_id is null
        and private.current_platform_admin_role() in ('owner', 'operations')
        and exists (
          select 1 from public.platform_languages l
          where l.code = job_runs.payload ->> 'locale'
        )
      )
      or (
        kind = 'legal.translate-document'
        and partner_id = private.current_partner_id()
        and payload ->> 'partnerId' = partner_id::text
        and (
          private.current_platform_admin_role() in ('owner', 'operations')
          or private.can_manage_partner_customers()
        )
        and exists (
          select 1 from public.partner_legal_documents d
          where d.id::text = job_runs.payload ->> 'documentId'
            and d.partner_id = job_runs.partner_id
        )
      )
    )
  );

-- Publishers of a partner follow the legal runs of that partner.
create policy job_runs_legal_translation_select on public.job_runs
  for select to app_runtime
  using (
    scope = 'platform'
    and kind = 'legal.translate-document'
    and partner_id = private.current_partner_id()
    and (
      private.can_manage_partner_customers()
      or requested_by = private.context_uuid('app.user_id')
    )
  );

-- ----------------------------------------------------------------------------
-- 2. Worker: dashboard texts
-- ----------------------------------------------------------------------------
create policy platform_languages_worker_select on public.platform_languages
  for select to app_worker
  using (true);

grant select (code, name, status) on public.platform_languages to app_worker;

create policy platform_translations_worker_select on public.platform_translations
  for select to app_worker
  using (
    exists (
      select 1 from public.job_runs j
      where j.kind = 'i18n.translate-texts'
        and j.status = 'running'
        and j.payload ->> 'locale' = platform_translations.locale
    )
  );

create policy platform_translations_worker_insert on public.platform_translations
  for insert to app_worker
  with check (
    origin = 'machine'
    and updated_by is null
    and exists (
      select 1 from public.job_runs j
      where j.kind = 'i18n.translate-texts'
        and j.status = 'running'
        and j.payload ->> 'locale' = platform_translations.locale
    )
  );

grant select (locale, key) on public.platform_translations to app_worker;
grant insert (locale, key, value, origin) on public.platform_translations to app_worker;

-- ----------------------------------------------------------------------------
-- 3. Worker: legal documents
-- ----------------------------------------------------------------------------
create policy partner_legal_documents_worker_select on public.partner_legal_documents
  for select to app_worker
  using (
    exists (
      select 1 from public.job_runs j
      where j.kind = 'legal.translate-document'
        and j.status = 'running'
        and j.payload ->> 'documentId' = partner_legal_documents.id::text
        and j.partner_id = partner_legal_documents.partner_id
    )
  );

grant select (id, partner_id, kind, version, title, body, locale)
  on public.partner_legal_documents to app_worker;

create policy partner_legal_document_translations_worker_select
  on public.partner_legal_document_translations
  for select to app_worker
  using (
    exists (
      select 1 from public.job_runs j
      where j.kind = 'legal.translate-document'
        and j.status = 'running'
        and j.payload ->> 'documentId' = partner_legal_document_translations.document_id::text
    )
  );

create policy partner_legal_document_translations_worker_insert
  on public.partner_legal_document_translations
  for insert to app_worker
  with check (
    origin = 'machine'
    and updated_by is null
    -- The document is readable only during its run (policy above); never
    -- in the language of the original.
    and exists (
      select 1 from public.partner_legal_documents d
      where d.id = partner_legal_document_translations.document_id
        and d.locale <> partner_legal_document_translations.locale
    )
    and exists (
      select 1 from public.job_runs j
      where j.kind = 'legal.translate-document'
        and j.status = 'running'
        and j.payload ->> 'documentId' = partner_legal_document_translations.document_id::text
    )
  );

grant select (document_id, locale) on public.partner_legal_document_translations to app_worker;
grant insert (document_id, locale, title, body, origin)
  on public.partner_legal_document_translations to app_worker;
