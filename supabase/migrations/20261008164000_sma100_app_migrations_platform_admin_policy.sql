-- ============================================================================
-- Migration: 20261008164000_sma100_app_migrations_platform_admin_policy.sql
-- Module: Grant app_migrations policy to manage platform_admin_members
--
-- Maintenance Rationale:
-- 1. Permits the migration administrator (app_migrations) to seed and manage
--    platform_admin_members under FORCE ROW LEVEL SECURITY.
-- 2. Leaves app_runtime with zero grants on platform_admin_members (isolation intact).
-- ============================================================================

grant all on public.platform_admin_members to app_migrations;

drop policy if exists platform_admin_members_migration_all on public.platform_admin_members;
create policy platform_admin_members_migration_all on public.platform_admin_members
  for all to app_migrations
  using (true)
  with check (true);
