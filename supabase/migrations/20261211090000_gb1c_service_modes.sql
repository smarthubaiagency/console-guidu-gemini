-- ============================================================================
-- Migration: 20261211090000_gb1c_service_modes.sql
-- Module: GB1c — Modos de serviço completos (ADR 0020; especificação do
--         Google Meu Negócio, seção 3)
--
-- Maintenance Rationale:
-- 1. `public.service_mode_requests`: the formal request to move a company
--    from `padrao` to `gerenciado`, made by the partner (partner_owner,
--    partner_admin) or by GUIDU for the direct customers (platform owner,
--    operations; partner zero). The company owner decides by a secure link
--    (single use, 7 days; only the SHA-256 of the token is kept, written
--    by the dispatch of the e-mail) or inside /app. The decision keeps who,
--    when, how, from which IP and user agent (proof of consent, LGPD).
--    States: pending, approved, denied, expired, cancelled. Nobody writes
--    the table directly: security definer functions create, cancel and
--    decide; readers see every column but the token hash.
-- 2. `public.organization_service_modes` gains `source` (registration,
--    request, customer, partner) and `request_id`. The partner no longer
--    switches a company to `gerenciado` at will: it inserts the mode only
--    in the transaction that registers the company (the contract), and may
--    only move it back to `padrao` (end of contract). The company owner
--    goes back to `padrao` alone, at any time; every policy that asks
--    `private.partner_manages_organization` reads the row, so the managing
--    team loses access on the next query.
-- 3. Management clause in the first-access terms: legal kind `management`,
--    versioned and translated like terms and privacy. Required only of
--    owners of a company registered as managed (`source = registration`)
--    by the partner of the host (`private.management_clause_required`).
--    Version 1 is seeded for every partner (and for every new partner by a
--    trigger) with a provisional text marked for the legal review
--    (D-PA-06).
-- 4. Managed access in the other modules (ADR 0020 item 7): the policies of
--    CRM contacts, the GUIDS of the workspace (writes), their conversations,
--    leads and notices, the channels of the workspace, the portfolio and
--    the workspace settings also accept the managing partner team, through
--    the same `private.partner_manages_organization(org)`, with no support
--    grant. The customer's credentials (the AI key among them) stay out.
--    Every write of the managing team in those tables is audited by a
--    trigger with origin `partner` (new value of `audit_events.origin`).
-- 5. Events `service_mode.*` (Central de Eventos, ADR 0022): emitted by
--    `emitEvent` from partner, platform and public-link transactions, which
--    have no workspace in context; a dedicated insert policy accepts them
--    only when they describe a request or a mode change made in the same
--    transaction by the same person, and the matching `events.dispatch`.
-- Settings read by helper policies (`app.service_mode_org`,
-- `app.service_mode_partner`, `app.service_mode_request`,
-- `app.service_mode_token`, `app.legal_seed`) are set and restored by the
-- functions below only; other helper functions filter by the person of the
-- context and gain no reach from them.
-- Owner app_migrations, ENABLE + FORCE RLS, no grants to anon/authenticated.
-- Functions owned by app_rls_helper get their grants before the ownership
-- transfer (app_migrations is NOINHERIT).
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 0. Audit origin of the managing partner
-- ----------------------------------------------------------------------------
alter table public.audit_events drop constraint audit_events_origin_check;
alter table public.audit_events add constraint audit_events_origin_check
  check (origin in ('app', 'api', 'mcp', 'worker', 'admin', 'partner'));

-- ----------------------------------------------------------------------------
-- 1. Requests
-- ----------------------------------------------------------------------------
create table public.service_mode_requests (
  id                 uuid primary key default gen_random_uuid(),
  organization_id    uuid not null references public.organizations(id) on delete cascade,
  workspace_id       uuid not null,
  partner_id         uuid not null references public.partners(id) on delete cascade,
  requested_mode     text not null default 'gerenciado' check (requested_mode = 'gerenciado'),
  status             text not null default 'pending'
                       check (status in ('pending', 'approved', 'denied', 'expired', 'cancelled')),
  requested_by       uuid references public.profiles(id) on delete set null,
  requested_via      text not null check (requested_via in ('partner', 'platform')),
  -- The company owner who decides (and receives the link).
  recipient_user_id  uuid references public.profiles(id) on delete set null,
  token_hash         text unique check (token_hash ~ '^[0-9a-f]{64}$'),
  token_issued_at    timestamptz,
  token_used_at      timestamptz,
  expires_at         timestamptz not null,
  decided_by         uuid references public.profiles(id) on delete set null,
  decided_at         timestamptz,
  decided_via        text check (decided_via in ('link', 'app')),
  decided_ip         inet,
  decided_user_agent text check (length(decided_user_agent) <= 500),
  cancelled_by       uuid references public.profiles(id) on delete set null,
  cancelled_at       timestamptz,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  constraint fk_service_mode_requests_workspace
    foreign key (workspace_id, organization_id)
    references public.workspaces(id, organization_id) on delete cascade,
  constraint service_mode_requests_decision_check
    check ((status in ('approved', 'denied')) = (decided_at is not null and decided_via is not null)),
  constraint service_mode_requests_cancel_check
    check ((status = 'cancelled') = (cancelled_at is not null)),
  constraint service_mode_requests_token_check
    check (token_used_at is null or token_hash is not null),
  constraint service_mode_requests_expiry_check check (expires_at > created_at)
);

create unique index service_mode_requests_one_pending
  on public.service_mode_requests (organization_id) where status = 'pending';
create index service_mode_requests_partner_idx
  on public.service_mode_requests (partner_id, created_at desc);
create index service_mode_requests_organization_idx
  on public.service_mode_requests (organization_id, created_at desc);

alter table public.service_mode_requests owner to app_migrations;
revoke all on public.service_mode_requests from public, anon, authenticated;
alter table public.service_mode_requests enable row level security;
alter table public.service_mode_requests force row level security;

create trigger service_mode_requests_touch_updated_at
  before update on public.service_mode_requests
  for each row execute function private.touch_updated_at();

-- Members of the company read its requests in the workspace context.
create policy service_mode_requests_member_select on public.service_mode_requests
  for select to app_runtime
  using (
    organization_id = private.context_uuid('app.organization_id')
    and (
      private.is_organization_member(organization_id)
      or private.current_workspace_role() is not null
    )
  );

-- The partner's team reads the requests of its companies.
create policy service_mode_requests_partner_select on public.service_mode_requests
  for select to app_runtime
  using (
    private.current_partner_role() in ('partner_owner', 'partner_admin', 'partner_support')
    and partner_id = private.current_partner_id()
    and private.is_partner_organization(organization_id)
  );

-- GUIDU reads the requests of its direct customers (partner zero).
create policy service_mode_requests_platform_select on public.service_mode_requests
  for select to app_runtime
  using (
    private.current_platform_admin_role() in ('owner', 'operations', 'support')
    and partner_id = '00000000-0000-4000-8000-000000000000'::uuid
  );

-- Every column but the token hash.
grant select (
  id, organization_id, workspace_id, partner_id, requested_mode, status,
  requested_by, requested_via, recipient_user_id, token_issued_at,
  token_used_at, expires_at, decided_by, decided_at, decided_via, decided_ip,
  decided_user_agent, cancelled_by, cancelled_at, created_at, updated_at
) on public.service_mode_requests to app_runtime;

-- Helper: the request pinned by a function (company, id or token).
create policy service_mode_requests_helper_select on public.service_mode_requests
  for select to app_rls_helper
  using (
    organization_id::text = current_setting('app.service_mode_org', true)
    or id::text = current_setting('app.service_mode_request', true)
    or (token_hash is not null and token_hash = current_setting('app.service_mode_token', true))
  );

create policy service_mode_requests_helper_insert on public.service_mode_requests
  for insert to app_rls_helper
  with check (
    organization_id::text = current_setting('app.service_mode_org', true)
    and status = 'pending'
    and token_hash is null
    and decided_at is null
  );

create policy service_mode_requests_helper_update on public.service_mode_requests
  for update to app_rls_helper
  using (organization_id::text = current_setting('app.service_mode_org', true))
  with check (organization_id::text = current_setting('app.service_mode_org', true));

grant select, insert, update on public.service_mode_requests to app_rls_helper;

-- ----------------------------------------------------------------------------
-- 2. Service mode: source, request, who may change it
-- ----------------------------------------------------------------------------
alter table public.organization_service_modes
  add column source text not null default 'registration'
    check (source in ('registration', 'request', 'customer', 'partner')),
  add column request_id uuid references public.service_mode_requests(id) on delete set null;

-- Only the transaction that registers the company (the contract) inserts
-- the managed mode; `now()` is the start of the transaction.
create function private.organization_born_in_transaction(p_organization_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.organizations organization
    where organization.id = p_organization_id
      and organization.partner_id = private.current_partner_id()
      and organization.created_at = now()
  );
$$;

revoke execute on function private.organization_born_in_transaction(uuid) from public, anon, authenticated;
grant execute on function private.organization_born_in_transaction(uuid) to app_runtime;
alter function private.organization_born_in_transaction(uuid) owner to app_rls_helper;

drop policy organization_service_modes_partner_insert on public.organization_service_modes;
create policy organization_service_modes_partner_insert on public.organization_service_modes
  for insert to app_runtime
  with check (
    private.current_partner_role() in ('partner_owner', 'partner_admin')
    and partner_id = private.current_partner_id()
    and private.is_partner_organization(organization_id)
    and set_by = private.context_uuid('app.user_id')
    and request_id is null
    and (
      (mode = 'gerenciado' and source = 'registration'
        and private.organization_born_in_transaction(organization_id))
      or (mode = 'padrao' and source in ('registration', 'partner'))
    )
  );

-- The partner only ends the managed service (end of contract).
drop policy organization_service_modes_partner_update on public.organization_service_modes;
create policy organization_service_modes_partner_update on public.organization_service_modes
  for update to app_runtime
  using (
    private.current_partner_role() in ('partner_owner', 'partner_admin')
    and partner_id = private.current_partner_id()
    and private.is_partner_organization(organization_id)
  )
  with check (
    private.current_partner_role() in ('partner_owner', 'partner_admin')
    and partner_id = private.current_partner_id()
    and private.is_partner_organization(organization_id)
    and set_by = private.context_uuid('app.user_id')
    and mode = 'padrao'
    and source = 'partner'
    and request_id is null
  );

-- The company owner goes back to `padrao` alone, in the workspace context.
create policy organization_service_modes_owner_update on public.organization_service_modes
  for update to app_runtime
  using (
    organization_id = private.context_uuid('app.organization_id')
    and private.current_organization_role() = 'owner'
    and mode = 'gerenciado'
  )
  with check (
    organization_id = private.context_uuid('app.organization_id')
    and private.current_organization_role() = 'owner'
    and set_by = private.context_uuid('app.user_id')
    and mode = 'padrao'
    and source = 'customer'
    and request_id is null
  );

-- The partner of a company never changes through an update.
revoke update on public.organization_service_modes from app_runtime;
grant update (mode, source, request_id, set_by) on public.organization_service_modes to app_runtime;

-- Helper: the company pinned by a service-mode function.
create policy organization_service_modes_sm_helper_select on public.organization_service_modes
  for select to app_rls_helper
  using (organization_id::text = current_setting('app.service_mode_org', true));

create policy organization_service_modes_sm_helper_insert on public.organization_service_modes
  for insert to app_rls_helper
  with check (
    organization_id::text = current_setting('app.service_mode_org', true)
    and mode = 'gerenciado' and source = 'request' and request_id is not null
  );

create policy organization_service_modes_sm_helper_update on public.organization_service_modes
  for update to app_rls_helper
  using (organization_id::text = current_setting('app.service_mode_org', true))
  with check (
    organization_id::text = current_setting('app.service_mode_org', true)
    and mode = 'gerenciado' and source = 'request' and request_id is not null
  );

grant insert, update on public.organization_service_modes to app_rls_helper;

-- ----------------------------------------------------------------------------
-- 3. What the service-mode functions read (pinned company and partner)
-- ----------------------------------------------------------------------------
create policy organizations_service_mode_helper_select on public.organizations
  for select to app_rls_helper
  using (id::text = current_setting('app.service_mode_org', true));

create policy workspaces_service_mode_helper_select on public.workspaces
  for select to app_rls_helper
  using (organization_id::text = current_setting('app.service_mode_org', true));

create policy organization_members_service_mode_helper_select on public.organization_members
  for select to app_rls_helper
  using (organization_id::text = current_setting('app.service_mode_org', true));

create policy invitations_service_mode_helper_select on public.invitations
  for select to app_rls_helper
  using (
    status = 'accepted'
    and organization_id::text = current_setting('app.service_mode_org', true)
  );

create policy partners_service_mode_helper_select on public.partners
  for select to app_rls_helper
  using (id::text = current_setting('app.service_mode_partner', true));

create policy partner_members_service_mode_helper_select on public.partner_members
  for select to app_rls_helper
  using (partner_id::text = current_setting('app.service_mode_partner', true));

create policy audit_events_service_mode_helper_insert on public.audit_events
  for insert to app_rls_helper
  with check (
    action like 'service\_mode.%'
    and organization_id::text = current_setting('app.service_mode_org', true)
    and occurred_at >= now() - interval '5 minutes'
    and occurred_at <= now() + interval '1 minute'
  );

grant select on public.organizations, public.workspaces, public.organization_members,
  public.invitations, public.partners, public.partner_members to app_rls_helper;
grant insert on public.audit_events to app_rls_helper;

-- ----------------------------------------------------------------------------
-- 4. Functions of the request
-- ----------------------------------------------------------------------------
-- Errors carry a stable code in the message (`service_mode:<code>`), which
-- the application turns into a translated message.

-- Creates a pending request (partner or platform), valid for 7 days.
create function private.service_mode_request_create(p_organization_id uuid, p_via text)
returns table(
  request_id uuid,
  workspace_id uuid,
  workspace_slug text,
  workspace_name text,
  organization_name text,
  partner_id uuid,
  partner_name text,
  recipient_user_id uuid,
  expires_at timestamptz
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
  v_partner uuid;
  v_org_name text;
  v_partner_name text;
  v_owner uuid;
  v_ws uuid;
  v_ws_slug text;
  v_ws_name text;
  v_id uuid;
  v_expires timestamptz := now() + interval '7 days';
begin
  if v_user is null then
    raise exception 'service_mode:forbidden' using errcode = '42501';
  end if;
  if p_via = 'partner' then
    if coalesce(private.current_partner_role(), '') not in ('partner_owner', 'partner_admin') then
      raise exception 'service_mode:forbidden' using errcode = '42501';
    end if;
  elsif p_via = 'platform' then
    if coalesce(private.current_platform_admin_role(), '') not in ('owner', 'operations') then
      raise exception 'service_mode:forbidden' using errcode = '42501';
    end if;
  else
    raise exception 'service_mode:invalid' using errcode = '22023';
  end if;

  perform set_config('app.service_mode_org', coalesce(p_organization_id::text, ''), true);
  select o.partner_id, o.name into v_partner, v_org_name
  from public.organizations o where o.id = p_organization_id;
  if v_partner is null
     or (p_via = 'partner' and v_partner is distinct from private.current_partner_id())
     or (p_via = 'platform' and v_partner <> '00000000-0000-4000-8000-000000000000'::uuid) then
    raise exception 'service_mode:not_found' using errcode = 'P0002';
  end if;
  perform set_config('app.service_mode_partner', v_partner::text, true);
  perform pg_advisory_xact_lock(hashtextextended('service_mode:' || p_organization_id::text, 0));

  if exists (
    select 1 from public.organization_service_modes m
    where m.organization_id = p_organization_id and m.partner_id = v_partner and m.mode = 'gerenciado'
  ) then
    raise exception 'service_mode:already_managed' using errcode = '23514';
  end if;

  update public.service_mode_requests r set status = 'expired'
  where r.organization_id = p_organization_id and r.status = 'pending' and r.expires_at <= now();
  if exists (
    select 1 from public.service_mode_requests r
    where r.organization_id = p_organization_id and r.status = 'pending'
  ) then
    raise exception 'service_mode:pending_exists' using errcode = '23505';
  end if;

  select m.user_id into v_owner
  from public.organization_members m
  where m.organization_id = p_organization_id and m.role = 'owner' and m.status = 'active'
  order by m.created_at, m.user_id limit 1;
  if v_owner is null then
    raise exception 'service_mode:no_owner' using errcode = '23514';
  end if;

  select w.id, w.slug, w.name into v_ws, v_ws_slug, v_ws_name
  from public.workspaces w
  where w.organization_id = p_organization_id and w.status = 'active'
  order by w.created_at, w.id limit 1;
  if v_ws is null then
    raise exception 'service_mode:no_workspace' using errcode = '23514';
  end if;

  select p.name into v_partner_name from public.partners p where p.id = v_partner;

  insert into public.service_mode_requests as r (
    organization_id, workspace_id, partner_id, requested_by, requested_via,
    recipient_user_id, expires_at
  ) values (
    p_organization_id, v_ws, v_partner, v_user, p_via, v_owner, v_expires
  ) returning r.id into v_id;

  insert into public.audit_events (
    organization_id, workspace_id, actor_user_id, actor_principal_type, origin,
    action, resource_type, resource_id, result, metadata
  ) values (
    p_organization_id, v_ws, v_user, 'user',
    case when p_via = 'platform' then 'admin' else 'partner' end,
    'service_mode.request.created', 'service_mode_request', v_id::text, 'success',
    jsonb_build_object('via', p_via, 'partnerId', v_partner)
  );

  perform set_config('app.service_mode_org', coalesce(v_prev_org, ''), true);
  perform set_config('app.service_mode_partner', coalesce(v_prev_partner, ''), true);
  return query select v_id, v_ws, v_ws_slug, v_ws_name, v_org_name, v_partner,
    v_partner_name, v_owner, v_expires;
end;
$$;

revoke execute on function private.service_mode_request_create(uuid, text) from public, anon, authenticated;
grant execute on function private.service_mode_request_create(uuid, text) to app_runtime;
alter function private.service_mode_request_create(uuid, text) owner to app_rls_helper;

-- Cancels a pending request (the side that asked).
create function private.service_mode_request_cancel(p_request_id uuid, p_via text)
returns boolean
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_prev_org text := current_setting('app.service_mode_org', true);
  v_prev_request text := current_setting('app.service_mode_request', true);
  v_user uuid := private.context_uuid('app.user_id');
  v_org uuid;
  v_ws uuid;
  v_partner uuid;
  v_done boolean := false;
begin
  if v_user is null
     or (p_via = 'partner' and coalesce(private.current_partner_role(), '') not in ('partner_owner', 'partner_admin'))
     or (p_via = 'platform' and coalesce(private.current_platform_admin_role(), '') not in ('owner', 'operations'))
     or p_via not in ('partner', 'platform') then
    raise exception 'service_mode:forbidden' using errcode = '42501';
  end if;
  perform set_config('app.service_mode_request', coalesce(p_request_id::text, ''), true);
  select r.organization_id, r.workspace_id, r.partner_id into v_org, v_ws, v_partner
  from public.service_mode_requests r
  where r.id = p_request_id and r.status = 'pending';
  if v_org is null
     or (p_via = 'partner' and v_partner is distinct from private.current_partner_id())
     or (p_via = 'platform' and v_partner <> '00000000-0000-4000-8000-000000000000'::uuid) then
    raise exception 'service_mode:not_found' using errcode = 'P0002';
  end if;
  perform set_config('app.service_mode_org', v_org::text, true);
  update public.service_mode_requests r
  set status = 'cancelled', cancelled_by = v_user, cancelled_at = now()
  where r.id = p_request_id and r.status = 'pending';
  v_done := found;
  if v_done then
    insert into public.audit_events (
      organization_id, workspace_id, actor_user_id, actor_principal_type, origin,
      action, resource_type, resource_id, result, metadata
    ) values (
      v_org, v_ws, v_user, 'user', case when p_via = 'platform' then 'admin' else 'partner' end,
      'service_mode.request.cancelled', 'service_mode_request', p_request_id::text, 'success',
      jsonb_build_object('via', p_via, 'partnerId', v_partner)
    );
  end if;
  perform set_config('app.service_mode_org', coalesce(v_prev_org, ''), true);
  perform set_config('app.service_mode_request', coalesce(v_prev_request, ''), true);
  return v_done;
end;
$$;

revoke execute on function private.service_mode_request_cancel(uuid, text) from public, anon, authenticated;
grant execute on function private.service_mode_request_cancel(uuid, text) to app_runtime;
alter function private.service_mode_request_cancel(uuid, text) owner to app_rls_helper;

-- The request of a link, for the public page of the host's partner. A
-- pending request past its date becomes `expired` here.
create function private.service_mode_request_by_token(p_token_hash text)
returns table(
  request_id uuid,
  status text,
  expires_at timestamptz,
  created_at timestamptz,
  decided_at timestamptz,
  requested_via text,
  organization_name text,
  workspace_name text,
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
  v_prev_token text := current_setting('app.service_mode_token', true);
  v_row public.service_mode_requests%rowtype;
  v_org_name text;
  v_ws_name text;
  v_partner_name text;
begin
  if p_token_hash is null or p_token_hash !~ '^[0-9a-f]{64}$' or private.current_partner_id() is null then
    return;
  end if;
  perform set_config('app.service_mode_token', p_token_hash, true);
  select * into v_row from public.service_mode_requests r where r.token_hash = p_token_hash;
  if v_row.id is null or v_row.partner_id is distinct from private.current_partner_id() then
    perform set_config('app.service_mode_token', coalesce(v_prev_token, ''), true);
    return;
  end if;
  perform set_config('app.service_mode_org', v_row.organization_id::text, true);
  perform set_config('app.service_mode_partner', v_row.partner_id::text, true);
  if v_row.status = 'pending' and v_row.expires_at <= now() then
    update public.service_mode_requests r set status = 'expired' where r.id = v_row.id;
    v_row.status := 'expired';
  end if;
  select o.name into v_org_name from public.organizations o where o.id = v_row.organization_id;
  select w.name into v_ws_name from public.workspaces w where w.id = v_row.workspace_id;
  select p.name into v_partner_name from public.partners p where p.id = v_row.partner_id;
  perform set_config('app.service_mode_org', coalesce(v_prev_org, ''), true);
  perform set_config('app.service_mode_partner', coalesce(v_prev_partner, ''), true);
  perform set_config('app.service_mode_token', coalesce(v_prev_token, ''), true);
  return query select v_row.id, v_row.status, v_row.expires_at, v_row.created_at,
    v_row.decided_at, v_row.requested_via, v_org_name, v_ws_name, v_partner_name;
end;
$$;

revoke execute on function private.service_mode_request_by_token(text) from public, anon, authenticated;
grant execute on function private.service_mode_request_by_token(text) to app_runtime;
alter function private.service_mode_request_by_token(text) owner to app_rls_helper;

-- Approves or denies. By link (`p_token_hash`, single use, the host's
-- partner in context; the decision is the recipient owner's) or in /app
-- (`p_request_id`, an active owner of the context company). Answers the
-- outcome instead of raising for a request already decided or expired, so
-- the expiry is kept.
create function private.service_mode_request_decide(
  p_token_hash text,
  p_request_id uuid,
  p_decision text,
  p_ip inet,
  p_user_agent text
)
returns table(
  outcome text,
  request_id uuid,
  organization_id uuid,
  workspace_id uuid,
  partner_id uuid,
  decided_by uuid,
  requested_by uuid
)
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_prev_org text := current_setting('app.service_mode_org', true);
  v_prev_request text := current_setting('app.service_mode_request', true);
  v_prev_token text := current_setting('app.service_mode_token', true);
  v_row public.service_mode_requests%rowtype;
  v_via text;
  v_by uuid;
  v_outcome text;
begin
  if p_decision not in ('approve', 'deny') then
    raise exception 'service_mode:invalid' using errcode = '22023';
  end if;

  if p_token_hash is not null then
    if p_token_hash !~ '^[0-9a-f]{64}$' or private.current_partner_id() is null then
      return query select 'not_found'::text, null::uuid, null::uuid, null::uuid, null::uuid, null::uuid, null::uuid;
      return;
    end if;
    perform set_config('app.service_mode_token', p_token_hash, true);
    select * into v_row from public.service_mode_requests r
    where r.token_hash = p_token_hash for update;
    if v_row.id is null or v_row.partner_id is distinct from private.current_partner_id() then
      perform set_config('app.service_mode_token', coalesce(v_prev_token, ''), true);
      return query select 'not_found'::text, null::uuid, null::uuid, null::uuid, null::uuid, null::uuid, null::uuid;
      return;
    end if;
    v_via := 'link';
    v_by := v_row.recipient_user_id;
  else
    perform set_config('app.service_mode_request', coalesce(p_request_id::text, ''), true);
    select * into v_row from public.service_mode_requests r
    where r.id = p_request_id for update;
    if v_row.id is null
       or v_row.organization_id is distinct from private.context_uuid('app.organization_id')
       or private.current_organization_role() is distinct from 'owner' then
      perform set_config('app.service_mode_request', coalesce(v_prev_request, ''), true);
      return query select 'not_found'::text, null::uuid, null::uuid, null::uuid, null::uuid, null::uuid, null::uuid;
      return;
    end if;
    v_via := 'app';
    v_by := private.context_uuid('app.user_id');
  end if;

  perform set_config('app.service_mode_org', v_row.organization_id::text, true);
  perform pg_advisory_xact_lock(hashtextextended('service_mode:' || v_row.organization_id::text, 0));

  if v_row.status <> 'pending' or v_row.token_used_at is not null then
    v_outcome := 'already_decided';
  elsif v_row.expires_at <= now() then
    update public.service_mode_requests r set status = 'expired' where r.id = v_row.id;
    v_outcome := 'expired';
  elsif p_decision = 'approve' then
    update public.service_mode_requests r
    set status = 'approved', decided_by = v_by, decided_at = now(), decided_via = v_via,
        decided_ip = p_ip, decided_user_agent = left(p_user_agent, 500),
        token_used_at = case when v_via = 'link' then now() else r.token_used_at end
    where r.id = v_row.id;
    insert into public.organization_service_modes as m
      (organization_id, partner_id, mode, set_by, source, request_id)
    values (v_row.organization_id, v_row.partner_id, 'gerenciado', v_by, 'request', v_row.id)
    on conflict (organization_id) do update
      set mode = 'gerenciado', set_by = excluded.set_by, source = 'request',
          request_id = excluded.request_id
      where m.partner_id = excluded.partner_id;
    v_outcome := 'approved';
  else
    update public.service_mode_requests r
    set status = 'denied', decided_by = v_by, decided_at = now(), decided_via = v_via,
        decided_ip = p_ip, decided_user_agent = left(p_user_agent, 500),
        token_used_at = case when v_via = 'link' then now() else r.token_used_at end
    where r.id = v_row.id;
    v_outcome := 'denied';
  end if;

  if v_outcome in ('approved', 'denied') then
    insert into public.audit_events (
      organization_id, workspace_id, actor_user_id, actor_principal_type, origin,
      action, resource_type, resource_id, result, metadata
    ) values (
      v_row.organization_id, v_row.workspace_id, v_by, 'user', 'app',
      'service_mode.request.' || v_outcome, 'service_mode_request', v_row.id::text, 'success',
      jsonb_build_object('via', v_via, 'partnerId', v_row.partner_id)
    );
  end if;

  perform set_config('app.service_mode_org', coalesce(v_prev_org, ''), true);
  perform set_config('app.service_mode_request', coalesce(v_prev_request, ''), true);
  perform set_config('app.service_mode_token', coalesce(v_prev_token, ''), true);
  return query select v_outcome, v_row.id, v_row.organization_id, v_row.workspace_id,
    v_row.partner_id, v_by, v_row.requested_by;
end;
$$;

revoke execute on function private.service_mode_request_decide(text, uuid, text, inet, text) from public, anon, authenticated;
grant execute on function private.service_mode_request_decide(text, uuid, text, inet, text) to app_runtime;
alter function private.service_mode_request_decide(text, uuid, text, inet, text) owner to app_rls_helper;

-- Modes and latest request of GUIDU's direct customers (/platform).
create function private.platform_service_modes()
returns table(
  organization_id uuid,
  mode text,
  request_id uuid,
  request_status text,
  request_expires_at timestamptz
)
language sql
stable
security definer
set search_path = ''
as $$
  select o.id,
         coalesce(m.mode, 'padrao'),
         r.id,
         r.status,
         r.expires_at
  from public.organizations o
  left join public.organization_service_modes m
    on m.organization_id = o.id and m.partner_id = o.partner_id
  left join lateral (
    select x.id, x.status, x.expires_at
    from public.service_mode_requests x
    where x.organization_id = o.id
    order by x.created_at desc, x.id
    limit 1
  ) r on true
  where private.current_platform_admin_role() in ('owner', 'operations', 'support')
    and o.partner_id = '00000000-0000-4000-8000-000000000000'::uuid;
$$;

-- Read as the platform: organizations, modes and requests of partner zero.
create policy organizations_platform_sm_helper_select on public.organizations
  for select to app_rls_helper
  using (
    partner_id = '00000000-0000-4000-8000-000000000000'::uuid
    and private.current_platform_admin_role() in ('owner', 'operations', 'support')
  );

create policy organization_service_modes_platform_helper_select on public.organization_service_modes
  for select to app_rls_helper
  using (
    partner_id = '00000000-0000-4000-8000-000000000000'::uuid
    and private.current_platform_admin_role() in ('owner', 'operations', 'support')
  );

create policy service_mode_requests_platform_helper_select on public.service_mode_requests
  for select to app_rls_helper
  using (
    partner_id = '00000000-0000-4000-8000-000000000000'::uuid
    and private.current_platform_admin_role() in ('owner', 'operations', 'support')
  );

revoke execute on function private.platform_service_modes() from public, anon, authenticated;
grant execute on function private.platform_service_modes() to app_runtime;
alter function private.platform_service_modes() owner to app_rls_helper;

-- ----------------------------------------------------------------------------
-- 5. Events `service_mode.*` and their dispatch
-- ----------------------------------------------------------------------------
-- True when the event describes what the same person did in this
-- transaction: a request created, a request decided, or the mode moved back
-- to `padrao`.
create function private.service_mode_event_allowed(
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
  elsif p_subject_type = 'organization_service_mode' and p_type = 'service_mode.changed' then
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
        and m.source in ('customer', 'partner')
        and m.updated_at = now()
        and m.set_by = p_created_by
    ) into v_ok;
  end if;
  perform set_config('app.service_mode_org', coalesce(v_prev_org, ''), true);
  return coalesce(v_ok, false);
end;
$$;

revoke execute on function private.service_mode_event_allowed(text, text, text, uuid, uuid, uuid, uuid) from public, anon, authenticated;
grant execute on function private.service_mode_event_allowed(text, text, text, uuid, uuid, uuid, uuid) to app_runtime;
alter function private.service_mode_event_allowed(text, text, text, uuid, uuid, uuid, uuid) owner to app_rls_helper;

create policy events_service_mode_insert on public.events
  for insert to app_runtime
  with check (
    level = 'workspace'
    and type in ('service_mode.change_requested', 'service_mode.changed', 'service_mode.change_denied')
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

-- The dispatch of a `service_mode.*` event created in this transaction.
create function private.service_mode_event_dispatch_allowed(p_event_id text, p_requested_by uuid)
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
      and e.type in ('service_mode.change_requested', 'service_mode.changed', 'service_mode.change_denied')
      and e.created_by is not distinct from p_requested_by
      and e.dispatched_at is null
      and e.created_at = now()
  ) into v_ok;
  perform set_config('app.event_id', coalesce(v_prev, ''), true);
  return coalesce(v_ok, false);
end;
$$;

revoke execute on function private.service_mode_event_dispatch_allowed(text, uuid) from public, anon, authenticated;
grant execute on function private.service_mode_event_dispatch_allowed(text, uuid) to app_runtime;
alter function private.service_mode_event_dispatch_allowed(text, uuid) owner to app_rls_helper;

create policy job_runs_service_mode_dispatch_insert on public.job_runs
  for insert to app_runtime
  with check (
    kind = 'events.dispatch'
    and scope = 'platform'
    and status = 'pending'
    and attempts = 0
    and partner_id is null
    and organization_id is null
    and workspace_id is null
    and idempotency_key = 'event:' || (payload ->> 'eventId')
    and private.service_mode_event_dispatch_allowed(payload ->> 'eventId', requested_by)
  );

-- Worker: writes the hash of a fresh link token into the pending request of
-- a `service_mode.change_requested` event and answers who receives it (the
-- e-mail of the person's latest accepted invitation in the company).
create function private.service_mode_issue_link(p_event_id uuid, p_token_hash text)
returns table(user_id uuid, email text, expires_at timestamptz)
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_prev_event text := current_setting('app.event_id', true);
  v_prev_org text := current_setting('app.service_mode_org', true);
  v_request uuid;
  v_org uuid;
  v_user uuid;
  v_expires timestamptz;
  v_email text;
begin
  if p_token_hash is null or p_token_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'service_mode:invalid' using errcode = '22023';
  end if;
  perform set_config('app.event_id', coalesce(p_event_id::text, ''), true);
  select nullif(e.subject_id, '')::uuid, e.organization_id into v_request, v_org
  from public.events e
  where e.id = p_event_id
    and e.type = 'service_mode.change_requested'
    and e.subject_type = 'service_mode_request';
  perform set_config('app.event_id', coalesce(v_prev_event, ''), true);
  if v_request is null then
    return;
  end if;
  perform set_config('app.service_mode_org', v_org::text, true);
  update public.service_mode_requests r
  set token_hash = p_token_hash, token_issued_at = now()
  where r.id = v_request
    and r.organization_id = v_org
    and r.status = 'pending'
    and r.expires_at > now()
    and r.token_used_at is null
  returning r.recipient_user_id, r.expires_at into v_user, v_expires;
  if v_user is not null then
    select lower(trim(i.email)) into v_email
    from public.invitations i
    where i.organization_id = v_org
      and i.status = 'accepted'
      and i.accepted_by_user_id = v_user
    order by i.accepted_at desc nulls last
    limit 1;
  end if;
  perform set_config('app.service_mode_org', coalesce(v_prev_org, ''), true);
  if v_user is not null then
    return query select v_user, v_email, v_expires;
  end if;
end;
$$;

revoke execute on function private.service_mode_issue_link(uuid, text) from public, anon, authenticated;
grant execute on function private.service_mode_issue_link(uuid, text) to app_worker;
alter function private.service_mode_issue_link(uuid, text) owner to app_rls_helper;

-- Worker: who hears about a decision or a change (bell). Approved: who
-- asked and the company owners. Denied: who asked. Back to `padrao`: the
-- partner's owners and admins and the company owners.
create function private.service_mode_event_recipients(p_event_id uuid)
returns table(user_id uuid, email text)
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_prev_event text := current_setting('app.event_id', true);
  v_prev_org text := current_setting('app.service_mode_org', true);
  v_prev_partner text := current_setting('app.service_mode_partner', true);
  v_type text;
  v_org uuid;
  v_partner uuid;
  v_subject_type text;
  v_subject text;
  v_to text;
  v_requester uuid;
begin
  perform set_config('app.event_id', coalesce(p_event_id::text, ''), true);
  select e.type, e.organization_id, e.partner_id, e.subject_type, e.subject_id, e.data ->> 'to'
    into v_type, v_org, v_partner, v_subject_type, v_subject, v_to
  from public.events e
  where e.id = p_event_id and e.type in ('service_mode.changed', 'service_mode.change_denied');
  perform set_config('app.event_id', coalesce(v_prev_event, ''), true);
  if v_type is null then
    return;
  end if;
  perform set_config('app.service_mode_org', v_org::text, true);
  perform set_config('app.service_mode_partner', v_partner::text, true);
  if v_subject_type = 'service_mode_request' then
    select r.requested_by into v_requester
    from public.service_mode_requests r
    where r.id::text = v_subject and r.organization_id = v_org;
  end if;

  return query
    with people as (
      select v_requester as person
      where v_requester is not null and v_type in ('service_mode.changed', 'service_mode.change_denied')
        and (v_type = 'service_mode.change_denied' or v_to = 'gerenciado')
      union
      select m.user_id
      from public.organization_members m
      where v_type = 'service_mode.changed'
        and m.organization_id = v_org and m.role = 'owner' and m.status = 'active'
      union
      select pm.user_id
      from public.partner_members pm
      where v_type = 'service_mode.changed' and v_to = 'padrao'
        and pm.partner_id = v_partner and pm.status = 'active'
        and pm.role in ('partner_owner', 'partner_admin')
    )
    select p.person, null::text from people p where p.person is not null order by p.person;

  perform set_config('app.service_mode_org', coalesce(v_prev_org, ''), true);
  perform set_config('app.service_mode_partner', coalesce(v_prev_partner, ''), true);
end;
$$;

revoke execute on function private.service_mode_event_recipients(uuid) from public, anon, authenticated;
grant execute on function private.service_mode_event_recipients(uuid) to app_worker;
alter function private.service_mode_event_recipients(uuid) owner to app_rls_helper;

-- ----------------------------------------------------------------------------
-- 6. Management clause in the first-access terms
-- ----------------------------------------------------------------------------
alter table public.partner_legal_documents drop constraint partner_legal_documents_kind_check;
alter table public.partner_legal_documents add constraint partner_legal_documents_kind_check
  check (kind in ('terms', 'privacy', 'management'));

-- True when the person of the context owns a company of the host's partner
-- registered as managed (the contract); a company that became managed by an
-- approved request already gave its consent there.
create function private.management_clause_required()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.organization_members member
    join public.organizations organization on organization.id = member.organization_id
    join public.organization_service_modes service_mode
      on service_mode.organization_id = organization.id
     and service_mode.partner_id = organization.partner_id
    where member.user_id = private.context_uuid('app.user_id')
      and member.role = 'owner'
      and member.status = 'active'
      and organization.partner_id = private.current_partner_id()
      and service_mode.mode = 'gerenciado'
      and service_mode.source = 'registration'
  );
$$;

revoke execute on function private.management_clause_required() from public, anon, authenticated;
grant execute on function private.management_clause_required() to app_runtime;
alter function private.management_clause_required() owner to app_rls_helper;

-- Version 1 of the clause for every partner, written by the trigger below.
create policy partner_legal_documents_seed_insert on public.partner_legal_documents
  for insert to app_rls_helper
  with check (
    current_setting('app.legal_seed', true) = 'on'
    and kind = 'management'
    and version = 1
    and published_by is null
    and requires_acceptance
  );

create policy partner_legal_documents_seed_select on public.partner_legal_documents
  for select to app_rls_helper
  using (current_setting('app.legal_seed', true) = 'on' and kind = 'management');

create policy partner_legal_document_translations_seed_insert on public.partner_legal_document_translations
  for insert to app_rls_helper
  with check (
    current_setting('app.legal_seed', true) = 'on'
    and origin = 'manual'
    and updated_by is null
  );

grant select, insert on public.partner_legal_documents to app_rls_helper;
grant insert on public.partner_legal_document_translations to app_rls_helper;

-- PROVISIONAL TEXT, pending the legal review (D-PA-06).
create function private.seed_management_clause(p_partner_id uuid)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_prev text := current_setting('app.legal_seed', true);
  v_id uuid;
begin
  perform set_config('app.legal_seed', 'on', true);
  if not exists (
    select 1 from public.partner_legal_documents d
    where d.partner_id = p_partner_id and d.kind = 'management'
  ) then
    insert into public.partner_legal_documents
      (partner_id, kind, version, title, body, requires_acceptance, published_by, locale)
    values (
      p_partner_id, 'management', 1,
      'Cláusula de gerenciamento',
      E'[TEXTO PROVISÓRIO — PENDENTE DE REVISÃO JURÍDICA (D-PA-06)]\n\n'
      || E'1. Ao contratar o serviço gerenciado, a empresa autoriza a equipe do parceiro que a atende '
      || E'(ou da GUIDU, quando a contratação é direta) a acessar e operar o workspace inteiro: '
      || E'agentes de IA (GUIDS), campanhas, avaliações, CRM, conversas e configurações.\n'
      || E'2. A equipe que gerencia trata os dados da empresa como operadora, com base no contrato, '
      || E'apenas para prestar o serviço contratado.\n'
      || E'3. Toda ação de quem gerencia é registrada na auditoria do workspace e fica visível para a empresa.\n'
      || E'4. A chave de IA da empresa nunca é lida nem trocada por quem gerencia.\n'
      || E'5. A empresa pode voltar ao modo padrão a qualquer momento, em Configurações › Modo de serviço; '
      || E'o acesso de quem gerencia termina na hora.',
      true, null, 'pt-BR'
    )
    returning id into v_id;
    insert into public.partner_legal_document_translations (document_id, locale, title, body, origin, updated_by)
    values
      (v_id, 'en', 'Management clause',
       E'[PROVISIONAL TEXT — PENDING LEGAL REVIEW (D-PA-06)]\n\n'
       || E'1. By hiring the managed service, the company authorizes the team of the partner that serves it '
       || E'(or of GUIDU, when hired directly) to access and operate the whole workspace: AI agents (GUIDS), '
       || E'campaigns, reviews, CRM, conversations and settings.\n'
       || E'2. The managing team processes the company''s data as a processor, under the contract, '
       || E'only to provide the service hired.\n'
       || E'3. Every action of the managing team is recorded in the workspace audit and is visible to the company.\n'
       || E'4. The company''s AI key is never read or replaced by the managing team.\n'
       || E'5. The company may go back to the standard mode at any time, in Settings › Service mode; '
       || E'the managing team loses access at once.',
       'manual', null),
      (v_id, 'es', 'Cláusula de gestión',
       E'[TEXTO PROVISIONAL — PENDIENTE DE REVISIÓN JURÍDICA (D-PA-06)]\n\n'
       || E'1. Al contratar el servicio gestionado, la empresa autoriza al equipo del socio que la atiende '
       || E'(o de GUIDU, cuando la contratación es directa) a acceder y operar todo el espacio de trabajo: '
       || E'agentes de IA (GUIDS), campañas, reseñas, CRM, conversaciones y configuración.\n'
       || E'2. El equipo que gestiona trata los datos de la empresa como encargado, con base en el contrato, '
       || E'solo para prestar el servicio contratado.\n'
       || E'3. Toda acción de quien gestiona queda registrada en la auditoría del espacio de trabajo y es visible para la empresa.\n'
       || E'4. La clave de IA de la empresa nunca es leída ni cambiada por quien gestiona.\n'
       || E'5. La empresa puede volver al modo estándar en cualquier momento, en Configuración › Modo de servicio; '
       || E'el acceso de quien gestiona termina en el acto.',
       'manual', null);
  end if;
  perform set_config('app.legal_seed', coalesce(v_prev, ''), true);
end;
$$;

revoke execute on function private.seed_management_clause(uuid) from public, anon, authenticated;
alter function private.seed_management_clause(uuid) owner to app_rls_helper;

create function private.partners_seed_management_clause()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.seed_management_clause(new.id);
  return new;
end;
$$;

revoke execute on function private.partners_seed_management_clause() from public, anon, authenticated;

-- The trigger is created while app_migrations still owns the function.
create trigger partners_seed_management_clause
  after insert on public.partners
  for each row execute function private.partners_seed_management_clause();

-- Runs as app_rls_helper, which calls the seed function it owns.
alter function private.partners_seed_management_clause() owner to app_rls_helper;

-- Partners that already exist.
set local role app_rls_helper;
select private.seed_management_clause(p.id)
from (select id from public.partners) p;
reset role;

-- ----------------------------------------------------------------------------
-- 7. Managed access in the other modules (ADR 0020 item 7)
-- ----------------------------------------------------------------------------
-- Each policy keeps what it accepted and also accepts the managing partner
-- team of the context company. Reads of members (and support grants) stay
-- as they were.

-- CRM contacts
drop policy crm_contacts_select on public.crm_contacts;
create policy crm_contacts_select on public.crm_contacts
  for select to app_runtime
  using (
    workspace_id = private.context_uuid('app.workspace_id')
    and organization_id = private.context_uuid('app.organization_id')
    and (
      private.is_workspace_member(workspace_id, organization_id)
      or private.partner_manages_organization(organization_id)
    )
  );

drop policy crm_contacts_insert on public.crm_contacts;
create policy crm_contacts_insert on public.crm_contacts
  for insert to app_runtime
  with check (
    workspace_id = private.context_uuid('app.workspace_id')
    and organization_id = private.context_uuid('app.organization_id')
    and created_by = private.context_uuid('app.user_id')
    and updated_by is null
    and (
      private.current_workspace_role() in ('owner', 'admin', 'editor')
      or private.partner_manages_organization(organization_id)
    )
  );

drop policy crm_contacts_update on public.crm_contacts;
create policy crm_contacts_update on public.crm_contacts
  for update to app_runtime
  using (
    workspace_id = private.context_uuid('app.workspace_id')
    and organization_id = private.context_uuid('app.organization_id')
    and (
      private.current_workspace_role() in ('owner', 'admin', 'editor')
      or private.partner_manages_organization(organization_id)
    )
  )
  with check (
    workspace_id = private.context_uuid('app.workspace_id')
    and organization_id = private.context_uuid('app.organization_id')
    and updated_by = private.context_uuid('app.user_id')
    and (
      private.current_workspace_role() in ('owner', 'admin', 'editor')
      or private.partner_manages_organization(organization_id)
    )
  );

-- GUIDS of the workspace (reads and the partner path already accept the
-- partner in any mode; the key stays in `credentials`, untouched).
drop policy ai_agents_workspace_insert on public.ai_agents;
create policy ai_agents_workspace_insert on public.ai_agents
  for insert to app_runtime
  with check (
    kind = 'guid'
    and workspace_id = private.context_uuid('app.workspace_id')
    and organization_id = private.context_uuid('app.organization_id')
    and created_by = private.context_uuid('app.user_id')
    and updated_by is null
    and updated_by_partner_id is null
    and (
      private.current_workspace_role() in ('owner', 'admin')
      or private.partner_manages_organization(organization_id)
    )
  );

drop policy ai_agents_workspace_update on public.ai_agents;
create policy ai_agents_workspace_update on public.ai_agents
  for update to app_runtime
  using (
    kind = 'guid'
    and workspace_id = private.context_uuid('app.workspace_id')
    and organization_id = private.context_uuid('app.organization_id')
    and (
      private.current_workspace_role() in ('owner', 'admin')
      or private.partner_manages_organization(organization_id)
    )
  )
  with check (
    workspace_id = private.context_uuid('app.workspace_id')
    and organization_id = private.context_uuid('app.organization_id')
    and updated_by = private.context_uuid('app.user_id')
    and (
      (updated_by_partner_id is null
        and private.current_workspace_role() in ('owner', 'admin'))
      or (updated_by_partner_id = private.current_partner_id()
        and private.partner_manages_organization(organization_id))
    )
  );

drop policy ai_agents_workspace_delete on public.ai_agents;
create policy ai_agents_workspace_delete on public.ai_agents
  for delete to app_runtime
  using (
    kind = 'guid'
    and workspace_id = private.context_uuid('app.workspace_id')
    and organization_id = private.context_uuid('app.organization_id')
    and (
      private.current_workspace_role() in ('owner', 'admin')
      or private.partner_manages_organization(organization_id)
    )
  );

-- Conversations of the GUIDS (and their messages, which follow them).
drop policy ai_conversations_select on public.ai_conversations;
create policy ai_conversations_select on public.ai_conversations
  for select to app_runtime
  using (
    (kind = 'guid'
      and workspace_id = private.context_uuid('app.workspace_id')
      and organization_id = private.context_uuid('app.organization_id')
      and (
        private.current_workspace_role() in ('owner', 'admin', 'editor')
        or private.partner_manages_organization(organization_id)
      ))
    or (kind = 'assistant' and user_id = private.context_uuid('app.user_id'))
  );

drop policy ai_conversations_update on public.ai_conversations;
create policy ai_conversations_update on public.ai_conversations
  for update to app_runtime
  using (
    (kind = 'guid'
      and workspace_id = private.context_uuid('app.workspace_id')
      and organization_id = private.context_uuid('app.organization_id')
      and (
        private.current_workspace_role() in ('owner', 'admin', 'editor')
        or private.partner_manages_organization(organization_id)
      ))
    or (kind = 'assistant' and user_id = private.context_uuid('app.user_id'))
  )
  with check (
    (kind = 'guid'
      and workspace_id = private.context_uuid('app.workspace_id')
      and organization_id = private.context_uuid('app.organization_id')
      and (
        private.current_workspace_role() in ('owner', 'admin', 'editor')
        or private.partner_manages_organization(organization_id)
      ))
    or (kind = 'assistant' and user_id = private.context_uuid('app.user_id'))
  );

-- Leads and notices of the GUIDS (referrals and usage already accept the
-- partner of the company in any mode).
drop policy ai_lead_activities_select on public.ai_lead_activities;
create policy ai_lead_activities_select on public.ai_lead_activities
  for select to app_runtime
  using (
    workspace_id = private.context_uuid('app.workspace_id')
    and organization_id = private.context_uuid('app.organization_id')
    and (
      private.current_workspace_role() in ('owner', 'admin', 'editor')
      or private.partner_manages_organization(organization_id)
    )
  );

drop policy ai_lead_notices_select on public.ai_lead_notices;
create policy ai_lead_notices_select on public.ai_lead_notices
  for select to app_runtime
  using (
    workspace_id = private.context_uuid('app.workspace_id')
    and organization_id = private.context_uuid('app.organization_id')
    and (
      private.current_workspace_role() in ('owner', 'admin', 'editor')
      or private.partner_manages_organization(organization_id)
    )
  );

-- Channels of the workspace: connections and routes (read and write);
-- conversations, deliveries and inbound events (read).
do $$
declare
  t text;
begin
  foreach t in array array['channel_connections', 'channel_routes'] loop
    execute format('drop policy %I on public.%I', t || '_select', t);
    execute format($p$
      create policy %I on public.%I for select to app_runtime
      using (
        workspace_id = private.context_uuid('app.workspace_id')
        and organization_id = private.context_uuid('app.organization_id')
        and (
          private.current_workspace_role() in ('owner', 'admin', 'editor')
          or private.partner_manages_organization(organization_id)
        )
      )$p$, t || '_select', t);

    execute format('drop policy %I on public.%I', t || '_insert', t);
    execute format($p$
      create policy %I on public.%I for insert to app_runtime
      with check (
        workspace_id = private.context_uuid('app.workspace_id')
        and organization_id = private.context_uuid('app.organization_id')
        and created_by = private.context_uuid('app.user_id')
        and updated_by is null
        and (
          private.current_workspace_role() in ('owner', 'admin')
          or private.partner_manages_organization(organization_id)
        )
      )$p$, t || '_insert', t);

    execute format('drop policy %I on public.%I', t || '_update', t);
    execute format($p$
      create policy %I on public.%I for update to app_runtime
      using (
        workspace_id = private.context_uuid('app.workspace_id')
        and organization_id = private.context_uuid('app.organization_id')
        and (
          private.current_workspace_role() in ('owner', 'admin')
          or private.partner_manages_organization(organization_id)
        )
      )
      with check (
        workspace_id = private.context_uuid('app.workspace_id')
        and organization_id = private.context_uuid('app.organization_id')
        and updated_by = private.context_uuid('app.user_id')
        and (
          private.current_workspace_role() in ('owner', 'admin')
          or private.partner_manages_organization(organization_id)
        )
      )$p$, t || '_update', t);

    execute format('drop policy %I on public.%I', t || '_delete', t);
    execute format($p$
      create policy %I on public.%I for delete to app_runtime
      using (
        workspace_id = private.context_uuid('app.workspace_id')
        and organization_id = private.context_uuid('app.organization_id')
        and (
          private.current_workspace_role() in ('owner', 'admin')
          or private.partner_manages_organization(organization_id)
        )
      )$p$, t || '_delete', t);
  end loop;

  foreach t in array array['channel_conversations', 'channel_deliveries', 'channel_inbound_events'] loop
    execute format('drop policy %I on public.%I', t || '_select', t);
    execute format($p$
      create policy %I on public.%I for select to app_runtime
      using (
        workspace_id = private.context_uuid('app.workspace_id')
        and organization_id = private.context_uuid('app.organization_id')
        and (
          private.current_workspace_role() in ('owner', 'admin', 'editor')
          or private.partner_manages_organization(organization_id)
        )
      )$p$, t || '_select', t);
  end loop;

  -- Portfolio of the business: read and write.
  foreach t in array array['portfolio_items', 'portfolio_variants', 'portfolio_rate_plans', 'portfolio_accommodation_types'] loop
    execute format('drop policy %I on public.%I', t || '_select', t);
    execute format($p$
      create policy %I on public.%I for select to app_runtime
      using (
        workspace_id = private.context_uuid('app.workspace_id')
        and organization_id = private.context_uuid('app.organization_id')
        and (
          private.is_workspace_member(workspace_id, organization_id)
          or private.partner_manages_organization(organization_id)
        )
      )$p$, t || '_select', t);

    execute format('drop policy %I on public.%I', t || '_insert', t);
    execute format($p$
      create policy %I on public.%I for insert to app_runtime
      with check (
        workspace_id = private.context_uuid('app.workspace_id')
        and organization_id = private.context_uuid('app.organization_id')
        and created_by = private.context_uuid('app.user_id')
        and updated_by is null
        and (
          private.current_workspace_role() in ('owner', 'admin', 'editor')
          or private.partner_manages_organization(organization_id)
        )
      )$p$, t || '_insert', t);

    execute format('drop policy %I on public.%I', t || '_update', t);
    execute format($p$
      create policy %I on public.%I for update to app_runtime
      using (
        workspace_id = private.context_uuid('app.workspace_id')
        and organization_id = private.context_uuid('app.organization_id')
        and (
          private.current_workspace_role() in ('owner', 'admin', 'editor')
          or private.partner_manages_organization(organization_id)
        )
      )
      with check (
        workspace_id = private.context_uuid('app.workspace_id')
        and organization_id = private.context_uuid('app.organization_id')
        and updated_by = private.context_uuid('app.user_id')
        and (
          private.current_workspace_role() in ('owner', 'admin', 'editor')
          or private.partner_manages_organization(organization_id)
        )
      )$p$, t || '_update', t);
  end loop;

  foreach t in array array['portfolio_variants', 'portfolio_rate_plans', 'portfolio_accommodation_types'] loop
    execute format('drop policy %I on public.%I', t || '_delete', t);
    execute format($p$
      create policy %I on public.%I for delete to app_runtime
      using (
        workspace_id = private.context_uuid('app.workspace_id')
        and organization_id = private.context_uuid('app.organization_id')
        and (
          private.current_workspace_role() in ('owner', 'admin', 'editor')
          or private.partner_manages_organization(organization_id)
        )
      )$p$, t || '_delete', t);
  end loop;
end
$$;

-- Workspace settings of the cascade (the platform and partner levels stay
-- as they were).
drop policy settings_select on public.settings;
create policy settings_select on public.settings
  for select to app_runtime
  using (
    (scope = 'platform' and private.current_platform_admin_role() is not null)
    or (scope = 'partner' and partner_id = private.current_partner_id()
        and private.current_partner_role() is not null)
    or (scope = 'workspace'
        and workspace_id = private.context_uuid('app.workspace_id')
        and organization_id = private.context_uuid('app.organization_id')
        and (
          private.current_workspace_role() is not null
          or private.partner_manages_organization(organization_id)
        ))
  );

drop policy settings_insert on public.settings;
create policy settings_insert on public.settings
  for insert to app_runtime
  with check (
    updated_by = private.context_uuid('app.user_id')
    and (
      (scope = 'platform' and private.current_platform_admin_role() in ('owner', 'operations'))
      or (scope = 'partner' and partner_id = private.current_partner_id()
          and private.current_partner_role() in ('partner_owner', 'partner_admin'))
      or (scope = 'workspace'
          and workspace_id = private.context_uuid('app.workspace_id')
          and organization_id = private.context_uuid('app.organization_id')
          and (
            private.current_workspace_role() in ('owner', 'admin')
            or private.partner_manages_organization(organization_id)
          ))
    )
  );

drop policy settings_update on public.settings;
create policy settings_update on public.settings
  for update to app_runtime
  using (
    (scope = 'platform' and private.current_platform_admin_role() in ('owner', 'operations'))
    or (scope = 'partner' and partner_id = private.current_partner_id()
        and private.current_partner_role() in ('partner_owner', 'partner_admin'))
    or (scope = 'workspace'
        and workspace_id = private.context_uuid('app.workspace_id')
        and organization_id = private.context_uuid('app.organization_id')
        and (
          private.current_workspace_role() in ('owner', 'admin')
          or private.partner_manages_organization(organization_id)
        ))
  )
  with check (updated_by = private.context_uuid('app.user_id'));

drop policy settings_delete on public.settings;
create policy settings_delete on public.settings
  for delete to app_runtime
  using (
    (scope = 'platform' and private.current_platform_admin_role() in ('owner', 'operations'))
    or (scope = 'partner' and partner_id = private.current_partner_id()
        and private.current_partner_role() in ('partner_owner', 'partner_admin'))
    or (scope = 'workspace'
        and workspace_id = private.context_uuid('app.workspace_id')
        and organization_id = private.context_uuid('app.organization_id')
        and (
          private.current_workspace_role() in ('owner', 'admin')
          or private.partner_manages_organization(organization_id)
        ))
  );

-- ----------------------------------------------------------------------------
-- 8. Audit of every write of the managing team (origin `partner`)
-- ----------------------------------------------------------------------------
-- Runs as the caller. Only app_runtime with a partner in context and no
-- membership in the workspace is the managing team; the row is audited in
-- the workspace of the context, as the person of the context.
create function private.audit_managed_partner_write()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_row jsonb := to_jsonb(coalesce(new, old));
  v_org uuid;
  v_ws uuid;
begin
  if current_user <> 'app_runtime'
     or nullif(current_setting('app.partner_id', true), '') is null
     or nullif(current_setting('app.user_id', true), '') is null then
    return null;
  end if;
  v_org := nullif(v_row ->> 'organization_id', '')::uuid;
  v_ws := nullif(v_row ->> 'workspace_id', '')::uuid;
  if v_org is null or v_ws is null
     or v_ws is distinct from private.context_uuid('app.workspace_id')
     or private.current_workspace_role() is not null
     or not private.partner_manages_organization(v_org) then
    return null;
  end if;
  insert into public.audit_events (
    organization_id, workspace_id, actor_user_id, actor_principal_type, origin,
    action, resource_type, resource_id, result, metadata
  ) values (
    v_org, v_ws, private.context_uuid('app.user_id'), 'user', 'partner',
    'managed.' || tg_table_name || '.' || lower(tg_op), tg_table_name,
    v_row ->> 'id', 'success',
    jsonb_build_object('partnerId', private.current_partner_id())
  );
  return null;
end;
$$;

alter function private.audit_managed_partner_write() owner to app_migrations;
revoke execute on function private.audit_managed_partner_write() from public, anon, authenticated;

do $$
declare
  t text;
begin
  foreach t in array array[
    'crm_contacts', 'ai_agents', 'ai_conversations', 'channel_connections',
    'channel_routes', 'portfolio_items', 'portfolio_variants', 'portfolio_rate_plans',
    'portfolio_accommodation_types', 'settings'
  ] loop
    execute format(
      'create trigger %I after insert or update or delete on public.%I
       for each row execute function private.audit_managed_partner_write()',
      t || '_managed_audit', t);
  end loop;
end
$$;
