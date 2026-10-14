-- ============================================================================
-- Migration: 20261108090000_a6b_referral_notices.sql
-- Module: A6b — the GUIDS refers a contact to a referral (plano-a6.md;
--         campos.md §4)
--
-- Maintenance Rationale:
-- 1. A referral the GUIDS gives a contact is told to the merchant through
--    the same partner webhook of the A6a (Marcelo, 14/10/2026: "nós >>
--    cliente >> indicado"; the merchant tells the referral, never us).
--    The notice table gains a kind: `lead` (A6a, once per agent and
--    contact, with score) or `referral` (once per conversation and
--    referral, with the referral and the reason; the contact may not exist
--    yet in the CRM).
-- 2. The referral is referenced in its own workspace and kept as null when
--    deleted, as in the lead log.
-- ============================================================================

alter table public.ai_lead_notices
  add column kind text not null default 'lead' check (kind in ('lead', 'referral')),
  add column referral_id uuid,
  add column reason_text text check (reason_text is null or length(reason_text) <= 500),
  alter column contact_id drop not null,
  alter column points drop not null,
  alter column temperature drop not null,
  add constraint ai_lead_notices_kind_fields_check check (
    (kind = 'lead' and contact_id is not null and points is not null and temperature is not null)
    or (kind = 'referral' and points is null and temperature is null)
  ),
  add constraint fk_ai_lead_notices_referral
    foreign key (referral_id, workspace_id)
    references public.ai_agent_referrals(id, workspace_id) on delete set null (referral_id);

-- Once per agent and contact for a lead; once per conversation and
-- referral for a referral.
alter table public.ai_lead_notices drop constraint ai_lead_notices_contact_key;
create unique index ai_lead_notices_lead_key
  on public.ai_lead_notices (agent_id, contact_id) where kind = 'lead';
create unique index ai_lead_notices_referral_key
  on public.ai_lead_notices (conversation_id, referral_id) where kind = 'referral';
