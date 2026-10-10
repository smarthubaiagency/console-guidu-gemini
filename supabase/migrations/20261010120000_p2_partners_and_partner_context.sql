-- ============================================================================
-- Migration: 20261010120000_p2_partners_and_partner_context.sql
-- Module: P2 — House partner and partner context (ADR 0012, plano P2)
--
-- Maintenance Rationale:
-- 1. `public.partners`: the partner level above organizations. The house
--    partner ("parceiro zero", is_house = true) is seeded here with a fixed id
--    and serves direct customers. Its display brand comes from the
--    environment (ADR 0004) until P3. The checkout switch and the platform
--    block are stored now and used from P5 on (especificação §3.1).
-- 2. `public.partner_domains`: hosts that belong to a partner (subdomain or
--    custom domain). Platform hosts are not stored here: they come from the
--    environment (APP_URL and PLATFORM_HOSTS) and always resolve to the house
--    partner. Verification and certificates arrive in P7.
-- 3. `public.organizations.partner_id`: every organization belongs to exactly
--    one partner. Existing rows take the house partner through the column
--    default. app_runtime cannot change it (trigger below); moving a company
--    between partners will be a platform operation.
-- 4. `private.current_partner_id()` reads `app.partner_id`, set by the server
--    from the request host, never from user input.
-- 5. `private.resolve_partner_host(text)`: maps an active partner host to its
--    partner before sign-in. Hosts are public, so this discloses nothing.
-- 6. `private.resolve_workspace_slug` and `private.list_user_workspaces` now
--    also require the organization to belong to the context partner. Without
--    `app.partner_id` they return nothing, so a caller that forgets the
--    partner is denied instead of seeing every partner's workspaces.
-- 7. Helper policy `organizations_workspace_helper_select`: the slug resolver
--    reads organizations.partner_id as app_rls_helper, which so far could only
--    see organizations where the context user is an organization member. The
--    new policy also allows organizations where the context user holds an
--    active workspace membership, so the partner check never depends on how
--    the membership was created.
-- Tables: owner app_migrations, ENABLE + FORCE RLS, no grants to anon or
-- authenticated, read-only for app_runtime and scoped to the context partner.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Table: public.partners
-- ----------------------------------------------------------------------------
create table public.partners (
  id               uuid primary key,
  slug             text not null unique
                     check (slug ~ '^[a-z][a-z0-9]*(-[a-z0-9]+)*$' and length(slug) <= 48),
  name             text not null check (length(trim(name)) > 0 and length(name) <= 120),
  status           text not null default 'active'
                     check (status in ('active', 'suspended', 'inactive')),
  is_house         boolean not null default false,
  checkout_enabled boolean not null default false,
  checkout_blocked boolean not null default false,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

-- At most one house partner.
create unique index partners_single_house on public.partners (is_house) where is_house;

alter table public.partners owner to app_migrations;

-- House partner. The fixed id is referenced by the organizations default and
-- by HOUSE_PARTNER_ID in src/core/partners/constants.ts. Seeded before RLS is
-- enabled: scripts/migrate.ts runs as app_migrations, which is NOBYPASSRLS
-- and has no policy on this table.
insert into public.partners (id, slug, name, status, is_house)
values ('00000000-0000-4000-8000-000000000000', 'guidu', 'GUIDU', 'active', true);

alter table public.partners enable row level security;
alter table public.partners force row level security;

create trigger partners_touch_updated_at
  before update on public.partners
  for each row execute function private.touch_updated_at();

-- ----------------------------------------------------------------------------
-- 2. Table: public.partner_domains
-- ----------------------------------------------------------------------------
create table public.partner_domains (
  host       text primary key
               check (
                 host = lower(host)
                 and length(host) <= 253
                 and host ~ '^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$'
               ),
  partner_id uuid not null references public.partners(id) on delete cascade,
  kind       text not null check (kind in ('subdomain', 'custom')),
  status     text not null default 'pending'
               check (status in ('pending', 'active', 'disabled')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index partner_domains_partner_id_idx on public.partner_domains (partner_id);

alter table public.partner_domains owner to app_migrations;
alter table public.partner_domains enable row level security;
alter table public.partner_domains force row level security;

create trigger partner_domains_touch_updated_at
  before update on public.partner_domains
  for each row execute function private.touch_updated_at();

-- ----------------------------------------------------------------------------
-- 3. Column: public.organizations.partner_id
-- ----------------------------------------------------------------------------
alter table public.organizations
  add column partner_id uuid not null
    default '00000000-0000-4000-8000-000000000000'
    references public.partners(id) on delete restrict;

create index organizations_partner_id_idx on public.organizations (partner_id);

-- app_runtime may update organizations (name, seats) but never their partner.
create function private.prevent_partner_change()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if new.partner_id is distinct from old.partner_id
     and current_user = 'app_runtime' then
    raise exception 'organizations.partner_id cannot be changed by the application'
      using errcode = '42501';
  end if;
  return new;
end;
$$;

alter function private.prevent_partner_change() owner to app_migrations;
revoke execute on function private.prevent_partner_change() from public, anon, authenticated;

create trigger organizations_prevent_partner_change
  before update of partner_id on public.organizations
  for each row execute function private.prevent_partner_change();

-- ----------------------------------------------------------------------------
-- 4. Helper: context partner
-- ----------------------------------------------------------------------------
create function private.current_partner_id()
returns uuid
language sql
stable
security invoker
set search_path = ''
as $$
  select private.context_uuid('app.partner_id');
$$;

alter function private.current_partner_id() owner to app_migrations;
revoke execute on function private.current_partner_id() from public, anon, authenticated;
grant execute on function private.current_partner_id() to app_runtime, app_rls_helper;

-- ----------------------------------------------------------------------------
-- 5. RLS: partners and partner_domains (read-only, context partner)
-- ----------------------------------------------------------------------------
create policy partners_select on public.partners
  for select to app_runtime
  using (id = private.current_partner_id());

create policy partner_domains_select on public.partner_domains
  for select to app_runtime
  using (partner_id = private.current_partner_id());

-- Helper principal: only active hosts of active partners, for the resolver.
create policy partners_helper_select on public.partners
  for select to app_rls_helper
  using (status = 'active');

create policy partner_domains_helper_select on public.partner_domains
  for select to app_rls_helper
  using (status = 'active');

revoke all on public.partners from public, anon, authenticated;
revoke all on public.partner_domains from public, anon, authenticated;
grant select on public.partners to app_runtime, app_rls_helper;
grant select on public.partner_domains to app_runtime, app_rls_helper;

-- ----------------------------------------------------------------------------
-- 6. Resolver: host → partner (before sign-in)
-- ----------------------------------------------------------------------------
create function private.resolve_partner_host(p_host text)
returns table(partner_id uuid, partner_slug text)
language sql
stable
security definer
set search_path = ''
as $$
  select partner.id, partner.slug
  from public.partner_domains domain
  join public.partners partner on partner.id = domain.partner_id
  where domain.host = lower(p_host)
    and domain.status = 'active'
    and partner.status = 'active';
$$;

-- Grants first: app_migrations is NOINHERIT, so once app_rls_helper owns the
-- function it can no longer grant on it (revoke/grant would only warn).
revoke execute on function private.resolve_partner_host(text) from public, anon, authenticated;
grant execute on function private.resolve_partner_host(text) to app_runtime;
alter function private.resolve_partner_host(text) owner to app_rls_helper;

-- ----------------------------------------------------------------------------
-- 7. Helper policy: organizations of the context user's workspaces
-- ----------------------------------------------------------------------------
create policy organizations_workspace_helper_select on public.organizations
  for select to app_rls_helper
  using (
    exists (
      select 1
      from public.workspace_members member
      where member.organization_id = organizations.id
        and member.user_id = private.context_uuid('app.user_id')
        and member.status = 'active'
    )
  );

-- ----------------------------------------------------------------------------
-- 8. Partner-bound workspace resolution and listing
-- ----------------------------------------------------------------------------
-- Both functions are owned by app_rls_helper. Only their owner may replace
-- them, so this section runs as that role (app_migrations and the local
-- superuser are both members). `create or replace` keeps owner and grants.
set local role app_rls_helper;

create or replace function private.resolve_workspace_slug(
  p_slug text
)
returns table(workspace_id uuid, organization_id uuid)
language sql
stable
security definer
set search_path = ''
as $$
  select workspace.id, workspace.organization_id
  from public.workspaces workspace
  join public.organizations organization on organization.id = workspace.organization_id
  where workspace.slug = p_slug
    and workspace.status = 'active'
    and private.context_uuid('app.user_id') is not null
    and organization.partner_id = private.current_partner_id()
    and exists (
      select 1
      from public.workspace_members member
      where member.workspace_id = workspace.id
        and member.organization_id = workspace.organization_id
        and member.user_id = private.context_uuid('app.user_id')
        and member.status = 'active'
    );
$$;

create or replace function private.list_user_workspaces()
returns table(
  workspace_id uuid,
  workspace_name text,
  workspace_slug text,
  workspace_status text,
  workspace_role text,
  organization_id uuid,
  organization_name text,
  organization_role text
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    w.id as workspace_id,
    w.name as workspace_name,
    w.slug as workspace_slug,
    w.status as workspace_status,
    wm.role as workspace_role,
    o.id as organization_id,
    o.name as organization_name,
    coalesce(om.role, 'member') as organization_role
  from public.workspaces w
  join public.workspace_members wm on wm.workspace_id = w.id and wm.organization_id = w.organization_id
  join public.organizations o on o.id = w.organization_id
  left join public.organization_members om on om.organization_id = o.id and om.user_id = wm.user_id and om.status = 'active'
  where wm.user_id = private.context_uuid('app.user_id')
    and wm.status = 'active'
    and w.status = 'active'
    and o.status = 'active'
    and o.partner_id = private.current_partner_id()
  order by o.name asc, w.name asc;
$$;

reset role;
