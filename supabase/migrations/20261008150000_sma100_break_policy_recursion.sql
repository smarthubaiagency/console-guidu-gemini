-- ============================================================================
-- Migration: 20261008150000_sma100_break_policy_recursion.sql
-- Module: Core Identity & Invitations RLS (Eliminate Mutual Recursion)
--
-- Maintenance Rationale:
-- Breaks circular dependency between organization_members and invitations:
-- 1. invitations policies scope purely to app.organization_id or app.invitation_token_hash
--    without referencing organization_members.
-- 2. organization_members_select permits selecting within app.organization_id
--    when holding an active membership, when reading own row, or when presenting
--    a valid pending invitation token for quota calculation (AC06).
-- 3. Both tables maintain strict multi-tenant isolation with zero recursion.
-- ============================================================================

-- 1. Redefine invitations policies without subqueries to organization_members
drop policy if exists invitations_select on public.invitations;
create policy invitations_select on public.invitations
  for select to app_runtime
  using (
    organization_id = private.context_uuid('app.organization_id')
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
  );

drop policy if exists invitations_update on public.invitations;
create policy invitations_update on public.invitations
  for update to app_runtime
  using (
    organization_id = private.context_uuid('app.organization_id')
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
  );

-- 2. Redefine organization_members_select to avoid infinite recursion
drop policy if exists organization_members_select on public.organization_members;
create policy organization_members_select on public.organization_members
  for select to app_runtime
  using (
    organization_id = private.context_uuid('app.organization_id')
    and (
      private.is_organization_member(organization_id)
      or user_id = private.context_uuid('app.user_id')
      or (
        current_setting('app.invitation_token_hash', true) is not null
        and current_setting('app.invitation_token_hash', true) <> ''
        and exists (
          select 1
          from public.invitations inv
          where inv.organization_id = organization_members.organization_id
            and inv.token_hash = current_setting('app.invitation_token_hash', true)
            and inv.status = 'pending'
        )
      )
    )
  );
