-- Manual cleanup only: deliberately kept outside supabase/migrations so a
-- clean `supabase db reset` retains the spike schema for its validation suite.
drop table if exists public.spike_notes;
drop table if exists public.spike_workspace_members;
drop table if exists public.spike_workspaces;
drop table if exists public.spike_organizations;
drop schema if exists spike_private;
-- Roles are intentionally retained: dropping shared roles is a separate,
-- explicitly approved operation after checking ownership and memberships.

