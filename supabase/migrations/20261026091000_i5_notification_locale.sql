-- ============================================================================
-- I5 — Notifications in the recipient's language (ADR 0013, plano-i18n §5)
--
-- 1. `private.notification_locale(p_email)`: language of the person who
--    receives an e-mail. The person is found by the e-mail of an active
--    partner membership (`partner_members.email`, lower-case, tied to the
--    user's profile); the e-mails of sign-in live in `auth.users`, which the
--    application roles do not read. Answers the profile's language when it
--    is active, else the platform default language, else pt-BR. It answers
--    only a language code: never whether the e-mail exists, nor any other
--    column.
-- 2. The function is SECURITY DEFINER owned by app_rls_helper (like the I1
--    readers). The helper reads only the rows of the e-mail being looked up:
--    the policies below match `app.notification_email`, which the function
--    sets for the duration of the lookup and restores right after, so no
--    other helper function sees more profiles or
--    memberships than before (same pattern as F4e's
--    `app.platform_api_key_hash`).
-- 3. The worker renders notifications as app_worker: it may call this
--    function and the I1 readers of active languages and their edited texts
--    (`private.ui_languages()`, `private.ui_translations(text)`), so the
--    edits of Plataforma › Idiomas apply to e-mails too.
-- Owner app_migrations for the policies; functions owned by app_rls_helper.
-- ============================================================================

-- Rows of the looked-up e-mail only (app_rls_helper already has SELECT on
-- both tables; FORCE RLS applies to it).
create policy partner_members_notification_helper_select on public.partner_members
  for select to app_rls_helper
  using (
    status = 'active'
    and email = nullif(current_setting('app.notification_email', true), '')
  );

-- profiles keeps a single helper policy (tests/auth/profiles-rls.sql): the
-- platform admin reach of SMA-100 plus the looked-up e-mail.
drop policy profiles_admin_helper_select on public.profiles;
create policy profiles_admin_helper_select on public.profiles
  for select to app_rls_helper
  using (
    private.is_platform_admin()
    or exists (
      select 1 from public.partner_members m
      where m.user_id = profiles.id
        and m.status = 'active'
        and m.email = nullif(current_setting('app.notification_email', true), '')
    )
  );

set local role app_rls_helper;

create function private.notification_locale(p_email text)
returns text
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_email text := lower(btrim(coalesce(p_email, '')));
  v_previous text := current_setting('app.notification_email', true);
  v_locale text;
begin
  if v_email <> '' and length(v_email) <= 254 then
    perform set_config('app.notification_email', v_email, true);
    select p.locale into v_locale
    from public.partner_members m
    join public.profiles p on p.id = m.user_id
    join public.platform_languages l on l.code = p.locale and l.status = 'active'
    where m.email = v_email
      and m.status = 'active'
    order by m.created_at, m.partner_id
    limit 1;
    -- The lookup e-mail does not outlive the call (an error aborts the
    -- transaction or savepoint, which undoes it as well).
    perform set_config('app.notification_email', coalesce(v_previous, ''), true);
  end if;
  if v_locale is null then
    select l.code into v_locale
    from public.platform_languages l
    where l.is_default and l.status = 'active';
  end if;
  return coalesce(v_locale, 'pt-BR');
end;
$$;

revoke all on function private.notification_locale(text) from public, anon, authenticated;
-- Only the worker sends e-mails; the dashboard never looks up a recipient.
grant execute on function private.notification_locale(text) to app_worker;

-- The worker reads active languages and their edits (I1 readers). I1 set
-- these grants before being the owner (app_migrations is NOINHERIT), so
-- they did not apply and the functions kept the default EXECUTE for
-- PUBLIC; fixed here by their owner.
revoke all on function private.ui_languages() from public, anon, authenticated;
revoke all on function private.ui_translations(text) from public, anon, authenticated;
revoke all on function private.ui_workspace_locale(text) from public, anon, authenticated;
grant execute on function private.ui_languages() to app_runtime, app_worker;
grant execute on function private.ui_translations(text) to app_runtime, app_worker;
grant execute on function private.ui_workspace_locale(text) to app_runtime;

reset role;
