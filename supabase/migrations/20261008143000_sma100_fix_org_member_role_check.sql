-- ============================================================================
-- Migration: 20261008143000_sma100_fix_org_member_role_check.sql
-- Module: Core Identity, RBAC & Invitations Acceptance Policies
--
-- Maintenance Rationale:
-- 1. Updates organization_members_role_check to permit 'member' role in addition
--    to 'owner' and 'admin', allowing regular non-admin staff to be members of
--    an organization without administrative privileges.
-- 2. Refines invitations_update policy to ensure the invitation acceptance and
--    expiration marking paths can safely update status under app.invitation_token_hash.
-- 3. Refines organization_members_insert policy for atomic invitation acceptance.
-- ============================================================================

-- 1. Support 'member' role in organization_members
alter table public.organization_members
  drop constraint if exists organization_members_role_check;

alter table public.organization_members
  add constraint organization_members_role_check
  check (role in ('owner', 'admin', 'member'));

-- 2. Refine invitations_update RLS policy
drop policy if exists invitations_update on public.invitations;
create policy invitations_update on public.invitations
  for update to app_runtime
  using (
    (
      private.is_organization_member(organization_id)
      and exists (
        select 1
        from public.organization_members m
        where m.organization_id = organization_id
          and m.user_id = private.context_uuid('app.user_id')
          and m.role in ('owner', 'admin')
          and m.status = 'active'
      )
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

-- 3. Refine organization_members_insert RLS policy
drop policy if exists organization_members_insert on public.organization_members;
create policy organization_members_insert on public.organization_members
  for insert to app_runtime
  with check (
    organization_id = private.context_uuid('app.organization_id')
    and (
      exists (
        select 1
        from public.organization_members m
        where m.organization_id = private.context_uuid('app.organization_id')
          and m.user_id = private.context_uuid('app.user_id')
          and m.role in ('owner', 'admin')
          and m.status = 'active'
      )
      or (
        user_id = private.context_uuid('app.user_id')
        and exists (
          select 1
          from public.invitations inv
          where inv.organization_id = private.context_uuid('app.organization_id')
            and inv.token_hash = current_setting('app.invitation_token_hash', true)
            and inv.status = 'pending'
        )
      )
    )
  );
