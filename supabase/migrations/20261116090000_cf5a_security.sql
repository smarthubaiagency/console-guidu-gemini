-- ============================================================================
-- Migration: 20261116090000_cf5a_security.sql
-- Module: CF5a — Configurações › Segurança: IP allow lists and the reading
--         of security events (/mnt/project-files/configuracoes/plano-cf5.md)
--
-- Maintenance Rationale:
-- 1. Marcelo (14/10/2026, levantamento item 6): no global IP list (a wrong
--    list locks everybody out), but an optional list per area: /platform,
--    set by the platform, and the /admin of each partner, set by that
--    partner. `public.ip_allowlists` holds one row per area with the
--    addresses as `cidr[]` (the database validates and normalizes them).
--    No row means no restriction. The lists stay out of the settings
--    cascade, whose upper rows every workspace reads.
-- 2. The managers of each area read and write its list: platform owner and
--    operations, partner owner and admin of the context partner. The
--    application refuses a list that leaves out the saver's own address.
-- 3. `private.ip_allowed(area, partner, ip)` answers whether an address may
--    enter an area, for the guards of /platform and /admin. It returns only
--    a boolean, never the list; an unknown address (null) passes only
--    where there is no list.
-- 4. Security events: `audit_events` stays without direct reads.
--    `private.security_events(before, limit)` returns the security actions
--    (sign-in, MFA, keys and credentials, roles and members, invitations,
--    support access and security settings) to the platform (owner,
--    operations, support), and to the partner managers (owner, admin) the
--    events tagged with their partner or of their customers' companies.
-- Owner app_migrations, ENABLE + FORCE RLS, no grants to anon/authenticated.
-- Functions owned by app_rls_helper get their grants before the ownership
-- transfer (app_migrations is NOINHERIT).
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Table: public.ip_allowlists
-- ----------------------------------------------------------------------------
create table public.ip_allowlists (
  id          uuid primary key default gen_random_uuid(),
  area        text not null check (area in ('platform', 'admin')),
  partner_id  uuid references public.partners(id) on delete cascade,
  entries     cidr[] not null
                check (cardinality(entries) between 1 and 50
                       and array_position(entries, null) is null),
  updated_by  uuid not null references public.profiles(id) on delete cascade,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  constraint ip_allowlists_scope_check check (
    (area = 'platform' and partner_id is null)
    or (area = 'admin' and partner_id is not null)
  )
);

create unique index ip_allowlists_platform_key on public.ip_allowlists (area)
  where area = 'platform';
create unique index ip_allowlists_admin_key on public.ip_allowlists (partner_id)
  where area = 'admin';

alter table public.ip_allowlists owner to app_migrations;
revoke all on public.ip_allowlists from public, anon, authenticated;
alter table public.ip_allowlists enable row level security;
alter table public.ip_allowlists force row level security;

create trigger ip_allowlists_touch_updated_at
  before update on public.ip_allowlists
  for each row execute function private.touch_updated_at();

-- Managers of each area read and write its list.
create policy ip_allowlists_select on public.ip_allowlists
  for select to app_runtime
  using (
    (area = 'platform' and private.current_platform_admin_role() in ('owner', 'operations'))
    or (area = 'admin'
        and partner_id = private.current_partner_id()
        and private.current_partner_role() in ('partner_owner', 'partner_admin'))
  );

create policy ip_allowlists_insert on public.ip_allowlists
  for insert to app_runtime
  with check (
    updated_by = private.context_uuid('app.user_id')
    and (
      (area = 'platform' and private.current_platform_admin_role() in ('owner', 'operations'))
      or (area = 'admin'
          and partner_id = private.current_partner_id()
          and private.current_partner_role() in ('partner_owner', 'partner_admin'))
    )
  );

create policy ip_allowlists_update on public.ip_allowlists
  for update to app_runtime
  using (
    (area = 'platform' and private.current_platform_admin_role() in ('owner', 'operations'))
    or (area = 'admin'
        and partner_id = private.current_partner_id()
        and private.current_partner_role() in ('partner_owner', 'partner_admin'))
  )
  with check (updated_by = private.context_uuid('app.user_id'));

create policy ip_allowlists_delete on public.ip_allowlists
  for delete to app_runtime
  using (
    (area = 'platform' and private.current_platform_admin_role() in ('owner', 'operations'))
    or (area = 'admin'
        and partner_id = private.current_partner_id()
        and private.current_partner_role() in ('partner_owner', 'partner_admin'))
  );

-- Area and partner never change: a list moves by delete and insert.
grant select, insert, delete on public.ip_allowlists to app_runtime;
grant update (entries, updated_by, updated_at) on public.ip_allowlists to app_runtime;

-- ----------------------------------------------------------------------------
-- 2. The guard: may this address enter the area?
-- ----------------------------------------------------------------------------
create policy ip_allowlists_helper_select on public.ip_allowlists
  for select to app_rls_helper
  using (true);

grant select on public.ip_allowlists to app_rls_helper;

create function private.ip_allowed(p_area text, p_partner_id uuid, p_ip inet)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (select p_ip is not null and p_ip <<= any (list.entries)
     from public.ip_allowlists list
     where list.area = p_area
       and list.partner_id is not distinct from
           (case when p_area = 'admin' then p_partner_id end)),
    true
  );
$$;

revoke execute on function private.ip_allowed(text, uuid, inet) from public, anon, authenticated;
grant execute on function private.ip_allowed(text, uuid, inet) to app_runtime;
alter function private.ip_allowed(text, uuid, inet) owner to app_rls_helper;

-- ----------------------------------------------------------------------------
-- 3. Security events
-- ----------------------------------------------------------------------------
create index idx_audit_events_occurred_at on public.audit_events (occurred_at desc);

-- Which audit actions are security events (CF5a, levantamento item 6).
create function private.is_security_event(p_action text, p_metadata jsonb)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select p_action like 'auth.%'
    or p_action like '%.security.%'
    or p_action in (
      'api_keys.created', 'api_keys.revoked',
      'platform_api_keys.create', 'platform_api_keys.revoke',
      'credentials.created', 'credentials.revoked',
      'partner.ai_credentials.create', 'partner.ai_credentials.revoke',
      'organization_members.role_changed', 'organization_members.removed',
      'workspace_members.role_changed', 'workspace_members.removed',
      'partner.member.join', 'partner.member.update',
      'invitations.created', 'invitations.accepted', 'invitations.revoked',
      'partner.invitation.create', 'partner.invitation.revoke',
      'partner.support.request', 'partner.support.end', 'partner.support.revoke'
    )
    or (p_action like '%.settings.save'
        and jsonb_typeof(p_metadata -> 'fields') = 'array'
        and exists (
          select 1
          from jsonb_array_elements_text(p_metadata -> 'fields') as field(name)
          where field.name like 'security.%'
        ));
$$;

alter function private.is_security_event(text, jsonb) owner to app_migrations;
revoke execute on function private.is_security_event(text, jsonb) from public, anon, authenticated;
grant execute on function private.is_security_event(text, jsonb) to app_runtime, app_rls_helper;

-- The platform reads every event; partner managers read theirs.
create policy audit_events_security_helper_select on public.audit_events
  for select to app_rls_helper
  using (
    private.current_platform_admin_role() in ('owner', 'operations', 'support')
    or (private.current_partner_role() in ('partner_owner', 'partner_admin')
        and (metadata ->> 'partnerId' = private.current_partner_id()::text
             or (organization_id is not null
                 and private.is_partner_organization(organization_id))))
  );

grant select on public.audit_events to app_rls_helper;

create function private.security_events(p_before timestamptz, p_limit integer)
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
    and (p_before is null or e.occurred_at < p_before)
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

revoke execute on function private.security_events(timestamptz, integer) from public, anon, authenticated;
grant execute on function private.security_events(timestamptz, integer) to app_runtime;
alter function private.security_events(timestamptz, integer) owner to app_rls_helper;
