-- ============================================================================
-- Migration: 20261107090000_a6a_lead_notices.sql
-- Module: A6a — the GUIDS tells the merchant about a hot lead (plano-a6.md;
--         campos.md §3)
--
-- Maintenance Rationale:
-- 1. `partner_notice_webhooks`: one webhook per partner (Marcelo,
--    14/10/2026). The notices of its customers' GUIDS go to it as a signed
--    JSON POST, and the partner's own flow sends the WhatsApp message from
--    the merchant's Assistant number (not the GUIDS's Meta number). The
--    signing secret is encrypted with the cipher of the vaults; partner
--    owner and admin manage it in /admin, as the admin keys.
-- 2. The engine reads the webhook of the partner of the turn through a
--    security definer function (app_rls_helper), as it reads the admin key
--    (A2b): the payload stays encrypted, only the server decrypts it.
-- 3. `ai_lead_notices`: one notice per (agent, contact), written by the
--    `score_lead` tool when the lead crosses the agent's notice score (or a
--    rule marked "avisar na hora") and delivered by a job. It is the record
--    the panel shows: sent, failed or skipped, with the reason.
-- 4. Purge of a deleted workspace (F3e) as the worker.
-- Owner app_migrations, ENABLE + FORCE RLS, no grants to anon/authenticated.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. The partner's webhook
-- ----------------------------------------------------------------------------
create table public.partner_notice_webhooks (
  partner_id        uuid primary key references public.partners(id) on delete cascade,
  url               text not null check (url ~ '^https?://' and length(url) between 10 and 2000),
  masked_secret     text not null check (length(masked_secret) between 1 and 40),
  encrypted_secret  text not null,
  enabled           boolean not null default true,
  updated_by        uuid not null references public.profiles(id) on delete cascade,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

alter table public.partner_notice_webhooks owner to app_migrations;
revoke all on public.partner_notice_webhooks from public, anon, authenticated;
alter table public.partner_notice_webhooks enable row level security;
alter table public.partner_notice_webhooks force row level security;

create trigger partner_notice_webhooks_touch_updated_at
  before update on public.partner_notice_webhooks
  for each row execute function private.touch_updated_at();

create policy partner_notice_webhooks_select on public.partner_notice_webhooks
  for select to app_runtime
  using (
    partner_id = private.current_partner_id()
    and private.current_partner_role() in ('partner_owner', 'partner_admin')
  );

create policy partner_notice_webhooks_insert on public.partner_notice_webhooks
  for insert to app_runtime
  with check (
    partner_id = private.current_partner_id()
    and updated_by = private.context_uuid('app.user_id')
    and private.current_partner_role() in ('partner_owner', 'partner_admin')
  );

create policy partner_notice_webhooks_update on public.partner_notice_webhooks
  for update to app_runtime
  using (
    partner_id = private.current_partner_id()
    and private.current_partner_role() in ('partner_owner', 'partner_admin')
  )
  with check (
    partner_id = private.current_partner_id()
    and updated_by = private.context_uuid('app.user_id')
    and private.current_partner_role() in ('partner_owner', 'partner_admin')
  );

create policy partner_notice_webhooks_delete on public.partner_notice_webhooks
  for delete to app_runtime
  using (
    partner_id = private.current_partner_id()
    and private.current_partner_role() in ('partner_owner', 'partner_admin')
  );

grant select, insert, delete on public.partner_notice_webhooks to app_runtime;
grant update (url, masked_secret, encrypted_secret, enabled, updated_by, updated_at)
  on public.partner_notice_webhooks to app_runtime;

-- ----------------------------------------------------------------------------
-- 2. The webhook for the engine
-- ----------------------------------------------------------------------------
create policy partner_notice_webhooks_helper_select on public.partner_notice_webhooks
  for select to app_rls_helper
  using (enabled and partner_id = private.ai_turn_partner_id());

grant select on public.partner_notice_webhooks to app_rls_helper;

create function private.ai_notice_webhook()
returns table(url text, encrypted_secret text)
language sql
stable
security definer
set search_path = ''
as $$
  select webhook.url, webhook.encrypted_secret
  from public.partner_notice_webhooks webhook
  where webhook.enabled
    and webhook.partner_id = private.ai_turn_partner_id();
$$;

revoke execute on function private.ai_notice_webhook() from public, anon, authenticated;
grant execute on function private.ai_notice_webhook() to app_runtime;
alter function private.ai_notice_webhook() owner to app_rls_helper;

-- ----------------------------------------------------------------------------
-- 3. Lead notices
-- ----------------------------------------------------------------------------
create table public.ai_lead_notices (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null,
  workspace_id     uuid not null,
  agent_id         uuid not null,
  contact_id       uuid not null,
  conversation_id  uuid not null,
  points           integer not null check (points between -100000 and 100000),
  temperature      text not null check (temperature in ('hot', 'warm', 'cold', 'suspect')),
  -- whatsapp: the partner's webhook; email and sms wait for a provider.
  channel          text not null check (channel in ('whatsapp', 'email', 'sms')),
  status           text not null default 'pending' check (status in ('pending', 'sent', 'failed', 'skipped')),
  reason           text check (reason is null or length(reason) <= 80),
  attempts         integer not null default 0 check (attempts between 0 and 100),
  created_at       timestamptz not null default now(),
  sent_at          timestamptz,
  constraint ai_lead_notices_contact_key unique (agent_id, contact_id),
  constraint fk_ai_lead_notices_workspace
    foreign key (workspace_id, organization_id)
    references public.workspaces(id, organization_id) on delete cascade,
  constraint fk_ai_lead_notices_contact
    foreign key (contact_id, workspace_id)
    references public.crm_contacts(id, workspace_id) on delete cascade,
  constraint fk_ai_lead_notices_agent
    foreign key (agent_id, workspace_id)
    references public.ai_agents(id, workspace_id) on delete cascade
);

create index ai_lead_notices_agent_idx
  on public.ai_lead_notices (agent_id, created_at desc);

alter table public.ai_lead_notices owner to app_migrations;
revoke all on public.ai_lead_notices from public, anon, authenticated;
alter table public.ai_lead_notices enable row level security;
alter table public.ai_lead_notices force row level security;

-- Read by the workspace, as the lead log.
create policy ai_lead_notices_select on public.ai_lead_notices
  for select to app_runtime
  using (
    workspace_id = private.context_uuid('app.workspace_id')
    and organization_id = private.context_uuid('app.organization_id')
    and private.current_workspace_role() in ('owner', 'admin', 'editor')
  );

-- Written by the engine, as whom runs the turn.
create policy ai_lead_notices_insert on public.ai_lead_notices
  for insert to app_runtime
  with check (
    workspace_id = private.context_uuid('app.workspace_id')
    and organization_id = private.context_uuid('app.organization_id')
    and status = 'pending'
    and attempts = 0
    and private.current_workspace_role() in ('owner', 'admin', 'editor')
  );

create policy ai_lead_notices_update on public.ai_lead_notices
  for update to app_runtime
  using (
    workspace_id = private.context_uuid('app.workspace_id')
    and organization_id = private.context_uuid('app.organization_id')
    and private.current_workspace_role() in ('owner', 'admin', 'editor')
  )
  with check (
    workspace_id = private.context_uuid('app.workspace_id')
    and organization_id = private.context_uuid('app.organization_id')
    and private.current_workspace_role() in ('owner', 'admin', 'editor')
  );

grant select, insert on public.ai_lead_notices to app_runtime;
grant update (status, reason, attempts, sent_at) on public.ai_lead_notices to app_runtime;

-- ----------------------------------------------------------------------------
-- 4. Purge of a deleted workspace (F3e)
-- ----------------------------------------------------------------------------
create policy ai_lead_notices_worker_purge on public.ai_lead_notices
  for delete to app_worker using (private.workspace_purgeable(workspace_id));
create policy ai_lead_notices_worker_purge_select on public.ai_lead_notices
  for select to app_worker using (private.workspace_purgeable(workspace_id));
grant select (workspace_id), delete on public.ai_lead_notices to app_worker;
