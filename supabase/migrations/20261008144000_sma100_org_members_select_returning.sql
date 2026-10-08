-- ============================================================================
-- Migration: 20261008144000_sma100_org_members_select_returning.sql
-- Module: Core Identity & Organization Members Select Policy (Prisma RETURNING support)
--
-- Maintenance Rationale:
-- Prisma executes INSERT with a RETURNING clause. Under PostgreSQL RLS,
-- RETURNING * evaluates the SELECT policy for the newly inserted row.
-- Permitting the user to select their own row in the contextual organization
-- enables atomic INSERT ... RETURNING during invitation acceptance without
-- widening access across organizations.
-- ============================================================================

drop policy if exists organization_members_select on public.organization_members;
create policy organization_members_select on public.organization_members
  for select to app_runtime
  using (
    private.is_organization_member(organization_id)
    or (
      user_id = private.context_uuid('app.user_id')
      and organization_id = private.context_uuid('app.organization_id')
    )
  );

drop policy if exists workspace_members_select on public.workspace_members;
create policy workspace_members_select on public.workspace_members
  for select to app_runtime
  using (
    private.is_workspace_member(workspace_id, organization_id)
    or (
      user_id = private.context_uuid('app.user_id')
      and organization_id = private.context_uuid('app.organization_id')
      and workspace_id = private.context_uuid('app.workspace_id')
    )
  );
