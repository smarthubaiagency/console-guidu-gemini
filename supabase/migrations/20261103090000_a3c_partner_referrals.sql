-- ============================================================================
-- Migration: 20261103090000_a3c_partner_referrals.sql
-- Module: A3c — The partner edits the referrals of its customers
--         (especificação v1.0 §5.2 and §6; plano-a3.md)
--
-- Maintenance Rationale:
-- 1. The referrals (`ai_agent_referrals`, the "Parceiros" tab of the legacy)
--    are part of a GUIDS's configuration: the out-of-scope leads are
--    forwarded to them. §5.2 gives them to the partner in `/admin` as well
--    as to the customer; the A1 left them with the workspace only and said
--    the partner's policy would come with the screen (§6).
-- 2. Same rule as the GUIDS configuration (A1, D-AG-17): members of the
--    partner with `partner.ai_agents.read` (owner, admin, support) read the
--    referrals of the workspaces of the partner's companies
--    (`organizations.partner_id`); owner and admin create, change and
--    delete them. Conversations, leads and the knowledge base keep needing
--    the support grant.
-- 3. The row says who changed it last (`updated_by`); the partner's changes
--    are audited by the service, with before and after.
-- Policies only: no data and no column changes.
-- ============================================================================

create policy ai_agent_referrals_partner_select on public.ai_agent_referrals
  for select to app_runtime
  using (
    private.current_partner_role() in ('partner_owner', 'partner_admin', 'partner_support')
    and private.is_partner_organization(organization_id)
  );

create policy ai_agent_referrals_partner_insert on public.ai_agent_referrals
  for insert to app_runtime
  with check (
    private.current_partner_role() in ('partner_owner', 'partner_admin')
    and private.is_partner_organization(organization_id)
    and created_by = private.context_uuid('app.user_id')
    and updated_by is null
  );

create policy ai_agent_referrals_partner_update on public.ai_agent_referrals
  for update to app_runtime
  using (
    private.current_partner_role() in ('partner_owner', 'partner_admin')
    and private.is_partner_organization(organization_id)
  )
  with check (
    private.current_partner_role() in ('partner_owner', 'partner_admin')
    and private.is_partner_organization(organization_id)
    and updated_by = private.context_uuid('app.user_id')
  );

create policy ai_agent_referrals_partner_delete on public.ai_agent_referrals
  for delete to app_runtime
  using (
    private.current_partner_role() in ('partner_owner', 'partner_admin')
    and private.is_partner_organization(organization_id)
  );
