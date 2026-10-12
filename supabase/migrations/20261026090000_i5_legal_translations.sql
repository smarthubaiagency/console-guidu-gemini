-- ============================================================================
-- I5 — Terms and privacy per dashboard language (ADR 0013, plano-i18n §5)
--
-- 1. `public.partner_legal_documents.locale`: language the original version
--    was written in. Existing versions and versions published without a
--    choice are in the source language of the dashboard (pt-BR). Versions
--    stay immutable: the column is set on insert only.
-- 2. `public.partner_legal_document_translations`: one translation of a
--    published version per dashboard language, edited in the legal settings
--    (origin `manual`) or filled by machine translation (origin `machine`,
--    I6). The original stays the reference: a translation in the language
--    of the original is refused, every other platform language (active or
--    draft) is allowed. Readers see the translation of their language and
--    fall back to the original.
-- 3. Acceptance stays per version (`legal_acceptances`), independent of the
--    language it was read in.
-- Owner app_migrations, ENABLE + FORCE RLS, no grants to anon/authenticated.
-- ============================================================================

alter table public.partner_legal_documents
  add column locale text not null default 'pt-BR'
    references public.platform_languages(code) on delete restrict;

comment on column public.partner_legal_documents.locale is
  'Language of the original text of this version; translations exist for the other languages.';

create table public.partner_legal_document_translations (
  document_id uuid not null
    references public.partner_legal_documents(id) on delete cascade,
  locale      text not null
    references public.platform_languages(code) on delete cascade,
  title       text not null check (length(trim(title)) > 0 and length(title) <= 120),
  body        text not null check (length(trim(body)) > 0 and length(body) <= 100000),
  origin      text not null default 'manual' check (origin in ('manual', 'machine')),
  updated_by  uuid references public.profiles(id) on delete set null,
  updated_at  timestamptz not null default now(),
  primary key (document_id, locale)
);

comment on table public.partner_legal_document_translations is
  'Translation of one legal document version into one dashboard language (I5). The original version prevails.';

create index partner_legal_document_translations_locale_idx
  on public.partner_legal_document_translations (locale);

alter table public.partner_legal_document_translations owner to app_migrations;
revoke all on public.partner_legal_document_translations from public, anon, authenticated;
alter table public.partner_legal_document_translations enable row level security;
alter table public.partner_legal_document_translations force row level security;

create trigger partner_legal_document_translations_touch_updated_at
  before update on public.partner_legal_document_translations
  for each row execute function private.touch_updated_at();

-- Whoever reads the version reads its translations (public before sign-in,
-- through the host's partner).
create policy partner_legal_document_translations_select
  on public.partner_legal_document_translations
  for select to app_runtime
  using (
    exists (
      select 1
      from public.partner_legal_documents document
      where document.id = partner_legal_document_translations.document_id
        and document.partner_id = private.current_partner_id()
    )
  );

-- Same publishers as the versions; never in the language of the original.
create policy partner_legal_document_translations_insert
  on public.partner_legal_document_translations
  for insert to app_runtime
  with check (
    updated_by = private.context_uuid('app.user_id')
    and (
      private.current_platform_admin_role() in ('owner', 'operations')
      or private.can_manage_partner_customers()
    )
    and exists (
      select 1
      from public.partner_legal_documents document
      where document.id = partner_legal_document_translations.document_id
        and document.partner_id = private.current_partner_id()
        and document.locale <> partner_legal_document_translations.locale
    )
  );

create policy partner_legal_document_translations_update
  on public.partner_legal_document_translations
  for update to app_runtime
  using (
    (
      private.current_platform_admin_role() in ('owner', 'operations')
      or private.can_manage_partner_customers()
    )
    and exists (
      select 1
      from public.partner_legal_documents document
      where document.id = partner_legal_document_translations.document_id
        and document.partner_id = private.current_partner_id()
    )
  )
  with check (
    updated_by = private.context_uuid('app.user_id')
    and (
      private.current_platform_admin_role() in ('owner', 'operations')
      or private.can_manage_partner_customers()
    )
    and exists (
      select 1
      from public.partner_legal_documents document
      where document.id = partner_legal_document_translations.document_id
        and document.partner_id = private.current_partner_id()
        and document.locale <> partner_legal_document_translations.locale
    )
  );

create policy partner_legal_document_translations_delete
  on public.partner_legal_document_translations
  for delete to app_runtime
  using (
    (
      private.current_platform_admin_role() in ('owner', 'operations')
      or private.can_manage_partner_customers()
    )
    and exists (
      select 1
      from public.partner_legal_documents document
      where document.id = partner_legal_document_translations.document_id
        and document.partner_id = private.current_partner_id()
    )
  );

grant select, insert, update, delete
  on public.partner_legal_document_translations to app_runtime;
