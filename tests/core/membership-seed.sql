-- Synthetic test fixtures for membership, RBAC, invitations and concurrency tests
-- Run as app_migrations or postgres.
insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values
  ('00000000-0000-4000-8000-000000000000', 'd0000000-0000-4000-8000-000000000001', 'authenticated', 'authenticated', 'member-owner@test.guidu.co', '', now(), '{}', '{}', now(), now()),
  ('00000000-0000-4000-8000-000000000000', 'd0000000-0000-4000-8000-000000000002', 'authenticated', 'authenticated', 'member-admin@test.guidu.co', '', now(), '{}', '{}', now(), now()),
  ('00000000-0000-4000-8000-000000000000', 'd0000000-0000-4000-8000-000000000003', 'authenticated', 'authenticated', 'member-user3@test.guidu.co', '', now(), '{}', '{}', now(), now()),
  ('00000000-0000-4000-8000-000000000000', 'd0000000-0000-4000-8000-000000000004', 'authenticated', 'authenticated', 'member-user4@test.guidu.co', '', now(), '{}', '{}', now(), now()),
  ('00000000-0000-4000-8000-000000000000', 'd0000000-0000-4000-8000-000000000005', 'authenticated', 'authenticated', 'member-user5@test.guidu.co', '', now(), '{}', '{}', now(), now()),
  ('00000000-0000-4000-8000-000000000000', 'd0000000-0000-4000-8000-000000000006', 'authenticated', 'authenticated', 'member-user6@test.guidu.co', '', now(), '{}', '{}', now(), now()),
  ('00000000-0000-4000-8000-000000000007', 'd0000000-0000-4000-8000-000000000007', 'authenticated', 'authenticated', 'member-user7@test.guidu.co', '', now(), '{}', '{}', now(), now()),
  ('00000000-0000-4000-8000-000000000008', 'd0000000-0000-4000-8000-000000000008', 'authenticated', 'authenticated', 'member-user8@test.guidu.co', '', now(), '{}', '{}', now(), now()),
  ('00000000-0000-4000-8000-000000000009', 'd0000000-0000-4000-8000-000000000009', 'authenticated', 'authenticated', 'member-user9@test.guidu.co', '', now(), '{}', '{}', now(), now()),
  ('00000000-0000-4000-8000-000000000010', 'd0000000-0000-4000-8000-000000000010', 'authenticated', 'authenticated', 'member-user10@test.guidu.co', '', now(), '{}', '{}', now(), now())
on conflict (id) do nothing;

insert into public.profiles (id, full_name, status) values
  ('d0000000-0000-4000-8000-000000000001', 'Member Test Owner', 'active'),
  ('d0000000-0000-4000-8000-000000000002', 'Member Test Admin', 'active'),
  ('d0000000-0000-4000-8000-000000000003', 'Member Test User 3', 'active'),
  ('d0000000-0000-4000-8000-000000000004', 'Member Test User 4', 'active'),
  ('d0000000-0000-4000-8000-000000000005', 'Member Test User 5', 'active'),
  ('d0000000-0000-4000-8000-000000000006', 'Member Test User 6', 'active'),
  ('d0000000-0000-4000-8000-000000000007', 'Member Test User 7', 'active'),
  ('d0000000-0000-4000-8000-000000000008', 'Member Test User 8', 'active'),
  ('d0000000-0000-4000-8000-000000000009', 'Member Test User 9', 'active'),
  ('d0000000-0000-4000-8000-000000000010', 'Member Test User 10', 'active')
on conflict (id) do nothing;

insert into public.organizations (id, name, status, max_seats) values
  ('d0000000-0000-4000-8000-000000000100', 'Organization Quota Test', 'active', 3)
on conflict (id) do update set max_seats = 3;

insert into public.workspaces (id, organization_id, slug, name, status) values
  ('d0000000-0000-4000-8000-000000000200', 'd0000000-0000-4000-8000-000000000100', 'workspace-quota-test', 'Workspace Quota Test', 'active')
on conflict (id) do nothing;

insert into public.organization_members (organization_id, user_id, role, status) values
  ('d0000000-0000-4000-8000-000000000100', 'd0000000-0000-4000-8000-000000000001', 'owner', 'active')
on conflict (organization_id, user_id) do update set role = 'owner', status = 'active';

insert into public.workspace_members (workspace_id, organization_id, user_id, role, status) values
  ('d0000000-0000-4000-8000-000000000200', 'd0000000-0000-4000-8000-000000000100', 'd0000000-0000-4000-8000-000000000001', 'owner', 'active')
on conflict (workspace_id, user_id) do update set role = 'owner', status = 'active';
