-- ============================================================================
-- Migration: 20261008151000_sma100_rls_admin_helper_and_clean_policies.sql
-- Module: Core Identity & RBAC RLS Helpers (Eliminate Recursion completely)
--
-- Maintenance Rationale:
-- 1. Introduces private.is_organization_admin(uuid) owned by app_rls_helper.
--    Because app_rls_helper evaluates organization_members_helper_select
--    (which compares user_id with no subquery), this helper is completely
--    immune to infinite recursion.
-- 2. Refactors policies on organization_members, invitations and workspace_members
--    to rely solely on non-recursive helpers and context parameters.
-- 3. Provides clean, predictable evaluation for all CRUD operations.
-- ============================================================================

-- 1. Helper function for organization admin/owner check
create or replace function private.is_organization_admin(
  p_organization_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select p_organization_id = private.context_uuid('app.organization_id')
    and exists (
      select 1
      from public.organization_members member
      where member.organization_id = p_organization_id
        and member.user_id = private.context_uuid('app.user_id')
        and member.role in ('owner', 'admin')
        and member.status = 'active'
    );
$$;

alter function private.is_organization_admin(uuid) owner to app_rls_helper;
grant execute on function private.is_organization_admin(uuid) to app_runtime;
revoke execute on function private.is_organization_admin(uuid) from public, anon, authenticated;

-- 2. Clean, non-recursive policies on organization_members
drop policy if exists organization_members_select on public.organization_members;
create policy organization_members_select on public.organization_members
  for select to app_runtime
  using (
    organization_id = private.context_uuid('app.organization_id')
    and (
      private.is_organization_member(organization_id)
      or user_id = private.context_uuid('app.user_id')
    )
  );

drop policy if exists organization_members_insert on public.organization_members;
create policy organization_members_insert on public.organization_members
  for insert to app_runtime
  with check (
    organization_id = private.context_uuid('app.organization_id')
    and (
      private.is_organization_admin(organization_id)
      or user_id = private.context_uuid('app.user_id')
    )
  );

drop policy if exists organization_members_update on public.organization_members;
create policy organization_members_update on public.organization_members
  for update to app_runtime
  using (
    organization_id = private.context_uuid('app.organization_id')
    and private.is_organization_admin(organization_id)
  )
  with check (
    organization_id = private.context_uuid('app.organization_id')
  );

drop policy if exists organization_members_delete on public.organization_members;
create policy organization_members_delete on public.organization_members
  for delete to app_runtime
  using (
    organization_id = private.context_uuid('app.organization_id')
    and (
      user_id = private.context_uuid('app.user_id')
      or private.is_organization_admin(organization_id)
    )
  );

-- 3. Clean, non-recursive policies on invitations
drop policy if exists invitations_select on public.invitations;
create policy invitations_select on public.invitations
  for select to app_runtime
  using (
    (
      organization_id = private.context_uuid('app.organization_id')
      and private.is_organization_member(organization_id)
    )
    or (
      current_setting('app.invitation_token_hash', true) is not null
      and current_setting('app.invitation_token_hash', true) <> ''
      and token_hash = current_setting('app.invitation_token_hash', true)
    )
  );

drop policy if exists invitations_insert on public.invitations;
create policy invitations_insert on public.invitations
  for insert to app_runtime
  with check (
    organization_id = private.context_uuid('app.organization_id')
    and private.is_organization_admin(organization_id)
  );

drop policy if exists invitations_update on public.invitations;
create policy invitations_update on public.invitations
  for update to app_runtime
  using (
    (
      organization_id = private.context_uuid('app.organization_id')
      and private.is_organization_admin(organization_id)
    )
    or (
      current_setting('app.invitation_token_hash', true) is not null
      and current_setting('app.invitation_token_hash', true) <> ''
      and token_hash = current_setting('app.invitation_token_hash', true)
    )
  )
  with check (
    organization_id = private.context_uuid('app.organization_id')
    or (
      current_setting('app.invitation_token_hash', true) is not null
      and current_setting('app.invitation_token_hash', true) <> ''
      and token_hash = current_setting('app.invitation_token_hash', true)
    )
  );

drop policy if exists invitations_delete on public.invitations;
create policy invitations_delete on public.invitations
  for delete to app_runtime
  using (
    organization_id = private.context_uuid('app.organization_id')
    and private.is_organization_admin(organization_id)
  );

-- 4. Clean policies on workspace_members
drop policy if exists workspace_members_select on public.workspace_members;
create policy workspace_members_select on public.workspace_members
  for select to app_runtime
  using (
    (
      workspace_id = private.context_uuid('app.workspace_id')
      and organization_id = private.context_uuid('app.organization_id')
      and private.is_workspace_member(workspace_id, organization_id)
    )
    or (
      user_id = private.context_uuid('app.user_id')
      and organization_id = private.context_uuid('app.organization_id')
      and workspace_id = private.context_uuid('app.workspace_id')
    )
  );

drop policy if exists workspace_members_insert on public.workspace_members;
create policy workspace_members_insert on public.workspace_members
  for insert to app_runtime
  with check (
    workspace_id = private.context_uuid('app.workspace_id')
    and organization_id = private.context_uuid('app.organization_id')
    and (
      private.is_organization_admin(organization_id)
      or private.is_workspace_member(workspace_id, organization_id)
      or user_id = private.context_uuid('app.user_id')
    )
  );

drop policy if exists workspace_members_update on public.workspace_members;
create policy workspace_members_update on public.workspace_members
  for update to app_runtime
  using (
    workspace_id = private.context_uuid('app.workspace_id')
    and organization_id = private.context_uuid('app.organization_id')
    and (
      private.is_organization_admin(organization_id)
      or private.is_workspace_member(workspace_id, organization_id)
    )
  )
  with check (
    workspace_id = private.context_uuid('app.workspace_id')
    and organization_id = private.context_uuid('app.organization_id')
  );

drop policy if exists workspace_members_delete on public.workspace_members;
create policy workspace_members_delete on public.workspace_members
  for delete to app_runtime
  using (
    workspace_id = private.context_uuid('app.workspace_id')
    and organization_id = private.context_uuid('app.organization_id')
    and (
      user_id = private.context_uuid('app.user_id')
      or private.is_organization_admin(organization_id)
      or private.is_workspace_member(workspace_id, organization_id)
    )
  );
