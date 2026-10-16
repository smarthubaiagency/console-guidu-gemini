-- ============================================================================
-- Migration: 20261125090000_h1_event_hub.sql
-- Module: H1 — Central de Eventos: núcleo e notificações (ADR 0022,
--         docs/architecture/central-de-eventos.md)
--
-- Maintenance Rationale:
-- 1. `public.events`: what happened, one row per event, written only by
--    `emitEvent` (src/core/events/emit.ts) in the transaction of the change:
--    app_runtime for the workspace of its context (a member, or the
--    partner that manages the company), app_worker for platform jobs. The
--    content never changes; only the status and the bookkeeping of the
--    dispatch and of the verification do.
-- 2. Seal: `content_hash` is the HMAC-SHA256 of the canonical content made
--    by the application with a key the database never sees
--    (`EVENTS_HMAC_KEY`, version in `key_version`); `prev_hash` is the seal
--    of the event before it in the same chain (`chain_key`: the workspace,
--    else the partner, else the platform) and `seq` its position.
--    `private.event_prepare` takes an advisory lock per chain for the rest
--    of the transaction, so two concurrent events never fork a chain.
-- 3. Reading: members of the workspace read the events whose audience
--    includes the customer, with their data. Nobody else reads the table:
--    the partner managers and the platform read through security definer
--    functions that return the situation (type, ids, dates, seal, delivery
--    counts) and leave `data` out — the partner gets it only for the
--    companies it manages (`private.partner_manages_organization`) and for
--    the events addressed to the partner itself; the platform never, except
--    through the `keychain` capability (item 6).
-- 4. Dispatch: `events.dispatch` (platform job, app_worker) asks
--    `private.event_recipients(event)` who to tell, by the route the event
--    carries (service mode, customer, partner, platform, a person). The
--    worker never reads members itself (F3c, I5): the helper reads them
--    while the function pins the event, its workspace, company and partner
--    in `app.event_*` variables, restored before it returns.
-- 5. `public.notification_deliveries` gets `event_id`, `channel`,
--    `recipient_user_id`, `provider`, `attempts` and the states `queued`,
--    `delivered` and `blocked_policy`; the rows already there keep their
--    meaning (channel e-mail). The platform (owner, operations, support)
--    reads the situation of an event's deliveries through
--    `private.event_deliveries`, without the addresses.
-- 6. `public.platform_admin_capabilities`: capabilities added to the main
--    platform role; today only `keychain` (permission
--    `platform.events.read_all_data`). Only the platform owner grants or
--    removes it. `private.read_event_data` checks the capability and a
--    written reason and records `platform.event.view_data` in the audit in
--    the same call; the record is the platform's only (no company or
--    workspace in it), so the customer is not told (Marcelo, 16/10/2026).
-- 7. Retention: category `events`, off like the others.
-- Owner app_migrations, ENABLE + FORCE RLS, no grants to anon/authenticated.
-- Functions owned by app_rls_helper get their grants before the ownership
-- transfer (app_migrations is NOINHERIT).
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Table: public.events
-- ----------------------------------------------------------------------------
create table public.events (
  id                uuid primary key,
  type              text not null
                      check (type ~ '^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$' and length(type) <= 80),
  module            text not null check (module ~ '^[a-z][a-z0-9_]*$' and length(module) <= 48),
  level             text not null check (level in ('workspace', 'partner', 'platform')),
  partner_id        uuid references public.partners(id) on delete cascade,
  organization_id   uuid references public.organizations(id) on delete cascade,
  workspace_id      uuid,
  subject_type      text check (subject_type is null or (subject_type ~ '^[a-z][a-z0-9_]*$' and length(subject_type) <= 48)),
  subject_id        text check (subject_id is null or length(subject_id) between 1 and 200),
  severity          text not null check (severity in ('info', 'attention', 'urgent')),
  audiences         text[] not null
                      check (cardinality(audiences) between 1 and 3
                             and audiences <@ array['customer', 'partner', 'platform']::text[]),
  route             text not null
                      check (route in ('service_mode', 'customer', 'partner', 'platform', 'subject_person', 'explicit')),
  -- The person of the `subject_person` route; kept as written (no foreign
  -- key), so a later change of the profile never touches the sealed row.
  recipient_user_id uuid,
  data              jsonb not null default '{}'::jsonb
                      check (jsonb_typeof(data) = 'object' and pg_column_size(data) <= 16384),
  status            text not null default 'open'
                      check (status in ('open', 'resolved', 'dismissed', 'pending', 'approved', 'denied', 'expired')),
  idempotency_key   text not null unique check (length(idempotency_key) between 1 and 200),
  created_by        uuid,
  occurred_at       timestamptz not null,
  created_at        timestamptz not null default now(),
  chain_key         text not null check (chain_key ~ '^(ws:[0-9a-f-]{36}|partner:[0-9a-f-]{36}|platform)$'),
  seq               bigint not null check (seq > 0),
  content_hash      text not null check (content_hash ~ '^[0-9a-f]{64}$'),
  prev_hash         text check (prev_hash is null or prev_hash ~ '^[0-9a-f]{64}$'),
  key_version       text not null check (key_version ~ '^[A-Za-z0-9_.-]{1,32}$'),
  dispatched_at     timestamptz,
  verified_at       timestamptz,
  integrity         text check (integrity is null or integrity in ('ok', 'broken', 'unverifiable')),
  constraint events_chain_position_key unique (chain_key, seq),
  constraint events_first_link_check check ((seq = 1) = (prev_hash is null)),
  constraint events_scope_check check (
    (level = 'workspace' and workspace_id is not null and organization_id is not null and partner_id is not null)
    or (level = 'partner' and workspace_id is null and partner_id is not null)
    or (level = 'platform' and workspace_id is null and organization_id is null and partner_id is null)
  ),
  constraint fk_events_workspace
    foreign key (workspace_id, organization_id)
    references public.workspaces(id, organization_id) on delete cascade
);

create index events_occurred_idx on public.events (occurred_at desc, id desc);
create index events_workspace_idx on public.events (workspace_id, occurred_at desc) where workspace_id is not null;
create index events_partner_idx on public.events (partner_id, occurred_at desc);
create index events_type_idx on public.events (type, occurred_at desc);
create index events_pending_dispatch_idx on public.events (created_at) where dispatched_at is null;

alter table public.events owner to app_migrations;
revoke all on public.events from public, anon, authenticated;
alter table public.events enable row level security;
alter table public.events force row level security;

-- Members of the workspace read its events addressed to the customer.
create policy events_member_select on public.events
  for select to app_runtime
  using (
    workspace_id = private.context_uuid('app.workspace_id')
    and organization_id = private.context_uuid('app.organization_id')
    and 'customer' = any (audiences)
    and private.is_workspace_member(workspace_id, organization_id)
  );

-- emitEvent in the web or in a workspace job: the workspace of the context,
-- by its member or by the partner that manages the company, as whom acts,
-- with the company's partner and at the current time.
create policy events_runtime_insert on public.events
  for insert to app_runtime
  with check (
    level = 'workspace'
    and status = 'open'
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

grant select, insert on public.events to app_runtime;

-- The worker emits platform events, dispatches and verifies them.
create policy events_worker_select on public.events
  for select to app_worker
  using (true);

create policy events_worker_insert on public.events
  for insert to app_worker
  with check (
    status = 'open'
    and dispatched_at is null
    and verified_at is null
    and integrity is null
    and occurred_at >= now() - interval '5 minutes'
    and occurred_at <= now() + interval '1 minute'
  );

create policy events_worker_update on public.events
  for update to app_worker
  using (true)
  with check (true);

-- Only the bookkeeping columns change; the content stays as sealed.
grant select, insert on public.events to app_worker;
grant update (status, dispatched_at, verified_at, integrity) on public.events to app_worker;

-- ----------------------------------------------------------------------------
-- 2. The chain: lock and head (security definer)
-- ----------------------------------------------------------------------------
-- The helper reads events pinned by the calling function (`app.event_id`,
-- `app.event_chain`, `app.event_key`), the events its caller created in
-- the workspace of its context, and the situation for the platform and the
-- partner managers; every function below filters again and never returns
-- `data` except where item 3 and 6 of the header say so.
create policy events_helper_select on public.events
  for select to app_rls_helper
  using (
    id::text = current_setting('app.event_id', true)
    or chain_key = current_setting('app.event_chain', true)
    or idempotency_key = current_setting('app.event_key', true)
    or (created_by = private.context_uuid('app.user_id')
        and workspace_id = private.context_uuid('app.workspace_id'))
    or private.current_platform_admin_role() in ('owner', 'operations', 'support')
    or (private.current_platform_admin_role() = 'billing' and module = 'billing')
    or (private.current_partner_role() in ('partner_owner', 'partner_admin', 'partner_support')
        and partner_id = private.current_partner_id())
  );

grant select on public.events to app_rls_helper;

-- Locks the chain until the end of the transaction and answers the event
-- already recorded with the key, if any, and the head of the chain.
create function private.event_prepare(p_chain_key text, p_idempotency_key text)
returns table(existing_id uuid, prev_hash text, next_seq bigint)
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_chain text := current_setting('app.event_chain', true);
  v_key text := current_setting('app.event_key', true);
begin
  if p_chain_key is null
     or p_chain_key !~ '^(ws:[0-9a-f-]{36}|partner:[0-9a-f-]{36}|platform)$'
     or p_idempotency_key is null
     or length(p_idempotency_key) not between 1 and 200 then
    raise exception 'events: invalid chain or key' using errcode = 'invalid_parameter_value';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('events_chain:' || p_chain_key, 0));
  perform set_config('app.event_chain', p_chain_key, true);
  perform set_config('app.event_key', p_idempotency_key, true);
  return query
    select
      (select e.id from public.events e where e.idempotency_key = p_idempotency_key),
      (select e.content_hash from public.events e
        where e.chain_key = p_chain_key order by e.seq desc limit 1),
      coalesce((select max(e.seq) from public.events e where e.chain_key = p_chain_key), 0) + 1;
  perform set_config('app.event_chain', coalesce(v_chain, ''), true);
  perform set_config('app.event_key', coalesce(v_key, ''), true);
end;
$$;

revoke execute on function private.event_prepare(text, text) from public, anon, authenticated;
grant execute on function private.event_prepare(text, text) to app_runtime, app_worker;
alter function private.event_prepare(text, text) owner to app_rls_helper;

-- ----------------------------------------------------------------------------
-- 3. Queueing `events.dispatch` from the web (same transaction)
-- ----------------------------------------------------------------------------
-- True for an event the caller has just created in the workspace of its
-- context and that was not dispatched yet.
create function private.event_dispatch_allowed(p_event_id text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    p_event_id ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    and exists (
      select 1 from public.events e
      where e.id = p_event_id::uuid
        and e.created_by = private.context_uuid('app.user_id')
        and e.workspace_id = private.context_uuid('app.workspace_id')
        and e.dispatched_at is null
    ),
    false
  );
$$;

revoke execute on function private.event_dispatch_allowed(text) from public, anon, authenticated;
grant execute on function private.event_dispatch_allowed(text) to app_runtime;
alter function private.event_dispatch_allowed(text) owner to app_rls_helper;

create policy job_runs_events_dispatch_insert on public.job_runs
  for insert to app_runtime
  with check (
    kind = 'events.dispatch'
    and scope = 'platform'
    and status = 'pending'
    and attempts = 0
    and partner_id is null
    and organization_id is null
    and workspace_id is null
    and requested_by = private.context_uuid('app.user_id')
    and idempotency_key = 'event:' || (payload ->> 'eventId')
    and private.event_dispatch_allowed(payload ->> 'eventId')
  );

-- ----------------------------------------------------------------------------
-- 4. Recipients of an event (worker)
-- ----------------------------------------------------------------------------
create policy organization_service_modes_event_helper_select on public.organization_service_modes
  for select to app_rls_helper
  using (organization_id::text = current_setting('app.event_org', true));

create policy workspace_members_event_helper_select on public.workspace_members
  for select to app_rls_helper
  using (workspace_id::text = current_setting('app.event_workspace', true));

create policy invitations_event_helper_select on public.invitations
  for select to app_rls_helper
  using (
    status = 'accepted'
    and organization_id::text = current_setting('app.event_org', true)
  );

create policy partner_members_event_helper_select on public.partner_members
  for select to app_rls_helper
  using (partner_id::text = current_setting('app.event_partner', true));

create policy partner_billing_profiles_event_helper_select on public.partner_billing_profiles
  for select to app_rls_helper
  using (partner_id::text = current_setting('app.event_partner', true));

-- The platform team: the owner's screen (`private.platform_team`), the
-- check of a capability's target and the platform route of an event.
create policy platform_admin_members_team_helper_select on public.platform_admin_members
  for select to app_rls_helper
  using (
    current_setting('app.platform_team', true) = 'on'
    or user_id::text = current_setting('app.platform_member', true)
  );

grant select on public.workspace_members, public.invitations, public.partner_members,
  public.partner_billing_profiles, public.organization_service_modes,
  public.platform_admin_members to app_rls_helper;

-- Who to tell, by the route the event carries:
-- * service_mode: standard company → active owners and admins of the
--   workspace (not support grants), each with the e-mail of their latest
--   accepted invitation (an e-mail goes to one person only); managed
--   company → the partner's active partner_owner, partner_admin and
--   partner_support with their e-mail. The house partner (zero) is GUIDU,
--   with no special case.
-- * customer: the workspace owners and admins, whatever the mode.
-- * partner: the partner's billing e-mail when it has one (no person) and
--   its active owners for the bell; else the owners with their e-mail.
-- * platform: active platform owners and operations (bell only).
-- * subject_person: the person written in the event.
-- * explicit: nobody here; the event carries its own target.
create function private.event_recipients(p_event_id uuid)
returns table(user_id uuid, email text)
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_prev_id text := current_setting('app.event_id', true);
  v_prev_ws text := current_setting('app.event_workspace', true);
  v_prev_org text := current_setting('app.event_org', true);
  v_prev_partner text := current_setting('app.event_partner', true);
  v_prev_team text := current_setting('app.platform_team', true);
  v_route text;
  v_workspace uuid;
  v_organization uuid;
  v_partner uuid;
  v_person uuid;
  v_mode text;
begin
  perform set_config('app.event_id', coalesce(p_event_id::text, ''), true);
  select e.route, e.workspace_id, e.organization_id, e.partner_id, e.recipient_user_id
    into v_route, v_workspace, v_organization, v_partner, v_person
  from public.events e
  where e.id = p_event_id;

  if v_route is not null then
    perform set_config('app.event_workspace', coalesce(v_workspace::text, ''), true);
    perform set_config('app.event_org', coalesce(v_organization::text, ''), true);
    perform set_config('app.event_partner', coalesce(v_partner::text, ''), true);

    if v_route = 'service_mode' and v_organization is not null then
      select m.mode into v_mode
      from public.organization_service_modes m
      where m.organization_id = v_organization and m.partner_id = v_partner;
    end if;

    if v_route = 'service_mode' and v_mode = 'gerenciado' then
      return query
        select m.user_id, m.email
        from public.partner_members m
        where m.partner_id = v_partner
          and m.status = 'active'
          and m.role in ('partner_owner', 'partner_admin', 'partner_support')
        order by m.created_at, m.user_id;
    elsif v_route in ('service_mode', 'customer') and v_workspace is not null then
      return query
        with people as (
          select member.user_id,
                 (select lower(trim(i.email))
                  from public.invitations i
                  where i.organization_id = v_organization
                    and i.status = 'accepted'
                    and i.accepted_by_user_id = member.user_id
                  order by i.accepted_at desc nulls last
                  limit 1) as email
          from public.workspace_members member
          where member.workspace_id = v_workspace
            and member.status = 'active'
            and member.role in ('owner', 'admin')
            and member.support_grant_id is null
        )
        select p.user_id,
               case when p.email is not null
                         and row_number() over (partition by p.email order by p.user_id) = 1
                    then p.email end
        from people p
        order by p.user_id;
    elsif v_route = 'partner' and v_partner is not null then
      if exists (select 1 from public.partner_billing_profiles b where b.partner_id = v_partner) then
        return query
          select null::uuid, lower(trim(b.billing_email))
          from public.partner_billing_profiles b
          where b.partner_id = v_partner;
        return query
          select m.user_id, null::text
          from public.partner_members m
          where m.partner_id = v_partner and m.role = 'partner_owner' and m.status = 'active'
          order by m.created_at, m.user_id;
      else
        return query
          select m.user_id, m.email
          from public.partner_members m
          where m.partner_id = v_partner and m.role = 'partner_owner' and m.status = 'active'
          order by m.created_at, m.user_id;
      end if;
    elsif v_route = 'platform' then
      perform set_config('app.platform_team', 'on', true);
      return query
        select pam.user_id, null::text
        from public.platform_admin_members pam
        where pam.status = 'active' and pam.role in ('owner', 'operations')
        order by pam.created_at, pam.user_id;
    elsif v_route = 'subject_person' and v_person is not null then
      return query select v_person, null::text;
    end if;
  end if;

  -- The event does not outlive the call (an error aborts the transaction
  -- or savepoint, which undoes these as well).
  perform set_config('app.event_id', coalesce(v_prev_id, ''), true);
  perform set_config('app.event_workspace', coalesce(v_prev_ws, ''), true);
  perform set_config('app.event_org', coalesce(v_prev_org, ''), true);
  perform set_config('app.event_partner', coalesce(v_prev_partner, ''), true);
  perform set_config('app.platform_team', coalesce(v_prev_team, ''), true);
end;
$$;

revoke execute on function private.event_recipients(uuid) from public, anon, authenticated;
grant execute on function private.event_recipients(uuid) to app_worker;
alter function private.event_recipients(uuid) owner to app_rls_helper;

-- The partner's webhook for the WhatsApp channel of an event (A6 format):
-- the one of the partner of the event's company, when on.
create policy partner_notice_webhooks_event_helper_select on public.partner_notice_webhooks
  for select to app_rls_helper
  using (enabled and partner_id::text = current_setting('app.event_partner', true));

create function private.event_notice_webhook(p_event_id uuid)
returns table(url text, encrypted_secret text)
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_prev_id text := current_setting('app.event_id', true);
  v_prev_partner text := current_setting('app.event_partner', true);
  v_partner uuid;
begin
  perform set_config('app.event_id', coalesce(p_event_id::text, ''), true);
  select e.partner_id into v_partner from public.events e where e.id = p_event_id;
  if v_partner is not null then
    perform set_config('app.event_partner', v_partner::text, true);
    return query
      select w.url, w.encrypted_secret
      from public.partner_notice_webhooks w
      where w.partner_id = v_partner and w.enabled;
  end if;
  perform set_config('app.event_id', coalesce(v_prev_id, ''), true);
  perform set_config('app.event_partner', coalesce(v_prev_partner, ''), true);
end;
$$;

revoke execute on function private.event_notice_webhook(uuid) from public, anon, authenticated;
grant execute on function private.event_notice_webhook(uuid) to app_worker;
alter function private.event_notice_webhook(uuid) owner to app_rls_helper;

-- The hub delivers the GUIDS notices (A6) and keeps their state for the
-- panel: the worker updates the state columns only.
create policy ai_lead_notices_worker_delivery_select on public.ai_lead_notices
  for select to app_worker
  using (true);

create policy ai_lead_notices_worker_delivery_update on public.ai_lead_notices
  for update to app_worker
  using (true)
  with check (true);

grant select (id, status, attempts) on public.ai_lead_notices to app_worker;
grant update (status, reason, attempts, sent_at) on public.ai_lead_notices to app_worker;

-- ----------------------------------------------------------------------------
-- 5. Deliveries: event, channel, person, provider and the new states
-- ----------------------------------------------------------------------------
alter table public.notification_deliveries
  add column event_id uuid references public.events(id) on delete set null,
  add column channel text not null default 'email' check (channel in ('email', 'app', 'whatsapp')),
  add column recipient_user_id uuid,
  add column provider text check (provider is null or provider ~ '^[a-z][a-z0-9_-]{0,39}$'),
  add column attempts integer not null default 0 check (attempts between 0 and 100);

alter table public.notification_deliveries alter column recipient_email drop not null;
alter table public.notification_deliveries alter column subject drop not null;

alter table public.notification_deliveries drop constraint notification_deliveries_status_check;
alter table public.notification_deliveries add constraint notification_deliveries_status_check
  check (status in ('pending', 'queued', 'sent', 'delivered', 'failed', 'skipped', 'blocked_policy'));

-- The format of `user_notifications` (a module name may have `_`).
alter table public.notification_deliveries drop constraint notification_deliveries_event_type_check;
alter table public.notification_deliveries add constraint notification_deliveries_event_type_check
  check (event_type ~ '^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$' and length(event_type) <= 80);

-- An e-mail keeps its address and subject, as before.
alter table public.notification_deliveries add constraint notification_deliveries_email_check
  check (channel <> 'email' or (recipient_email is not null and subject is not null));

create index notification_deliveries_event_idx
  on public.notification_deliveries (event_id) where event_id is not null;

-- A failed WhatsApp delivery is tried again by the hub.
drop policy notification_deliveries_worker_update on public.notification_deliveries;
create policy notification_deliveries_worker_update on public.notification_deliveries
  for update to app_worker
  using (status in ('pending', 'queued', 'failed'))
  with check (status in ('queued', 'sent', 'delivered', 'failed', 'skipped', 'blocked_policy'));

create policy notification_deliveries_event_helper_select on public.notification_deliveries
  for select to app_rls_helper
  using (
    event_id is not null
    and private.current_platform_admin_role() in ('owner', 'operations', 'support', 'billing')
  );

grant select on public.notification_deliveries to app_rls_helper;

-- ----------------------------------------------------------------------------
-- 6. Situation reads: the platform and the partner managers
-- ----------------------------------------------------------------------------
create policy partners_event_helper_select on public.partners
  for select to app_rls_helper
  using (private.current_platform_admin_role() is not null);

-- Events of the platform without data: owner, operations and support read
-- every event, billing only the billing ones. Filters by type, module,
-- partner, company and period; newest first, keyset by `p_before`.
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
  failed_deliveries integer
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
           where d.event_id = e.id and d.status in ('failed', 'blocked_policy'))
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

-- Situation of an event's deliveries for the platform: channel, state,
-- reason, provider and attempts, never the address or the person.
create function private.event_deliveries(p_event_id uuid)
returns table(
  id uuid,
  channel text,
  status text,
  reason text,
  provider text,
  attempts integer,
  created_at timestamptz,
  updated_at timestamptz
)
language sql
stable
security definer
set search_path = ''
as $$
  select d.id, d.channel, d.status, d.reason, d.provider, d.attempts, d.created_at, d.updated_at
  from public.notification_deliveries d
  join public.events e on e.id = d.event_id
  where d.event_id = p_event_id
    and (
      private.current_platform_admin_role() in ('owner', 'operations', 'support')
      or (private.current_platform_admin_role() = 'billing' and e.module = 'billing')
    )
  order by d.created_at, d.id;
$$;

revoke execute on function private.event_deliveries(uuid) from public, anon, authenticated;
grant execute on function private.event_deliveries(uuid) to app_runtime;
alter function private.event_deliveries(uuid) owner to app_rls_helper;

-- Events of the partner's customers and of the partner itself, for its
-- owner, admin and support: the data only of the companies it manages and
-- of the events addressed to the partner; the situation otherwise.
create function private.partner_events(p_before timestamptz, p_limit integer)
returns table(
  id uuid,
  type text,
  module text,
  severity text,
  status text,
  organization_id uuid,
  workspace_id uuid,
  subject_type text,
  subject_id text,
  occurred_at timestamptz,
  content_hash text,
  data jsonb
)
language sql
stable
security definer
set search_path = ''
as $$
  select e.id, e.type, e.module, e.severity, e.status, e.organization_id, e.workspace_id,
         e.subject_type, e.subject_id, e.occurred_at, e.content_hash,
         case
           when 'partner' = any (e.audiences) then e.data
           when e.organization_id is not null
                and private.partner_manages_organization(e.organization_id) then e.data
         end
  from public.events e
  where private.current_partner_role() in ('partner_owner', 'partner_admin', 'partner_support')
    and e.partner_id = private.current_partner_id()
    and ('partner' = any (e.audiences) or 'customer' = any (e.audiences))
    and (p_before is null or e.occurred_at < p_before)
  order by e.occurred_at desc, e.id desc
  limit least(greatest(coalesce(p_limit, 50), 1), 200);
$$;

revoke execute on function private.partner_events(timestamptz, integer) from public, anon, authenticated;
grant execute on function private.partner_events(timestamptz, integer) to app_runtime;
alter function private.partner_events(timestamptz, integer) owner to app_rls_helper;

-- ----------------------------------------------------------------------------
-- 7. Capabilities of the platform team: `keychain`
-- ----------------------------------------------------------------------------
create table public.platform_admin_capabilities (
  user_id     uuid not null references public.platform_admin_members(user_id) on delete cascade,
  capability  text not null check (capability in ('keychain')),
  granted_by  uuid not null references public.profiles(id) on delete cascade,
  granted_at  timestamptz not null default now(),
  primary key (user_id, capability)
);

alter table public.platform_admin_capabilities owner to app_migrations;
revoke all on public.platform_admin_capabilities from public, anon, authenticated;
alter table public.platform_admin_capabilities enable row level security;
alter table public.platform_admin_capabilities force row level security;

-- An active member of the platform team (for the owner's grant).
create function private.platform_member_active(p_user_id uuid)
returns boolean
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_prev text := current_setting('app.platform_member', true);
  v_active boolean;
begin
  perform set_config('app.platform_member', coalesce(p_user_id::text, ''), true);
  select exists (
    select 1 from public.platform_admin_members pam
    where pam.user_id = p_user_id and pam.status = 'active'
  ) into v_active;
  perform set_config('app.platform_member', coalesce(v_prev, ''), true);
  return coalesce(v_active, false);
end;
$$;

revoke execute on function private.platform_member_active(uuid) from public, anon, authenticated;
grant execute on function private.platform_member_active(uuid) to app_runtime;
alter function private.platform_member_active(uuid) owner to app_rls_helper;

-- Each member reads their own capabilities; the owner reads all.
create policy platform_admin_capabilities_select on public.platform_admin_capabilities
  for select to app_runtime
  using (
    user_id = private.context_uuid('app.user_id')
    or private.current_platform_admin_role() = 'owner'
  );

-- Only the platform owner grants (to an active member, themselves
-- included) and removes; the grant names who gave it.
create policy platform_admin_capabilities_insert on public.platform_admin_capabilities
  for insert to app_runtime
  with check (
    private.current_platform_admin_role() = 'owner'
    and granted_by = private.context_uuid('app.user_id')
    and private.platform_member_active(user_id)
  );

create policy platform_admin_capabilities_delete on public.platform_admin_capabilities
  for delete to app_runtime
  using (private.current_platform_admin_role() = 'owner');

grant select, insert, delete on public.platform_admin_capabilities to app_runtime;

create policy platform_admin_capabilities_helper_select on public.platform_admin_capabilities
  for select to app_rls_helper
  using (
    user_id = private.context_uuid('app.user_id')
    or current_setting('app.platform_team', true) = 'on'
  );

grant select on public.platform_admin_capabilities to app_rls_helper;

-- The platform team for the owner's screen, with the capability of each.
create function private.platform_team()
returns table(
  user_id uuid,
  role text,
  status text,
  full_name text,
  keychain boolean,
  keychain_granted_at timestamptz
)
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_prev text := current_setting('app.platform_team', true);
begin
  if private.current_platform_admin_role() is distinct from 'owner' then
    return;
  end if;
  perform set_config('app.platform_team', 'on', true);
  return query
    select pam.user_id, pam.role, pam.status, profile.full_name,
           capability.user_id is not null, capability.granted_at
    from public.platform_admin_members pam
    left join public.profiles profile on profile.id = pam.user_id
    left join public.platform_admin_capabilities capability
      on capability.user_id = pam.user_id and capability.capability = 'keychain'
    order by pam.created_at, pam.user_id;
  perform set_config('app.platform_team', coalesce(v_prev, ''), true);
end;
$$;

revoke execute on function private.platform_team() from public, anon, authenticated;
grant execute on function private.platform_team() to app_runtime;
alter function private.platform_team() owner to app_rls_helper;

-- Opening the data of an event with `keychain`: an active platform member
-- holding the capability, with a written reason (10 or more characters).
-- The audit record goes in with the read, in the same call; it carries no
-- company or workspace, so it stays in the platform's audit.
create policy audit_events_view_data_helper_insert on public.audit_events
  for insert to app_rls_helper
  with check (
    action = 'platform.event.view_data'
    and resource_type = 'event'
    and resource_id = current_setting('app.event_id', true)
    and actor_principal_type = 'user'
    and actor_user_id = private.context_uuid('app.user_id')
    and represented_user_id is null
    and grant_id is null
    and organization_id is null
    and workspace_id is null
    and origin = 'admin'
    and occurred_at >= now() - interval '5 minutes'
    and occurred_at <= now() + interval '1 minute'
  );

grant insert on public.audit_events to app_rls_helper;

create function private.read_event_data(p_event_id uuid, p_reason text, p_ip text)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_prev text := current_setting('app.event_id', true);
  v_user uuid := private.context_uuid('app.user_id');
  v_reason text := trim(coalesce(p_reason, ''));
  v_ip text;
  v_type text;
  v_data jsonb;
begin
  if v_user is null
     or private.current_platform_admin_role() is null
     or not exists (
       select 1 from public.platform_admin_capabilities c
       where c.user_id = v_user and c.capability = 'keychain'
     ) then
    raise exception 'events: keychain required' using errcode = 'insufficient_privilege';
  end if;
  if length(v_reason) < 10 or length(v_reason) > 500 then
    raise exception 'events: a reason of 10 to 500 characters is required'
      using errcode = 'invalid_parameter_value';
  end if;
  begin
    v_ip := host(nullif(trim(coalesce(p_ip, '')), '')::inet);
  exception when invalid_text_representation then
    v_ip := null;
  end;

  perform set_config('app.event_id', coalesce(p_event_id::text, ''), true);
  select e.type, e.data into v_type, v_data from public.events e where e.id = p_event_id;
  if v_type is null then
    perform set_config('app.event_id', coalesce(v_prev, ''), true);
    return null;
  end if;

  insert into public.audit_events (
    id, occurred_at, organization_id, workspace_id, actor_user_id, actor_principal_type,
    represented_user_id, origin, client_id, grant_id, action, resource_type, resource_id,
    result, request_id, metadata
  ) values (
    gen_random_uuid(), now(), null, null, v_user, 'user',
    null, 'admin', null, null, 'platform.event.view_data', 'event', p_event_id::text,
    'success', null,
    jsonb_strip_nulls(jsonb_build_object(
      'eventId', p_event_id, 'eventType', v_type, 'reason', v_reason, 'ip', v_ip
    ))
  );

  perform set_config('app.event_id', coalesce(v_prev, ''), true);
  return v_data;
end;
$$;

revoke execute on function private.read_event_data(uuid, text, text) from public, anon, authenticated;
grant execute on function private.read_event_data(uuid, text, text) to app_runtime;
alter function private.read_event_data(uuid, text, text) owner to app_rls_helper;

-- ----------------------------------------------------------------------------
-- 8. Retention (off until the legal rules)
-- ----------------------------------------------------------------------------
-- The owner is bound by FORCE RLS too; lifted only for this insert.
alter table public.retention_policies no force row level security;
insert into public.retention_policies (category, description, automated) values
  ('events', 'Eventos da Central de Eventos (situação, dados e selo).', true);
alter table public.retention_policies force row level security;

create policy events_worker_retention on public.events
  for delete to app_worker
  using (created_at < now() - make_interval(days => private.retention_days('events')));

grant delete on public.events to app_worker;
