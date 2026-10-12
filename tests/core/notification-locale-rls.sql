-- ============================================================================
-- SQL Notification language (I5, ADR 0013): private.notification_locale
--
-- Executed as migration administrator. Each block prepares its fixtures as
-- administrator, switches role with `set local role` and rolls back.
-- Fixtures: tests/core/seed.sql (profiles a…031, a…032, a…033).
--   partner B b0000000-0000-4000-8000-000000000001 (per block):
--   a…031 dono@b.test partner_owner (language es)
--   a…032 fin@b.test partner_finance (language fr, a draft)
--   a…033 ex@b.test partner_support, inactive (language en)
-- ============================================================================

create or replace function pg_temp.locale_fixture() returns void
language sql as $$
  insert into public.partners (id, slug, name)
  values ('b0000000-0000-4000-8000-000000000001', 'agencia-b', 'Agência B');
  insert into public.partner_members (partner_id, user_id, email, role, status) values
    ('b0000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000031', 'dono@b.test', 'partner_owner', 'active'),
    ('b0000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000032', 'fin@b.test', 'partner_finance', 'active'),
    ('b0000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000033', 'ex@b.test', 'partner_support', 'inactive');
  insert into public.platform_languages (code, name, status) values ('fr', 'Français', 'draft');
  update public.profiles set locale = 'es' where id = 'a0000000-0000-4000-8000-000000000031';
  update public.profiles set locale = 'fr' where id = 'a0000000-0000-4000-8000-000000000032';
  update public.profiles set locale = 'en' where id = 'a0000000-0000-4000-8000-000000000033';
  insert into public.platform_translations (locale, key, value)
  values ('es', 'notifications.pastDue.subject', 'Pago pendiente: {organization}');
$$;

-- ----------------------------------------------------------------------------
-- Test 1: the worker reads the language of a recipient and the edited texts
-- ----------------------------------------------------------------------------
begin;
select pg_temp.locale_fixture();
set local role app_worker;
do $$
begin
  if private.notification_locale('dono@b.test') is distinct from 'es' then
    raise exception 'notification locale: language of the recipient not read';
  end if;
  -- Case and spaces of the e-mail do not matter.
  if private.notification_locale('  Dono@B.Test ') is distinct from 'es' then
    raise exception 'notification locale: e-mail not normalized';
  end if;
  -- A draft language is never answered: the platform default instead.
  if private.notification_locale('fin@b.test') is distinct from 'pt-BR' then
    raise exception 'notification locale: a draft language was answered';
  end if;
  -- An inactive membership does not identify the person.
  if private.notification_locale('ex@b.test') is distinct from 'pt-BR' then
    raise exception 'notification locale: inactive membership used';
  end if;
  if private.notification_locale('ninguem@x.test') is distinct from 'pt-BR'
     or private.notification_locale('') is distinct from 'pt-BR'
     or private.notification_locale(null) is distinct from 'pt-BR' then
    raise exception 'notification locale: unknown e-mail without the default';
  end if;
  -- The lookup e-mail does not outlive the call.
  if coalesce(current_setting('app.notification_email', true), '') <> '' then
    raise exception 'notification locale: lookup e-mail left in the session';
  end if;
  -- Edits of Plataforma › Idiomas reach the worker.
  if (select value from private.ui_translations('es')
      where key = 'notifications.pastDue.subject') is distinct from 'Pago pendiente: {organization}' then
    raise exception 'notification locale: worker cannot read the edited texts';
  end if;
  if (select count(*) from private.ui_languages()) <> 3 then
    raise exception 'notification locale: worker cannot read the active languages';
  end if;
end
$$;
rollback;

-- ----------------------------------------------------------------------------
-- Test 2: the platform default and a language turned off
-- ----------------------------------------------------------------------------
begin;
select pg_temp.locale_fixture();
update public.platform_languages set is_default = false where code = 'pt-BR';
update public.platform_languages set is_default = true where code = 'en';
update public.platform_languages set status = 'disabled' where code = 'es';
set local role app_worker;
do $$
begin
  if private.notification_locale('ninguem@x.test') is distinct from 'en' then
    raise exception 'notification locale: platform default not used';
  end if;
  if private.notification_locale('dono@b.test') is distinct from 'en' then
    raise exception 'notification locale: a disabled language was answered';
  end if;
  if exists (select 1 from private.ui_translations('es')) then
    raise exception 'notification locale: edits of a disabled language read';
  end if;
end
$$;
rollback;

-- ----------------------------------------------------------------------------
-- Test 3: nothing else leaks
-- ----------------------------------------------------------------------------
begin;
select pg_temp.locale_fixture();
do $$
begin
  if has_function_privilege('anon', 'private.notification_locale(text)', 'execute')
     or has_function_privilege('authenticated', 'private.notification_locale(text)', 'execute') then
    raise exception 'notification locale: callable by anon or authenticated';
  end if;
  -- Only the worker, which sends the e-mails, looks up a recipient.
  if has_function_privilege('app_runtime', 'private.notification_locale(text)', 'execute') then
    raise exception 'notification locale: the dashboard can call it';
  end if;
  if not has_function_privilege('app_worker', 'private.notification_locale(text)', 'execute') then
    raise exception 'notification locale: the worker cannot call it';
  end if;
  -- The I1 readers are closed to PUBLIC too.
  if has_function_privilege('anon', 'private.ui_languages()', 'execute')
     or has_function_privilege('anon', 'private.ui_translations(text)', 'execute')
     or has_function_privilege('anon', 'private.ui_workspace_locale(text)', 'execute') then
    raise exception 'notification locale: I1 readers callable by anon';
  end if;
end
$$;
set local role app_worker;
do $$
begin
  -- The worker still reads no profile and no member's user.
  begin
    perform 1 from public.profiles;
    raise exception 'notification locale: worker reads profiles';
  exception when insufficient_privilege then null;
  end;
  begin
    perform user_id from public.partner_members;
    raise exception 'notification locale: worker reads member users';
  exception when insufficient_privilege then null;
  end;
end
$$;
reset role;
-- The helper sees the rows of the looked-up e-mail only, and nothing
-- without one (other helper functions keep their reach).
set local role app_rls_helper;
do $$
begin
  perform set_config('app.notification_email', '', true);
  if exists (select 1 from public.profiles)
     or exists (select 1 from public.partner_members) then
    raise exception 'notification locale: helper reads rows without a lookup';
  end if;
  perform set_config('app.notification_email', 'dono@b.test', true);
  if (select count(*) from public.profiles) <> 1
     or (select count(*) from public.partner_members) <> 1 then
    raise exception 'notification locale: helper reads beyond the looked-up e-mail';
  end if;
  perform set_config('app.notification_email', 'ex@b.test', true);
  if exists (select 1 from public.profiles) then
    raise exception 'notification locale: helper reads the profile of an inactive member';
  end if;
end
$$;
reset role;
rollback;
