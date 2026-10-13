-- ============================================================================
-- Migration: 20261030090000_a2a_ai_engine_data.sql
-- Module: A2a — Data and keys of the AI engine (especificação v1.0 §7, §9,
--         §12 e §15; plano-a2.md)
--
-- Maintenance Rationale:
-- 1. `public.ai_conversations` and `public.ai_messages`: conversations of
--    the GUIDS (workspace) and of the Assistant (partner agent, owned by the
--    person who talks to it). They replace the prototype's agent_sessions
--    and agent_messages. Messages follow the visibility of their
--    conversation.
-- 2. `public.ai_usage_events`: consumption per model call, with the key
--    used (customer, admin or backup). Backup use is a courtesy (§9.2) and
--    never counts for the customer.
-- 3. `public.partner_credentials`: the partner's vault for the admin key of
--    its Assistant (§9.1), with the cipher of the workspace vault.
-- 4. `public.platform_ai_settings`: the platform backup key and its cheap
--    model (§9.2), one row.
-- 5. OpenRouter joins the providers of the workspace vault.
-- 6. The prototype tables (agent_configs, agent_sessions, agent_messages)
--    leave with the prototype code (D-AG-11).
-- This stage only reads: the engine (A2b) adds the write policies of
-- conversations, messages and usage together with the code that writes
-- them, and the worker policies of the GUIDS turn.
-- Owner app_migrations, ENABLE + FORCE RLS, no grants to anon/authenticated.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Prototype out (D-AG-11)
-- ----------------------------------------------------------------------------
drop table public.agent_messages;
drop table public.agent_sessions;
drop table public.agent_configs;

-- ----------------------------------------------------------------------------
-- 2. OpenRouter in the workspace vault
-- ----------------------------------------------------------------------------
alter table public.credentials drop constraint credentials_provider_check;
alter table public.credentials add constraint credentials_provider_check
  check (provider in ('openai', 'anthropic', 'gemini', 'openrouter'));

-- ----------------------------------------------------------------------------
-- 3. Conversations
-- ----------------------------------------------------------------------------
-- An Assistant conversation references an assistant of its own partner.
alter table public.ai_agents
  add constraint ai_agents_id_partner_key unique (id, partner_id);

create table public.ai_conversations (
  id              uuid primary key default gen_random_uuid(),
  kind            text not null check (kind in ('assistant', 'guid')),
  agent_id        uuid not null,
  partner_id      uuid references public.partners(id) on delete cascade,
  organization_id uuid,
  workspace_id    uuid,
  -- GUIDS: the CRM contact on the other side (channels, A5).
  contact_id      uuid,
  -- Who talks: the person of an Assistant conversation or of a GUIDS test.
  user_id         uuid references public.profiles(id) on delete cascade,
  -- The channels of the A5 extend this list.
  channel         text not null check (channel in ('test', 'panel')),
  status          text not null default 'active' check (status in ('active', 'handoff', 'closed')),
  -- Conversation memory (variaveis.md §2.5), written by set_conversation_variable.
  variables       jsonb not null default '{}'::jsonb check (jsonb_typeof(variables) = 'object'),
  summary         text check (summary is null or length(summary) <= 20000),
  -- Answered with the platform backup key (§9.2): only conversations that
  -- were already open when the customer key failed.
  key_mode        text not null default 'own' check (key_mode in ('own', 'backup')),
  last_message_at timestamptz,
  closed_at       timestamptz,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  guid_workspace_id uuid generated always as (case when kind = 'guid' then workspace_id end) stored,
  constraint ai_conversations_owner_check check (
    (kind = 'guid' and partner_id is null and workspace_id is not null and organization_id is not null)
    or (
      kind = 'assistant' and partner_id is not null and user_id is not null and contact_id is null
      and (workspace_id is null) = (organization_id is null)
    )
  ),
  constraint ai_conversations_closed_check check ((status = 'closed') = (closed_at is not null)),
  constraint fk_ai_conversations_workspace
    foreign key (workspace_id, organization_id)
    references public.workspaces(id, organization_id) on delete cascade,
  -- A GUIDS conversation belongs to a GUIDS of its own workspace.
  constraint fk_ai_conversations_guid
    foreign key (agent_id, guid_workspace_id)
    references public.ai_agents(id, workspace_id) on delete cascade,
  -- An Assistant conversation belongs to the Assistant of its partner.
  constraint fk_ai_conversations_assistant
    foreign key (agent_id, partner_id)
    references public.ai_agents(id, partner_id) on delete cascade,
  constraint fk_ai_conversations_contact
    foreign key (contact_id, workspace_id)
    references public.crm_contacts(id, workspace_id) on delete cascade
);

alter table public.ai_conversations owner to app_migrations;

create index ai_conversations_workspace_idx
  on public.ai_conversations (workspace_id, last_message_at desc) where kind = 'guid';
create index ai_conversations_agent_idx
  on public.ai_conversations (agent_id, created_at desc);
create index ai_conversations_user_idx
  on public.ai_conversations (user_id, last_message_at desc) where kind = 'assistant';
create index ai_conversations_contact_idx
  on public.ai_conversations (contact_id) where contact_id is not null;

create trigger ai_conversations_touch_updated_at
  before update on public.ai_conversations
  for each row execute function private.touch_updated_at();

create table public.ai_messages (
  id              uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.ai_conversations(id) on delete cascade,
  role            text not null check (role in ('user', 'assistant', 'tool')),
  content         text not null default '' check (length(content) <= 100000),
  -- [{ id, name, input }] asked by the model in an assistant message.
  tool_calls      jsonb not null default '[]'::jsonb check (jsonb_typeof(tool_calls) = 'array'),
  -- A tool message answers one call.
  tool_call_id    text check (tool_call_id is null or length(tool_call_id) <= 200),
  tool_name       text check (tool_name is null or length(tool_name) <= 80),
  -- The turn that wrote the message (one id per turn, shared with the usage
  -- and the audit).
  execution_id    uuid,
  provider        text check (provider is null or provider in ('openai', 'anthropic', 'gemini', 'openrouter')),
  model           text check (model is null or length(model) <= 200),
  input_tokens    integer check (input_tokens is null or input_tokens >= 0),
  output_tokens   integer check (output_tokens is null or output_tokens >= 0),
  error_code      text check (error_code is null or length(error_code) <= 80),
  created_at      timestamptz not null default now(),
  constraint ai_messages_tool_check check ((role = 'tool') = (tool_call_id is not null))
);

alter table public.ai_messages owner to app_migrations;

create index ai_messages_conversation_idx
  on public.ai_messages (conversation_id, created_at, id);
create index ai_messages_execution_idx
  on public.ai_messages (execution_id) where execution_id is not null;

-- ----------------------------------------------------------------------------
-- 4. Usage
-- ----------------------------------------------------------------------------
create table public.ai_usage_events (
  id              uuid primary key default gen_random_uuid(),
  execution_id    uuid not null,
  partner_id      uuid references public.partners(id) on delete cascade,
  organization_id uuid,
  workspace_id    uuid,
  -- Kept when the agent or the conversation is deleted: usage is history.
  agent_id        uuid references public.ai_agents(id) on delete set null,
  conversation_id uuid references public.ai_conversations(id) on delete set null,
  key_source      text not null check (key_source in ('customer', 'admin', 'backup')),
  -- Backup use is a courtesy of the platform (§9.2).
  courtesy        boolean generated always as (key_source = 'backup') stored,
  provider        text not null check (provider in ('openai', 'anthropic', 'gemini', 'openrouter')),
  model           text not null check (length(model) between 1 and 200),
  -- chat or embeddings; audio arrives with the channels.
  usage_kind      text not null default 'chat' check (usage_kind in ('chat', 'embeddings')),
  input_tokens    integer not null default 0 check (input_tokens >= 0),
  output_tokens   integer not null default 0 check (output_tokens >= 0),
  created_at      timestamptz not null default now(),
  constraint ai_usage_events_owner_check check (
    (workspace_id is null) = (organization_id is null)
    and (key_source <> 'admin' or partner_id is not null)
    and (key_source = 'admin' or workspace_id is not null)
  ),
  constraint fk_ai_usage_events_workspace
    foreign key (workspace_id, organization_id)
    references public.workspaces(id, organization_id) on delete cascade
);

alter table public.ai_usage_events owner to app_migrations;

create index ai_usage_events_workspace_idx
  on public.ai_usage_events (workspace_id, created_at desc) where workspace_id is not null;
create index ai_usage_events_partner_idx
  on public.ai_usage_events (partner_id, created_at desc) where partner_id is not null;
create index ai_usage_events_execution_idx
  on public.ai_usage_events (execution_id);

-- ----------------------------------------------------------------------------
-- 5. Partner vault (admin key)
-- ----------------------------------------------------------------------------
create table public.partner_credentials (
  id                uuid primary key default gen_random_uuid(),
  partner_id        uuid not null references public.partners(id) on delete cascade,
  provider          text not null check (provider in ('openai', 'anthropic', 'gemini', 'openrouter')),
  purpose           text not null default 'all' check (purpose in ('chat', 'embeddings', 'all')),
  label             text not null check (length(btrim(label)) between 1 and 120),
  masked_value      text not null,
  encrypted_payload text not null,
  status            text not null default 'active' check (status in ('active', 'revoked')),
  created_by        uuid not null references public.profiles(id) on delete cascade,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

alter table public.partner_credentials owner to app_migrations;

create index partner_credentials_partner_idx
  on public.partner_credentials (partner_id, provider, status);

create trigger partner_credentials_touch_updated_at
  before update on public.partner_credentials
  for each row execute function private.touch_updated_at();

-- ----------------------------------------------------------------------------
-- 6. Platform backup key (one row)
-- ----------------------------------------------------------------------------
create table public.platform_ai_settings (
  id                       boolean primary key default true check (id),
  backup_provider          text check (backup_provider is null or backup_provider in ('openai', 'anthropic', 'gemini', 'openrouter')),
  backup_masked_value      text,
  backup_encrypted_payload text,
  -- The cheap model the backup answers with.
  backup_model             text check (backup_model is null or length(backup_model) between 1 and 200),
  updated_by               uuid not null references public.profiles(id),
  created_at               timestamptz not null default now(),
  updated_at               timestamptz not null default now(),
  constraint platform_ai_settings_backup_check check (
    (backup_provider is null) = (backup_encrypted_payload is null)
    and (backup_provider is null) = (backup_masked_value is null)
  )
);

alter table public.platform_ai_settings owner to app_migrations;

create trigger platform_ai_settings_touch_updated_at
  before update on public.platform_ai_settings
  for each row execute function private.touch_updated_at();

-- ----------------------------------------------------------------------------
-- 7. RLS
-- ----------------------------------------------------------------------------
do $$
declare
  t text;
begin
  foreach t in array array[
    'ai_conversations', 'ai_messages', 'ai_usage_events', 'partner_credentials', 'platform_ai_settings'
  ] loop
    execute format('revoke all on public.%I from public, anon, authenticated', t);
    execute format('alter table public.%I enable row level security', t);
    execute format('alter table public.%I force row level security', t);
  end loop;
end
$$;

-- Roles (src/core/permissions/matrix.ts): ai_agents.conversations.read =
-- owner, admin, editor. The partner never reads the conversations of its
-- customers without a support grant (§6, ADR 0012).
create policy ai_conversations_select on public.ai_conversations
  for select to app_runtime
  using (
    (
      kind = 'guid'
      and workspace_id = private.context_uuid('app.workspace_id')
      and organization_id = private.context_uuid('app.organization_id')
      and private.current_workspace_role() in ('owner', 'admin', 'editor')
    )
    -- The Assistant's conversations belong to the person who talks to it.
    or (kind = 'assistant' and user_id = private.context_uuid('app.user_id'))
  );

grant select on public.ai_conversations to app_runtime;

-- A message is visible with its conversation.
create policy ai_messages_select on public.ai_messages
  for select to app_runtime
  using (
    exists (select 1 from public.ai_conversations c where c.id = conversation_id)
  );

grant select on public.ai_messages to app_runtime;

create policy ai_usage_events_select on public.ai_usage_events
  for select to app_runtime
  using (
    private.current_platform_admin_role() is not null
    -- The workspace sees its own consumption and the backup courtesy.
    or (
      key_source in ('customer', 'backup')
      and workspace_id = private.context_uuid('app.workspace_id')
      and organization_id = private.context_uuid('app.organization_id')
      and private.current_workspace_role() in ('owner', 'admin')
    )
    -- The partner sees what its admin key spent.
    or (
      key_source = 'admin'
      and partner_id = private.current_partner_id()
      and private.current_partner_role() in ('partner_owner', 'partner_admin', 'partner_finance')
    )
  );

grant select on public.ai_usage_events to app_runtime;

-- partner.ai_agents.manage = partner_owner, partner_admin.
create policy partner_credentials_select on public.partner_credentials
  for select to app_runtime
  using (
    partner_id = private.current_partner_id()
    and private.current_partner_role() in ('partner_owner', 'partner_admin')
  );

create policy partner_credentials_insert on public.partner_credentials
  for insert to app_runtime
  with check (
    partner_id = private.current_partner_id()
    and created_by = private.context_uuid('app.user_id')
    and status = 'active'
    and private.current_partner_role() in ('partner_owner', 'partner_admin')
  );

-- Only revoking: a key is never edited.
create policy partner_credentials_update on public.partner_credentials
  for update to app_runtime
  using (
    partner_id = private.current_partner_id()
    and private.current_partner_role() in ('partner_owner', 'partner_admin')
  )
  with check (
    partner_id = private.current_partner_id()
    and status = 'revoked'
    and private.current_partner_role() in ('partner_owner', 'partner_admin')
  );

grant select, insert on public.partner_credentials to app_runtime;
grant update (status) on public.partner_credentials to app_runtime;

-- platform.ai.manage = owner, operations.
create policy platform_ai_settings_select on public.platform_ai_settings
  for select to app_runtime
  using (private.current_platform_admin_role() in ('owner', 'operations'));

create policy platform_ai_settings_insert on public.platform_ai_settings
  for insert to app_runtime
  with check (
    updated_by = private.context_uuid('app.user_id')
    and private.current_platform_admin_role() in ('owner', 'operations')
  );

create policy platform_ai_settings_update on public.platform_ai_settings
  for update to app_runtime
  using (private.current_platform_admin_role() in ('owner', 'operations'))
  with check (
    updated_by = private.context_uuid('app.user_id')
    and private.current_platform_admin_role() in ('owner', 'operations')
  );

grant select, insert on public.platform_ai_settings to app_runtime;
grant update (backup_provider, backup_masked_value, backup_encrypted_payload, backup_model, updated_by)
  on public.platform_ai_settings to app_runtime;

-- Purge of a deleted workspace (F3e). Messages leave with their
-- conversations.
do $$
declare
  t text;
begin
  foreach t in array array['ai_usage_events', 'ai_conversations'] loop
    execute format(
      'create policy %I on public.%I for delete to app_worker using (private.workspace_purgeable(workspace_id))',
      t || '_worker_purge', t
    );
    execute format(
      'create policy %I on public.%I for select to app_worker using (private.workspace_purgeable(workspace_id))',
      t || '_worker_purge_select', t
    );
    execute format('grant select (workspace_id), delete on public.%I to app_worker', t);
  end loop;
end
$$;
