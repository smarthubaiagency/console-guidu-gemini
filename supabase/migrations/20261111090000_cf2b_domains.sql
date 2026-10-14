-- ============================================================================
-- Migration: 20261111090000_cf2b_domains.sql
-- Module: CF2b — custom domains of partners and workspaces
--         (/mnt/project-files/configuracoes/plano-dominios.md)
--
-- Maintenance Rationale:
-- 1. Marcelo (14/10/2026): the partner changes the domain of its dashboard
--    (`console.parceiro.com`) itself in /admin; customers never change the
--    dashboard domain, but manage the public domains of their workspace
--    (site, digital profile, quiz) in /app, and the partner manages them too
--    from /admin. The flow follows the legacy (cartaopro-linkko): a CNAME to
--    the proxy target, a Cloudflare for SaaS custom hostname with DV
--    certificate, activation when DNS and certificate are ready, and a
--    ForwardAuth check of Traefik that only lets active hosts through.
-- 2. `public.partner_domains` gains the verification state. Partner owners
--    and admins add, verify and remove the custom domains of their own
--    partner; subdomains stay a platform operation (P4a).
-- 3. `public.workspace_domains`: public domains of a workspace, managed by
--    the workspace owner/admin and by the partner owner/admin of the
--    company. How many a workspace may have comes from the plan
--    (quota `core.public_domains`, checked by the application under lock).
-- 4. A host is unique across both tables (trigger under an advisory lock).
--    Platform hosts come from the environment and are refused by the app.
-- 5. Resolvers for requests without sign-in: `private.domain_host_active`
--    (ForwardAuth) and `private.resolve_public_domain` (future public
--    routes). Hosts are public information. The partner lists its
--    customers' workspaces by `private.partner_customer_workspaces()`.
-- 6. Verification runs when a manager asks for it ("Verificar"): the
--    network calls happen outside the transaction and the result is written
--    with the manager's context.
-- 7. Purge of a deleted workspace (F3e) as the worker.
-- Owner app_migrations, ENABLE + FORCE RLS, no grants to anon/authenticated.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Verification state of partner domains
-- ----------------------------------------------------------------------------
alter table public.partner_domains
  add column cloudflare_hostname_id text check (length(cloudflare_hostname_id) between 1 and 64),
  add column ssl_status text not null default 'none'
    check (ssl_status in ('none', 'pending', 'active', 'error')),
  add column checked_at timestamptz,
  add column verified_at timestamptz,
  add column last_error text check (length(last_error) <= 300);

create policy partner_domains_partner_insert on public.partner_domains
  for insert to app_runtime
  with check (
    partner_id = private.current_partner_id()
    and private.current_partner_role() in ('partner_owner', 'partner_admin')
    and kind = 'custom'
    and status = 'pending'
  );

create policy partner_domains_partner_update on public.partner_domains
  for update to app_runtime
  using (
    partner_id = private.current_partner_id()
    and private.current_partner_role() in ('partner_owner', 'partner_admin')
    and kind = 'custom'
  )
  with check (
    partner_id = private.current_partner_id()
    and kind = 'custom'
  );

create policy partner_domains_partner_delete on public.partner_domains
  for delete to app_runtime
  using (
    partner_id = private.current_partner_id()
    and private.current_partner_role() in ('partner_owner', 'partner_admin')
    and kind = 'custom'
  );

create policy partner_domains_platform_delete on public.partner_domains
  for delete to app_runtime
  using (private.current_platform_admin_role() in ('owner', 'operations'));

grant delete on public.partner_domains to app_runtime;

-- ----------------------------------------------------------------------------
-- 2. Table: public.workspace_domains
-- ----------------------------------------------------------------------------
create table public.workspace_domains (
  id                     uuid primary key default gen_random_uuid(),
  host                   text not null unique
                           check (
                             host = lower(host)
                             and length(host) <= 253
                             and host ~ '^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$'
                           ),
  organization_id        uuid not null,
  workspace_id           uuid not null,
  status                 text not null default 'pending'
                           check (status in ('pending', 'active', 'disabled')),
  is_primary             boolean not null default false,
  cloudflare_hostname_id text check (length(cloudflare_hostname_id) between 1 and 64),
  ssl_status             text not null default 'none'
                           check (ssl_status in ('none', 'pending', 'active', 'error')),
  checked_at             timestamptz,
  verified_at            timestamptz,
  last_error             text check (length(last_error) <= 300),
  created_by             uuid references public.profiles(id) on delete set null,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now(),
  constraint fk_workspace_domains_workspace
    foreign key (workspace_id, organization_id)
    references public.workspaces(id, organization_id) on delete cascade
);

create index workspace_domains_workspace_idx on public.workspace_domains (workspace_id);
create index workspace_domains_organization_idx on public.workspace_domains (organization_id);
create unique index workspace_domains_primary on public.workspace_domains (workspace_id)
  where is_primary;

alter table public.workspace_domains owner to app_migrations;
revoke all on public.workspace_domains from public, anon, authenticated;
alter table public.workspace_domains enable row level security;
alter table public.workspace_domains force row level security;

create trigger workspace_domains_touch_updated_at
  before update on public.workspace_domains
  for each row execute function private.touch_updated_at();

-- Workspace managers (owner, admin) of the context workspace; members read.
-- Partner managers of the company's partner (partner context); every
-- partner role reads. Platform admins read.
create policy workspace_domains_select on public.workspace_domains
  for select to app_runtime
  using (
    (workspace_id = private.context_uuid('app.workspace_id')
     and organization_id = private.context_uuid('app.organization_id')
     and private.current_workspace_role() is not null)
    or (private.current_partner_role() is not null
        and private.is_partner_organization(organization_id))
    or private.current_platform_admin_role() is not null
  );

create policy workspace_domains_insert on public.workspace_domains
  for insert to app_runtime
  with check (
    created_by = private.context_uuid('app.user_id')
    and status = 'pending'
    and (
      (workspace_id = private.context_uuid('app.workspace_id')
       and organization_id = private.context_uuid('app.organization_id')
       and private.current_workspace_role() in ('owner', 'admin'))
      or (private.can_manage_partner_customers()
          and private.is_partner_organization(organization_id))
    )
  );

create policy workspace_domains_update on public.workspace_domains
  for update to app_runtime
  using (
    (workspace_id = private.context_uuid('app.workspace_id')
     and organization_id = private.context_uuid('app.organization_id')
     and private.current_workspace_role() in ('owner', 'admin'))
    or (private.can_manage_partner_customers()
        and private.is_partner_organization(organization_id))
  );

create policy workspace_domains_delete on public.workspace_domains
  for delete to app_runtime
  using (
    (workspace_id = private.context_uuid('app.workspace_id')
     and organization_id = private.context_uuid('app.organization_id')
     and private.current_workspace_role() in ('owner', 'admin'))
    or (private.can_manage_partner_customers()
        and private.is_partner_organization(organization_id))
  );

-- Host and owner never change: a domain moves by removal and a new entry.
grant select, insert, delete on public.workspace_domains to app_runtime;
grant update (status, is_primary, cloudflare_hostname_id, ssl_status, checked_at,
              verified_at, last_error, updated_at)
  on public.workspace_domains to app_runtime;

-- ----------------------------------------------------------------------------
-- 3. One host across both tables
-- ----------------------------------------------------------------------------
create policy partner_domains_helper_host_select on public.partner_domains
  for select to app_rls_helper
  using (true);

create policy workspace_domains_helper_select on public.workspace_domains
  for select to app_rls_helper
  using (true);

grant select on public.workspace_domains to app_rls_helper;

create function private.guard_domain_host()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' and new.host = old.host then
    return new;
  end if;
  perform pg_advisory_xact_lock(hashtext('domain_host:' || new.host));
  if (tg_table_name = 'partner_domains'
        and exists (select 1 from public.workspace_domains d where d.host = new.host))
     or (tg_table_name = 'workspace_domains'
        and exists (select 1 from public.partner_domains d where d.host = new.host)) then
    raise exception 'domain host already in use' using errcode = 'unique_violation';
  end if;
  return new;
end;
$$;

-- Triggers first: creating one needs EXECUTE, which app_migrations loses
-- once the function belongs to app_rls_helper (it reads both tables).
create trigger partner_domains_guard_host
  before insert or update of host on public.partner_domains
  for each row execute function private.guard_domain_host();

create trigger workspace_domains_guard_host
  before insert or update of host on public.workspace_domains
  for each row execute function private.guard_domain_host();

revoke execute on function private.guard_domain_host() from public, anon, authenticated;
alter function private.guard_domain_host() owner to app_rls_helper;

-- ----------------------------------------------------------------------------
-- 4. Resolvers without sign-in
-- ----------------------------------------------------------------------------
create policy workspaces_helper_public_domain_select on public.workspaces
  for select to app_rls_helper
  using (
    status = 'active'
    and exists (
      select 1 from public.workspace_domains d
      where d.workspace_id = workspaces.id and d.status = 'active'
    )
  );

-- Active custom host of an active partner, or active public domain of an
-- active workspace: the ForwardAuth answer.
create function private.domain_host_active(p_host text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.partner_domains d
    join public.partners p on p.id = d.partner_id
    where d.host = lower(p_host) and d.status = 'active' and p.status = 'active'
  ) or exists (
    select 1
    from public.workspace_domains d
    join public.workspaces w on w.id = d.workspace_id
    where d.host = lower(p_host) and d.status = 'active' and w.status = 'active'
  );
$$;

revoke execute on function private.domain_host_active(text) from public, anon, authenticated;
grant execute on function private.domain_host_active(text) to app_runtime;
alter function private.domain_host_active(text) owner to app_rls_helper;

-- Workspace of an active public domain, for the public routes.
create function private.resolve_public_domain(p_host text)
returns table(workspace_id uuid, organization_id uuid, workspace_slug text)
language sql
stable
security definer
set search_path = ''
as $$
  select w.id, w.organization_id, w.slug
  from public.workspace_domains d
  join public.workspaces w on w.id = d.workspace_id
  where d.host = lower(p_host) and d.status = 'active' and w.status = 'active';
$$;

revoke execute on function private.resolve_public_domain(text) from public, anon, authenticated;
grant execute on function private.resolve_public_domain(text) to app_runtime;
alter function private.resolve_public_domain(text) owner to app_rls_helper;

-- Workspaces of the context partner's companies, for the domain screen of
-- /admin (names and slugs only; the partner reads no other workspace data).
create policy organizations_helper_partner_select on public.organizations
  for select to app_rls_helper
  using (
    partner_id = private.current_partner_id()
    and private.current_partner_role() is not null
  );

create policy workspaces_helper_partner_select on public.workspaces
  for select to app_rls_helper
  using (
    private.current_partner_role() is not null
    and exists (
      select 1 from public.organizations o
      where o.id = workspaces.organization_id
        and o.partner_id = private.current_partner_id()
    )
  );

-- The plan of a customer company, for the quota check when the partner
-- adds a public domain from /admin (private.organization_contract).
create policy subscriptions_helper_partner_select on public.subscriptions
  for select to app_rls_helper
  using (
    private.current_partner_role() is not null
    and exists (
      select 1 from public.organizations o
      where o.id = subscriptions.organization_id
        and o.partner_id = private.current_partner_id()
    )
  );

create function private.partner_customer_workspaces()
returns table(workspace_id uuid, organization_id uuid, organization_name text,
              workspace_name text, workspace_slug text)
language sql
stable
security definer
set search_path = ''
as $$
  select w.id, o.id, o.name, w.name, w.slug
  from public.workspaces w
  join public.organizations o on o.id = w.organization_id
  where private.current_partner_role() is not null
    and o.partner_id = private.current_partner_id()
    and w.status = 'active'
  order by o.name, w.name;
$$;

revoke execute on function private.partner_customer_workspaces() from public, anon, authenticated;
grant execute on function private.partner_customer_workspaces() to app_runtime;
alter function private.partner_customer_workspaces() owner to app_rls_helper;

-- ----------------------------------------------------------------------------
-- 5. Purge of a deleted workspace (F3e)
-- ----------------------------------------------------------------------------
create policy workspace_domains_worker_purge_select on public.workspace_domains
  for select to app_worker
  using (private.workspace_purgeable(workspace_id));

create policy workspace_domains_worker_purge on public.workspace_domains
  for delete to app_worker
  using (private.workspace_purgeable(workspace_id));

grant select (workspace_id), delete on public.workspace_domains to app_worker;
