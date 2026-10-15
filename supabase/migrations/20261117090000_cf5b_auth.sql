-- ============================================================================
-- Migration: 20261117090000_cf5b_auth.sql
-- Module: CF5b — Configurações › Autenticação: login methods of each host
--         (/mnt/project-files/configuracoes/plano-cf5.md)
--
-- Maintenance Rationale:
-- 1. Marcelo (14 and 15/10/2026): "Entrar com Google" and the sign-in link
--    by e-mail are settings of the cascade (keys `auth.google` and
--    `auth.magic_link`, platform and partner levels): the platform offers a
--    method, the partner may hide it on its own hosts. Supabase Auth itself
--    is not changed here; the buttons also need the provider switched on by
--    operations (`AUTH_GOOGLE_ENABLED`, `AUTH_MAGIC_LINK_ENABLED`,
--    docs/operacao/autenticacao.md).
-- 2. The login page is read before sign-in, with no identity, so
--    `private.settings_cascade()` only returns the platform rows there.
--    `private.auth_login_settings(partner)` returns only the `auth.*` rows
--    of the platform and of the host's partner: two switches that hold no
--    secret and that the login page itself shows to anyone.
-- 3. Writes keep going through `public.settings` and its policies (CF1);
--    each save is audited (`<level>.settings.save`). A save that changes an
--    `auth.*` key is also a security event (Segurança › Eventos, CF5a), like
--    one that changes a `security.*` key.
-- Owner app_rls_helper for the security definer function; the event
-- predicate stays with app_migrations, as in CF5a.
-- ============================================================================

create policy settings_helper_auth_select on public.settings
  for select to app_rls_helper
  using (key like 'auth.%' and scope in ('platform', 'partner'));

create function private.auth_login_settings(p_partner_id uuid)
returns table(scope text, key text, value jsonb, locked boolean)
language sql
stable
security definer
set search_path = ''
as $$
  select s.scope, s.key, s.value, s.locked
  from public.settings s
  where s.key like 'auth.%'
    and (s.scope = 'platform'
         or (s.scope = 'partner' and s.partner_id = p_partner_id));
$$;

revoke execute on function private.auth_login_settings(uuid) from public, anon, authenticated;
grant execute on function private.auth_login_settings(uuid) to app_runtime;
alter function private.auth_login_settings(uuid) owner to app_rls_helper;

-- Which audit actions are security events: CF5a plus the `auth.*` keys.
create or replace function private.is_security_event(p_action text, p_metadata jsonb)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select p_action like 'auth.%'
    or p_action like '%.security.%'
    or p_action in (
      'api_keys.created', 'api_keys.revoked',
      'platform_api_keys.create', 'platform_api_keys.revoke',
      'credentials.created', 'credentials.revoked',
      'partner.ai_credentials.create', 'partner.ai_credentials.revoke',
      'organization_members.role_changed', 'organization_members.removed',
      'workspace_members.role_changed', 'workspace_members.removed',
      'partner.member.join', 'partner.member.update',
      'invitations.created', 'invitations.accepted', 'invitations.revoked',
      'partner.invitation.create', 'partner.invitation.revoke',
      'partner.support.request', 'partner.support.end', 'partner.support.revoke'
    )
    or (p_action like '%.settings.save'
        and jsonb_typeof(p_metadata -> 'fields') = 'array'
        and exists (
          select 1
          from jsonb_array_elements_text(p_metadata -> 'fields') as field(name)
          where field.name like 'security.%' or field.name like 'auth.%'
        ));
$$;

alter function private.is_security_event(text, jsonb) owner to app_migrations;
revoke execute on function private.is_security_event(text, jsonb) from public, anon, authenticated;
grant execute on function private.is_security_event(text, jsonb) to app_runtime, app_rls_helper;
