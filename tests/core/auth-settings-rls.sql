-- ============================================================================
-- SQL authentication settings (CF5b): `private.auth_login_settings(partner)`
-- gives the login page, before sign-in, only the `auth.*` rows of the
-- platform and of the host's partner.
--   partner B b7…007 and another partner b7…008 (per block)
--   platform owner d…003, partner admin d…006 (per block)
-- Each block prepares its fixtures as administrator, switches role with
-- `set local role` and rolls back.
-- ============================================================================

create or replace function pg_temp.ctx(p_user uuid, p_partner uuid default null)
returns void
language sql as $$
  select set_config('app.user_id', coalesce(p_user::text, ''), true),
         set_config('app.principal_type', 'user', true),
         set_config('app.workspace_id', '', true),
         set_config('app.organization_id', '', true),
         set_config('app.partner_id', coalesce(p_partner::text, ''), true);
$$;

create or replace function pg_temp.fixture() returns void
language sql as $$
  insert into public.partners (id, slug, name) values
    ('b7000000-0000-4000-8000-000000000007', 'agencia-cf5b', 'Agência CF5b'),
    ('b7000000-0000-4000-8000-000000000008', 'outra-cf5b', 'Outra CF5b');
  insert into public.partner_members (partner_id, user_id, email, role) values
    ('b7000000-0000-4000-8000-000000000007', 'd0000000-0000-4000-8000-000000000006', 'admin@cf5b.test', 'partner_admin');
  insert into public.settings (scope, key, value, locked, updated_by) values
    ('platform', 'auth.google', 'true', false, 'd0000000-0000-4000-8000-000000000003'),
    ('platform', 'region.currency', '"USD"', false, 'd0000000-0000-4000-8000-000000000003');
  insert into public.settings (scope, partner_id, key, value, locked, updated_by) values
    ('partner', 'b7000000-0000-4000-8000-000000000007', 'auth.google', 'false', false,
     'd0000000-0000-4000-8000-000000000006'),
    ('partner', 'b7000000-0000-4000-8000-000000000007', 'email.from_name', '"Agência"', false,
     'd0000000-0000-4000-8000-000000000006'),
    ('partner', 'b7000000-0000-4000-8000-000000000008', 'auth.magic_link', 'false', false,
     'd0000000-0000-4000-8000-000000000006');
$$;

-- ----------------------------------------------------------------------------
-- Test 1: before sign-in, only the `auth.*` rows of the platform and of the
-- host's partner; the table itself stays closed.
-- ----------------------------------------------------------------------------
begin;
select pg_temp.fixture();
set local role app_runtime;
do $$
declare
  rows text;
begin
  -- The login page: no identity, the host's partner only.
  perform pg_temp.ctx(null, 'b7000000-0000-4000-8000-000000000007');
  select string_agg(scope || ':' || key || '=' || (value #>> '{}'), ',' order by scope, key)
    into rows
    from private.auth_login_settings('b7000000-0000-4000-8000-000000000007');
  if rows is distinct from 'partner:auth.google=false,platform:auth.google=true' then
    raise exception 'auth_login_settings: partner rows are %', rows;
  end if;

  -- An unknown host: the platform's rows alone.
  select string_agg(scope || ':' || key, ',' order by scope, key)
    into rows from private.auth_login_settings(null);
  if rows is distinct from 'platform:auth.google' then
    raise exception 'auth_login_settings: platform rows are %', rows;
  end if;

  if exists (select 1 from public.settings) then
    raise exception 'auth_login_settings: a visitor reads the table';
  end if;
end $$;
reset role;

-- The other roles never call it.
set local role authenticated;
do $$
begin
  perform private.auth_login_settings(null);
  raise exception 'auth_login_settings: authenticated called it';
exception when insufficient_privilege then null;
end $$;
reset role;

set local role anon;
do $$
begin
  perform private.auth_login_settings(null);
  raise exception 'auth_login_settings: anon called it';
exception when insufficient_privilege then null;
end $$;
reset role;

set local role app_worker;
do $$
begin
  perform private.auth_login_settings(null);
  raise exception 'auth_login_settings: worker called it';
exception when insufficient_privilege then null;
end $$;
rollback;

-- ----------------------------------------------------------------------------
-- Test 2: writes keep the CF1 rules: the partner admin writes its own
-- `auth.*` rows only, never the platform's or another partner's.
-- ----------------------------------------------------------------------------
begin;
select pg_temp.fixture();
set local role app_runtime;
do $$
begin
  perform pg_temp.ctx('d0000000-0000-4000-8000-000000000006', 'b7000000-0000-4000-8000-000000000007');
  update public.settings set value = 'true', updated_by = 'd0000000-0000-4000-8000-000000000006'
  where scope = 'partner' and key = 'auth.google';
  if not found then raise exception 'settings: partner admin could not change its own auth row'; end if;

  update public.settings set value = 'false', updated_by = 'd0000000-0000-4000-8000-000000000006'
  where scope = 'platform' and key = 'auth.google';
  if found then raise exception 'settings: partner admin changed the platform auth row'; end if;

  begin
    insert into public.settings (scope, partner_id, key, value, updated_by)
    values ('partner', 'b7000000-0000-4000-8000-000000000008', 'auth.google', 'false',
            'd0000000-0000-4000-8000-000000000006');
    raise exception 'settings: partner admin wrote another partner''s auth row';
  exception when insufficient_privilege then null;
  end;
end $$;
rollback;

-- ----------------------------------------------------------------------------
-- Test 3: the function belongs to app_rls_helper and runs as definer.
-- ----------------------------------------------------------------------------
do $$
begin
  if not exists (
    select 1 from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'private' and p.proname = 'auth_login_settings'
      and p.prosecdef and pg_get_userbyid(p.proowner) = 'app_rls_helper'
  ) then
    raise exception 'auth_login_settings: not a security definer of app_rls_helper';
  end if;
end $$;

-- ----------------------------------------------------------------------------
-- Test 4: a save that changes an `auth.*` key is a security event; one that
-- only changes the region is not.
-- ----------------------------------------------------------------------------
do $$
begin
  if not private.is_security_event('partner.settings.save', '{"fields": ["auth.google"]}') then
    raise exception 'is_security_event: auth.* save missing';
  end if;
  if not private.is_security_event('platform.settings.save', '{"fields": ["security.mfa.app"]}') then
    raise exception 'is_security_event: security.* save missing (CF5a)';
  end if;
  if private.is_security_event('platform.settings.save', '{"fields": ["region.currency"]}') then
    raise exception 'is_security_event: region save counted';
  end if;
end $$;
