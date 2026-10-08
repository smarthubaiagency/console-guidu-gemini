-- ============================================================================
-- Migration: 20261008163000_sma100_protect_platform_admin_table.sql
-- Module: Enforce Zero Table Grants on platform_admin_members for app_runtime
--
-- Maintenance Rationale:
-- 1. Restores the isolation invariant tested in tests/core/isolation.test.ts:
--    app_runtime must not hold SELECT privileges directly on platform_admin_members.
-- 2. platform_admin_members remains accessible only to app_rls_helper via
--    platform_admin_members_helper_select for the context user's own active record.
-- 3. Exposes security-definer function `private.get_platform_admin_member()` owned
--    by `app_rls_helper` for app_runtime to inspect the caller's admin status.
-- ============================================================================

-- 1. Revoke direct select grant from app_runtime and remove its policy
drop policy if exists platform_admin_members_select on public.platform_admin_members;
revoke select on public.platform_admin_members from app_runtime;

-- 2. Security-definer helper to retrieve caller's platform admin membership
create or replace function private.get_platform_admin_member()
returns table(
  user_id uuid,
  role text,
  status text
)
language sql
stable
security definer
set search_path = ''
as $$
  select pam.user_id, pam.role, pam.status
  from public.platform_admin_members pam
  where pam.user_id = private.context_uuid('app.user_id')
    and pam.status = 'active';
$$;

alter function private.get_platform_admin_member() owner to app_rls_helper;
revoke execute on function private.get_platform_admin_member() from public, anon, authenticated;
grant execute on function private.get_platform_admin_member() to app_runtime;
