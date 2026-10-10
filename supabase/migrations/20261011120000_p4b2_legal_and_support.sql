-- ============================================================================
-- Migration: 20261011120000_p4b2_legal_and_support.sql
-- Module: P4b (2/2) — Partner legal documents with acceptance and temporary
--         support access (ADR 0012, plano P4; especificação §5 and §12)
--
-- Maintenance Rationale:
-- 1. `public.partner_legal_documents`: terms and privacy policy per partner,
--    insert-only and versioned. A version marked `requires_acceptance`
--    makes users accept it again; the first version always requires it.
--    Published by platform owner/operations (for the context partner, e.g.
--    the house partner) or by partner_owner/partner_admin.
-- 2. `public.legal_acceptances`: who accepted which version, when. No IP or
--    user agent: §20 asks for a legal basis we do not have yet.
-- 3. `public.partner_support_grants`: a partner member asks for temporary
--    access to a customer, with a reason and a duration (1–72 h). An owner or
--    admin of the customer workspace approves it in that workspace, which
--    creates a `viewer` membership linked to the grant
--    (`workspace_members.support_grant_id`).
-- 4. Grant validity is enforced where membership is evaluated:
--    is_workspace_member, current_workspace_role, resolve_workspace_slug and
--    list_user_workspaces treat a support membership as active only while
--    its grant is approved and unexpired. Expiry and revocation therefore
--    need no job: the next query already denies.
-- Owner app_migrations, ENABLE + FORCE RLS, no grants to anon/authenticated.
-- Functions owned by app_rls_helper are replaced under that role; grants of
-- new functions come before the ownership transfer (app_migrations is
-- NOINHERIT).
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Legal documents and acceptances
-- ----------------------------------------------------------------------------
create table public.partner_legal_documents (
  id                  uuid primary key default gen_random_uuid(),
  partner_id          uuid not null references public.partners(id) on delete cascade,
  kind                text not null check (kind in ('terms', 'privacy')),
  version             integer not null check (version > 0),
  title               text not null check (length(trim(title)) > 0 and length(title) <= 120),
  body                text not null check (length(trim(body)) > 0 and length(body) <= 100000),
  requires_acceptance boolean not null default true,
  published_by        uuid references public.profiles(id) on delete set null,
  published_at        timestamptz not null default now(),
  unique (partner_id, kind, version),
  check (version > 1 or requires_acceptance)
);

alter table public.partner_legal_documents owner to app_migrations;
revoke all on public.partner_legal_documents from public, anon, authenticated;
alter table public.partner_legal_documents enable row level security;
alter table public.partner_legal_documents force row level security;

-- Public documents of the host's partner, readable before sign-in.
create policy partner_legal_documents_select on public.partner_legal_documents
  for select to app_runtime
  using (partner_id = private.current_partner_id());

create policy partner_legal_documents_insert on public.partner_legal_documents
  for insert to app_runtime
  with check (
    partner_id = private.current_partner_id()
    and published_by = private.context_uuid('app.user_id')
    and (
      private.current_platform_admin_role() in ('owner', 'operations')
      or private.can_manage_partner_customers()
    )
  );

grant select, insert on public.partner_legal_documents to app_runtime;

create table public.legal_acceptances (
  user_id     uuid not null references public.profiles(id) on delete cascade,
  document_id uuid not null references public.partner_legal_documents(id) on delete restrict,
  accepted_at timestamptz not null default now(),
  primary key (user_id, document_id)
);

alter table public.legal_acceptances owner to app_migrations;
revoke all on public.legal_acceptances from public, anon, authenticated;
alter table public.legal_acceptances enable row level security;
alter table public.legal_acceptances force row level security;

create policy legal_acceptances_select on public.legal_acceptances
  for select to app_runtime
  using (user_id = private.context_uuid('app.user_id'));

create policy legal_acceptances_insert on public.legal_acceptances
  for insert to app_runtime
  with check (
    user_id = private.context_uuid('app.user_id')
    and exists (
      select 1
      from public.partner_legal_documents document
      where document.id = legal_acceptances.document_id
        and document.partner_id = private.current_partner_id()
    )
  );

grant select, insert on public.legal_acceptances to app_runtime;

-- ----------------------------------------------------------------------------
-- 2. Support grants
-- ----------------------------------------------------------------------------
create table public.partner_support_grants (
  id              uuid primary key default gen_random_uuid(),
  partner_id      uuid not null references public.partners(id) on delete cascade,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  -- Set by the customer when approving, in that workspace.
  workspace_id    uuid,
  workspace_slug  text,
  grantee_user_id uuid not null references public.profiles(id) on delete cascade,
  -- Copied from partner_members so the customer sees who asked.
  grantee_email   text not null check (length(grantee_email) <= 254),
  requested_by    uuid not null references public.profiles(id) on delete cascade,
  reason          text not null check (length(trim(reason)) between 10 and 500),
  duration_hours  integer not null check (duration_hours between 1 and 72),
  status          text not null default 'pending'
                    check (status in ('pending', 'approved', 'denied', 'revoked')),
  expires_at      timestamptz,
  decided_by      uuid references public.profiles(id) on delete set null,
  decided_at      timestamptz,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  foreign key (workspace_id, organization_id)
    references public.workspaces(id, organization_id) on delete cascade,
  check (status <> 'approved' or (workspace_id is not null and expires_at is not null))
);

create index partner_support_grants_partner_idx on public.partner_support_grants (partner_id);
create index partner_support_grants_organization_idx on public.partner_support_grants (organization_id);
create index partner_support_grants_grantee_idx on public.partner_support_grants (grantee_user_id);

alter table public.partner_support_grants owner to app_migrations;
revoke all on public.partner_support_grants from public, anon, authenticated;
alter table public.partner_support_grants enable row level security;
alter table public.partner_support_grants force row level security;

create trigger partner_support_grants_touch_updated_at
  before update on public.partner_support_grants
  for each row execute function private.touch_updated_at();

-- Partner side: members of the context partner see the partner's requests.
create policy partner_support_grants_partner_select on public.partner_support_grants
  for select to app_runtime
  using (
    partner_id = private.current_partner_id()
    and private.current_partner_role() is not null
  );

-- Customer side: owners and admins of the contextual workspace/company.
create policy partner_support_grants_customer_select on public.partner_support_grants
  for select to app_runtime
  using (
    organization_id = private.context_uuid('app.organization_id')
    and (
      private.current_workspace_role() in ('owner', 'admin')
      or private.current_organization_role() in ('owner', 'admin')
    )
  );

-- The grantee sees their own grants.
create policy partner_support_grants_grantee_select on public.partner_support_grants
  for select to app_runtime
  using (grantee_user_id = private.context_uuid('app.user_id'));

-- A partner member (owner, admin or support; never finance) asks for access
-- for themselves, for a customer of the context partner.
create policy partner_support_grants_insert on public.partner_support_grants
  for insert to app_runtime
  with check (
    partner_id = private.current_partner_id()
    and private.current_partner_role() in ('partner_owner', 'partner_admin', 'partner_support')
    and private.is_partner_organization(organization_id)
    and grantee_user_id = private.context_uuid('app.user_id')
    and requested_by = private.context_uuid('app.user_id')
    and status = 'pending'
    and workspace_id is null
    and expires_at is null
  );

-- Permissive UPDATE policies combine USING of one with WITH CHECK of another,
-- so every WITH CHECK below repeats who may write it. Otherwise a requester
-- (USING of partner_revoke) could approve their own grant (CHECK of decide).

-- The customer decides a pending request in the contextual workspace; the
-- expiry may not exceed the requested duration.
create policy partner_support_grants_decide on public.partner_support_grants
  for update to app_runtime
  using (
    status = 'pending'
    and organization_id = private.context_uuid('app.organization_id')
    and (
      private.current_workspace_role() in ('owner', 'admin')
      or private.current_organization_role() in ('owner', 'admin')
    )
  )
  with check (
    decided_by = private.context_uuid('app.user_id')
    and organization_id = private.context_uuid('app.organization_id')
    and (
      private.current_workspace_role() in ('owner', 'admin')
      or private.current_organization_role() in ('owner', 'admin')
    )
    and (
      status = 'denied'
      or (
        status = 'approved'
        and workspace_id = private.context_uuid('app.workspace_id')
        and expires_at > now()
        and expires_at <= now() + make_interval(hours => duration_hours) + interval '1 minute'
      )
    )
  );

-- The customer revokes an approved grant at any time.
create policy partner_support_grants_customer_revoke on public.partner_support_grants
  for update to app_runtime
  using (
    status = 'approved'
    and organization_id = private.context_uuid('app.organization_id')
    and (
      private.current_workspace_role() in ('owner', 'admin')
      or private.current_organization_role() in ('owner', 'admin')
    )
  )
  with check (
    status = 'revoked'
    and decided_by = private.context_uuid('app.user_id')
    and organization_id = private.context_uuid('app.organization_id')
    and (
      private.current_workspace_role() in ('owner', 'admin')
      or private.current_organization_role() in ('owner', 'admin')
    )
  );

-- The requester withdraws or ends their own grant.
create policy partner_support_grants_partner_revoke on public.partner_support_grants
  for update to app_runtime
  using (
    partner_id = private.current_partner_id()
    and requested_by = private.context_uuid('app.user_id')
    and status in ('pending', 'approved')
  )
  with check (
    status = 'revoked'
    and partner_id = private.current_partner_id()
    and requested_by = private.context_uuid('app.user_id')
  );

grant select, insert, update on public.partner_support_grants to app_runtime;

-- ----------------------------------------------------------------------------
-- 3. Support memberships and their validity
-- ----------------------------------------------------------------------------
alter table public.workspace_members
  add column support_grant_id uuid references public.partner_support_grants(id) on delete cascade;

create policy partner_support_grants_helper_select on public.partner_support_grants
  for select to app_rls_helper
  using (grantee_user_id = private.context_uuid('app.user_id'));

grant select on public.partner_support_grants to app_rls_helper;

create function private.support_grant_valid(
  p_grant_id uuid,
  p_user_id uuid,
  p_workspace_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.partner_support_grants grant_row
    where grant_row.id = p_grant_id
      and grant_row.grantee_user_id = p_user_id
      and grant_row.workspace_id = p_workspace_id
      and grant_row.status = 'approved'
      and grant_row.expires_at > now()
  );
$$;

revoke execute on function private.support_grant_valid(uuid, uuid, uuid) from public, anon, authenticated;
grant execute on function private.support_grant_valid(uuid, uuid, uuid) to app_runtime, app_rls_helper;
alter function private.support_grant_valid(uuid, uuid, uuid) owner to app_rls_helper;

set local role app_rls_helper;

create or replace function private.is_workspace_member(
  p_workspace_id uuid,
  p_organization_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select p_workspace_id = private.context_uuid('app.workspace_id')
    and p_organization_id = private.context_uuid('app.organization_id')
    and exists (
      select 1
      from public.workspace_members member
      where member.workspace_id = p_workspace_id
        and member.organization_id = p_organization_id
        and member.user_id = private.context_uuid('app.user_id')
        and member.status = 'active'
        and (
          member.support_grant_id is null
          or private.support_grant_valid(member.support_grant_id, member.user_id, member.workspace_id)
        )
    );
$$;

create or replace function private.current_workspace_role()
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select member.role
  from public.workspace_members member
  where member.workspace_id = private.context_uuid('app.workspace_id')
    and member.organization_id = private.context_uuid('app.organization_id')
    and member.user_id = private.context_uuid('app.user_id')
    and member.status = 'active'
    and (
      member.support_grant_id is null
      or private.support_grant_valid(member.support_grant_id, member.user_id, member.workspace_id)
    );
$$;

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
        and (
          member.support_grant_id is null
          or private.support_grant_valid(member.support_grant_id, member.user_id, member.workspace_id)
        )
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
    and (
      wm.support_grant_id is null
      or private.support_grant_valid(wm.support_grant_id, wm.user_id, wm.workspace_id)
    )
    and w.status = 'active'
    and o.status = 'active'
    and o.partner_id = private.current_partner_id()
  order by o.name asc, w.name asc;
$$;

reset role;
