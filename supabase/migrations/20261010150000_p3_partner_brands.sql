-- ============================================================================
-- Migration: 20261010150000_p3_partner_brands.sql
-- Module: P3 — Partner brand by host (ADR 0012, plano P3)
--
-- Maintenance Rationale:
-- 1. `public.partner_brands`: versioned brand of a partner (display name,
--    primary color, support contacts and logo). Rows are insert-only: every
--    change creates the next version and the highest version is the active
--    brand. A partner without rows uses the environment brand (ADR 0004).
-- 2. The logo is stored in the row (PNG, JPEG or WebP, at most 256 KiB), so
--    the brand works without a storage service. SVG is not accepted. The
--    application validates the real file type; the checks below repeat the
--    size and type limits.
-- 3. RLS: app_runtime reads the brand of the context partner only (brands
--    are public information of that host) and inserts new versions only as
--    an active platform admin with the owner or operations role, for the
--    context partner. No update or delete grants: history is kept.
-- Owner app_migrations, ENABLE + FORCE RLS, no grants to anon/authenticated.
-- ============================================================================

create table public.partner_brands (
  id            uuid primary key default gen_random_uuid(),
  partner_id    uuid not null references public.partners(id) on delete cascade,
  version       integer not null check (version > 0),
  display_name  text not null
                  check (length(trim(display_name)) > 0 and length(display_name) <= 60),
  primary_color text check (primary_color ~ '^#[0-9a-f]{6}$'),
  support_email text check (
                  support_email is null
                  or (length(support_email) <= 254 and support_email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$')
                ),
  support_url   text check (
                  support_url is null
                  or (length(support_url) <= 2048 and support_url ~ '^https://')
                ),
  logo          bytea check (logo is null or octet_length(logo) between 1 and 262144),
  logo_mime     text check (logo_mime in ('image/png', 'image/jpeg', 'image/webp')),
  created_by    uuid references public.profiles(id) on delete set null,
  created_at    timestamptz not null default now(),
  unique (partner_id, version),
  check ((logo is null) = (logo_mime is null))
);

alter table public.partner_brands owner to app_migrations;
alter table public.partner_brands enable row level security;
alter table public.partner_brands force row level security;

create policy partner_brands_select on public.partner_brands
  for select to app_runtime
  using (partner_id = private.current_partner_id());

create policy partner_brands_insert on public.partner_brands
  for insert to app_runtime
  with check (
    partner_id = private.current_partner_id()
    and private.current_platform_admin_role() in ('owner', 'operations')
    and created_by = private.context_uuid('app.user_id')
  );

revoke all on public.partner_brands from public, anon, authenticated;
grant select, insert on public.partner_brands to app_runtime;
