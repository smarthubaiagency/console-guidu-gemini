-- ============================================================================
-- Migration: 20261213090000_aj1_adjustments.sql
-- Module: AJ1 — Ajustes da H2 e da GB1c (Central de Eventos, ADR 0022;
--         modos de serviço, ADR 0020)
--
-- Maintenance Rationale:
-- 1. Back to `padrao` by one function for everybody:
--    `private.service_mode_revert(company, via, reason)`. The company owner
--    (via `customer`, in the workspace context, as in the GB1c), the
--    partner (via `partner`: partner_owner, partner_admin of the company's
--    partner) or GUIDU for the direct customers (via `platform`: platform
--    owner, operations; partner zero). The partner and the platform write a
--    reason (10 to 500 characters). The mode row moves to `padrao` with
--    `source` customer or partner, the audit is written in the same call
--    and every policy that asks `private.partner_manages_organization`
--    reads the row, so the managing team loses access in this transaction.
-- 2. New event `service_mode.reverted_by_partner`: the insert policy of the
--    `service_mode.*` events and their dispatch accept it when the same
--    person moved the mode back as partner in this transaction.
--    `private.service_mode_revert_recipients` answers the worker who hears:
--    the company owners (bell and e-mail, the address of their latest
--    accepted invitation) and the partner's owners and admins (bell).
-- 3. `security.ip_blocked` (CF5a, H2 decision 11): the IP gate of /platform
--    and /admin queues the job `security.ip-blocked` when it refuses an
--    address; the worker records the event (it holds the seal's key). The
--    insert policy accepts only an address the allow list really refuses,
--    in the current hour, with the key `ip_blocked:<area>[:<partner>]:
--    <ip>:<hour>`; `job_runs (kind, idempotency_key)` is unique, so an
--    address and area leave at most one event per hour. Only the address
--    and the area are kept.
-- 4. Security events (CF5a) page by (`occurred_at`, `id`), like the AUD1:
--    `private.security_events(before, before_id, limit)` replaces the
--    two-argument version, which skipped events of the same millisecond.
-- Settings read by helper policies (`app.service_mode_org`,
-- `app.service_mode_partner`, `app.event_id`) are set and restored by the
-- functions below only.
-- Owner app_migrations, no grants to anon/authenticated. Functions owned by
-- app_rls_helper get their grants before the ownership transfer
-- (app_migrations is NOINHERIT); the GB1c functions are replaced as their
-- owner (`set local role app_rls_helper`).
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Back to `padrao` (owner, partner or platform)
-- ----------------------------------------------------------------------------
-- Helper: the company pinned by `private.service_mode_revert` leaves the
-- managed mode, signed by whom acts.
create policy organization_service_modes_revert_helper_update on public.organization_service_modes
  for update to app_rls_helper
  using (
    organization_id::text = current_setting('app.service_mode_org', true)
    and mode = 'gerenciado'
  )
  with check (
    organization_id::text = current_setting('app.service_mode_org', true)
    and mode = 'padrao'
    and source in ('customer', 'partner')
    and request_id is null
    and set_by = private.context_uuid('app.user_id')
  );

create function private.service_mode_revert(p_organization_id uuid, p_via text, p_reason text)
returns table(
  workspace_id uuid,
  workspace_slug text,
  workspace_name text,
  organization_name text,
  partner_id uuid,
  partner_name text
)
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_prev_org text := current_setting('app.service_mode_org', true);
  v_prev_partner text := current_setting('app.service_mode_partner', true);
  v_user uuid := private.context_uuid('app.user_id');
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
  v_partner uuid;
  v_org_name text;
  v_partner_name text;
  v_ws uuid;
  v_ws_slug text;
  v_ws_name text;
begin
  if v_user is null then
    raise exception 'service_mode:forbidden';
  end if;
  if p_via = 'customer' then
    if p_organization_id is distinct from private.context_uuid('app.organization_id')
       or coalesce(private.current_organization_role(), '') <> 'owner' then
      raise exception 'service_mode:forbidden';
    end if;
  elsif p_via = 'partner' then
    if coalesce(private.current_partner_role(), '') not in ('partner_owner', 'partner_admin') then
      raise exception 'service_mode:forbidden';
    end if;
  elsif p_via = 'platform' then
    if coalesce(private.current_platform_admin_role(), '') not in ('owner', 'operations') then
      raise exception 'service_mode:forbidden';
    end if;
  else
    raise exception 'service_mode:invalid';
  end if;
  if p_via <> 'customer'
     and (v_reason is null or char_length(v_reason) not between 10 and 500) then
    raise exception 'service_mode:reason';
  end if;

  perform set_config('app.service_mode_org', coalesce(p_organization_id::text, ''), true);
  select o.partner_id, o.name into v_partner, v_org_name
  from public.organizations o where o.id = p_organization_id;
  if v_partner is null
     or (p_via = 'partner' and v_partner is distinct from private.current_partner_id())
     or (p_via = 'platform' and v_partner <> '00000000-0000-4000-8000-000000000000'::uuid) then
    perform set_config('app.service_mode_org', coalesce(v_prev_org, ''), true);
    raise exception 'service_mode:not_found';
  end if;
  perform set_config('app.service_mode_partner', v_partner::text, true);
  perform pg_advisory_xact_lock(hashtextextended('service_mode:' || p_organization_id::text, 0));

  update public.organization_service_modes m
  set mode = 'padrao',
      source = case when p_via = 'customer' then 'customer' else 'partner' end,
      request_id = null,
      set_by = v_user
  where m.organization_id = p_organization_id
    and m.partner_id = v_partner
    and m.mode = 'gerenciado';
  if not found then
    perform set_config('app.service_mode_org', coalesce(v_prev_org, ''), true);
    perform set_config('app.service_mode_partner', coalesce(v_prev_partner, ''), true);
    raise exception 'service_mode:not_managed';
  end if;

  select w.id, w.slug, w.name into v_ws, v_ws_slug, v_ws_name
  from public.workspaces w
  where w.organization_id = p_organization_id and w.status = 'active'
  order by w.created_at, w.id limit 1;
  select p.name into v_partner_name from public.partners p where p.id = v_partner;

  insert into public.audit_events (
    organization_id, workspace_id, actor_user_id, actor_principal_type, origin,
    action, resource_type, resource_id, result, metadata
  ) values (
    p_organization_id, v_ws, v_user, 'user',
    case p_via when 'customer' then 'app' when 'platform' then 'admin' else 'partner' end,
    case when p_via = 'customer' then 'service_mode.reverted' else 'service_mode.reverted_by_partner' end,
    'organization', p_organization_id::text, 'success',
    jsonb_strip_nulls(jsonb_build_object(
      'from', 'gerenciado', 'to', 'padrao', 'via', p_via, 'partnerId', v_partner,
      'reason', v_reason
    ))
  );

  perform set_config('app.service_mode_org', coalesce(v_prev_org, ''), true);
  perform set_config('app.service_mode_partner', coalesce(v_prev_partner, ''), true);
  return query select v_ws, v_ws_slug, v_ws_name, v_org_name, v_partner, v_partner_name;
end;
$$;

revoke execute on function private.service_mode_revert(uuid, text, text) from public, anon, authenticated;
grant execute on function private.service_mode_revert(uuid, text, text) to app_runtime;
alter function private.service_mode_revert(uuid, text, text) owner to app_rls_helper;

-- ----------------------------------------------------------------------------
-- 2. Event `service_mode.reverted_by_partner` and its dispatch
-- ----------------------------------------------------------------------------
drop policy events_service_mode_insert on public.events;
create policy events_service_mode_insert on public.events
  for insert to app_runtime
  with check (
    level = 'workspace'
    and type in ('service_mode.change_requested', 'service_mode.changed',
                 'service_mode.change_denied', 'service_mode.reverted_by_partner')
    and module = 'service_modes'
    and status = 'open'
    and dispatched_at is null
    and verified_at is null
    and integrity is null
    and chain_key = 'ws:' || workspace_id::text
    and occurred_at >= now() - interval '5 minutes'
    and occurred_at <= now() + interval '1 minute'
    and private.service_mode_event_allowed(
      type, subject_type, subject_id, organization_id, workspace_id, partner_id, created_by
    )
  );

set local role app_rls_helper;

create or replace function private.service_mode_event_allowed(
  p_type text,
  p_subject_type text,
  p_subject_id text,
  p_organization_id uuid,
  p_workspace_id uuid,
  p_partner_id uuid,
  p_created_by uuid
)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_prev_org text := current_setting('app.service_mode_org', true);
  v_ok boolean := false;
begin
  if p_created_by is null or p_organization_id is null
     or p_subject_id is null
     or p_subject_id !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    return false;
  end if;
  perform set_config('app.service_mode_org', p_organization_id::text, true);
  if p_subject_type = 'service_mode_request' then
    select exists (
      select 1
      from public.service_mode_requests r
      join public.organizations o on o.id = r.organization_id
      where r.id = p_subject_id::uuid
        and r.organization_id = p_organization_id
        and r.workspace_id = p_workspace_id
        and r.partner_id = p_partner_id
        and o.partner_id = p_partner_id
        and (
          (p_type = 'service_mode.change_requested' and r.status = 'pending'
            and r.created_at = now() and r.requested_by = p_created_by)
          or (p_type = 'service_mode.changed' and r.status = 'approved'
            and r.decided_at = now() and r.decided_by = p_created_by)
          or (p_type = 'service_mode.change_denied' and r.status = 'denied'
            and r.decided_at = now() and r.decided_by = p_created_by)
        )
    ) into v_ok;
  elsif p_subject_type = 'organization_service_mode'
        and p_type in ('service_mode.changed', 'service_mode.reverted_by_partner') then
    select exists (
      select 1
      from public.organization_service_modes m
      join public.organizations o on o.id = m.organization_id
      join public.workspaces w on w.id = p_workspace_id and w.organization_id = m.organization_id
      where m.organization_id = p_organization_id
        and p_subject_id::uuid = m.organization_id
        and m.partner_id = p_partner_id
        and o.partner_id = p_partner_id
        and m.mode = 'padrao'
        and (
          (p_type = 'service_mode.changed' and m.source in ('customer', 'partner'))
          or (p_type = 'service_mode.reverted_by_partner' and m.source = 'partner')
        )
        and m.updated_at = now()
        and m.set_by = p_created_by
    ) into v_ok;
  end if;
  perform set_config('app.service_mode_org', coalesce(v_prev_org, ''), true);
  return coalesce(v_ok, false);
end;
$$;

create or replace function private.service_mode_event_dispatch_allowed(p_event_id text, p_requested_by uuid)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_prev text := current_setting('app.event_id', true);
  v_ok boolean := false;
begin
  if p_event_id is null
     or p_event_id !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    return false;
  end if;
  perform set_config('app.event_id', p_event_id, true);
  select exists (
    select 1 from public.events e
    where e.id = p_event_id::uuid
      and e.type in ('service_mode.change_requested', 'service_mode.changed',
                     'service_mode.change_denied', 'service_mode.reverted_by_partner')
      and e.created_by is not distinct from p_requested_by
      and e.dispatched_at is null
      and e.created_at = now()
  ) into v_ok;
  perform set_config('app.event_id', coalesce(v_prev, ''), true);
  return coalesce(v_ok, false);
end;
$$;

reset role;

-- Worker: who hears that the partner (or GUIDU) moved the company back to
-- `padrao`: the company owners, with the e-mail of their latest accepted
-- invitation in the company, and the partner's owners and admins (bell).
create function private.service_mode_revert_recipients(p_event_id uuid)
returns table(user_id uuid, email text, kind text, organization_name text, partner_name text)
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_prev_event text := current_setting('app.event_id', true);
  v_prev_org text := current_setting('app.service_mode_org', true);
  v_prev_partner text := current_setting('app.service_mode_partner', true);
  v_org uuid;
  v_partner uuid;
  v_org_name text;
  v_partner_name text;
begin
  perform set_config('app.event_id', coalesce(p_event_id::text, ''), true);
  select e.organization_id, e.partner_id into v_org, v_partner
  from public.events e
  where e.id = p_event_id and e.type = 'service_mode.reverted_by_partner';
  perform set_config('app.event_id', coalesce(v_prev_event, ''), true);
  if v_org is null then
    return;
  end if;
  perform set_config('app.service_mode_org', v_org::text, true);
  perform set_config('app.service_mode_partner', v_partner::text, true);
  select o.name into v_org_name from public.organizations o where o.id = v_org;
  select p.name into v_partner_name from public.partners p where p.id = v_partner;

  return query
    with people as (
      select m.user_id as person, 'owner'::text as person_kind, 1 as rank
      from public.organization_members m
      where m.organization_id = v_org and m.role = 'owner' and m.status = 'active'
      union all
      select pm.user_id, 'partner', 2
      from public.partner_members pm
      where pm.partner_id = v_partner and pm.status = 'active'
        and pm.role in ('partner_owner', 'partner_admin')
    ),
    chosen as (
      select distinct on (p.person) p.person, p.person_kind
      from people p where p.person is not null
      order by p.person, p.rank
    )
    select c.person,
           case when c.person_kind = 'owner' then (
             select lower(trim(i.email))
             from public.invitations i
             where i.organization_id = v_org
               and i.status = 'accepted'
               and i.accepted_by_user_id = c.person
             order by i.accepted_at desc nulls last
             limit 1
           ) end,
           c.person_kind, v_org_name, v_partner_name
    from chosen c
    order by c.person;

  perform set_config('app.service_mode_org', coalesce(v_prev_org, ''), true);
  perform set_config('app.service_mode_partner', coalesce(v_prev_partner, ''), true);
end;
$$;

revoke execute on function private.service_mode_revert_recipients(uuid) from public, anon, authenticated;
grant execute on function private.service_mode_revert_recipients(uuid) to app_worker;
alter function private.service_mode_revert_recipients(uuid) owner to app_rls_helper;

-- ----------------------------------------------------------------------------
-- 3. `security.ip_blocked`: the gate queues, the worker records
-- ----------------------------------------------------------------------------
-- True for the job of an address the area's allow list refuses now, keyed
-- by area, partner (for /admin), address and the current hour (UTC).
create function private.ip_blocked_job_allowed(p_payload jsonb, p_key text)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_area text := p_payload ->> 'area';
  v_partner_raw text := p_payload ->> 'partnerId';
  v_ip_raw text := p_payload ->> 'ip';
  v_hour text := to_char(date_trunc('hour', now() at time zone 'UTC'), 'YYYY-MM-DD"T"HH24');
  v_partner uuid;
  v_ip inet;
  v_key text;
begin
  if p_payload is null or jsonb_typeof(p_payload) <> 'object'
     or (select count(*) from jsonb_object_keys(p_payload)) <> 4
     or not (p_payload ? 'area' and p_payload ? 'partnerId' and p_payload ? 'ip' and p_payload ? 'hour')
     or p_payload ->> 'hour' is distinct from v_hour
     or v_area not in ('platform', 'admin') then
    return false;
  end if;
  if v_area = 'admin' then
    if v_partner_raw is null
       or v_partner_raw !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
      return false;
    end if;
    v_partner := v_partner_raw::uuid;
  elsif v_partner_raw is not null then
    return false;
  end if;
  if v_ip_raw is not null then
    begin
      v_ip := v_ip_raw::inet;
    exception when others then
      return false;
    end;
    -- One spelling per address: the host form, without a mask.
    if host(v_ip) <> v_ip_raw or abbrev(v_ip) <> host(v_ip) then
      return false;
    end if;
  end if;
  v_key := 'ip_blocked:' || v_area || ':'
    || coalesce(v_partner::text || ':', '')
    || coalesce(v_ip_raw, 'unknown') || ':' || v_hour;
  if p_key is distinct from v_key then
    return false;
  end if;
  return not private.ip_allowed(v_area, v_partner, v_ip);
end;
$$;

revoke execute on function private.ip_blocked_job_allowed(jsonb, text) from public, anon, authenticated;
grant execute on function private.ip_blocked_job_allowed(jsonb, text) to app_runtime;
alter function private.ip_blocked_job_allowed(jsonb, text) owner to app_rls_helper;

-- The gate runs before any workspace context and may run without a person
-- in context: the job carries no person, company or workspace.
create policy job_runs_ip_blocked_insert on public.job_runs
  for insert to app_runtime
  with check (
    kind = 'security.ip-blocked'
    and scope = 'platform'
    and status = 'pending'
    and attempts = 0
    and partner_id is null
    and organization_id is null
    and workspace_id is null
    and requested_by is null
    and private.ip_blocked_job_allowed(payload, idempotency_key)
  );

-- ----------------------------------------------------------------------------
-- 4. Security events (CF5a) paged by (occurred_at, id)
-- ----------------------------------------------------------------------------
create function private.security_events(p_before timestamptz, p_before_id uuid, p_limit integer)
returns table(
  id uuid,
  occurred_at timestamptz,
  action text,
  result text,
  origin text,
  actor_user_id uuid,
  organization_id uuid,
  workspace_id uuid,
  resource_type text,
  resource_id text,
  partner_id text
)
language sql
stable
security definer
set search_path = ''
as $$
  select e.id, e.occurred_at, e.action, e.result, e.origin, e.actor_user_id,
         e.organization_id, e.workspace_id, e.resource_type, e.resource_id,
         e.metadata ->> 'partnerId'
  from public.audit_events e
  where private.is_security_event(e.action, e.metadata)
    and (p_before is null
         or (e.occurred_at, e.id)
            < (p_before, coalesce(p_before_id, 'ffffffff-ffff-ffff-ffff-ffffffffffff'::uuid)))
    and (
      private.current_platform_admin_role() in ('owner', 'operations', 'support')
      or (private.current_partner_role() in ('partner_owner', 'partner_admin')
          and (e.metadata ->> 'partnerId' = private.current_partner_id()::text
               or (e.organization_id is not null
                   and private.is_partner_organization(e.organization_id))))
    )
  order by e.occurred_at desc, e.id desc
  limit least(greatest(coalesce(p_limit, 50), 1), 200);
$$;

revoke execute on function private.security_events(timestamptz, uuid, integer) from public, anon, authenticated;
grant execute on function private.security_events(timestamptz, uuid, integer) to app_runtime;
alter function private.security_events(timestamptz, uuid, integer) owner to app_rls_helper;

-- The two-argument version is dropped by its owner.
set local role app_rls_helper;
drop function private.security_events(timestamptz, integer);
reset role;
