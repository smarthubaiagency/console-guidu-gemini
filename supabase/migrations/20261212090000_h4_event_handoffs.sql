-- ============================================================================
-- Migration: 20261212090000_h4_event_handoffs.sql
-- Module: H4 — Central de Eventos: passagem de trabalho e aprovações
--         (ADR 0022, docs/architecture/central-de-eventos.md §4 and §11)
--
-- Maintenance Rationale:
-- 1. Chain of causes: `events.caused_by_event_id` (the event that led to
--    this one, nullable) and `events.depth` (0 for a root). A trigger
--    computes the depth from the cause, in the same workspace, and refuses
--    a sixth level (`depth` 0 to 5), so two subscribers can never feed each
--    other forever. `private.event_depth(event)` lets `emitEvent` ask
--    before it seals. The seal includes the cause only when there is one,
--    so every event sealed before H4 still verifies.
-- 2. `public.event_handoffs`: the destination `subscribers` (hand-off of
--    work): one row per event and subscriber with the module, the state
--    (`queued`, `done`, `failed`, `skipped`), the reason, the attempts and
--    the job run. The worker writes it (dispatch and the job
--    `events.subscriber`); members read the hand-offs of the events they
--    read; the partner and the platform read the situation through
--    `private.event_trace_handoffs`, by the rules of the trace (H2).
--    `private.event_module_enabled(event, module)` tells the worker whether
--    the subscriber's module is on in the event's workspace (else the
--    hand-off is `skipped / module_disabled`).
-- 3. The managing partner (ADR 0020) reads the module state of the
--    workspaces it manages, so the module services it runs (an approved
--    proposal) answer as for the customer's admins.
-- 4. WhatsApp outside the job transaction: a delivery is marked `sending`
--    (with `sending_at`) and committed before the HTTP call to the
--    partner's webhook; the result is recorded in a second transaction.
--    `events.notices-tick` takes back the deliveries left in `sending`
--    past a timeout (the process died between the two), with the same
--    delivery id, which travels in `x-guidu-delivery-id` so the partner
--    can drop a repeat.
-- 5. Proposals (F4d) in the hub:
--    - origin `agent` (a module job or agent, with neither API key nor
--      Assistant turn) with `source_event_id`, the event that led to it;
--      valid up to 7 days (API key and Assistant keep 24 hours). Column
--      `origin` (`api_key`, `assistant`, `agent`), filled for the rows
--      already there;
--    - state `expired`: the job `events.notices-tick` (app_worker) marks a
--      pending proposal past its validity; the trigger allows that one
--      transition without a person;
--    - who decides follows the service mode: `padrao` → owner and admin of
--      the workspace (as before); `gerenciado` → the managing partner's
--      partner_owner, partner_admin and partner_support
--      (`private.partner_manages_organization`), who read the proposals of
--      the companies they manage from /admin; the managed customer only
--      follows (reads, never decides);
--    - each step is an event (`proposals.*`); `proposals.requested` waits
--      for a decision (`pending`, inserted by app_runtime) and follows the
--      proposal through `private.proposal_event_sync` (as the access
--      requests of H2), so the escalation of H2 applies.
-- 6. `private.platform_events` returns the cause and the depth, so the
--    platform checks a presented datum of an event with a cause.
-- Settings read by helper policies (`app.event_proposal`, and the
-- `app.event_*` of H1/H2) are set and restored by the functions below
-- only; other helper functions filter by the person of the context and
-- gain no reach from them.
-- Owner app_migrations, ENABLE + FORCE RLS, no grants to anon/authenticated.
-- Functions owned by app_rls_helper get their grants before the ownership
-- transfer (app_migrations is NOINHERIT).
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Chain of causes
-- ----------------------------------------------------------------------------
alter table public.events
  add column caused_by_event_id uuid references public.events(id) on delete set null,
  add column depth smallint not null default 0 check (depth between 0 and 5);

create index events_caused_by_idx
  on public.events (caused_by_event_id) where caused_by_event_id is not null;

-- The depth comes from the cause, never from the caller: a root is 0, an
-- event caused by another is one level below it, in the same workspace.
create function private.events_set_depth()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_prev text := current_setting('app.event_id', true);
  v_depth smallint;
  v_workspace uuid;
  v_found boolean;
begin
  if new.caused_by_event_id is null then
    new.depth := 0;
    return new;
  end if;
  perform set_config('app.event_id', new.caused_by_event_id::text, true);
  select e.depth, e.workspace_id into v_depth, v_workspace
  from public.events e where e.id = new.caused_by_event_id;
  v_found := found;
  perform set_config('app.event_id', coalesce(v_prev, ''), true);
  if not v_found then
    raise exception 'events: unknown cause' using errcode = 'foreign_key_violation';
  end if;
  if new.workspace_id is not null and v_workspace is distinct from new.workspace_id then
    raise exception 'events: the cause is in another workspace' using errcode = 'check_violation';
  end if;
  if v_depth >= 5 then
    raise exception 'events: chain limit reached' using errcode = 'check_violation';
  end if;
  new.depth := v_depth + 1;
  return new;
end;
$$;

-- The trigger is created before the ownership transfer (app_migrations
-- loses EXECUTE on it afterwards).
create trigger events_set_depth
  before insert on public.events
  for each row execute function private.events_set_depth();

revoke execute on function private.events_set_depth() from public, anon, authenticated;
alter function private.events_set_depth() owner to app_rls_helper;

-- The depth of a cause, for `emitEvent` (null when there is no such event).
create function private.event_depth(p_event_id uuid)
returns integer
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_prev text := current_setting('app.event_id', true);
  v_depth integer;
begin
  perform set_config('app.event_id', coalesce(p_event_id::text, ''), true);
  select e.depth into v_depth from public.events e where e.id = p_event_id;
  perform set_config('app.event_id', coalesce(v_prev, ''), true);
  return v_depth;
end;
$$;

revoke execute on function private.event_depth(uuid) from public, anon, authenticated;
grant execute on function private.event_depth(uuid) to app_runtime, app_worker;
alter function private.event_depth(uuid) owner to app_rls_helper;

-- ----------------------------------------------------------------------------
-- 2. Hand-offs (destination `subscribers`)
-- ----------------------------------------------------------------------------
create table public.event_handoffs (
  id              uuid primary key default gen_random_uuid(),
  event_id        uuid not null references public.events(id) on delete cascade,
  subscriber      text not null
                    check (subscriber ~ '^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_-]*)+$' and length(subscriber) <= 96),
  module          text not null check (module ~ '^[a-z][a-z0-9_-]*$' and length(module) <= 48),
  -- The event's scope, kept with the row for the readers' policies.
  partner_id      uuid,
  organization_id uuid,
  workspace_id    uuid,
  status          text not null default 'queued'
                    check (status in ('queued', 'done', 'failed', 'skipped')),
  reason          text check (reason is null or length(reason) <= 80),
  attempts        integer not null default 0 check (attempts between 0 and 20),
  job_run_id      uuid,
  finished_at     timestamptz,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  constraint event_handoffs_event_subscriber_key unique (event_id, subscriber),
  constraint event_handoffs_finished_check
    check (status not in ('done', 'skipped') or finished_at is not null)
);

create index event_handoffs_workspace_idx
  on public.event_handoffs (workspace_id, created_at desc) where workspace_id is not null;

alter table public.event_handoffs owner to app_migrations;
revoke all on public.event_handoffs from public, anon, authenticated;
alter table public.event_handoffs enable row level security;
alter table public.event_handoffs force row level security;

create trigger event_handoffs_touch_updated_at
  before update on public.event_handoffs
  for each row execute function private.touch_updated_at();

-- Members read the hand-offs of the events they read (the policy of
-- `events` answers the subquery).
create policy event_handoffs_member_select on public.event_handoffs
  for select to app_runtime
  using (
    workspace_id = private.context_uuid('app.workspace_id')
    and organization_id = private.context_uuid('app.organization_id')
    and exists (select 1 from public.events e where e.id = event_id)
  );

grant select on public.event_handoffs to app_runtime;

-- The worker creates them (queued, or skipped with the reason) and moves
-- them on; a done or skipped hand-off never runs again.
create policy event_handoffs_worker_select on public.event_handoffs
  for select to app_worker
  using (true);

create policy event_handoffs_worker_insert on public.event_handoffs
  for insert to app_worker
  with check (status in ('queued', 'skipped') and attempts = 0);

create policy event_handoffs_worker_update on public.event_handoffs
  for update to app_worker
  using (status in ('queued', 'failed'))
  with check (status in ('queued', 'done', 'failed', 'skipped'));

grant select, insert on public.event_handoffs to app_worker;
grant update (status, reason, attempts, job_run_id, finished_at, updated_at)
  on public.event_handoffs to app_worker;

-- The trace reads the hand-offs of the event its function pins.
create policy event_handoffs_trace_helper_select on public.event_handoffs
  for select to app_rls_helper
  using (event_id::text = current_setting('app.event_id', true));

grant select on public.event_handoffs to app_rls_helper;

-- The hand-offs of an event, as the trace of H2 lets the caller see it:
-- the customer, the partner (situation or managed) and the platform. A
-- hand-off carries no data of the event, only its situation.
create function private.event_trace_handoffs(p_event_id uuid)
returns table(
  id uuid,
  subscriber text,
  module text,
  status text,
  reason text,
  attempts integer,
  created_at timestamptz,
  updated_at timestamptz,
  finished_at timestamptz
)
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_prev text := current_setting('app.event_id', true);
  v_viewer text := private.event_trace_viewer(p_event_id);
begin
  if v_viewer is null then
    return;
  end if;
  perform set_config('app.event_id', p_event_id::text, true);
  return query
    select h.id, h.subscriber, h.module, h.status, h.reason, h.attempts,
           h.created_at, h.updated_at, h.finished_at
    from public.event_handoffs h
    where h.event_id = p_event_id
    order by h.created_at, h.subscriber;
  perform set_config('app.event_id', coalesce(v_prev, ''), true);
end;
$$;

revoke execute on function private.event_trace_handoffs(uuid) from public, anon, authenticated;
grant execute on function private.event_trace_handoffs(uuid) to app_runtime;
alter function private.event_trace_handoffs(uuid) owner to app_rls_helper;

-- The module of a subscriber is on in the event's workspace: available on
-- the platform and enabled by the workspace. Events without a workspace
-- have no module state.
create policy workspace_modules_event_helper_select on public.workspace_modules
  for select to app_rls_helper
  using (workspace_id::text = current_setting('app.event_workspace', true));

create policy platform_modules_event_helper_select on public.platform_modules
  for select to app_rls_helper
  using (coalesce(current_setting('app.event_workspace', true), '') <> '');

grant select on public.workspace_modules, public.platform_modules to app_rls_helper;

create function private.event_module_enabled(p_event_id uuid, p_module_key text)
returns boolean
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_prev_id text := current_setting('app.event_id', true);
  v_prev_ws text := current_setting('app.event_workspace', true);
  v_workspace uuid;
  v_found boolean;
  v_ok boolean;
begin
  perform set_config('app.event_id', coalesce(p_event_id::text, ''), true);
  select e.workspace_id into v_workspace from public.events e where e.id = p_event_id;
  v_found := found;
  if not v_found then
    v_ok := false;
  elsif v_workspace is null then
    v_ok := true;
  else
    perform set_config('app.event_workspace', v_workspace::text, true);
    v_ok := not exists (
        select 1 from public.platform_modules p
        where p.module_key = p_module_key and p.availability <> 'enabled'
      )
      and exists (
        select 1 from public.workspace_modules w
        where w.workspace_id = v_workspace and w.module_key = p_module_key and w.status = 'enabled'
      );
  end if;
  perform set_config('app.event_id', coalesce(v_prev_id, ''), true);
  perform set_config('app.event_workspace', coalesce(v_prev_ws, ''), true);
  return coalesce(v_ok, false);
end;
$$;

revoke execute on function private.event_module_enabled(uuid, text) from public, anon, authenticated;
grant execute on function private.event_module_enabled(uuid, text) to app_worker;
alter function private.event_module_enabled(uuid, text) owner to app_rls_helper;

-- ----------------------------------------------------------------------------
-- 3. The managing partner reads the module state of a managed workspace
-- ----------------------------------------------------------------------------
create policy workspace_modules_partner_managed_select on public.workspace_modules
  for select to app_runtime
  using (
    workspace_id = private.context_uuid('app.workspace_id')
    and organization_id = private.context_uuid('app.organization_id')
    and private.partner_manages_organization(organization_id)
  );

-- ----------------------------------------------------------------------------
-- 4. WhatsApp outside the job transaction: `sending`
-- ----------------------------------------------------------------------------
alter table public.notification_deliveries
  add column sending_at timestamptz;

alter table public.notification_deliveries drop constraint notification_deliveries_status_check;
alter table public.notification_deliveries add constraint notification_deliveries_status_check
  check (status in ('pending', 'queued', 'sending', 'sent', 'delivered', 'failed', 'skipped', 'blocked_policy'));

alter table public.notification_deliveries add constraint notification_deliveries_sending_check
  check (status <> 'sending' or sending_at is not null);

create index notification_deliveries_sending_idx
  on public.notification_deliveries (sending_at) where status = 'sending';

drop policy notification_deliveries_worker_update on public.notification_deliveries;
create policy notification_deliveries_worker_update on public.notification_deliveries
  for update to app_worker
  using (status in ('pending', 'queued', 'sending', 'failed'))
  with check (status in ('queued', 'sending', 'sent', 'delivered', 'failed', 'skipped', 'blocked_policy'));

-- ----------------------------------------------------------------------------
-- 5. Proposals in the hub
-- ----------------------------------------------------------------------------
alter table public.execution_proposals
  add column origin text not null default 'api_key'
    check (origin in ('api_key', 'assistant', 'agent')),
  add column source_event_id uuid references public.events(id) on delete set null;

-- The rows already there: the Assistant's have its turn. The owner is
-- bound by FORCE RLS too; lifted only for this update.
alter table public.execution_proposals no force row level security;
update public.execution_proposals set origin = 'assistant' where ai_execution_id is not null;
alter table public.execution_proposals force row level security;

alter table public.execution_proposals alter column origin drop default;

alter table public.execution_proposals add constraint execution_proposals_origin_source_check
  check (
    (origin = 'api_key' and ai_execution_id is null and source_event_id is null)
    or (origin = 'assistant' and api_key_id is null and ai_execution_id is not null
        and source_event_id is null)
    or (origin = 'agent' and api_key_id is null and ai_execution_id is null)
  );

alter table public.execution_proposals drop constraint execution_proposals_status_check;
alter table public.execution_proposals add constraint execution_proposals_status_check
  check (status in ('pending', 'approved', 'rejected', 'executed', 'failed', 'expired'));

create index execution_proposals_expiry_idx
  on public.execution_proposals (expires_at) where status = 'pending';

-- Same rules as F4d, plus: origin and source event never change (the
-- source only cleared by its foreign key), and a pending proposal past its
-- validity becomes `expired` by the hub's job, with no person.
create or replace function private.execution_proposals_guard_update()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_user uuid := nullif(current_setting('app.user_id', true), '')::uuid;
  v_principal text := coalesce(nullif(current_setting('app.principal_type', true), ''), 'user');
begin
  -- The proposal itself never changes. The references may only be cleared
  -- by their foreign keys (key, profile or event removed).
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
     or new.origin is distinct from old.origin
     or new.ai_execution_id is distinct from old.ai_execution_id
     or (new.api_key_id is distinct from old.api_key_id and new.api_key_id is not null)
     or (new.source_event_id is distinct from old.source_event_id and new.source_event_id is not null) then
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

  -- The validity ran out with nobody deciding: the hub's job closes it.
  if old.status = 'pending' and new.status = 'expired' then
    if old.expires_at > now()
       or new.decided_by is distinct from old.decided_by
       or new.decided_at is not null or new.approved_hash is not null
       or new.executed_at is not null or new.result is not null or new.error_code is not null then
      raise exception 'execution proposals: only a proposal past its validity expires'
        using errcode = 'check_violation';
    end if;
    return new;
  end if;

  -- Every other transition is made by a person (the session or the job
  -- that runs in the approver's context), never by an API key.
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

-- The source event of an agent's proposal is an event of the same
-- workspace (the caller may not read it: the agent runs for a person).
create function private.proposal_source_event_ok(p_event_id uuid, p_workspace_id uuid)
returns boolean
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_prev text := current_setting('app.event_id', true);
  v_ok boolean;
begin
  if p_event_id is null or p_workspace_id is null then
    return false;
  end if;
  perform set_config('app.event_id', p_event_id::text, true);
  select exists (
    select 1 from public.events e where e.id = p_event_id and e.workspace_id = p_workspace_id
  ) into v_ok;
  perform set_config('app.event_id', coalesce(v_prev, ''), true);
  return coalesce(v_ok, false);
end;
$$;

revoke execute on function private.proposal_source_event_ok(uuid, uuid) from public, anon, authenticated;
grant execute on function private.proposal_source_event_ok(uuid, uuid) to app_runtime;
alter function private.proposal_source_event_ok(uuid, uuid) owner to app_rls_helper;

-- The service mode of a company, for the decision policies (the members
-- of a managed company follow, never decide).
create function private.organization_is_managed(p_organization_id uuid)
returns boolean
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_prev text := current_setting('app.event_org', true);
  v_managed boolean;
begin
  perform set_config('app.event_org', coalesce(p_organization_id::text, ''), true);
  select exists (
    select 1 from public.organization_service_modes m
    join public.organizations o on o.id = m.organization_id and o.partner_id = m.partner_id
    where m.organization_id = p_organization_id and m.mode = 'gerenciado'
  ) into v_managed;
  perform set_config('app.event_org', coalesce(v_prev, ''), true);
  return coalesce(v_managed, false);
end;
$$;

create policy organizations_event_helper_select on public.organizations
  for select to app_rls_helper
  using (id::text = current_setting('app.event_org', true));

grant select on public.organizations to app_rls_helper;

revoke execute on function private.organization_is_managed(uuid) from public, anon, authenticated;
grant execute on function private.organization_is_managed(uuid) to app_runtime;
alter function private.organization_is_managed(uuid) owner to app_rls_helper;

-- Who creates a proposal: an API key (its member and key), the Assistant
-- (in the person's name, with its turn) or a module's agent (a job that
-- runs for a person of the workspace, or for the managing partner, with
-- the event that led to it), each with its validity.
alter policy execution_proposals_insert on public.execution_proposals
  with check (
    workspace_id = private.context_uuid('app.workspace_id')
    and organization_id = private.context_uuid('app.organization_id')
    and requested_by = private.context_uuid('app.user_id')
    and (
      (
        origin = 'api_key'
        and current_setting('app.principal_type', true) = 'api_key'
        and api_key_id = nullif(current_setting('app.grant_id', true), '')::uuid
        and ai_execution_id is null
        and private.current_workspace_role() in ('owner', 'admin', 'editor')
        and expires_at <= now() + interval '24 hours 5 minutes'
      )
      or (
        origin = 'assistant'
        and current_setting('app.principal_type', true) = 'user'
        and api_key_id is null
        and ai_execution_id is not null
        and private.current_workspace_role() in ('owner', 'admin', 'editor')
        and expires_at <= now() + interval '24 hours 5 minutes'
      )
      or (
        origin = 'agent'
        and current_setting('app.principal_type', true) = 'user'
        and api_key_id is null
        and ai_execution_id is null
        and private.proposal_source_event_ok(source_event_id, workspace_id)
        and (
          private.current_workspace_role() in ('owner', 'admin', 'editor')
          or private.partner_manages_organization(organization_id)
        )
        and expires_at <= now() + interval '7 days 5 minutes'
      )
    )
    and status = 'pending'
    and decided_by is null and decided_at is null and approved_hash is null
    and executed_at is null and result is null and error_code is null
    and expires_at > now()
  );

-- Owner and admin decide only in a standard company; in a managed one
-- they follow. The execution (in the approver's context) keeps going.
alter policy execution_proposals_update on public.execution_proposals
  using (
    workspace_id = private.context_uuid('app.workspace_id')
    and organization_id = private.context_uuid('app.organization_id')
    and private.current_workspace_role() in ('owner', 'admin')
  )
  with check (
    workspace_id = private.context_uuid('app.workspace_id')
    and organization_id = private.context_uuid('app.organization_id')
    and private.current_workspace_role() in ('owner', 'admin')
    and (status not in ('approved', 'rejected') or not private.organization_is_managed(organization_id))
  );

-- The managing partner reads the proposals of the companies it manages
-- (in a workspace context or in the /admin queue) and decides them in the
-- workspace's context.
create policy execution_proposals_partner_select on public.execution_proposals
  for select to app_runtime
  using (private.partner_manages_organization(organization_id));

create policy execution_proposals_partner_update on public.execution_proposals
  for update to app_runtime
  using (
    workspace_id = private.context_uuid('app.workspace_id')
    and organization_id = private.context_uuid('app.organization_id')
    and private.partner_manages_organization(organization_id)
  )
  with check (
    workspace_id = private.context_uuid('app.workspace_id')
    and organization_id = private.context_uuid('app.organization_id')
    and private.partner_manages_organization(organization_id)
  );

-- The hub's job closes the proposals past their validity.
-- (`expired` too: the update returns the rows it closed.)
create policy execution_proposals_worker_expiry_select on public.execution_proposals
  for select to app_worker
  using (status in ('pending', 'expired') and expires_at <= now());

create policy execution_proposals_worker_expire on public.execution_proposals
  for update to app_worker
  using (status = 'pending' and expires_at <= now())
  with check (status = 'expired');

grant select (id, organization_id, operation, origin, source_event_id)
  on public.execution_proposals to app_worker;
grant update (status) on public.execution_proposals to app_worker;

-- ----------------------------------------------------------------------------
-- 6. Events of the proposals: `pending` from the web; the status follows
-- ----------------------------------------------------------------------------
alter policy events_runtime_insert on public.events
  with check (
    level = 'workspace'
    and (status = 'open' or (status = 'pending' and type = 'proposals.requested'))
    and dispatched_at is null
    and verified_at is null
    and integrity is null
    and workspace_id = private.context_uuid('app.workspace_id')
    and organization_id = private.context_uuid('app.organization_id')
    and created_by = private.context_uuid('app.user_id')
    and partner_id = private.ai_turn_partner_id()
    and chain_key = 'ws:' || workspace_id::text
    and occurred_at >= now() - interval '5 minutes'
    and occurred_at <= now() + interval '1 minute'
    and (
      private.is_workspace_member(workspace_id, organization_id)
      or private.partner_manages_organization(organization_id)
    )
  );

create policy events_helper_proposal_update on public.events
  for update to app_rls_helper
  using (
    type = 'proposals.requested'
    and subject_id = current_setting('app.event_proposal', true)
  )
  with check (
    type = 'proposals.requested'
    and subject_id = current_setting('app.event_proposal', true)
  );

create policy events_helper_proposal_select on public.events
  for select to app_rls_helper
  using (
    type = 'proposals.requested'
    and subject_id = current_setting('app.event_proposal', true)
  );

create policy execution_proposals_event_helper_select on public.execution_proposals
  for select to app_rls_helper
  using (id::text = current_setting('app.event_proposal', true));

grant select (id, status) on public.execution_proposals to app_rls_helper;

-- The request's event follows the proposal: approved (and then executed
-- or failed) → approved, rejected → denied, expired → expired.
create function private.proposal_event_sync(p_proposal_id uuid)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_prev text := current_setting('app.event_proposal', true);
  v_status text;
begin
  perform set_config('app.event_proposal', coalesce(p_proposal_id::text, ''), true);
  select p.status into v_status from public.execution_proposals p where p.id = p_proposal_id;
  if v_status in ('approved', 'executed', 'failed', 'rejected', 'expired') then
    update public.events
    set status = case v_status
                   when 'rejected' then 'denied'
                   when 'expired' then 'expired'
                   else 'approved'
                 end
    where type = 'proposals.requested'
      and subject_id = p_proposal_id::text
      and status = 'pending';
  end if;
  perform set_config('app.event_proposal', coalesce(v_prev, ''), true);
end;
$$;

revoke execute on function private.proposal_event_sync(uuid) from public, anon, authenticated;
grant execute on function private.proposal_event_sync(uuid) to app_runtime, app_worker;
alter function private.proposal_event_sync(uuid) owner to app_rls_helper;

-- ----------------------------------------------------------------------------
-- 7. The platform's situation read gets the cause and the depth
-- ----------------------------------------------------------------------------
drop function private.platform_events(text, text, uuid, uuid, timestamptz, timestamptz, uuid, integer);

create function private.platform_events(
  p_type text,
  p_module text,
  p_partner_id uuid,
  p_organization_id uuid,
  p_from timestamptz,
  p_to timestamptz,
  p_event_id uuid,
  p_limit integer
)
returns table(
  id uuid,
  type text,
  module text,
  level text,
  severity text,
  status text,
  route text,
  partner_id uuid,
  partner_name text,
  organization_id uuid,
  organization_name text,
  workspace_id uuid,
  workspace_name text,
  subject_type text,
  subject_id text,
  created_by uuid,
  occurred_at timestamptz,
  chain_key text,
  seq bigint,
  content_hash text,
  prev_hash text,
  key_version text,
  chain_ok boolean,
  dispatched_at timestamptz,
  verified_at timestamptz,
  integrity text,
  deliveries integer,
  failed_deliveries integer,
  caused_by_event_id uuid,
  depth smallint
)
language sql
stable
security definer
set search_path = ''
as $$
  select e.id, e.type, e.module, e.level, e.severity, e.status, e.route,
         e.partner_id, partner.name, e.organization_id, organization.name,
         e.workspace_id, workspace.name, e.subject_type, e.subject_id, e.created_by,
         e.occurred_at, e.chain_key, e.seq, e.content_hash, e.prev_hash, e.key_version,
         e.prev_hash is not distinct from (
           select p.content_hash from public.events p
           where p.chain_key = e.chain_key and p.seq = e.seq - 1
         ),
         e.dispatched_at, e.verified_at, e.integrity,
         (select count(*)::integer from public.notification_deliveries d where d.event_id = e.id),
         (select count(*)::integer from public.notification_deliveries d
           where d.event_id = e.id and d.status in ('failed', 'blocked_policy')),
         e.caused_by_event_id, e.depth
  from public.events e
  left join public.partners partner on partner.id = e.partner_id
  left join public.organizations organization on organization.id = e.organization_id
  left join public.workspaces workspace on workspace.id = e.workspace_id
  where (
      private.current_platform_admin_role() in ('owner', 'operations', 'support')
      or (private.current_platform_admin_role() = 'billing' and e.module = 'billing')
    )
    and (p_event_id is null or e.id = p_event_id)
    and (p_type is null or e.type = p_type)
    and (p_module is null or e.module = p_module)
    and (p_partner_id is null or e.partner_id = p_partner_id)
    and (p_organization_id is null or e.organization_id = p_organization_id)
    and (p_from is null or e.occurred_at >= p_from)
    and (p_to is null or e.occurred_at < p_to)
  order by e.occurred_at desc, e.id desc
  limit least(greatest(coalesce(p_limit, 50), 1), 200);
$$;

revoke execute on function private.platform_events(text, text, uuid, uuid, timestamptz, timestamptz, uuid, integer)
  from public, anon, authenticated;
grant execute on function private.platform_events(text, text, uuid, uuid, timestamptz, timestamptz, uuid, integer)
  to app_runtime;
alter function private.platform_events(text, text, uuid, uuid, timestamptz, timestamptz, uuid, integer)
  owner to app_rls_helper;
