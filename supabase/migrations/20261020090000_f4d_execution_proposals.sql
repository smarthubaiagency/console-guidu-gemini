-- ============================================================================
-- Migration: 20261020090000_f4d_execution_proposals.sql
-- Module: F4d — Proposals with human approval (Especificação §17.4, AC11)
--
-- Maintenance Rationale:
-- 1. `public.execution_proposals`: an operation an assistant asked for
--    through the MCP (`propose_operation`, scope `proposals:write`). It
--    records the actor, the key, the workspace, the operation, the target,
--    the canonical payload, its SHA-256 hash, the version of the target and
--    the expiry. Creating it never runs the effect.
-- 2. Only a person approves: the approval is made with the browser session
--    (principal `user`), by owner or admin, and is bound to the exact hash
--    shown. A key (principal `api_key`) cannot approve or reject.
-- 3. The content is immutable. A trigger allows only the transitions
--    pending -> approved | rejected and approved -> executed | failed, and
--    an approval must carry the hash of the stored payload.
-- 4. The idempotency key of the assistant is unique per workspace: the
--    services return the same proposal for the same content and refuse a
--    different content under the same key.
-- 5. Workspace deletion (F3e): app_worker deletes the rows of a workspace
--    past its grace period. Retention category `execution_proposals`
--    (disabled, like the others) removes decided or expired proposals.
-- Owner app_migrations, ENABLE + FORCE RLS, no grants to anon/authenticated.
-- ============================================================================

create table public.execution_proposals (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null,
  workspace_id     uuid not null,
  requested_by     uuid not null references public.profiles(id) on delete cascade,
  api_key_id       uuid references public.api_keys(id) on delete set null,
  operation        text not null
    check (length(operation) <= 96 and operation ~ '^[a-z][a-z0-9_-]*(\.[a-z][a-z0-9_-]*)+$'),
  target_id        uuid,
  payload          jsonb not null
    check (jsonb_typeof(payload) = 'object' and octet_length(payload::text) <= 20000),
  payload_hash     text not null check (payload_hash ~ '^[0-9a-f]{64}$'),
  resource_version text check (resource_version is null or length(resource_version) <= 64),
  reason           text check (reason is null or length(reason) between 1 and 500),
  idempotency_key  text not null check (length(idempotency_key) between 1 and 128),
  status           text not null default 'pending'
    check (status in ('pending', 'approved', 'rejected', 'executed', 'failed')),
  expires_at       timestamptz not null,
  decided_by       uuid references public.profiles(id) on delete set null,
  decided_at       timestamptz,
  approved_hash    text check (approved_hash is null or approved_hash ~ '^[0-9a-f]{64}$'),
  executed_at      timestamptz,
  result           jsonb check (result is null or octet_length(result::text) <= 2000),
  error_code       text check (error_code is null or length(error_code) <= 64),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  constraint execution_proposals_idempotency unique (workspace_id, idempotency_key),
  constraint execution_proposals_approved_hash
    check (status not in ('approved', 'executed', 'failed') or approved_hash is not null),
  constraint fk_execution_proposals_workspace
    foreign key (workspace_id, organization_id)
    references public.workspaces(id, organization_id) on delete cascade
);

create index execution_proposals_workspace_idx
  on public.execution_proposals (workspace_id, created_at desc, id desc);
create index execution_proposals_status_idx
  on public.execution_proposals (workspace_id, status, expires_at);

alter table public.execution_proposals owner to app_migrations;
revoke all on public.execution_proposals from public, anon, authenticated;
alter table public.execution_proposals enable row level security;
alter table public.execution_proposals force row level security;

create trigger execution_proposals_touch_updated_at
  before update on public.execution_proposals
  for each row execute function private.touch_updated_at();

create function private.execution_proposals_guard_update()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_user uuid := nullif(current_setting('app.user_id', true), '')::uuid;
  v_principal text := coalesce(nullif(current_setting('app.principal_type', true), ''), 'user');
begin
  -- The proposal itself never changes. The two references may only be
  -- cleared by their foreign keys (key or profile removed).
  if new.id is distinct from old.id
     or new.organization_id is distinct from old.organization_id
     or new.workspace_id is distinct from old.workspace_id
     or new.requested_by is distinct from old.requested_by
     or new.operation is distinct from old.operation
     or new.target_id is distinct from old.target_id
     or new.payload is distinct from old.payload
     or new.payload_hash is distinct from old.payload_hash
     or new.resource_version is distinct from old.resource_version
     or new.reason is distinct from old.reason
     or new.idempotency_key is distinct from old.idempotency_key
     or new.expires_at is distinct from old.expires_at
     or new.created_at is distinct from old.created_at
     or (new.api_key_id is distinct from old.api_key_id and new.api_key_id is not null) then
    raise exception 'execution proposals: the content of a proposal is immutable'
      using errcode = 'check_violation';
  end if;

  if new.status = old.status then
    if new.decided_by is distinct from old.decided_by and new.decided_by is not null
       or new.decided_at is distinct from old.decided_at
       or new.approved_hash is distinct from old.approved_hash
       or new.executed_at is distinct from old.executed_at
       or new.result is distinct from old.result
       or new.error_code is distinct from old.error_code then
      raise exception 'execution proposals: invalid change without a transition'
        using errcode = 'check_violation';
    end if;
    return new;
  end if;

  -- Every transition is made by a person (the session or the job that runs
  -- in the approver's context), never by an API key.
  if v_principal <> 'user' or v_user is null then
    raise exception 'execution proposals: only a person decides or executes'
      using errcode = 'insufficient_privilege';
  end if;

  if old.status = 'pending' and new.status in ('approved', 'rejected') then
    if new.decided_by is distinct from v_user or new.decided_at is null
       or new.executed_at is not null or new.result is not null or new.error_code is not null then
      raise exception 'execution proposals: the decision must be signed by its author'
        using errcode = 'check_violation';
    end if;
    if new.status = 'approved' then
      if new.approved_hash is distinct from old.payload_hash then
        raise exception 'execution proposals: the approval must carry the hash of the content'
          using errcode = 'check_violation';
      end if;
      if old.expires_at <= now() then
        raise exception 'execution proposals: an expired proposal cannot be approved'
          using errcode = 'check_violation';
      end if;
    elsif new.approved_hash is not null then
      raise exception 'execution proposals: a rejection carries no hash'
        using errcode = 'check_violation';
    end if;
    return new;
  end if;

  if old.status = 'approved' and new.status in ('executed', 'failed') then
    if new.decided_by is distinct from old.decided_by
       or new.decided_at is distinct from old.decided_at
       or new.approved_hash is distinct from old.approved_hash
       or new.executed_at is null
       or (new.status = 'failed' and new.error_code is null)
       or (new.status = 'executed' and new.error_code is not null) then
      raise exception 'execution proposals: invalid execution record'
        using errcode = 'check_violation';
    end if;
    return new;
  end if;

  raise exception 'execution proposals: transition % -> % is not allowed', old.status, new.status
    using errcode = 'check_violation';
end;
$$;

alter function private.execution_proposals_guard_update() owner to app_migrations;
revoke execute on function private.execution_proposals_guard_update() from public, anon, authenticated;

create trigger execution_proposals_guard_update
  before update on public.execution_proposals
  for each row execute function private.execution_proposals_guard_update();

-- Owner and admin see every proposal of the workspace; the member who asked
-- (through their key) sees their own.
create policy execution_proposals_select on public.execution_proposals
  for select to app_runtime
  using (
    workspace_id = private.context_uuid('app.workspace_id')
    and organization_id = private.context_uuid('app.organization_id')
    and private.is_workspace_member(workspace_id, organization_id)
    and (
      private.current_workspace_role() in ('owner', 'admin')
      or requested_by = private.context_uuid('app.user_id')
    )
  );

-- Only an API key creates proposals, signed by its member and its key.
create policy execution_proposals_insert on public.execution_proposals
  for insert to app_runtime
  with check (
    workspace_id = private.context_uuid('app.workspace_id')
    and organization_id = private.context_uuid('app.organization_id')
    and requested_by = private.context_uuid('app.user_id')
    and current_setting('app.principal_type', true) = 'api_key'
    and api_key_id = nullif(current_setting('app.grant_id', true), '')::uuid
    and private.current_workspace_role() in ('owner', 'admin', 'editor')
    and status = 'pending'
    and decided_by is null and decided_at is null and approved_hash is null
    and executed_at is null and result is null and error_code is null
    and expires_at > now() and expires_at <= now() + interval '24 hours 5 minutes'
  );

create policy execution_proposals_update on public.execution_proposals
  for update to app_runtime
  using (
    workspace_id = private.context_uuid('app.workspace_id')
    and organization_id = private.context_uuid('app.organization_id')
    and private.current_workspace_role() in ('owner', 'admin')
  )
  with check (
    workspace_id = private.context_uuid('app.workspace_id')
    and organization_id = private.context_uuid('app.organization_id')
    and private.current_workspace_role() in ('owner', 'admin')
  );

grant select, insert, update on public.execution_proposals to app_runtime;

-- Purge of a deleted workspace (F3e).
create policy execution_proposals_worker_purge_select on public.execution_proposals
  for select to app_worker
  using (private.workspace_purgeable(workspace_id));

create policy execution_proposals_worker_purge on public.execution_proposals
  for delete to app_worker
  using (private.workspace_purgeable(workspace_id));

-- Retention: decided or expired proposals, once the category is enabled.
-- The owner is bound by FORCE RLS too; lifted only for this insert.
alter table public.retention_policies no force row level security;
insert into public.retention_policies (category, description, automated) values
  ('execution_proposals', 'Propostas do MCP decididas, executadas ou vencidas.', true);
alter table public.retention_policies force row level security;

create policy execution_proposals_worker_retention_select on public.execution_proposals
  for select to app_worker
  using (
    (status in ('rejected', 'executed', 'failed') or expires_at < now())
    and created_at < now() - make_interval(days => private.retention_days('execution_proposals'))
  );

create policy execution_proposals_worker_retention on public.execution_proposals
  for delete to app_worker
  using (
    (status in ('rejected', 'executed', 'failed') or expires_at < now())
    and created_at < now() - make_interval(days => private.retention_days('execution_proposals'))
  );

grant select (workspace_id, status, expires_at, created_at), delete
  on public.execution_proposals to app_worker;
