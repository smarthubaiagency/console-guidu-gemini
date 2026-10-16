-- ============================================================================
-- Migration: 20261210090000_h2_event_rules.sql
-- Module: H2 — Central de Eventos: regras, telas e acesso por evento
--         (ADR 0022, docs/architecture/central-de-eventos.md §4 and §10)
--
-- Maintenance Rationale:
-- 1. The notice rules live in the settings cascade (ADR 0018, no table):
--    `notifications.rules`, `notifications.quiet_hours` and
--    `notifications.digest_time`. The worker reads them per event through
--    `private.event_settings(event)`, which returns only the notification
--    keys and the time zone of the platform, of the event's partner and of
--    the event's workspace (variables `app.event_*`, restored before it
--    returns).
-- 2. `private.event_audience(event, roles)`: who to tell. Without roles it
--    is the route of H1 (`private.event_recipients`, kept for H1 callers);
--    with roles, the active members of the workspace with those roles and,
--    when the partner manages the company (or the event is the partner's),
--    the partner members with the partner roles. Each person comes with
--    their WhatsApp number only when they accepted it.
-- 3. `public.user_whatsapp_numbers`: the person's own number (E.164) and
--    when they accepted the notices; only the person reads and writes it.
-- 4. `public.notification_deliveries` gets `deliver_after` and
--    `hold_reason` (`quiet_hours`, `digest`): a WhatsApp inside the quiet
--    window and the notices of a digest wait as `queued` until their time;
--    the job `events.notices-tick` sends them. `private.delivery_whatsapp`
--    gives the worker the number of a waiting WhatsApp delivery, nothing
--    else. `notification_preferences` accepts the channel `whatsapp`.
--    `user_notifications.event_id` ties a bell notice to its event for the
--    trace.
-- 5. `public.whatsapp_templates`: WhatsApp texts per event and language,
--    versioned (each edit inserts a version and the previous one stops
--    being current; nothing is deleted), at the platform and at the
--    partner, as the e-mail templates (CF3b).
-- 6. `public.event_access_grants` (ADR 0022 item 7): the platform support
--    (owner, operations, support) or the partner (partner_owner,
--    partner_admin, partner_support) asks the customer for the data of one
--    or more events of a workspace, with a reason and the reference of the
--    request; the owner or an admin of the workspace approves (24 h to 7
--    days, 72 h by default), denies or revokes; the job expires it. The
--    data is read only by `private.read_event_data_by_grant`, which checks
--    the grant and records `event.data.viewed` (with the company and the
--    workspace, so the customer sees it) in the same call. The request
--    becomes an event of the hub (`events.access_requested`) emitted by the
--    worker (job `events.access-request`, queued by the requester).
-- 7. Trace of an event (gap "Rastro completo"): deliveries with the bell,
--    audit records and data views, by level, through security definer
--    functions; the customer never sees the `keychain` openings.
-- 8. `private.set_event_status`: resolved or dismissed by the customer's
--    owner and admins, the partner managers and the platform (owner,
--    operations) for its own events.
-- Owner app_migrations, ENABLE + FORCE RLS, no grants to anon/authenticated.
-- Functions owned by app_rls_helper get their grants before the ownership
-- transfer (app_migrations is NOINHERIT).
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Settings of an event (worker)
-- ----------------------------------------------------------------------------
create policy settings_event_helper_select on public.settings
  for select to app_rls_helper
  using (
    (key like 'notifications.%' or key = 'region.timezone')
    and (
      scope = 'platform'
      or (scope = 'partner' and partner_id::text = current_setting('app.event_partner', true))
      or (scope = 'workspace' and workspace_id::text = current_setting('app.event_workspace', true))
    )
  );

create function private.event_settings(p_event_id uuid)
returns table(scope text, key text, value jsonb, locked boolean)
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_prev_id text := current_setting('app.event_id', true);
  v_prev_ws text := current_setting('app.event_workspace', true);
  v_prev_partner text := current_setting('app.event_partner', true);
  v_workspace uuid;
  v_partner uuid;
begin
  perform set_config('app.event_id', coalesce(p_event_id::text, ''), true);
  select e.workspace_id, e.partner_id into v_workspace, v_partner
  from public.events e where e.id = p_event_id;
  if found then
    perform set_config('app.event_workspace', coalesce(v_workspace::text, ''), true);
    perform set_config('app.event_partner', coalesce(v_partner::text, ''), true);
    return query
      select s.scope, s.key, s.value, s.locked
      from public.settings s
      where (s.key like 'notifications.%' or s.key = 'region.timezone')
        and (
          s.scope = 'platform'
          or (s.scope = 'partner' and s.partner_id = v_partner)
          or (s.scope = 'workspace' and s.workspace_id = v_workspace)
        );
  end if;
  perform set_config('app.event_id', coalesce(v_prev_id, ''), true);
  perform set_config('app.event_workspace', coalesce(v_prev_ws, ''), true);
  perform set_config('app.event_partner', coalesce(v_prev_partner, ''), true);
end;
$$;

revoke execute on function private.event_settings(uuid) from public, anon, authenticated;
grant execute on function private.event_settings(uuid) to app_worker;
alter function private.event_settings(uuid) owner to app_rls_helper;

-- ----------------------------------------------------------------------------
-- 2. The person's WhatsApp
-- ----------------------------------------------------------------------------
create table public.user_whatsapp_numbers (
  user_id       uuid primary key references public.profiles(id) on delete cascade,
  phone         text not null check (phone ~ '^\+[1-9][0-9]{7,14}$'),
  consented_at  timestamptz not null,
  updated_at    timestamptz not null default now()
);

alter table public.user_whatsapp_numbers owner to app_migrations;
revoke all on public.user_whatsapp_numbers from public, anon, authenticated;
alter table public.user_whatsapp_numbers enable row level security;
alter table public.user_whatsapp_numbers force row level security;

create trigger user_whatsapp_numbers_touch_updated_at
  before update on public.user_whatsapp_numbers
  for each row execute function private.touch_updated_at();

create policy user_whatsapp_numbers_self_select on public.user_whatsapp_numbers
  for select to app_runtime
  using (user_id = private.context_uuid('app.user_id'));

create policy user_whatsapp_numbers_self_insert on public.user_whatsapp_numbers
  for insert to app_runtime
  with check (
    user_id = private.context_uuid('app.user_id')
    and consented_at <= now() + interval '1 minute'
    and consented_at >= now() - interval '5 minutes'
  );

create policy user_whatsapp_numbers_self_update on public.user_whatsapp_numbers
  for update to app_runtime
  using (user_id = private.context_uuid('app.user_id'))
  with check (
    user_id = private.context_uuid('app.user_id')
    and consented_at <= now() + interval '1 minute'
  );

create policy user_whatsapp_numbers_self_delete on public.user_whatsapp_numbers
  for delete to app_runtime
  using (user_id = private.context_uuid('app.user_id'));

grant select, insert, delete on public.user_whatsapp_numbers to app_runtime;
grant update (phone, consented_at, updated_at) on public.user_whatsapp_numbers to app_runtime;

-- The hub reads a number only while one of its functions asks (flag set and
-- restored by the function), never the table at large.
create policy user_whatsapp_numbers_event_helper_select on public.user_whatsapp_numbers
  for select to app_rls_helper
  using (current_setting('app.event_phones', true) = 'on');

grant select on public.user_whatsapp_numbers to app_rls_helper;

-- ----------------------------------------------------------------------------
-- 3. Deliveries waiting for their time, preferences and the bell's event
-- ----------------------------------------------------------------------------
alter table public.notification_deliveries
  add column deliver_after timestamptz,
  add column hold_reason text check (hold_reason is null or hold_reason in ('quiet_hours', 'digest'));

create index notification_deliveries_waiting_idx
  on public.notification_deliveries (deliver_after)
  where status = 'queued' and hold_reason is not null;

alter table public.notification_preferences drop constraint notification_preferences_channel_check;
alter table public.notification_preferences add constraint notification_preferences_channel_check
  check (channel in ('email', 'app', 'whatsapp'));

alter table public.user_notifications
  add column event_id uuid references public.events(id) on delete set null;

create index user_notifications_event_idx
  on public.user_notifications (event_id) where event_id is not null;

-- The number of a WhatsApp delivery that waits (quiet window or digest),
-- for the job that sends it: only a queued WhatsApp of a person who still
-- accepts it.
create function private.delivery_whatsapp(p_delivery_id uuid)
returns text
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_prev text := current_setting('app.event_phones', true);
  v_user uuid;
  v_phone text;
begin
  select d.recipient_user_id into v_user
  from public.notification_deliveries d
  where d.id = p_delivery_id and d.channel = 'whatsapp' and d.status = 'queued';
  if v_user is null then
    return null;
  end if;
  perform set_config('app.event_phones', 'on', true);
  select n.phone into v_phone from public.user_whatsapp_numbers n where n.user_id = v_user;
  perform set_config('app.event_phones', coalesce(v_prev, ''), true);
  return v_phone;
end;
$$;

create policy notification_deliveries_whatsapp_helper_select on public.notification_deliveries
  for select to app_rls_helper
  using (channel = 'whatsapp' and status = 'queued');

revoke execute on function private.delivery_whatsapp(uuid) from public, anon, authenticated;
grant execute on function private.delivery_whatsapp(uuid) to app_worker;
alter function private.delivery_whatsapp(uuid) owner to app_rls_helper;

-- ----------------------------------------------------------------------------
-- 4. Who to tell: the route, or the roles of a rule
-- ----------------------------------------------------------------------------
create function private.event_audience(p_event_id uuid, p_roles text[])
returns table(user_id uuid, email text, role text, whatsapp text)
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
  v_prev_phones text := current_setting('app.event_phones', true);
  v_route text;
  v_level text;
  v_workspace uuid;
  v_organization uuid;
  v_partner uuid;
  v_person uuid;
  v_mode text;
  v_managed boolean := false;
  v_ws_roles text[];
  v_partner_roles text[];
begin
  perform set_config('app.event_id', coalesce(p_event_id::text, ''), true);
  select e.route, e.level, e.workspace_id, e.organization_id, e.partner_id, e.recipient_user_id
    into v_route, v_level, v_workspace, v_organization, v_partner, v_person
  from public.events e
  where e.id = p_event_id;

  if v_route is not null then
    perform set_config('app.event_workspace', coalesce(v_workspace::text, ''), true);
    perform set_config('app.event_org', coalesce(v_organization::text, ''), true);
    perform set_config('app.event_partner', coalesce(v_partner::text, ''), true);
    perform set_config('app.event_phones', 'on', true);

    if v_organization is not null then
      select m.mode into v_mode
      from public.organization_service_modes m
      where m.organization_id = v_organization and m.partner_id = v_partner;
      v_managed := v_mode = 'gerenciado';
    end if;

    if p_roles is null then
      -- The route of the event (as `private.event_recipients`).
      if v_route = 'service_mode' and v_managed then
        return query
          select m.user_id, m.email, m.role, n.phone
          from public.partner_members m
          left join public.user_whatsapp_numbers n on n.user_id = m.user_id
          where m.partner_id = v_partner
            and m.status = 'active'
            and m.role in ('partner_owner', 'partner_admin', 'partner_support')
          order by m.created_at, m.user_id;
      elsif v_route in ('service_mode', 'customer') and v_workspace is not null then
        v_ws_roles := array['owner', 'admin'];
      elsif v_route = 'partner' and v_partner is not null then
        if exists (select 1 from public.partner_billing_profiles b where b.partner_id = v_partner) then
          return query
            select null::uuid, lower(trim(b.billing_email)), 'billing'::text, null::text
            from public.partner_billing_profiles b
            where b.partner_id = v_partner;
          return query
            select m.user_id, null::text, m.role, n.phone
            from public.partner_members m
            left join public.user_whatsapp_numbers n on n.user_id = m.user_id
            where m.partner_id = v_partner and m.role = 'partner_owner' and m.status = 'active'
            order by m.created_at, m.user_id;
        else
          return query
            select m.user_id, m.email, m.role, n.phone
            from public.partner_members m
            left join public.user_whatsapp_numbers n on n.user_id = m.user_id
            where m.partner_id = v_partner and m.role = 'partner_owner' and m.status = 'active'
            order by m.created_at, m.user_id;
        end if;
      elsif v_route = 'platform' then
        perform set_config('app.platform_team', 'on', true);
        return query
          select pam.user_id, null::text, pam.role, n.phone
          from public.platform_admin_members pam
          left join public.user_whatsapp_numbers n on n.user_id = pam.user_id
          where pam.status = 'active' and pam.role in ('owner', 'operations')
          order by pam.created_at, pam.user_id;
      elsif v_route = 'subject_person' and v_person is not null then
        return query
          select v_person, null::text, 'person'::text,
                 (select n.phone from public.user_whatsapp_numbers n where n.user_id = v_person);
      end if;
    else
      -- The roles of a rule: workspace roles for a workspace event; partner
      -- roles when the partner manages the company or the event is its own.
      v_ws_roles := array(
        select r from unnest(p_roles) r
        where r in ('owner', 'admin', 'editor', 'viewer') and v_level = 'workspace'
      );
      v_partner_roles := array(
        select r from unnest(p_roles) r
        where r in ('partner_owner', 'partner_admin', 'partner_support')
          and (v_level = 'partner' or (v_level = 'workspace' and v_managed))
      );
      if cardinality(v_partner_roles) > 0 and v_partner is not null then
        return query
          select m.user_id, m.email, m.role, n.phone
          from public.partner_members m
          left join public.user_whatsapp_numbers n on n.user_id = m.user_id
          where m.partner_id = v_partner
            and m.status = 'active'
            and m.role = any (v_partner_roles)
          order by m.created_at, m.user_id;
      end if;
    end if;

    if cardinality(coalesce(v_ws_roles, array[]::text[])) > 0 and v_workspace is not null then
      return query
        with people as (
          select member.user_id, member.role,
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
            and member.role = any (v_ws_roles)
            and member.support_grant_id is null
        )
        select p.user_id,
               case when p.email is not null
                         and row_number() over (partition by p.email order by p.user_id) = 1
                    then p.email end,
               p.role,
               (select n.phone from public.user_whatsapp_numbers n where n.user_id = p.user_id)
        from people p
        order by p.user_id;
    end if;
  end if;

  perform set_config('app.event_id', coalesce(v_prev_id, ''), true);
  perform set_config('app.event_workspace', coalesce(v_prev_ws, ''), true);
  perform set_config('app.event_org', coalesce(v_prev_org, ''), true);
  perform set_config('app.event_partner', coalesce(v_prev_partner, ''), true);
  perform set_config('app.platform_team', coalesce(v_prev_team, ''), true);
  perform set_config('app.event_phones', coalesce(v_prev_phones, ''), true);
end;
$$;

revoke execute on function private.event_audience(uuid, text[]) from public, anon, authenticated;
grant execute on function private.event_audience(uuid, text[]) to app_worker;
alter function private.event_audience(uuid, text[]) owner to app_rls_helper;

-- ----------------------------------------------------------------------------
-- 5. WhatsApp texts, versioned
-- ----------------------------------------------------------------------------
create table public.whatsapp_templates (
  id          uuid primary key default gen_random_uuid(),
  scope       text not null check (scope in ('platform', 'partner')),
  partner_id  uuid references public.partners(id) on delete cascade,
  event_type  text not null
                check (event_type ~ '^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$' and length(event_type) <= 80),
  locale      text not null check (locale ~ '^[a-z]{2,3}(-[A-Z][A-Za-z0-9]{1,7})?$'),
  version     integer not null check (version between 1 and 100000),
  body        text not null check (length(btrim(body)) between 1 and 1000),
  is_current  boolean not null default true,
  parent_id   uuid references public.whatsapp_templates(id) on delete set null,
  created_by  uuid references public.profiles(id) on delete set null,
  created_at  timestamptz not null default now(),
  constraint whatsapp_templates_level_check check (
    (scope = 'platform' and partner_id is null)
    or (scope = 'partner' and partner_id is not null)
  )
);

create unique index whatsapp_templates_platform_version
  on public.whatsapp_templates (event_type, locale, version) where scope = 'platform';
create unique index whatsapp_templates_partner_version
  on public.whatsapp_templates (partner_id, event_type, locale, version) where scope = 'partner';
create unique index whatsapp_templates_platform_current
  on public.whatsapp_templates (event_type, locale) where scope = 'platform' and is_current;
create unique index whatsapp_templates_partner_current
  on public.whatsapp_templates (partner_id, event_type, locale) where scope = 'partner' and is_current;

alter table public.whatsapp_templates owner to app_migrations;
revoke all on public.whatsapp_templates from public, anon, authenticated;
alter table public.whatsapp_templates enable row level security;
alter table public.whatsapp_templates force row level security;

create policy whatsapp_templates_select on public.whatsapp_templates
  for select to app_runtime
  using (
    (scope = 'platform' and private.current_platform_admin_role() is not null)
    or (scope = 'partner'
        and partner_id = private.current_partner_id()
        and private.current_partner_role() is not null)
  );

-- A new version, current, by the level's managers.
create policy whatsapp_templates_insert on public.whatsapp_templates
  for insert to app_runtime
  with check (
    created_by = private.context_uuid('app.user_id')
    and is_current
    and (
      (scope = 'platform' and private.current_platform_admin_role() in ('owner', 'operations'))
      or (scope = 'partner'
          and partner_id = private.current_partner_id()
          and private.current_partner_role() in ('partner_owner', 'partner_admin'))
    )
  );

-- The only change: a current version stops being current (a new version
-- or "restore the default"). The text never changes.
create policy whatsapp_templates_retire on public.whatsapp_templates
  for update to app_runtime
  using (
    is_current
    and (
      (scope = 'platform' and private.current_platform_admin_role() in ('owner', 'operations'))
      or (scope = 'partner'
          and partner_id = private.current_partner_id()
          and private.current_partner_role() in ('partner_owner', 'partner_admin'))
    )
  )
  with check (
    not is_current
    and (
      (scope = 'platform' and private.current_platform_admin_role() in ('owner', 'operations'))
      or (scope = 'partner'
          and partner_id = private.current_partner_id()
          and private.current_partner_role() in ('partner_owner', 'partner_admin'))
    )
  );

grant select, insert on public.whatsapp_templates to app_runtime;
grant update (is_current) on public.whatsapp_templates to app_runtime;

create policy whatsapp_templates_helper_select on public.whatsapp_templates
  for select to app_rls_helper
  using (is_current);

grant select on public.whatsapp_templates to app_rls_helper;

-- The current text to send: the partner's, else the platform's.
create function private.whatsapp_template(p_partner_id uuid, p_event_type text, p_locale text)
returns table(scope text, body text, version integer)
language sql
stable
security definer
set search_path = ''
as $$
  select t.scope, t.body, t.version
  from public.whatsapp_templates t
  where t.is_current
    and t.event_type = p_event_type
    and t.locale = p_locale
    and (t.scope = 'platform' or (t.scope = 'partner' and t.partner_id = p_partner_id))
  order by (t.scope = 'partner') desc
  limit 1;
$$;

revoke execute on function private.whatsapp_template(uuid, text, text) from public, anon, authenticated;
grant execute on function private.whatsapp_template(uuid, text, text) to app_runtime, app_worker;
alter function private.whatsapp_template(uuid, text, text) owner to app_rls_helper;

-- ----------------------------------------------------------------------------
-- 6. Approval events from the worker; status changes
-- ----------------------------------------------------------------------------
-- The worker may record an event that waits for a decision (`pending`).
drop policy events_worker_insert on public.events;
create policy events_worker_insert on public.events
  for insert to app_worker
  with check (
    status in ('open', 'pending')
    and dispatched_at is null
    and verified_at is null
    and integrity is null
    and occurred_at >= now() - interval '5 minutes'
    and occurred_at <= now() + interval '1 minute'
  );

-- The helper changes the status of the event its function pins, or of the
-- access request of the grant it pins.
create policy events_helper_status_update on public.events
  for update to app_rls_helper
  using (
    id::text = current_setting('app.event_id', true)
    or (type = 'events.access_requested'
        and subject_id = current_setting('app.event_grant', true))
  )
  with check (
    id::text = current_setting('app.event_id', true)
    or (type = 'events.access_requested'
        and subject_id = current_setting('app.event_grant', true))
  );

-- An update reads the row too: the access request of the pinned grant.
create policy events_helper_grant_select on public.events
  for select to app_rls_helper
  using (
    type = 'events.access_requested'
    and subject_id = current_setting('app.event_grant', true)
  );

grant update (status) on public.events to app_rls_helper;

-- Resolved, dismissed or open again: the customer's owner and admins for
-- the customer's events, the partner managers for the events they manage
-- or that are addressed to the partner, the platform (owner, operations)
-- for its own events. Approvals keep their own status.
create function private.set_event_status(p_event_id uuid, p_status text)
returns boolean
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_prev text := current_setting('app.event_id', true);
  v_event record;
  v_allowed boolean := false;
begin
  if p_status is null or p_status not in ('open', 'resolved', 'dismissed') then
    raise exception 'events: invalid status' using errcode = 'invalid_parameter_value';
  end if;
  perform set_config('app.event_id', coalesce(p_event_id::text, ''), true);
  select e.id, e.level, e.status, e.audiences, e.workspace_id, e.organization_id, e.partner_id
    into v_event
  from public.events e where e.id = p_event_id;
  if v_event.id is null or v_event.status not in ('open', 'resolved', 'dismissed') then
    perform set_config('app.event_id', coalesce(v_prev, ''), true);
    return false;
  end if;
  v_allowed :=
    (v_event.workspace_id = private.context_uuid('app.workspace_id')
      and v_event.organization_id = private.context_uuid('app.organization_id')
      and 'customer' = any (v_event.audiences)
      and private.current_workspace_role() in ('owner', 'admin'))
    or (private.current_partner_role() in ('partner_owner', 'partner_admin', 'partner_support')
      and v_event.partner_id = private.current_partner_id()
      and ('partner' = any (v_event.audiences)
           or (v_event.organization_id is not null
               and private.partner_manages_organization(v_event.organization_id))))
    or (v_event.level = 'platform'
      and private.current_platform_admin_role() in ('owner', 'operations'));
  if coalesce(v_allowed, false) then
    update public.events set status = p_status where id = p_event_id;
  end if;
  perform set_config('app.event_id', coalesce(v_prev, ''), true);
  return coalesce(v_allowed, false);
end;
$$;

revoke execute on function private.set_event_status(uuid, text) from public, anon, authenticated;
grant execute on function private.set_event_status(uuid, text) to app_runtime;
alter function private.set_event_status(uuid, text) owner to app_rls_helper;

-- ----------------------------------------------------------------------------
-- 7. Access to the data of events (ADR 0022 item 7)
-- ----------------------------------------------------------------------------
create table public.event_access_grants (
  id               uuid primary key default gen_random_uuid(),
  requester_kind   text not null check (requester_kind in ('platform', 'partner')),
  -- The requester's partner (partner requests only).
  partner_id       uuid references public.partners(id) on delete cascade,
  organization_id  uuid not null references public.organizations(id) on delete cascade,
  workspace_id     uuid not null,
  -- Written by the database when the request is made.
  workspace_slug   text,
  workspace_name   text,
  requester_label  text check (requester_label is null or length(requester_label) <= 254),
  event_ids        uuid[] not null check (cardinality(event_ids) between 1 and 50),
  requested_by     uuid not null references public.profiles(id) on delete cascade,
  reason           text not null check (length(btrim(reason)) between 10 and 500),
  reference        text not null check (length(btrim(reference)) between 1 and 120),
  duration_hours   integer not null default 72 check (duration_hours between 24 and 168),
  status           text not null default 'pending'
                     check (status in ('pending', 'approved', 'denied', 'revoked', 'expired')),
  expires_at       timestamptz,
  decided_by       uuid references public.profiles(id) on delete set null,
  decided_at       timestamptz,
  revoked_by       uuid references public.profiles(id) on delete set null,
  revoked_at       timestamptz,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  constraint event_access_grants_kind_check check (
    (requester_kind = 'platform' and partner_id is null)
    or (requester_kind = 'partner' and partner_id is not null)
  ),
  constraint event_access_grants_approved_check check (status <> 'approved' or expires_at is not null),
  constraint fk_event_access_grants_workspace
    foreign key (workspace_id, organization_id)
    references public.workspaces(id, organization_id) on delete cascade
);

create index event_access_grants_workspace_idx on public.event_access_grants (workspace_id, created_at desc);
create index event_access_grants_requester_idx on public.event_access_grants (requested_by, created_at desc);
create index event_access_grants_expiry_idx on public.event_access_grants (expires_at) where status = 'approved';
create index event_access_grants_events_idx on public.event_access_grants using gin (event_ids);

alter table public.event_access_grants owner to app_migrations;
revoke all on public.event_access_grants from public, anon, authenticated;
alter table public.event_access_grants enable row level security;
alter table public.event_access_grants force row level security;

create trigger event_access_grants_touch_updated_at
  before update on public.event_access_grants
  for each row execute function private.touch_updated_at();

-- Every event of the request is a customer event of that workspace.
create function private.event_access_target_ok(p_event_ids uuid[], p_workspace_id uuid, p_organization_id uuid)
returns boolean
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_prev text := current_setting('app.event_chain', true);
  v_ok boolean;
begin
  if p_event_ids is null or cardinality(p_event_ids) not between 1 and 50
     or (select count(distinct x) from unnest(p_event_ids) x) <> cardinality(p_event_ids)
     or p_workspace_id is null then
    return false;
  end if;
  perform set_config('app.event_chain', 'ws:' || p_workspace_id::text, true);
  select count(*) = cardinality(p_event_ids) into v_ok
  from public.events e
  where e.id = any (p_event_ids)
    and e.chain_key = 'ws:' || p_workspace_id::text
    and e.workspace_id = p_workspace_id
    and e.organization_id = p_organization_id
    and 'customer' = any (e.audiences);
  perform set_config('app.event_chain', coalesce(v_prev, ''), true);
  return coalesce(v_ok, false);
end;
$$;

revoke execute on function private.event_access_target_ok(uuid[], uuid, uuid) from public, anon, authenticated;
grant execute on function private.event_access_target_ok(uuid[], uuid, uuid) to app_runtime;
alter function private.event_access_target_ok(uuid[], uuid, uuid) owner to app_rls_helper;

-- The slug and the requester's label are the database's, never the
-- requester's: the customer reads who asked.
create policy workspaces_event_helper_select on public.workspaces
  for select to app_rls_helper
  using (id::text = current_setting('app.event_workspace', true));

create function private.event_access_grant_fill()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_prev_ws text := current_setting('app.event_workspace', true);
  v_prev_partner text := current_setting('app.event_partner', true);
begin
  perform set_config('app.event_workspace', new.workspace_id::text, true);
  select w.slug, w.name into new.workspace_slug, new.workspace_name
  from public.workspaces w where w.id = new.workspace_id;
  if new.requester_kind = 'partner' then
    perform set_config('app.event_partner', new.partner_id::text, true);
    select m.email into new.requester_label
    from public.partner_members m
    where m.partner_id = new.partner_id and m.user_id = new.requested_by;
  else
    new.requester_label := null;
  end if;
  perform set_config('app.event_workspace', coalesce(v_prev_ws, ''), true);
  perform set_config('app.event_partner', coalesce(v_prev_partner, ''), true);
  return new;
end;
$$;

revoke execute on function private.event_access_grant_fill() from public, anon, authenticated;

-- Created while app_migrations still owns the function (creating a trigger
-- needs EXECUTE on it); it runs as its owner afterwards.
create trigger event_access_grants_fill
  before insert on public.event_access_grants
  for each row execute function private.event_access_grant_fill();

alter function private.event_access_grant_fill() owner to app_rls_helper;

-- Who sees a request: the requester, and the owner and admins of the
-- workspace in its context.
create policy event_access_grants_requester_select on public.event_access_grants
  for select to app_runtime
  using (requested_by = private.context_uuid('app.user_id'));

create policy event_access_grants_customer_select on public.event_access_grants
  for select to app_runtime
  using (
    workspace_id = private.context_uuid('app.workspace_id')
    and organization_id = private.context_uuid('app.organization_id')
    and private.current_workspace_role() in ('owner', 'admin')
  );

-- The platform support asks for itself.
create policy event_access_grants_platform_insert on public.event_access_grants
  for insert to app_runtime
  with check (
    requester_kind = 'platform'
    and partner_id is null
    and private.current_platform_admin_role() in ('owner', 'operations', 'support')
    and requested_by = private.context_uuid('app.user_id')
    and status = 'pending'
    and expires_at is null and decided_by is null and decided_at is null
    and revoked_by is null and revoked_at is null
    and private.event_access_target_ok(event_ids, workspace_id, organization_id)
  );

-- The partner asks for itself, for a company of the context partner.
create policy event_access_grants_partner_insert on public.event_access_grants
  for insert to app_runtime
  with check (
    requester_kind = 'partner'
    and partner_id = private.current_partner_id()
    and private.current_partner_role() in ('partner_owner', 'partner_admin', 'partner_support')
    and private.is_partner_organization(organization_id)
    and requested_by = private.context_uuid('app.user_id')
    and status = 'pending'
    and expires_at is null and decided_by is null and decided_at is null
    and revoked_by is null and revoked_at is null
    and private.event_access_target_ok(event_ids, workspace_id, organization_id)
  );

-- Every WITH CHECK below repeats who may write it (permissive UPDATE
-- policies combine USING of one with WITH CHECK of another).

-- The customer decides a pending request: approve for at most the asked
-- duration, or deny.
create policy event_access_grants_decide on public.event_access_grants
  for update to app_runtime
  using (
    status = 'pending'
    and workspace_id = private.context_uuid('app.workspace_id')
    and organization_id = private.context_uuid('app.organization_id')
    and private.current_workspace_role() in ('owner', 'admin')
  )
  with check (
    decided_by = private.context_uuid('app.user_id')
    and decided_at is not null
    and workspace_id = private.context_uuid('app.workspace_id')
    and organization_id = private.context_uuid('app.organization_id')
    and private.current_workspace_role() in ('owner', 'admin')
    and revoked_by is null
    and (
      (status = 'denied' and expires_at is null)
      or (status = 'approved'
          and expires_at > now()
          and expires_at <= now() + make_interval(hours => duration_hours) + interval '1 minute')
    )
  );

-- The customer revokes an approved grant at any time.
create policy event_access_grants_customer_revoke on public.event_access_grants
  for update to app_runtime
  using (
    status = 'approved'
    and workspace_id = private.context_uuid('app.workspace_id')
    and organization_id = private.context_uuid('app.organization_id')
    and private.current_workspace_role() in ('owner', 'admin')
  )
  with check (
    status = 'revoked'
    and revoked_by = private.context_uuid('app.user_id')
    and revoked_at is not null
    and workspace_id = private.context_uuid('app.workspace_id')
    and organization_id = private.context_uuid('app.organization_id')
    and private.current_workspace_role() in ('owner', 'admin')
  );

-- The requester withdraws a request or ends a grant.
create policy event_access_grants_requester_revoke on public.event_access_grants
  for update to app_runtime
  using (
    requested_by = private.context_uuid('app.user_id')
    and status in ('pending', 'approved')
  )
  with check (
    status = 'revoked'
    and requested_by = private.context_uuid('app.user_id')
    and revoked_by = private.context_uuid('app.user_id')
    and revoked_at is not null
  );

grant select, insert on public.event_access_grants to app_runtime;
grant update (status, expires_at, decided_by, decided_at, revoked_by, revoked_at, updated_at)
  on public.event_access_grants to app_runtime;

-- The worker emits the request's event and expires grants and requests.
create policy event_access_grants_worker_select on public.event_access_grants
  for select to app_worker
  using (true);

create policy event_access_grants_worker_expire on public.event_access_grants
  for update to app_worker
  using (status in ('pending', 'approved'))
  with check (status = 'expired');

grant select (id, requester_kind, partner_id, organization_id, workspace_id, workspace_slug,
              workspace_name, requester_label, event_ids, requested_by, reason, reference, duration_hours,
              status, expires_at, created_at)
  on public.event_access_grants to app_worker;
grant update (status, updated_at) on public.event_access_grants to app_worker;

create policy event_access_grants_helper_select on public.event_access_grants
  for select to app_rls_helper
  using (
    requested_by = private.context_uuid('app.user_id')
    or id::text = current_setting('app.event_grant', true)
    or workspace_id::text = current_setting('app.event_workspace', true)
  );

grant select on public.event_access_grants to app_rls_helper;

-- The requester queues the job that emits the request's event.
create function private.event_access_request_pending(p_grant_id text)
returns boolean
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_ok boolean;
begin
  if p_grant_id is null
     or p_grant_id !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    return false;
  end if;
  select exists (
    select 1 from public.event_access_grants g
    where g.id = p_grant_id::uuid
      and g.status = 'pending'
      and g.requested_by = private.context_uuid('app.user_id')
  ) into v_ok;
  return coalesce(v_ok, false);
end;
$$;

revoke execute on function private.event_access_request_pending(text) from public, anon, authenticated;
grant execute on function private.event_access_request_pending(text) to app_runtime;
alter function private.event_access_request_pending(text) owner to app_rls_helper;

create policy job_runs_event_access_insert on public.job_runs
  for insert to app_runtime
  with check (
    kind = 'events.access-request'
    and scope = 'platform'
    and status = 'pending'
    and attempts = 0
    and partner_id is null
    and organization_id is null
    and workspace_id is null
    and requested_by = private.context_uuid('app.user_id')
    and idempotency_key = 'access:' || (payload ->> 'grantId')
    and private.event_access_request_pending(payload ->> 'grantId')
  );

-- The request's event follows the grant (approved, denied, expired).
create function private.event_access_sync(p_grant_id uuid)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_prev text := current_setting('app.event_grant', true);
  v_status text;
begin
  perform set_config('app.event_grant', coalesce(p_grant_id::text, ''), true);
  select g.status into v_status from public.event_access_grants g where g.id = p_grant_id;
  if v_status in ('approved', 'denied', 'expired') then
    update public.events
    set status = v_status
    where type = 'events.access_requested'
      and subject_id = p_grant_id::text
      and status = 'pending';
  end if;
  perform set_config('app.event_grant', coalesce(v_prev, ''), true);
end;
$$;

revoke execute on function private.event_access_sync(uuid) from public, anon, authenticated;
grant execute on function private.event_access_sync(uuid) to app_runtime;
alter function private.event_access_sync(uuid) owner to app_rls_helper;

-- Reading the data with a grant: the requester, still holding the role of
-- the request, an approved and unexpired grant naming the event. The view
-- is recorded with the company and the workspace (the customer sees it).
create policy audit_events_data_viewed_helper_insert on public.audit_events
  for insert to app_rls_helper
  with check (
    action = 'event.data.viewed'
    and resource_type = 'event'
    and resource_id = current_setting('app.event_id', true)
    and actor_principal_type = 'user'
    and actor_user_id = private.context_uuid('app.user_id')
    and organization_id::text = current_setting('app.event_org', true)
    and workspace_id::text = current_setting('app.event_workspace', true)
    and represented_user_id is null
    and grant_id is null
    and origin = 'admin'
    and occurred_at >= now() - interval '5 minutes'
    and occurred_at <= now() + interval '1 minute'
  );

create function private.read_event_data_by_grant(p_event_id uuid, p_ip text)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_prev_id text := current_setting('app.event_id', true);
  v_prev_ws text := current_setting('app.event_workspace', true);
  v_prev_org text := current_setting('app.event_org', true);
  v_user uuid := private.context_uuid('app.user_id');
  v_grant record;
  v_event record;
  v_ip text;
begin
  if v_user is null or p_event_id is null then
    raise exception 'events: access grant required' using errcode = 'insufficient_privilege';
  end if;
  select g.id, g.requester_kind, g.partner_id, g.workspace_id, g.organization_id
    into v_grant
  from public.event_access_grants g
  where g.requested_by = v_user
    and g.status = 'approved'
    and g.expires_at > now()
    and p_event_id = any (g.event_ids)
  order by g.expires_at desc
  limit 1;
  if v_grant.id is null
     or (v_grant.requester_kind = 'platform'
         and private.current_platform_admin_role() is distinct from 'owner'
         and private.current_platform_admin_role() is distinct from 'operations'
         and private.current_platform_admin_role() is distinct from 'support')
     or (v_grant.requester_kind = 'partner'
         and (private.current_partner_id() is distinct from v_grant.partner_id
              or private.current_partner_role() not in ('partner_owner', 'partner_admin', 'partner_support')
              or private.current_partner_role() is null)) then
    raise exception 'events: access grant required' using errcode = 'insufficient_privilege';
  end if;
  begin
    v_ip := host(nullif(trim(coalesce(p_ip, '')), '')::inet);
  exception when invalid_text_representation then
    v_ip := null;
  end;

  perform set_config('app.event_id', p_event_id::text, true);
  select e.id, e.type, e.data, e.workspace_id, e.organization_id into v_event
  from public.events e
  where e.id = p_event_id and e.workspace_id = v_grant.workspace_id;
  if v_event.id is null then
    perform set_config('app.event_id', coalesce(v_prev_id, ''), true);
    return null;
  end if;
  perform set_config('app.event_workspace', v_event.workspace_id::text, true);
  perform set_config('app.event_org', v_event.organization_id::text, true);

  insert into public.audit_events (
    id, occurred_at, organization_id, workspace_id, actor_user_id, actor_principal_type,
    represented_user_id, origin, client_id, grant_id, action, resource_type, resource_id,
    result, request_id, metadata
  ) values (
    gen_random_uuid(), now(), v_event.organization_id, v_event.workspace_id, v_user, 'user',
    null, 'admin', null, null, 'event.data.viewed', 'event', p_event_id::text,
    'success', null,
    jsonb_strip_nulls(jsonb_build_object(
      'eventId', p_event_id, 'eventType', v_event.type, 'accessGrantId', v_grant.id,
      'requesterKind', v_grant.requester_kind, 'partnerId', v_grant.partner_id, 'ip', v_ip
    ))
  );

  perform set_config('app.event_id', coalesce(v_prev_id, ''), true);
  perform set_config('app.event_workspace', coalesce(v_prev_ws, ''), true);
  perform set_config('app.event_org', coalesce(v_prev_org, ''), true);
  return v_event.data;
end;
$$;

revoke execute on function private.read_event_data_by_grant(uuid, text) from public, anon, authenticated;
grant execute on function private.read_event_data_by_grant(uuid, text) to app_runtime;
alter function private.read_event_data_by_grant(uuid, text) owner to app_rls_helper;

-- ----------------------------------------------------------------------------
-- 8. Trace of an event
-- ----------------------------------------------------------------------------
-- Who may trace an event and how much they see:
--   'customer'  a member of the event's workspace (customer events);
--   'partner'   a partner manager of the event's partner (people only where
--               it manages the company or the event is the partner's);
--   'platform'  owner, operations and support (billing: billing events),
--               never the people.
create function private.event_trace_viewer(p_event_id uuid)
returns text
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_prev text := current_setting('app.event_id', true);
  v_event record;
  v_viewer text;
begin
  perform set_config('app.event_id', coalesce(p_event_id::text, ''), true);
  select e.id, e.workspace_id, e.organization_id, e.partner_id, e.audiences, e.module
    into v_event
  from public.events e where e.id = p_event_id;
  if v_event.id is not null then
    if v_event.workspace_id is not null
       and v_event.workspace_id = private.context_uuid('app.workspace_id')
       and v_event.organization_id = private.context_uuid('app.organization_id')
       and 'customer' = any (v_event.audiences)
       and private.is_workspace_member(v_event.workspace_id, v_event.organization_id) then
      v_viewer := 'customer';
    elsif private.current_partner_role() in ('partner_owner', 'partner_admin', 'partner_support')
          and v_event.partner_id = private.current_partner_id() then
      v_viewer := case
        when 'partner' = any (v_event.audiences)
             or (v_event.organization_id is not null
                 and private.partner_manages_organization(v_event.organization_id))
          then 'partner'
        else 'partner_situation'
      end;
    elsif private.current_platform_admin_role() in ('owner', 'operations', 'support')
          or (private.current_platform_admin_role() = 'billing' and v_event.module = 'billing') then
      v_viewer := 'platform';
    end if;
  end if;
  perform set_config('app.event_id', coalesce(v_prev, ''), true);
  return v_viewer;
end;
$$;

revoke execute on function private.event_trace_viewer(uuid) from public, anon, authenticated;
grant execute on function private.event_trace_viewer(uuid) to app_runtime;
alter function private.event_trace_viewer(uuid) owner to app_rls_helper;

create policy notification_deliveries_trace_helper_select on public.notification_deliveries
  for select to app_rls_helper
  using (event_id::text = current_setting('app.event_id', true));

create policy user_notifications_trace_helper_select on public.user_notifications
  for select to app_rls_helper
  using (event_id::text = current_setting('app.event_id', true));

grant select (event_id, read_at, created_at) on public.user_notifications to app_rls_helper;

-- Every delivery of the event, the bell included (one row per notice,
-- `read` once the person opened it). The person only for the customer and
-- the partner that manages the company.
create function private.event_trace_deliveries(p_event_id uuid)
returns table(
  id uuid,
  channel text,
  status text,
  reason text,
  provider text,
  attempts integer,
  hold_reason text,
  deliver_after timestamptz,
  recipient_user_id uuid,
  created_at timestamptz,
  updated_at timestamptz
)
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_prev text := current_setting('app.event_id', true);
  v_viewer text := private.event_trace_viewer(p_event_id);
  v_people boolean;
begin
  if v_viewer is null then
    return;
  end if;
  v_people := v_viewer in ('customer', 'partner');
  perform set_config('app.event_id', p_event_id::text, true);
  return query
    select d.id, d.channel, d.status, d.reason, d.provider, d.attempts, d.hold_reason,
           d.deliver_after, case when v_people then d.recipient_user_id end,
           d.created_at, d.updated_at
    from public.notification_deliveries d
    where d.event_id = p_event_id
    union all
    select n.id, 'app'::text, case when n.read_at is null then 'delivered' else 'read' end,
           null::text, 'bell'::text, 1, null::text, null::timestamptz,
           case when v_people then n.user_id end, n.created_at, coalesce(n.read_at, n.created_at)
    from public.user_notifications n
    where n.event_id = p_event_id
    order by 10, 1;
  perform set_config('app.event_id', coalesce(v_prev, ''), true);
end;
$$;

revoke execute on function private.event_trace_deliveries(uuid) from public, anon, authenticated;
grant execute on function private.event_trace_deliveries(uuid) to app_runtime;
alter function private.event_trace_deliveries(uuid) owner to app_rls_helper;

create policy audit_events_trace_helper_select on public.audit_events
  for select to app_rls_helper
  using (
    resource_id = current_setting('app.event_id', true)
    or metadata ->> 'eventId' = current_setting('app.event_id', true)
  );

grant select on public.audit_events to app_rls_helper;

-- What was audited about the event. The `keychain` openings stay in the
-- platform's audit (Marcelo, 16/10/2026): only the platform sees them.
create function private.event_trace_audit(p_event_id uuid)
returns table(
  id uuid,
  occurred_at timestamptz,
  action text,
  result text,
  origin text,
  actor_user_id uuid,
  access_grant_id uuid
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
  if v_viewer is null or v_viewer = 'partner_situation' then
    return;
  end if;
  perform set_config('app.event_id', p_event_id::text, true);
  return query
    select a.id, a.occurred_at, a.action, a.result, a.origin,
           case when v_viewer = 'platform' or a.action = 'event.data.viewed' then a.actor_user_id end,
           case when (a.metadata ->> 'accessGrantId')
                       ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
                then (a.metadata ->> 'accessGrantId')::uuid end
    from public.audit_events a
    where (a.resource_id = p_event_id::text or a.metadata ->> 'eventId' = p_event_id::text)
      and (v_viewer = 'platform' or a.action <> 'platform.event.view_data')
    order by a.occurred_at, a.id;
  perform set_config('app.event_id', coalesce(v_prev, ''), true);
end;
$$;

revoke execute on function private.event_trace_audit(uuid) from public, anon, authenticated;
grant execute on function private.event_trace_audit(uuid) to app_runtime;
alter function private.event_trace_audit(uuid) owner to app_rls_helper;

-- The data views of the event with the grant behind each: who asked (the
-- platform, or the partner's member e-mail) and who authorized.
create function private.event_data_views(p_event_id uuid)
returns table(
  viewed_at timestamptz,
  requester_kind text,
  requester_label text,
  requested_by uuid,
  decided_by uuid,
  access_grant_id uuid
)
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_prev text := current_setting('app.event_id', true);
  v_prev_ws text := current_setting('app.event_workspace', true);
  v_viewer text := private.event_trace_viewer(p_event_id);
  v_workspace uuid;
begin
  if v_viewer is null or v_viewer = 'partner_situation' then
    return;
  end if;
  perform set_config('app.event_id', p_event_id::text, true);
  select e.workspace_id into v_workspace from public.events e where e.id = p_event_id;
  perform set_config('app.event_workspace', coalesce(v_workspace::text, ''), true);
  return query
    select a.occurred_at, g.requester_kind, g.requester_label, g.requested_by, g.decided_by, g.id
    from public.audit_events a
    join public.event_access_grants g
      on g.id::text = a.metadata ->> 'accessGrantId' and g.workspace_id = v_workspace
    where a.action = 'event.data.viewed'
      and a.resource_id = p_event_id::text
    order by a.occurred_at desc;
  perform set_config('app.event_id', coalesce(v_prev, ''), true);
  perform set_config('app.event_workspace', coalesce(v_prev_ws, ''), true);
end;
$$;

revoke execute on function private.event_data_views(uuid) from public, anon, authenticated;
grant execute on function private.event_data_views(uuid) to app_runtime;
alter function private.event_data_views(uuid) owner to app_rls_helper;
