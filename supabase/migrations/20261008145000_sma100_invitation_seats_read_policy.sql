-- ============================================================================
-- Migration: 20261008145000_sma100_invitation_seats_read_policy.sql
-- Module: Core Identity & Organization Members Select Policy under Invitation
--
-- Maintenance Rationale:
-- When an invited user accepts an invitation, the transaction must evaluate
-- current seat usage (active member count) against organization.max_seats.
-- This policy permits selecting organization_members within the contextual
-- organization when holding a valid pending invitation token_hash, enabling
-- accurate concurrency quota enforcement (AC06).
-- Cross-tenant isolation is strictly preserved via organization_id check.
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
    or (
      organization_id = private.context_uuid('app.organization_id')
      and current_setting('app.invitation_token_hash', true) is not null
      and current_setting('app.invitation_token_hash', true) <> ''
      and exists (
        select 1
        from public.invitations inv
        where inv.organization_id = organization_members.organization_id
          and inv.token_hash = current_setting('app.invitation_token_hash', true)
          and inv.status = 'pending'
      )
    )
  );
