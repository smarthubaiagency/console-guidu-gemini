-- ============================================================================
-- File: tests/core/audit-seed.sql
-- Synthetic test fixtures for Append-Only Audit Trail tests (C11)
-- Run as app_migrations or postgres. Completely isolated in UUID range e000...
-- ============================================================================

insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values
  ('00000000-0000-4000-8000-000000000000', 'e0000000-0000-4000-8000-000000000031', 'authenticated', 'authenticated', 'audit-owner@test.guidu.co', '', now(), '{}', '{}', now(), now()),
  ('00000000-0000-4000-8000-000000000000', 'e0000000-0000-4000-8000-000000000032', 'authenticated', 'authenticated', 'audit-editor@test.guidu.co', '', now(), '{}', '{}', now(), now()),
  ('00000000-0000-4000-8000-000000000000', 'e0000000-0000-4000-8000-000000000033', 'authenticated', 'authenticated', 'audit-viewer@test.guidu.co', '', now(), '{}', '{}', now(), now()),
  ('00000000-0000-4000-8000-000000000000', 'e0000000-0000-4000-8000-000000000034', 'authenticated', 'authenticated', 'audit-target@test.guidu.co', '', now(), '{}', '{}', now(), now())
on conflict (id) do nothing;

insert into public.profiles (id, full_name, status) values
  ('e0000000-0000-4000-8000-000000000031', 'Audit Test Owner', 'active'),
  ('e0000000-0000-4000-8000-000000000032', 'Audit Test Editor', 'active'),
  ('e0000000-0000-4000-8000-000000000033', 'Audit Test Viewer', 'active'),
  ('e0000000-0000-4000-8000-000000000034', 'Audit Target Member', 'active')
on conflict (id) do nothing;

insert into public.organizations (id, name, status, max_seats) values
  ('e0000000-0000-4000-8000-000000000010', 'Organization Audit Test', 'active', 50)
on conflict (id) do update set max_seats = 50;

insert into public.workspaces (id, organization_id, slug, name, status) values
  ('e0000000-0000-4000-8000-000000000011', 'e0000000-0000-4000-8000-000000000010', 'workspace-audit-test', 'Workspace Audit Test', 'active')
on conflict (id) do nothing;

insert into public.organization_members (organization_id, user_id, role, status) values
  ('e0000000-0000-4000-8000-000000000010', 'e0000000-0000-4000-8000-000000000031', 'owner', 'active'),
  ('e0000000-0000-4000-8000-000000000010', 'e0000000-0000-4000-8000-000000000032', 'admin', 'active'),
  ('e0000000-0000-4000-8000-000000000010', 'e0000000-0000-4000-8000-000000000033', 'admin', 'active'),
  ('e0000000-0000-4000-8000-000000000010', 'e0000000-0000-4000-8000-000000000034', 'admin', 'active')
on conflict (organization_id, user_id) do update set role = excluded.role, status = 'active';

insert into public.workspace_members (workspace_id, organization_id, user_id, role, status) values
  ('e0000000-0000-4000-8000-000000000011', 'e0000000-0000-4000-8000-000000000010', 'e0000000-0000-4000-8000-000000000031', 'owner', 'active'),
  ('e0000000-0000-4000-8000-000000000011', 'e0000000-0000-4000-8000-000000000010', 'e0000000-0000-4000-8000-000000000032', 'editor', 'active'),
  ('e0000000-0000-4000-8000-000000000011', 'e0000000-0000-4000-8000-000000000010', 'e0000000-0000-4000-8000-000000000033', 'viewer', 'active')
on conflict (workspace_id, user_id) do update set role = excluded.role, status = 'active';
