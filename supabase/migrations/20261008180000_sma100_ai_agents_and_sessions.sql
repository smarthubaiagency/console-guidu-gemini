-- ============================================================================
-- Migration: 20261008180000_sma100_ai_agents_and_sessions.sql
-- Module: AI Agents Engine, Sessions and Interaction History
--
-- Maintenance Rationale:
-- 1. Introduces `public.agent_configs`: personas, prompt templates and primary/fallback
--    provider configuration per workspace.
-- 2. Introduces `public.agent_sessions`: interaction threads per workspace and user.
-- 3. Introduces `public.agent_messages`: detailed audit trail of prompts, responses,
--    provider used, model, latency (ms), and fallback status.
-- 4. Enforces composite foreign keys (workspace_id, organization_id) ensuring
--    strict multi-tenant isolation.
-- 5. Enables ENABLE + FORCE ROW LEVEL SECURITY on all three tables with policies
--    scoped to app_runtime via withContext. Data API stays completely closed.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Table: public.agent_configs
-- ----------------------------------------------------------------------------
create table public.agent_configs (
  id                uuid primary key default gen_random_uuid(),
  organization_id   uuid not null,
  workspace_id      uuid not null,
  name              text not null check (length(name) > 0),
  description       text,
  system_prompt     text not null check (length(system_prompt) > 0),
  primary_provider  text not null
                      check (primary_provider in ('openai', 'gemini', 'anthropic')),
  primary_model     text not null,
  fallback_provider text
                      check (fallback_provider is null or fallback_provider in ('openai', 'gemini', 'anthropic')),
  fallback_model    text,
  temperature       numeric(3, 2) not null default 0.70
                      check (temperature >= 0.0 and temperature <= 2.0),
  status            text not null default 'active'
                      check (status in ('active', 'inactive', 'archived')),
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  constraint fk_agent_configs_workspace
    foreign key (workspace_id, organization_id)
    references public.workspaces(id, organization_id) on delete cascade
);

alter table public.agent_configs owner to app_migrations;

create index idx_agent_configs_workspace
  on public.agent_configs (workspace_id, organization_id);

create trigger agent_configs_touch_updated_at
  before update on public.agent_configs
  for each row execute function private.touch_updated_at();

alter table public.agent_configs enable row level security;
alter table public.agent_configs force row level security;

-- ----------------------------------------------------------------------------
-- 2. Table: public.agent_sessions
-- ----------------------------------------------------------------------------
create table public.agent_sessions (
  id                  uuid primary key default gen_random_uuid(),
  organization_id     uuid not null,
  workspace_id        uuid not null,
  agent_config_id     uuid references public.agent_configs(id) on delete set null,
  title               text not null default 'Nova Conversa',
  created_by_user_id  uuid not null references public.profiles(id) on delete cascade,
  status              text not null default 'active'
                        check (status in ('active', 'archived')),
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  constraint fk_agent_sessions_workspace
    foreign key (workspace_id, organization_id)
    references public.workspaces(id, organization_id) on delete cascade
);

alter table public.agent_sessions owner to app_migrations;

create index idx_agent_sessions_workspace
  on public.agent_sessions (workspace_id, organization_id);

create trigger agent_sessions_touch_updated_at
  before update on public.agent_sessions
  for each row execute function private.touch_updated_at();

alter table public.agent_sessions enable row level security;
alter table public.agent_sessions force row level security;

-- ----------------------------------------------------------------------------
-- 3. Table: public.agent_messages
-- ----------------------------------------------------------------------------
create table public.agent_messages (
  id                  uuid primary key default gen_random_uuid(),
  organization_id     uuid not null,
  workspace_id        uuid not null,
  session_id          uuid not null references public.agent_sessions(id) on delete cascade,
  role                text not null check (role in ('user', 'assistant', 'system')),
  content             text not null,
  provider_used       text not null,
  model_used          text not null,
  fallback_triggered  boolean not null default false,
  latency_ms          integer not null default 0,
  tokens_estimated    integer not null default 0,
  created_at          timestamptz not null default now(),
  constraint fk_agent_messages_workspace
    foreign key (workspace_id, organization_id)
    references public.workspaces(id, organization_id) on delete cascade
);

alter table public.agent_messages owner to app_migrations;

create index idx_agent_messages_session
  on public.agent_messages (session_id, created_at);

create index idx_agent_messages_workspace
  on public.agent_messages (workspace_id, organization_id);

alter table public.agent_messages enable row level security;
alter table public.agent_messages force row level security;

-- ----------------------------------------------------------------------------
-- 4. RLS Policies
-- ----------------------------------------------------------------------------

-- agent_configs policies
drop policy if exists agent_configs_select on public.agent_configs;
create policy agent_configs_select on public.agent_configs
  for select to app_runtime
  using (
    workspace_id = private.context_uuid('app.workspace_id')
    and organization_id = private.context_uuid('app.organization_id')
    and private.is_workspace_member(workspace_id, organization_id)
  );

drop policy if exists agent_configs_insert on public.agent_configs;
create policy agent_configs_insert on public.agent_configs
  for insert to app_runtime
  with check (
    workspace_id = private.context_uuid('app.workspace_id')
    and organization_id = private.context_uuid('app.organization_id')
    and private.is_workspace_member(workspace_id, organization_id)
  );

drop policy if exists agent_configs_update on public.agent_configs;
create policy agent_configs_update on public.agent_configs
  for update to app_runtime
  using (
    workspace_id = private.context_uuid('app.workspace_id')
    and organization_id = private.context_uuid('app.organization_id')
    and private.is_workspace_member(workspace_id, organization_id)
  )
  with check (
    workspace_id = private.context_uuid('app.workspace_id')
    and organization_id = private.context_uuid('app.organization_id')
    and private.is_workspace_member(workspace_id, organization_id)
  );

drop policy if exists agent_configs_delete on public.agent_configs;
create policy agent_configs_delete on public.agent_configs
  for delete to app_runtime
  using (
    workspace_id = private.context_uuid('app.workspace_id')
    and organization_id = private.context_uuid('app.organization_id')
    and private.is_workspace_member(workspace_id, organization_id)
  );

-- agent_sessions policies
drop policy if exists agent_sessions_select on public.agent_sessions;
create policy agent_sessions_select on public.agent_sessions
  for select to app_runtime
  using (
    workspace_id = private.context_uuid('app.workspace_id')
    and organization_id = private.context_uuid('app.organization_id')
    and private.is_workspace_member(workspace_id, organization_id)
  );

drop policy if exists agent_sessions_insert on public.agent_sessions;
create policy agent_sessions_insert on public.agent_sessions
  for insert to app_runtime
  with check (
    workspace_id = private.context_uuid('app.workspace_id')
    and organization_id = private.context_uuid('app.organization_id')
    and private.is_workspace_member(workspace_id, organization_id)
  );

drop policy if exists agent_sessions_update on public.agent_sessions;
create policy agent_sessions_update on public.agent_sessions
  for update to app_runtime
  using (
    workspace_id = private.context_uuid('app.workspace_id')
    and organization_id = private.context_uuid('app.organization_id')
    and private.is_workspace_member(workspace_id, organization_id)
  )
  with check (
    workspace_id = private.context_uuid('app.workspace_id')
    and organization_id = private.context_uuid('app.organization_id')
    and private.is_workspace_member(workspace_id, organization_id)
  );

drop policy if exists agent_sessions_delete on public.agent_sessions;
create policy agent_sessions_delete on public.agent_sessions
  for delete to app_runtime
  using (
    workspace_id = private.context_uuid('app.workspace_id')
    and organization_id = private.context_uuid('app.organization_id')
    and private.is_workspace_member(workspace_id, organization_id)
  );

-- agent_messages policies
drop policy if exists agent_messages_select on public.agent_messages;
create policy agent_messages_select on public.agent_messages
  for select to app_runtime
  using (
    workspace_id = private.context_uuid('app.workspace_id')
    and organization_id = private.context_uuid('app.organization_id')
    and private.is_workspace_member(workspace_id, organization_id)
  );

drop policy if exists agent_messages_insert on public.agent_messages;
create policy agent_messages_insert on public.agent_messages
  for insert to app_runtime
  with check (
    workspace_id = private.context_uuid('app.workspace_id')
    and organization_id = private.context_uuid('app.organization_id')
    and private.is_workspace_member(workspace_id, organization_id)
  );

-- ----------------------------------------------------------------------------
-- 5. Privilege Grants
-- ----------------------------------------------------------------------------
revoke all on public.agent_configs from public, anon, authenticated;
revoke all on public.agent_sessions from public, anon, authenticated;
revoke all on public.agent_messages from public, anon, authenticated;

grant select, insert, update, delete on public.agent_configs to app_runtime;
grant select, insert, update, delete on public.agent_sessions to app_runtime;
grant select, insert on public.agent_messages to app_runtime;
