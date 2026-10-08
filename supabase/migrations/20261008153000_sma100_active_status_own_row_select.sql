-- ============================================================================
-- Migration: 20261008153000_sma100_active_status_own_row_select.sql
-- Module: Core Identity & Active Own-Row Select Policies
--
-- Maintenance Rationale:
-- 1. Evaluates status = 'active' when selecting own membership rows, ensuring
--    inactive/revoked members see 0 rows (AC03).
-- 2. Enables Prisma INSERT ... RETURNING * to immediately return the newly
--    created active row during invitation acceptance.
-- ============================================================================

drop policy if exists organization_members_select on public.organization_members;
create policy organization_members_select on public.organization_members
  for select to app_runtime
  using (
    organization_id = private.context_uuid('app.organization_id')
    and (
      private.is_organization_member(organization_id)
      or (
        user_id = private.context_uuid('app.user_id')
        and status = 'active'
      )
    )
  );

drop policy if exists workspace_members_select on public.workspace_members;
create policy workspace_members_select on public.workspace_members
  for select to app_runtime
  using (
    workspace_id = private.context_uuid('app.workspace_id')
    and organization_id = private.context_uuid('app.organization_id')
    and (
      private.is_workspace_member(workspace_id, organization_id)
      or (
        user_id = private.context_uuid('app.user_id')
        and status = 'active'
      )
    )
  );
