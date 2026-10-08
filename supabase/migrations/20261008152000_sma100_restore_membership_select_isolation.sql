-- ============================================================================
-- Migration: 20261008152000_sma100_restore_membership_select_isolation.sql
-- Module: Core Identity & Active Membership Isolation (AC01, AC03)
--
-- Maintenance Rationale:
-- Restores strict active membership checks on workspace_members and
-- organization_members SELECT policies so that revoked/inactive members
-- lose all read access immediately (AC03).
-- ============================================================================

drop policy if exists workspace_members_select on public.workspace_members;
create policy workspace_members_select on public.workspace_members
  for select to app_runtime
  using (
    private.is_workspace_member(workspace_id, organization_id)
  );

drop policy if exists organization_members_select on public.organization_members;
create policy organization_members_select on public.organization_members
  for select to app_runtime
  using (
    private.is_organization_member(organization_id)
  );
