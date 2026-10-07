-- Cleanup only: keep ready, but DO NOT APPLY as part of SMA-92 validation.
drop table if exists public.spike_notes;
drop table if exists public.spike_workspace_members;
drop table if exists public.spike_workspaces;
drop table if exists public.spike_organizations;
drop schema if exists spike_private;
-- Roles are intentionally retained: dropping shared roles is a separate,
-- explicitly approved operation after checking ownership and memberships.

