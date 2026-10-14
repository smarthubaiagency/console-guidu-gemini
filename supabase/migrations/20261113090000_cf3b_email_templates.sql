-- ============================================================================
-- Migration: 20261113090000_cf3b_email_templates.sql
-- Module: CF3b — editable e-mail templates (subject and body per event and
--         language) (/mnt/project-files/configuracoes/plano-cf3.md)
--
-- Maintenance Rationale:
-- 1. Marcelo (14/10/2026): the platform edits the base over the code's
--    templates and each partner overrides it for its customers; customers
--    never edit. Resolution when sending: the partner's row, else the
--    platform's, else the code's template.
-- 2. A row holds only a subject and a body in the template format of
--    `src/core/notifications/markup.ts` (a small Markdown subset with
--    `{{tag}}` variables), never HTML: the application renders it and
--    escapes every value. The application also refuses unknown tags and
--    non-http(s) links; the table bounds sizes and the subject's line.
-- 3. Writes go through the table with the level's managers: platform owner
--    and operations, partner owner and admin (the roles of
--    `platform.settings.manage` and `partner.settings.manage`). Every
--    platform admin and every partner member reads the rows of their level.
-- 4. The worker sends billing and AI key notices for any partner, and the
--    dashboard sends invitations and test e-mails on any host, so neither
--    has that partner in its context. `private.email_template(partner,
--    event, locale)` returns the most specific row of that partner or of
--    the platform; templates hold no secret (they are the e-mails' texts).
-- 5. `updated_by` loses its person (set null) when the profile goes away:
--    a partner's templates outlive the staff that wrote them.
-- Owner app_migrations, ENABLE + FORCE RLS, no grants to anon/authenticated;
-- the security definer function is owned by app_rls_helper.
-- ============================================================================

create table public.email_templates (
  id          uuid primary key default gen_random_uuid(),
  scope       text not null check (scope in ('platform', 'partner')),
  partner_id  uuid references public.partners(id) on delete cascade,
  event_type  text not null
                check (event_type ~ '^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$' and length(event_type) <= 80),
  locale      text not null
                check (locale ~ '^[a-z]{2,3}(-[A-Z][A-Za-z0-9]{1,7})?$'),
  subject     text not null
                check (length(btrim(subject)) between 1 and 200 and subject !~ '[\r\n]'),
  body        text not null
                check (length(btrim(body)) >= 1 and length(body) <= 10000),
  updated_by  uuid references public.profiles(id) on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  constraint email_templates_level_check check (
    (scope = 'platform' and partner_id is null)
    or (scope = 'partner' and partner_id is not null)
  )
);

create unique index email_templates_platform_key
  on public.email_templates (event_type, locale) where scope = 'platform';
create unique index email_templates_partner_key
  on public.email_templates (partner_id, event_type, locale) where scope = 'partner';

alter table public.email_templates owner to app_migrations;
revoke all on public.email_templates from public, anon, authenticated;
alter table public.email_templates enable row level security;
alter table public.email_templates force row level security;

create trigger email_templates_touch_updated_at
  before update on public.email_templates
  for each row execute function private.touch_updated_at();

-- ----------------------------------------------------------------------------
-- 1. Managers of each level
-- ----------------------------------------------------------------------------
create policy email_templates_select on public.email_templates
  for select to app_runtime
  using (
    (scope = 'platform' and private.current_platform_admin_role() is not null)
    or (scope = 'partner'
        and partner_id = private.current_partner_id()
        and private.current_partner_role() is not null)
  );

create policy email_templates_insert on public.email_templates
  for insert to app_runtime
  with check (
    updated_by = private.context_uuid('app.user_id')
    and (
      (scope = 'platform' and private.current_platform_admin_role() in ('owner', 'operations'))
      or (scope = 'partner'
          and partner_id = private.current_partner_id()
          and private.current_partner_role() in ('partner_owner', 'partner_admin'))
    )
  );

create policy email_templates_update on public.email_templates
  for update to app_runtime
  using (
    (scope = 'platform' and private.current_platform_admin_role() in ('owner', 'operations'))
    or (scope = 'partner'
        and partner_id = private.current_partner_id()
        and private.current_partner_role() in ('partner_owner', 'partner_admin'))
  )
  with check (
    updated_by = private.context_uuid('app.user_id')
  );

create policy email_templates_delete on public.email_templates
  for delete to app_runtime
  using (
    (scope = 'platform' and private.current_platform_admin_role() in ('owner', 'operations'))
    or (scope = 'partner'
        and partner_id = private.current_partner_id()
        and private.current_partner_role() in ('partner_owner', 'partner_admin'))
  );

-- Scope, owner, event and language never change: "restore" deletes the row.
grant select, insert, delete on public.email_templates to app_runtime;
grant update (subject, body, updated_by, updated_at) on public.email_templates to app_runtime;

-- ----------------------------------------------------------------------------
-- 2. The template used to send, for the dashboard and the worker
-- ----------------------------------------------------------------------------
create policy email_templates_helper_select on public.email_templates
  for select to app_rls_helper
  using (scope in ('platform', 'partner'));

grant select on public.email_templates to app_rls_helper;

create function private.email_template(p_partner_id uuid, p_event_type text, p_locale text)
returns table(scope text, subject text, body text)
language sql
stable
security definer
set search_path = ''
as $$
  select t.scope, t.subject, t.body
  from public.email_templates t
  where t.event_type = p_event_type
    and t.locale = p_locale
    and (t.scope = 'platform'
         or (t.scope = 'partner' and t.partner_id = p_partner_id))
  order by (t.scope = 'partner') desc
  limit 1;
$$;

revoke execute on function private.email_template(uuid, text, text) from public, anon, authenticated;
grant execute on function private.email_template(uuid, text, text) to app_runtime, app_worker;
alter function private.email_template(uuid, text, text) owner to app_rls_helper;
