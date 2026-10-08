-- ============================================================================
-- File: tests/core/admin-seed.sql
-- Synthetic test fixtures for Platform Administration tests
-- User d0000000-0000-4000-8000-000000000003 is already created in auth.users
-- ============================================================================

insert into public.platform_admin_members (user_id, role, status)
values
  ('d0000000-0000-4000-8000-000000000003', 'owner', 'active')
on conflict (user_id) do update set role = 'owner', status = 'active';
