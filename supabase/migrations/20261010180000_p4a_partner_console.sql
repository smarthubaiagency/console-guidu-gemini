-- ============================================================================
-- Migration: 20261010180000_p4a_partner_console.sql
-- Module: P4a — Partner console and partner management (ADR 0012, plano P4)
--
-- Maintenance Rationale:
-- 1. `public.partner_members`: partner roles approved by Marcelo (D-PA-02):
--    partner_owner, partner_admin, partner_finance, partner_support. They are
--    separate from internal and company/workspace roles and grant no access
--    to workspace data.
-- 2. `public.partner_invitations`: members join only by invitation. The
--    token is stored as a hash; acceptance works like organization
--    invitations, through `app.partner_invitation_token_hash`, and the
--    recipient e-mail is checked by the server against the verified identity.
-- 3. `private.current_partner_role()`: active role of app.user_id in
--    app.partner_id (partner must be active). Security definer owned by
--    app_rls_helper, reading only the caller's own membership rows.
-- 4. Platform management: active platform admins read every partner, domain,
--    member and invitation; owner/operations create and update partners
--    (never the house partner), domains and invitations.
-- 5. Partner console: members of the context partner read their partner's
--    members and organizations (metadata only, no workspace data); the
--    partner_owner invites and manages members; partner_owner and
--    partner_admin may also save brand versions of their partner.
-- Owner app_migrations, ENABLE + FORCE RLS, no grants to anon/authenticated.
-- Functions owned by app_rls_helper get their grants before the ownership
-- transfer (app_migrations is NOINHERIT).
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Tables
-- ----------------------------------------------------------------------------
create table public.partner_members (
  partner_id uuid not null references public.partners(id) on delete cascade,
  user_id    uuid not null references public.profiles(id) on delete cascade,
  -- Copied from the accepted invitation, whose recipient the server matched
  -- against the verified identity; lets the console list members without
  -- reading other users' profiles.
  email      text not null check (length(email) <= 254 and email = lower(email)),
  role       text not null
               check (role in ('partner_owner', 'partner_admin', 'partner_finance', 'partner_support')),
  status     text not null default 'active' check (status in ('active', 'inactive')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (partner_id, user_id)
);

create index partner_members_user_id_idx on public.partner_members (user_id);

create table public.partner_invitations (
  id          uuid primary key default gen_random_uuid(),
  partner_id  uuid not null references public.partners(id) on delete cascade,
  email       text not null check (length(email) <= 254 and email = lower(email)),
  role        text not null
                check (role in ('partner_owner', 'partner_admin', 'partner_finance', 'partner_support')),
  token_hash  text not null unique check (token_hash ~ '^[0-9a-f]{64}$'),
  status      text not null default 'pending'
                check (status in ('pending', 'accepted', 'revoked', 'expired')),
  expires_at  timestamptz not null,
  invited_by  uuid references public.profiles(id) on delete set null,
  accepted_by uuid references public.profiles(id) on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index partner_invitations_partner_id_idx on public.partner_invitations (partner_id);

alter table public.partner_members owner to app_migrations;
alter table public.partner_invitations owner to app_migrations;
-- Supabase grants new public tables to anon/authenticated by default.
revoke all on public.partner_members from public, anon, authenticated;
revoke all on public.partner_invitations from public, anon, authenticated;
alter table public.partner_members enable row level security;
alter table public.partner_members force row level security;
alter table public.partner_invitations enable row level security;
alter table public.partner_invitations force row level security;

create trigger partner_members_touch_updated_at
  before update on public.partner_members
  for each row execute function private.touch_updated_at();
create trigger partner_invitations_touch_updated_at
  before update on public.partner_invitations
  for each row execute function private.touch_updated_at();

-- ----------------------------------------------------------------------------
-- 2. Helper: role of the context user in the context partner
-- ----------------------------------------------------------------------------
create policy partner_members_helper_select on public.partner_members
  for select to app_rls_helper
  using (user_id = private.context_uuid('app.user_id'));

grant select on public.partner_members to app_rls_helper;

create function private.current_partner_role()
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select member.role
  from public.partner_members member
  join public.partners partner on partner.id = member.partner_id
  where member.partner_id = private.current_partner_id()
    and member.user_id = private.context_uuid('app.user_id')
    and member.status = 'active'
    and partner.status = 'active';
$$;

revoke execute on function private.current_partner_role() from public, anon, authenticated;
grant execute on function private.current_partner_role() to app_runtime;
alter function private.current_partner_role() owner to app_rls_helper;

-- ----------------------------------------------------------------------------
-- 3. partners and partner_domains: platform management
-- ----------------------------------------------------------------------------
create policy partners_platform_select on public.partners
  for select to app_runtime
  using (private.current_platform_admin_role() is not null);

create policy partners_platform_insert on public.partners
  for insert to app_runtime
  with check (
    private.current_platform_admin_role() in ('owner', 'operations')
    and not is_house
  );

create policy partners_platform_update on public.partners
  for update to app_runtime
  using (private.current_platform_admin_role() in ('owner', 'operations') and not is_house)
  with check (private.current_platform_admin_role() in ('owner', 'operations') and not is_house);

create policy partner_domains_platform_select on public.partner_domains
  for select to app_runtime
  using (private.current_platform_admin_role() is not null);

create policy partner_domains_platform_insert on public.partner_domains
  for insert to app_runtime
  with check (private.current_platform_admin_role() in ('owner', 'operations'));

create policy partner_domains_platform_update on public.partner_domains
  for update to app_runtime
  using (private.current_platform_admin_role() in ('owner', 'operations'))
  with check (private.current_platform_admin_role() in ('owner', 'operations'));

grant insert, update on public.partners to app_runtime;
grant insert, update on public.partner_domains to app_runtime;

-- ----------------------------------------------------------------------------
-- 4. partner_members
-- ----------------------------------------------------------------------------
create policy partner_members_select on public.partner_members
  for select to app_runtime
  using (
    user_id = private.context_uuid('app.user_id')
    or private.current_platform_admin_role() is not null
    or (partner_id = private.current_partner_id() and private.current_partner_role() is not null)
  );

-- Joining: only with a pending, unexpired invitation of the same partner and
-- role, identified by the token hash the server placed in the context.
create policy partner_members_insert_by_invitation on public.partner_members
  for insert to app_runtime
  with check (
    user_id = private.context_uuid('app.user_id')
    and status = 'active'
    and exists (
      select 1
      from public.partner_invitations invitation
      where invitation.token_hash = current_setting('app.partner_invitation_token_hash', true)
        and invitation.partner_id = partner_members.partner_id
        and invitation.role = partner_members.role
        and invitation.email = partner_members.email
        and invitation.status = 'pending'
        and invitation.expires_at > now()
    )
  );

-- Managing: the partner_owner of the context partner, never on their own row;
-- platform owner/operations on any partner.
create policy partner_members_update on public.partner_members
  for update to app_runtime
  using (
    private.current_platform_admin_role() in ('owner', 'operations')
    or (
      partner_id = private.current_partner_id()
      and private.current_partner_role() = 'partner_owner'
      and user_id <> private.context_uuid('app.user_id')
    )
  )
  with check (
    private.current_platform_admin_role() in ('owner', 'operations')
    or (
      partner_id = private.current_partner_id()
      and private.current_partner_role() = 'partner_owner'
      and user_id <> private.context_uuid('app.user_id')
    )
  );

grant select, insert, update on public.partner_members to app_runtime;

-- ----------------------------------------------------------------------------
-- 5. partner_invitations
-- ----------------------------------------------------------------------------
create policy partner_invitations_select on public.partner_invitations
  for select to app_runtime
  using (
    token_hash = current_setting('app.partner_invitation_token_hash', true)
    or private.current_platform_admin_role() is not null
    or (partner_id = private.current_partner_id() and private.current_partner_role() = 'partner_owner')
  );

create policy partner_invitations_insert on public.partner_invitations
  for insert to app_runtime
  with check (
    status = 'pending'
    and invited_by = private.context_uuid('app.user_id')
    and (
      private.current_platform_admin_role() in ('owner', 'operations')
      or (partner_id = private.current_partner_id() and private.current_partner_role() = 'partner_owner')
    )
  );

-- Accepting: the holder of the token marks it accepted for themselves.
create policy partner_invitations_accept on public.partner_invitations
  for update to app_runtime
  using (
    token_hash = current_setting('app.partner_invitation_token_hash', true)
    and status = 'pending'
  )
  with check (
    token_hash = current_setting('app.partner_invitation_token_hash', true)
    and status in ('accepted', 'expired')
    and (status = 'expired' or accepted_by = private.context_uuid('app.user_id'))
  );

-- Revoking: whoever may invite for that partner.
create policy partner_invitations_revoke on public.partner_invitations
  for update to app_runtime
  using (
    status = 'pending'
    and (
      private.current_platform_admin_role() in ('owner', 'operations')
      or (partner_id = private.current_partner_id() and private.current_partner_role() = 'partner_owner')
    )
  )
  with check (status = 'revoked');

grant select, insert, update on public.partner_invitations to app_runtime;

-- ----------------------------------------------------------------------------
-- 6. organizations: partner members read their partner's companies
-- ----------------------------------------------------------------------------
create policy organizations_partner_select on public.organizations
  for select to app_runtime
  using (
    partner_id = private.current_partner_id()
    and private.current_partner_role() is not null
  );

-- ----------------------------------------------------------------------------
-- 7. partner_brands: partner_owner and partner_admin edit their own brand
-- ----------------------------------------------------------------------------
drop policy partner_brands_insert on public.partner_brands;

create policy partner_brands_insert on public.partner_brands
  for insert to app_runtime
  with check (
    partner_id = private.current_partner_id()
    and created_by = private.context_uuid('app.user_id')
    and (
      private.current_platform_admin_role() in ('owner', 'operations')
      or private.current_partner_role() in ('partner_owner', 'partner_admin')
    )
  );
