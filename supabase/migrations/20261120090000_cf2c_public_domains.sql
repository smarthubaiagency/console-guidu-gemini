-- ============================================================================
-- Migration: 20261120090000_cf2c_public_domains.sql
-- Module: CF2c — default public domains (core)
--         (/mnt/project-files/configuracoes/plano-cf2c.md; decision 4 of
--         /mnt/project-files/cartao-digital/plano-perfil-digital.md)
--
-- Maintenance Rationale:
-- 1. Marcelo (15/10/2026): every public route type (digital profile, quiz,
--    pages and sites) has a default domain on the platform (`mobio.pro`,
--    `quiz.mobio.pro`, `mobio.page`, from the environment) and each
--    workspace gets a subdomain of it with its slug
--    (`rodobens.mobio.pro/{slug}`). The subdomain is derived from the slug:
--    it is no row and never counts in the `core.public_domains` quota.
-- 2. `public.partner_public_domains`: a partner replaces the platform
--    default of a route type for its customers with its own domain (one per
--    type). Partner owners and admins add, verify (DNS: the host and the
--    wildcard point to the proxy) and remove it. The house partner has no
--    row: its default is the platform's.
-- 3. `public.workspace_public_routes`: the domain a tool with a public route
--    uses, when it is one of the workspace's own domains (CF2b). Without a
--    row the tool uses the default subdomain of its type. Removing the
--    domain removes the choice (back to the default).
-- 4. Hosts: a default domain of a partner never equals or contains a host
--    of `partner_domains`, `workspace_domains` or another default domain,
--    and no new host is created under one (trigger under one advisory lock,
--    since suffix conflicts cannot be locked per host).
-- 5. Resolvers without sign-in, for the proxy and the public routes:
--    `private.resolve_public_bases(text[])` (active default domains of
--    active partners among the suffixes of a host),
--    `private.resolve_public_workspace(text)` (active workspace of a slug,
--    its partner and the route types its partner replaces) and
--    `private.public_domain_routes(text)` (tools that chose an active own
--    domain). The slug lookup reads workspaces and organizations through
--    policies bound to `app.public_workspace_slug` and
--    `app.public_organization_id`, which the function sets for the duration
--    of the call and restores right after, so no other helper function sees
--    more rows (same pattern as I5's `app.notification_email`). Hosts and
--    slugs are public information.
-- 6. `private.context_public_bases()`: default domains of the partner of the
--    context workspace, for the /app screens (members do not read the
--    partner table).
-- 7. Purge of a deleted workspace (F3e) as the worker.
-- Owner app_migrations, ENABLE + FORCE RLS, no grants to anon/authenticated.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Table: public.partner_public_domains
-- ----------------------------------------------------------------------------
create table public.partner_public_domains (
  id          uuid primary key default gen_random_uuid(),
  partner_id  uuid not null references public.partners(id) on delete cascade,
  route_type  text not null check (route_type in ('profile', 'quiz', 'page')),
  host        text not null unique
                check (
                  host = lower(host)
                  and length(host) <= 200
                  and host ~ '^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$'
                ),
  status      text not null default 'pending'
                check (status in ('pending', 'active', 'disabled')),
  checked_at  timestamptz,
  verified_at timestamptz,
  last_error  text check (length(last_error) <= 300),
  created_by  uuid references public.profiles(id) on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  constraint partner_public_domains_one_per_type unique (partner_id, route_type),
  constraint partner_public_domains_not_house
    check (partner_id <> '00000000-0000-4000-8000-000000000000')
);

alter table public.partner_public_domains owner to app_migrations;
revoke all on public.partner_public_domains from public, anon, authenticated;
alter table public.partner_public_domains enable row level security;
alter table public.partner_public_domains force row level security;

create trigger partner_public_domains_touch_updated_at
  before update on public.partner_public_domains
  for each row execute function private.touch_updated_at();

-- Every role of the context partner reads; platform admins read.
create policy partner_public_domains_select on public.partner_public_domains
  for select to app_runtime
  using (
    (partner_id = private.current_partner_id()
     and private.current_partner_role() is not null)
    or private.current_platform_admin_role() is not null
  );

create policy partner_public_domains_insert on public.partner_public_domains
  for insert to app_runtime
  with check (
    partner_id = private.current_partner_id()
    and private.current_partner_role() in ('partner_owner', 'partner_admin')
    and created_by = private.context_uuid('app.user_id')
    and status = 'pending'
  );

create policy partner_public_domains_update on public.partner_public_domains
  for update to app_runtime
  using (
    partner_id = private.current_partner_id()
    and private.current_partner_role() in ('partner_owner', 'partner_admin')
  )
  with check (partner_id = private.current_partner_id());

create policy partner_public_domains_delete on public.partner_public_domains
  for delete to app_runtime
  using (
    (partner_id = private.current_partner_id()
     and private.current_partner_role() in ('partner_owner', 'partner_admin'))
    or private.current_platform_admin_role() in ('owner', 'operations')
  );

-- Host, type and owner never change: a domain moves by removal.
grant select, insert, delete on public.partner_public_domains to app_runtime;
grant update (status, checked_at, verified_at, last_error, updated_at)
  on public.partner_public_domains to app_runtime;

-- ----------------------------------------------------------------------------
-- 2. Table: public.workspace_public_routes
-- ----------------------------------------------------------------------------
-- A domain belongs to one workspace; the composite key keeps the choice in it.
alter table public.workspace_domains
  add constraint workspace_domains_id_workspace unique (id, workspace_id);

create table public.workspace_public_routes (
  workspace_id    uuid not null,
  organization_id uuid not null,
  tool_key        text not null check (tool_key ~ '^[a-z][a-z0-9-]{1,62}$'),
  route_type      text not null check (route_type in ('profile', 'quiz', 'page')),
  domain_id       uuid not null,
  updated_by      uuid references public.profiles(id) on delete set null,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  primary key (workspace_id, tool_key),
  constraint fk_workspace_public_routes_workspace
    foreign key (workspace_id, organization_id)
    references public.workspaces(id, organization_id) on delete cascade,
  constraint fk_workspace_public_routes_domain
    foreign key (domain_id, workspace_id)
    references public.workspace_domains(id, workspace_id) on delete cascade
);

create index workspace_public_routes_domain_idx on public.workspace_public_routes (domain_id);

alter table public.workspace_public_routes owner to app_migrations;
revoke all on public.workspace_public_routes from public, anon, authenticated;
alter table public.workspace_public_routes enable row level security;
alter table public.workspace_public_routes force row level security;

create trigger workspace_public_routes_touch_updated_at
  before update on public.workspace_public_routes
  for each row execute function private.touch_updated_at();

-- Same reach as workspace_domains (CF2b).
create policy workspace_public_routes_select on public.workspace_public_routes
  for select to app_runtime
  using (
    (workspace_id = private.context_uuid('app.workspace_id')
     and organization_id = private.context_uuid('app.organization_id')
     and private.current_workspace_role() is not null)
    or (private.current_partner_role() is not null
        and private.is_partner_organization(organization_id))
    or private.current_platform_admin_role() is not null
  );

create policy workspace_public_routes_insert on public.workspace_public_routes
  for insert to app_runtime
  with check (
    updated_by = private.context_uuid('app.user_id')
    and (
      (workspace_id = private.context_uuid('app.workspace_id')
       and organization_id = private.context_uuid('app.organization_id')
       and private.current_workspace_role() in ('owner', 'admin'))
      or (private.can_manage_partner_customers()
          and private.is_partner_organization(organization_id))
    )
  );

create policy workspace_public_routes_update on public.workspace_public_routes
  for update to app_runtime
  using (
    (workspace_id = private.context_uuid('app.workspace_id')
     and organization_id = private.context_uuid('app.organization_id')
     and private.current_workspace_role() in ('owner', 'admin'))
    or (private.can_manage_partner_customers()
        and private.is_partner_organization(organization_id))
  )
  with check (updated_by = private.context_uuid('app.user_id'));

create policy workspace_public_routes_delete on public.workspace_public_routes
  for delete to app_runtime
  using (
    (workspace_id = private.context_uuid('app.workspace_id')
     and organization_id = private.context_uuid('app.organization_id')
     and private.current_workspace_role() in ('owner', 'admin'))
    or (private.can_manage_partner_customers()
        and private.is_partner_organization(organization_id))
  );

grant select, insert, delete on public.workspace_public_routes to app_runtime;
grant update (route_type, domain_id, updated_by, updated_at)
  on public.workspace_public_routes to app_runtime;

-- ----------------------------------------------------------------------------
-- 3. Hosts under a partner's default domain
-- ----------------------------------------------------------------------------
create policy partner_public_domains_helper_select on public.partner_public_domains
  for select to app_rls_helper
  using (true);

create policy workspace_public_routes_helper_select on public.workspace_public_routes
  for select to app_rls_helper
  using (true);

grant select on public.partner_public_domains to app_rls_helper;
grant select on public.workspace_public_routes to app_rls_helper;

create function private.guard_public_domain_host()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_host text := new.host;
begin
  if tg_op = 'UPDATE' and new.host = old.host then
    return new;
  end if;
  -- One lock for every host: a suffix conflict has no single key.
  perform pg_advisory_xact_lock(hashtext('public_domain_base'));
  if tg_table_name = 'partner_public_domains' then
    if exists (select 1 from public.partner_domains d
               where d.host = v_host or d.host like '%.' || v_host)
       or exists (select 1 from public.workspace_domains d
                  where d.host = v_host or d.host like '%.' || v_host)
       or exists (select 1 from public.partner_public_domains d
                  where d.id <> new.id
                    and (d.host = v_host
                         or d.host like '%.' || v_host
                         or v_host like '%.' || d.host)) then
      raise exception 'domain host already in use' using errcode = 'unique_violation';
    end if;
  elsif exists (select 1 from public.partner_public_domains d
                where d.host = v_host or v_host like '%.' || d.host) then
    raise exception 'domain host already in use' using errcode = 'unique_violation';
  end if;
  return new;
end;
$$;

-- Triggers first: creating one needs EXECUTE, which app_migrations loses
-- once the function belongs to app_rls_helper.
create trigger partner_public_domains_guard_host
  before insert or update of host on public.partner_public_domains
  for each row execute function private.guard_public_domain_host();

create trigger partner_domains_guard_public_host
  before insert or update of host on public.partner_domains
  for each row execute function private.guard_public_domain_host();

create trigger workspace_domains_guard_public_host
  before insert or update of host on public.workspace_domains
  for each row execute function private.guard_public_domain_host();

revoke execute on function private.guard_public_domain_host() from public, anon, authenticated;
alter function private.guard_public_domain_host() owner to app_rls_helper;

-- ----------------------------------------------------------------------------
-- 4. Resolvers without sign-in
-- ----------------------------------------------------------------------------
-- Rows of the looked-up slug only (app_rls_helper already has SELECT on
-- both tables; FORCE RLS applies to it).
create policy workspaces_helper_public_slug_select on public.workspaces
  for select to app_rls_helper
  using (
    status = 'active'
    and slug = nullif(current_setting('app.public_workspace_slug', true), '')
  );

-- The company of that workspace, by its id (a policy that read workspaces
-- here would recurse through the workspaces helper policies).
create policy organizations_helper_public_slug_select on public.organizations
  for select to app_rls_helper
  using (id = private.context_uuid('app.public_organization_id'));

-- Active default domains of active partners among the given hosts (the
-- suffixes of a request host).
create function private.resolve_public_bases(p_hosts text[])
returns table(host text, partner_id uuid, route_type text)
language sql
stable
security definer
set search_path = ''
as $$
  select d.host, d.partner_id, d.route_type
  from public.partner_public_domains d
  join public.partners p on p.id = d.partner_id
  where d.host = any(p_hosts[1:20]) and d.status = 'active' and p.status = 'active';
$$;

revoke execute on function private.resolve_public_bases(text[]) from public, anon, authenticated;
grant execute on function private.resolve_public_bases(text[]) to app_runtime;
alter function private.resolve_public_bases(text[]) owner to app_rls_helper;

-- Active workspace of a slug, its partner and the route types its partner
-- replaces with an active default domain (whatever the partner's status, so
-- a suspended partner's customers never fall back to the platform domain).
create function private.resolve_public_workspace(p_slug text)
returns table(workspace_id uuid, organization_id uuid, workspace_slug text,
              partner_id uuid, replaced_types text[])
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_slug text := lower(btrim(coalesce(p_slug, '')));
  v_previous_slug text := current_setting('app.public_workspace_slug', true);
  v_previous_org text := current_setting('app.public_organization_id', true);
  v_workspace_id uuid;
  v_organization_id uuid;
  v_partner_id uuid;
begin
  if v_slug = '' or length(v_slug) > 63 then
    return;
  end if;
  perform set_config('app.public_workspace_slug', v_slug, true);
  select w.id, w.organization_id into v_workspace_id, v_organization_id
  from public.workspaces w
  where w.slug = v_slug and w.status = 'active';
  if v_workspace_id is not null then
    perform set_config('app.public_organization_id', v_organization_id::text, true);
    select o.partner_id into v_partner_id
    from public.organizations o
    where o.id = v_organization_id;
  end if;
  -- The lookup values do not outlive the call (an error aborts the
  -- transaction or savepoint, which undoes them as well).
  perform set_config('app.public_workspace_slug', coalesce(v_previous_slug, ''), true);
  perform set_config('app.public_organization_id', coalesce(v_previous_org, ''), true);
  if v_partner_id is null then
    return;
  end if;
  return query
    select v_workspace_id, v_organization_id, v_slug, v_partner_id,
           coalesce(
             (select array_agg(d.route_type order by d.route_type)
              from public.partner_public_domains d
              where d.partner_id = v_partner_id and d.status = 'active'),
             '{}'::text[]);
end;
$$;

revoke execute on function private.resolve_public_workspace(text) from public, anon, authenticated;
grant execute on function private.resolve_public_workspace(text) to app_runtime;
alter function private.resolve_public_workspace(text) owner to app_rls_helper;

-- Tools that use an active own domain (the workspace must be active too).
create function private.public_domain_routes(p_host text)
returns table(tool_key text, route_type text)
language sql
stable
security definer
set search_path = ''
as $$
  select r.tool_key, r.route_type
  from public.workspace_public_routes r
  join public.workspace_domains d on d.id = r.domain_id
  join public.workspaces w on w.id = d.workspace_id
  where d.host = lower(p_host) and d.status = 'active' and w.status = 'active'
  order by r.tool_key;
$$;

revoke execute on function private.public_domain_routes(text) from public, anon, authenticated;
grant execute on function private.public_domain_routes(text) to app_runtime;
alter function private.public_domain_routes(text) owner to app_rls_helper;

-- Default domains of the context workspace's partner, for its members.
create function private.context_public_bases()
returns table(route_type text, host text)
language sql
stable
security definer
set search_path = ''
as $$
  select d.route_type, d.host
  from public.partner_public_domains d
  join public.organizations o on o.partner_id = d.partner_id
  where o.id = private.context_uuid('app.organization_id')
    and private.current_workspace_role() is not null
    and d.status = 'active'
  order by d.route_type;
$$;

revoke execute on function private.context_public_bases() from public, anon, authenticated;
grant execute on function private.context_public_bases() to app_runtime;
alter function private.context_public_bases() owner to app_rls_helper;

-- ----------------------------------------------------------------------------
-- 5. Purge of a deleted workspace (F3e)
-- ----------------------------------------------------------------------------
create policy workspace_public_routes_worker_purge_select on public.workspace_public_routes
  for select to app_worker
  using (private.workspace_purgeable(workspace_id));

create policy workspace_public_routes_worker_purge on public.workspace_public_routes
  for delete to app_worker
  using (private.workspace_purgeable(workspace_id));

grant select (workspace_id), delete on public.workspace_public_routes to app_worker;
