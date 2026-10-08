-- Run as the migration owner, never as app_runtime. Synthetic fixtures only.
-- Three identities: two active (to prove cross-identity denial) and one
-- blocked (to prove revocation holds in the database, not only in the app).

insert into auth.users (instance_id, id, aud, role, email) values
  ('00000000-0000-0000-0000-000000000000', '30000000-0000-4000-8000-000000000001', 'authenticated', 'authenticated', 'identity-a@example.test'),
  ('00000000-0000-0000-0000-000000000000', '30000000-0000-4000-8000-000000000002', 'authenticated', 'authenticated', 'identity-b@example.test'),
  ('00000000-0000-0000-0000-000000000000', '30000000-0000-4000-8000-000000000003', 'authenticated', 'authenticated', 'identity-blocked@example.test')
on conflict (id) do nothing;

insert into public.profiles (id, full_name, status) values
  ('30000000-0000-4000-8000-000000000001', 'Identity A', 'active'),
  ('30000000-0000-4000-8000-000000000002', 'Identity B', 'active'),
  ('30000000-0000-4000-8000-000000000003', 'Blocked Identity', 'blocked')
on conflict (id) do nothing;
