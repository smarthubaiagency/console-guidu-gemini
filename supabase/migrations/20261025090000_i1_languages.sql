-- ============================================================================
-- I1 — Languages of the dashboard
--
-- 1. `public.platform_languages`: languages of the dashboard, managed in
--    Plataforma › Configurações › Idiomas. Born with pt-BR (source and
--    default), en and es. New languages start as drafts.
-- 2. `public.platform_translations`: edits of the platform over the texts
--    shipped in the code (`src/i18n/messages/*.json`), one row per language
--    and message key. Manual or machine origin.
-- 3. Language of a person (`profiles.locale`) and default language of a
--    workspace (`workspaces.default_locale`). The person's choice wins.
-- 4. Readers without context (login, every page) use SECURITY DEFINER
--    functions that return only active languages and their texts.
-- Owner app_migrations, ENABLE + FORCE RLS, no grants to anon/authenticated.
-- ============================================================================

create table public.platform_languages (
  code        text primary key
    check (code ~ '^[a-z]{2,3}(-[A-Z][A-Za-z0-9]{1,7})?$'),
  name        text not null check (length(btrim(name)) between 1 and 60),
  status      text not null default 'draft'
    check (status in ('draft', 'active', 'disabled')),
  is_default  boolean not null default false,
  position    integer not null default 0 check (position between 0 and 1000),
  created_by  uuid references public.profiles(id) on delete set null,
  updated_by  uuid references public.profiles(id) on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  -- The default language is active; the source language never turns off.
  check (not is_default or status = 'active'),
  check (code <> 'pt-BR' or status = 'active')
);

create unique index platform_languages_one_default
  on public.platform_languages (is_default) where is_default;

insert into public.platform_languages (code, name, status, is_default, position) values
  ('pt-BR', 'Português (Brasil)', 'active', true, 0),
  ('en', 'English', 'active', false, 1),
  ('es', 'Español', 'active', false, 2);

create table public.platform_translations (
  locale      text not null references public.platform_languages(code) on delete cascade,
  key         text not null
    check (length(key) between 1 and 200 and key ~ '^[A-Za-z0-9_-]+(\.[A-Za-z0-9_-]+)*$'),
  value       text not null check (length(value) between 1 and 5000),
  origin      text not null default 'manual' check (origin in ('manual', 'machine')),
  updated_by  uuid references public.profiles(id) on delete set null,
  updated_at  timestamptz not null default now(),
  primary key (locale, key)
);

do $$
declare
  t text;
begin
  foreach t in array array['platform_languages', 'platform_translations'] loop
    execute format('alter table public.%I owner to app_migrations', t);
    execute format('revoke all on public.%I from public, anon, authenticated', t);
    execute format('alter table public.%I enable row level security', t);
    execute format('alter table public.%I force row level security', t);
    execute format(
      'create trigger %I before update on public.%I for each row execute function private.touch_updated_at()',
      t || '_touch_updated_at', t
    );
  end loop;
end
$$;

-- Internal roles read; owner and operations manage (platform.languages.manage).
create policy platform_languages_select on public.platform_languages
  for select to app_runtime
  using (private.current_platform_admin_role() is not null);

create policy platform_languages_insert on public.platform_languages
  for insert to app_runtime
  with check (
    private.current_platform_admin_role() in ('owner', 'operations')
    and created_by = private.context_uuid('app.user_id')
    and updated_by is null
  );

create policy platform_languages_update on public.platform_languages
  for update to app_runtime
  using (private.current_platform_admin_role() in ('owner', 'operations'))
  with check (
    private.current_platform_admin_role() in ('owner', 'operations')
    and updated_by = private.context_uuid('app.user_id')
  );

grant select, insert, update on public.platform_languages to app_runtime;

create policy platform_translations_select on public.platform_translations
  for select to app_runtime
  using (private.current_platform_admin_role() is not null);

create policy platform_translations_insert on public.platform_translations
  for insert to app_runtime
  with check (
    private.current_platform_admin_role() in ('owner', 'operations')
    and updated_by = private.context_uuid('app.user_id')
  );

create policy platform_translations_update on public.platform_translations
  for update to app_runtime
  using (private.current_platform_admin_role() in ('owner', 'operations'))
  with check (
    private.current_platform_admin_role() in ('owner', 'operations')
    and updated_by = private.context_uuid('app.user_id')
  );

-- Going back to the text of the code removes the edit.
create policy platform_translations_delete on public.platform_translations
  for delete to app_runtime
  using (private.current_platform_admin_role() in ('owner', 'operations'));

grant select, insert, update, delete on public.platform_translations to app_runtime;

-- ----------------------------------------------------------------------------
-- Language of a person and default language of a workspace
-- ----------------------------------------------------------------------------
alter table public.profiles
  add column locale text references public.platform_languages(code) on delete set null;

alter table public.workspaces
  add column default_locale text references public.platform_languages(code) on delete set null;

-- Owner and admin change only the default language of their workspace.
create policy workspaces_update_locale on public.workspaces
  for update to app_runtime
  using (
    id = private.context_uuid('app.workspace_id')
    and organization_id = private.context_uuid('app.organization_id')
    and private.current_workspace_role() in ('owner', 'admin')
  )
  with check (
    id = private.context_uuid('app.workspace_id')
    and organization_id = private.context_uuid('app.organization_id')
    and private.current_workspace_role() in ('owner', 'admin')
  );

grant update (default_locale) on public.workspaces to app_runtime;

-- ----------------------------------------------------------------------------
-- Readers for every page (no request context yet)
-- ----------------------------------------------------------------------------

-- Active languages, for the selectors and the locale negotiation.
create function private.ui_languages()
returns table (code text, name text, is_default boolean, "position" integer)
language sql
stable
security definer
set search_path = ''
as $$
  select l.code, l.name, l.is_default, l.position
  from public.platform_languages l
  where l.status = 'active'
  order by l.position, l.code;
$$;

-- Edited texts of an active language.
create function private.ui_translations(p_locale text)
returns table (key text, value text)
language sql
stable
security definer
set search_path = ''
as $$
  select t.key, t.value
  from public.platform_translations t
  join public.platform_languages l on l.code = t.locale and l.status = 'active'
  where t.locale = p_locale;
$$;

-- Default language of the workspace in the path, when the context user is
-- an active member (the caller sets app.user_id in the same transaction; the
-- helper policies of workspaces and members narrow to that user). The
-- person's own language is read from the profile with the identity context.
create function private.ui_workspace_locale(p_workspace_slug text)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select w.default_locale from public.workspaces w
  where w.slug = p_workspace_slug
  limit 1;
$$;

do $$
declare
  f text;
begin
  foreach f in array array[
    'private.ui_languages()',
    'private.ui_translations(text)',
    'private.ui_workspace_locale(text)'
  ] loop
    execute format('alter function %s owner to app_rls_helper', f);
    execute format('revoke execute on function %s from public, anon, authenticated', f);
    execute format('grant execute on function %s to app_runtime', f);
  end loop;
end
$$;

grant select on public.platform_languages to app_rls_helper;
grant select on public.platform_translations to app_rls_helper;

-- The helper reads through narrow policies (FORCE RLS applies to it too).
create policy platform_languages_helper_select on public.platform_languages
  for select to app_rls_helper using (true);
create policy platform_translations_helper_select on public.platform_translations
  for select to app_rls_helper using (true);
