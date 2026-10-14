-- ============================================================================
-- Migration: 20261112090000_cf3a_email_sender.sql
-- Module: CF3a — e-mail sending with Resend: the sender of each partner
--         (/mnt/project-files/configuracoes/plano-cf3.md)
--
-- Maintenance Rationale:
-- 1. Marcelo (14/10/2026): e-mails leave through Resend (D-PA-08). The
--    sender name and the reply-to address are settings of the cascade
--    (keys `email.from_name` and `email.reply_to`, platform and partner
--    levels); the sending address stays the platform's verified one.
-- 2. The worker sends billing and AI key notices for any partner, and the
--    dashboard sends invitations and test e-mails with the brand of the
--    request's partner, so neither has that partner in its context.
--    `private.email_settings(partner)` returns only the `email.*` rows of
--    the platform and of that partner; they hold no secret (a name and a
--    public address), the same values the e-mails themselves show.
-- Owner app_rls_helper for the security definer function.
-- ============================================================================

create policy settings_helper_email_select on public.settings
  for select to app_rls_helper
  using (key like 'email.%' and scope in ('platform', 'partner'));

create function private.email_settings(p_partner_id uuid)
returns table(scope text, key text, value jsonb, locked boolean)
language sql
stable
security definer
set search_path = ''
as $$
  select s.scope, s.key, s.value, s.locked
  from public.settings s
  where s.key like 'email.%'
    and (s.scope = 'platform'
         or (s.scope = 'partner' and s.partner_id = p_partner_id));
$$;

revoke execute on function private.email_settings(uuid) from public, anon, authenticated;
grant execute on function private.email_settings(uuid) to app_runtime, app_worker;
alter function private.email_settings(uuid) owner to app_rls_helper;
