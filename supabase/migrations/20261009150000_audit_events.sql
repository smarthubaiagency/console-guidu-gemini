-- ============================================================================
-- Migration: 20261009150000_audit_events.sql
-- Module: Append-Only Audit Trail (Specification §6, §16, §20, §24 AC14 & ADR 0009)
--
-- Maintenance Rationale:
-- 1. Introduces `public.audit_events` for immutable recording of security-critical actions
--    (credential changes, API key lifecycle, invitation lifecycle, role and membership modifications).
-- 2. Strict append-only architecture (§20):
--    - ENABLE + FORCE ROW LEVEL SECURITY.
--    - Grants ONLY INSERT to `app_runtime`. SELECT, UPDATE, DELETE are forbidden for runtime.
--    - Trigger `audit_events_append_only` strictly forbids UPDATE and DELETE for all roles,
--      including table owner (`app_migrations`).
-- 3. Composite FK (workspace_id, organization_id) enforces tenant integrity (AC05).
-- 4. RLS `WITH CHECK` enforces actor authenticity (actor_user_id = app.user_id),
--    context boundaries (workspace/organization match app.* settings), and prevents
--    retroactive or future timestamp forging (occurred_at near now()).
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Table: public.audit_events
-- ----------------------------------------------------------------------------
create table public.audit_events (
  id                   uuid primary key default gen_random_uuid(),
  occurred_at          timestamptz not null default now(),
  organization_id      uuid null,
  workspace_id         uuid null,
  actor_user_id        uuid null,
  actor_principal_type text not null
                         check (actor_principal_type in ('user', 'service', 'api_key')),
  represented_user_id  uuid null,
  origin               text not null
                         check (origin in ('app', 'api', 'mcp', 'worker', 'admin')),
  client_id            text null,
  grant_id             uuid null,
  action               text not null check (length(action) > 0),
  resource_type        text not null check (length(resource_type) > 0),
  resource_id          text null,
  result               text not null
                         check (result in ('success', 'denied', 'error')),
  request_id           text null,
  metadata             jsonb not null default '{}'::jsonb,

  constraint fk_audit_events_workspace
    foreign key (workspace_id, organization_id)
    references public.workspaces(id, organization_id),

  constraint fk_audit_events_organization
    foreign key (organization_id)
    references public.organizations(id),

  constraint check_audit_events_workspace_org
    check (workspace_id is null or organization_id is not null)
);

alter table public.audit_events owner to app_migrations;

-- ----------------------------------------------------------------------------
-- 2. Performance & Access Pattern Indexes (§20, AC14)
-- ----------------------------------------------------------------------------
-- Índice 1 (workspace_id, occurred_at desc):
-- Justificativa: otimiza consultas da trilha de auditoria no escopo de um workspace
-- específico ordenadas cronologicamente inversa (tela settings/audit na F3).
create index idx_audit_events_workspace_occurred_at
  on public.audit_events (workspace_id, occurred_at desc);

-- Índice 2 (organization_id, occurred_at desc):
-- Justificativa: otimiza relatórios de conformidade e governança corporativa no nível
-- da organização contratante, incluindo agregações multi-workspace para auditorias (§20).
create index idx_audit_events_organization_occurred_at
  on public.audit_events (organization_id, occurred_at desc);

-- ----------------------------------------------------------------------------
-- 3. Append-Only Trigger (§20, AC14)
-- ----------------------------------------------------------------------------
-- Strictly prohibits any UPDATE or DELETE operations on audit_events,
-- even for table owner `app_migrations` and privileged users.
create or replace function private.prevent_audit_events_mutation()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  raise exception 'audit_events is append-only: updates and deletes are strictly prohibited (§20, AC14)';
end;
$$;

alter function private.prevent_audit_events_mutation() owner to app_migrations;
revoke all on function private.prevent_audit_events_mutation() from public, anon, authenticated;

drop trigger if exists audit_events_append_only on public.audit_events;
create trigger audit_events_append_only
  before update or delete on public.audit_events
  for each row execute function private.prevent_audit_events_mutation();

-- ----------------------------------------------------------------------------
-- 4. Row Level Security & Access Privileges
-- ----------------------------------------------------------------------------
alter table public.audit_events enable row level security;
alter table public.audit_events force row level security;

-- Revoke all privileges from public, anonymous and direct authenticated roles
revoke all on public.audit_events from public, anon, authenticated;

-- Grant INSERT ONLY to app_runtime (no SELECT, UPDATE or DELETE in this phase)
grant insert on public.audit_events to app_runtime;

-- RLS Policy: Insert validation for application runtime
drop policy if exists audit_events_insert on public.audit_events;
create policy audit_events_insert on public.audit_events
  for insert to app_runtime
  with check (
    -- 1. Actor verification: user must match app.user_id, or principal_type is service/worker
    (
      (actor_principal_type = 'user' and actor_user_id is not null and actor_user_id = private.context_uuid('app.user_id'))
      or
      (actor_principal_type <> 'user' and coalesce(current_setting('app.principal_type', true), '') <> 'user')
    )
    -- 2. Workspace and organization context boundary (must match active context when filled)
    and (
      workspace_id is null or workspace_id = private.context_uuid('app.workspace_id')
    )
    and (
      organization_id is null or organization_id = private.context_uuid('app.organization_id')
    )
    -- 3. Temporal verification: occurred_at must be near now() (prevents forging historical/future records)
    and (
      occurred_at >= (now() - interval '5 minutes')
      and occurred_at <= (now() + interval '1 minute')
    )
  );
