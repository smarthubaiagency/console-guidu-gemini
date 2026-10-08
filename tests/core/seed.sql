-- Synthetic test fixtures. Run as the migration administrator, never as
-- app_runtime. Mirrors tests/core/fixtures.ts.
--
-- Beyond the two isolated tenants, the fixtures carry the identities needed to
-- prove the negative paths: a multi-organization user, an organization-only
-- member (inheritance is off), a revoked workspace membership, and a blocked
-- identity.
insert into auth.users (id, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values
  ('a0000000-0000-4000-8000-000000000031', 'user-a@test.guidu.co', '', now(), '{}', '{}', now(), now()),
  ('a0000000-0000-4000-8000-000000000032', 'user-b@test.guidu.co', '', now(), '{}', '{}', now(), now()),
  ('a0000000-0000-4000-8000-000000000033', 'user-multi-org@test.guidu.co', '', now(), '{}', '{}', now(), now()),
  ('a0000000-0000-4000-8000-000000000034', 'user-org-only@test.guidu.co', '', now(), '{}', '{}', now(), now()),
  ('a0000000-0000-4000-8000-000000000035', 'user-revoked@test.guidu.co', '', now(), '{}', '{}', now(), now()),
  ('a0000000-0000-4000-8000-000000000036', 'user-blocked@test.guidu.co', '', now(), '{}', '{}', now(), now()),
  -- Deliberately has no profile row: used by the profiles INSERT policy tests.
  ('a0000000-0000-4000-8000-000000000037', 'user-no-profile@test.guidu.co', '', now(), '{}', '{}', now(), now()),
  -- Also profile-less: the identity the INSERT policy must refuse to forge.
  ('a0000000-0000-4000-8000-000000000038', 'user-forge-target@test.guidu.co', '', now(), '{}', '{}', now(), now());

insert into public.profiles (id, full_name, status) values
  ('a0000000-0000-4000-8000-000000000031', 'User A', 'active'),
  ('a0000000-0000-4000-8000-000000000032', 'User B', 'active'),
  ('a0000000-0000-4000-8000-000000000033', 'User Multi Org', 'active'),
  ('a0000000-0000-4000-8000-000000000034', 'User Org Only', 'active'),
  ('a0000000-0000-4000-8000-000000000035', 'User Revoked', 'active'),
  ('a0000000-0000-4000-8000-000000000036', 'User Blocked', 'blocked');

insert into public.organizations (id, name, status) values
  ('a0000000-0000-4000-8000-000000000010', 'Organization A', 'active'),
  ('a0000000-0000-4000-8000-000000000020', 'Organization B', 'active');

insert into public.organization_members (organization_id, user_id, role, status) values
  ('a0000000-0000-4000-8000-000000000010', 'a0000000-0000-4000-8000-000000000031', 'owner', 'active'),
  ('a0000000-0000-4000-8000-000000000020', 'a0000000-0000-4000-8000-000000000032', 'owner', 'active'),
  -- Multi-organization user: active in both A and B.
  ('a0000000-0000-4000-8000-000000000010', 'a0000000-0000-4000-8000-000000000033', 'admin', 'active'),
  ('a0000000-0000-4000-8000-000000000020', 'a0000000-0000-4000-8000-000000000033', 'admin', 'active'),
  -- Organization A member with no workspace membership at all.
  ('a0000000-0000-4000-8000-000000000010', 'a0000000-0000-4000-8000-000000000034', 'admin', 'active'),
  ('a0000000-0000-4000-8000-000000000010', 'a0000000-0000-4000-8000-000000000035', 'admin', 'active'),
  ('a0000000-0000-4000-8000-000000000010', 'a0000000-0000-4000-8000-000000000036', 'admin', 'active');

insert into public.workspaces (id, organization_id, slug, name, status) values
  ('a0000000-0000-4000-8000-000000000011', 'a0000000-0000-4000-8000-000000000010', 'workspace-a', 'Workspace A', 'active'),
  ('a0000000-0000-4000-8000-000000000021', 'a0000000-0000-4000-8000-000000000020', 'workspace-b', 'Workspace B', 'active');

insert into public.workspace_members (workspace_id, organization_id, user_id, role, status) values
  ('a0000000-0000-4000-8000-000000000011', 'a0000000-0000-4000-8000-000000000010', 'a0000000-0000-4000-8000-000000000031', 'owner', 'active'),
  ('a0000000-0000-4000-8000-000000000021', 'a0000000-0000-4000-8000-000000000020', 'a0000000-0000-4000-8000-000000000032', 'owner', 'active'),
  -- Multi-organization user belongs to workspace A only.
  ('a0000000-0000-4000-8000-000000000011', 'a0000000-0000-4000-8000-000000000010', 'a0000000-0000-4000-8000-000000000033', 'viewer', 'active'),
  -- Revoked membership: the row exists but is inactive.
  ('a0000000-0000-4000-8000-000000000011', 'a0000000-0000-4000-8000-000000000010', 'a0000000-0000-4000-8000-000000000035', 'viewer', 'inactive'),
  -- Blocked identity keeps an active workspace membership on purpose.
  ('a0000000-0000-4000-8000-000000000011', 'a0000000-0000-4000-8000-000000000010', 'a0000000-0000-4000-8000-000000000036', 'viewer', 'active');
