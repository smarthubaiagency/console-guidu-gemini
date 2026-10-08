-- ============================================================================
-- Migration: 20261008170000_sma100_credentials_and_api_keys.sql
-- Module: Encrypted BYOK Credentials & Platform API Keys (ADR 0009, Spec §16)
--
-- Maintenance Rationale:
-- 1. Introduces `public.credentials` for BYOK secrets encrypted at rest (AES-256-GCM).
--    Stores only masked representation and encrypted payload. Never plain text.
-- 2. Introduces `public.api_keys` for platform integration and MCP authentication.
--    Stores only SHA-256 hash of tokens with mandatory expiration (ADR 0009).
-- 3. Enforces composite foreign keys (workspace_id, organization_id) ensuring
--    strict tenant integrity.
-- 4. Enables ENABLE + FORCE ROW LEVEL SECURITY on both tables, granting access
--    exclusively to `app_runtime` under `withContext`.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Table: public.credentials (BYOK Vault)
-- ----------------------------------------------------------------------------
create table public.credentials (
  id                uuid primary key default gen_random_uuid(),
  organization_id   uuid not null,
  workspace_id      uuid not null,
  provider          text not null
                      check (provider in ('openai', 'anthropic', 'gemini')),
  purpose           text not null default 'all'
                      check (purpose in ('chat', 'embeddings', 'all')),
  label             text not null check (length(label) > 0),
  masked_value      text not null,
  encrypted_payload text not null,
  status            text not null default 'active'
                      check (status in ('active', 'revoked')),
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  constraint fk_credentials_workspace
    foreign key (workspace_id, organization_id)
    references public.workspaces(id, organization_id) on delete cascade
);

alter table public.credentials owner to app_migrations;

create index idx_credentials_workspace
  on public.credentials (workspace_id, organization_id);

create trigger credentials_touch_updated_at
  before update on public.credentials
  for each row execute function private.touch_updated_at();

alter table public.credentials enable row level security;
alter table public.credentials force row level security;

-- ----------------------------------------------------------------------------
-- 2. Table: public.api_keys (Platform API Keys & MCP Tokens)
-- ----------------------------------------------------------------------------
create table public.api_keys (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  workspace_id    uuid not null,
  user_id         uuid not null references public.profiles(id) on delete cascade,
  name            text not null check (length(name) > 0),
  prefix          text not null,
  key_hash        text not null unique,
  scopes          text[] not null default array['read']::text[],
  status          text not null default 'active'
                    check (status in ('active', 'revoked')),
  expires_at      timestamptz not null,
  last_used_at    timestamptz,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  constraint fk_api_keys_workspace
    foreign key (workspace_id, organization_id)
    references public.workspaces(id, organization_id) on delete cascade
);

alter table public.api_keys owner to app_migrations;

create index idx_api_keys_lookup
  on public.api_keys (key_hash, status);

create index idx_api_keys_workspace
  on public.api_keys (workspace_id, organization_id);

create trigger api_keys_touch_updated_at
  before update on public.api_keys
  for each row execute function private.touch_updated_at();

alter table public.api_keys enable row level security;
alter table public.api_keys force row level security;

-- ----------------------------------------------------------------------------
-- 3. RLS Policies for credentials and api_keys
-- ----------------------------------------------------------------------------

-- Credentials policies: scoped strictly to context workspace & organization
drop policy if exists credentials_select on public.credentials;
create policy credentials_select on public.credentials
  for select to app_runtime
  using (
    workspace_id = private.context_uuid('app.workspace_id')
    and organization_id = private.context_uuid('app.organization_id')
    and private.is_workspace_member(workspace_id, organization_id)
  );

drop policy if exists credentials_insert on public.credentials;
create policy credentials_insert on public.credentials
  for insert to app_runtime
  with check (
    workspace_id = private.context_uuid('app.workspace_id')
    and organization_id = private.context_uuid('app.organization_id')
    and private.is_workspace_member(workspace_id, organization_id)
  );

drop policy if exists credentials_update on public.credentials;
create policy credentials_update on public.credentials
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

drop policy if exists credentials_delete on public.credentials;
create policy credentials_delete on public.credentials
  for delete to app_runtime
  using (
    workspace_id = private.context_uuid('app.workspace_id')
    and organization_id = private.context_uuid('app.organization_id')
    and private.is_workspace_member(workspace_id, organization_id)
  );

-- API Keys policies: scoped to workspace and organization
drop policy if exists api_keys_select on public.api_keys;
create policy api_keys_select on public.api_keys
  for select to app_runtime
  using (
    workspace_id = private.context_uuid('app.workspace_id')
    and organization_id = private.context_uuid('app.organization_id')
    and private.is_workspace_member(workspace_id, organization_id)
  );

drop policy if exists api_keys_insert on public.api_keys;
create policy api_keys_insert on public.api_keys
  for insert to app_runtime
  with check (
    workspace_id = private.context_uuid('app.workspace_id')
    and organization_id = private.context_uuid('app.organization_id')
    and private.is_workspace_member(workspace_id, organization_id)
  );

drop policy if exists api_keys_update on public.api_keys;
create policy api_keys_update on public.api_keys
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

drop policy if exists api_keys_delete on public.api_keys;
create policy api_keys_delete on public.api_keys
  for delete to app_runtime
  using (
    workspace_id = private.context_uuid('app.workspace_id')
    and organization_id = private.context_uuid('app.organization_id')
    and private.is_workspace_member(workspace_id, organization_id)
  );

-- ----------------------------------------------------------------------------
-- 4. Privilege Grants
-- ----------------------------------------------------------------------------
revoke all on public.credentials from public, anon, authenticated;
revoke all on public.api_keys from public, anon, authenticated;

grant select, insert, update, delete on public.credentials to app_runtime;
grant select, insert, update, delete on public.api_keys to app_runtime;
