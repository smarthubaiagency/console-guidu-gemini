-- ============================================================================
-- Migration: 20261022090000_f5a_portfolio.sql
-- Module: F5a — Portfolio module (formerly Catalog) and workspace locations
--
-- Maintenance Rationale:
-- 1. The module key `catalog` becomes `portfolio` (decision of 11/10/2026).
--    The catalog was a "coming soon" placeholder without data; the rows
--    that name it (workspace and platform state, partner offer, templates,
--    plan versions) are renamed so nothing stays pointing to the old key.
-- 2. `public.workspace_locations` (core): the stores and properties of the
--    business in the shape of the UCP Location (name, postal address,
--    coordinates, weekly hours, exceptions, time zone, amenities). Used by
--    the Portfolio, Google Business and the AI agent. Members read; owner
--    and admin manage. No delete: a location is deactivated.
-- 3. `public.portfolio_items`: items of the Portfolio (single table, with
--    `item_type` and `vertical` as discriminators). UCP product fields in
--    columns, internal management and AI governance in their own columns
--    (never exposed through UCP) and the vertical extension in `details`.
-- 4. `public.portfolio_variants`: every item has at least one variant
--    (UCP), which holds price (integer minor units), SKU, barcodes, sale
--    basis, availability and the internal stock.
-- 5. Members read; owner, admin and editor write, signing the rows. Items
--    are archived, not deleted; a variant can be deleted (the services keep
--    at least one per item). Workspace deletion (F3e) purges all of it.
-- Owner app_migrations, ENABLE + FORCE RLS, no grants to anon/authenticated.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. catalog -> portfolio
-- ----------------------------------------------------------------------------
alter table public.workspace_modules no force row level security;
update public.workspace_modules set module_key = 'portfolio' where module_key = 'catalog';
alter table public.workspace_modules force row level security;

alter table public.platform_modules no force row level security;
update public.platform_modules set module_key = 'portfolio' where module_key = 'catalog';
alter table public.platform_modules force row level security;

alter table public.partner_offered_modules no force row level security;
update public.partner_offered_modules set module_key = 'portfolio' where module_key = 'catalog';
alter table public.partner_offered_modules force row level security;

alter table public.partner_workspace_templates no force row level security;
update public.partner_workspace_templates
set module_keys = array_replace(module_keys, 'catalog', 'portfolio')
where 'catalog' = any(module_keys);
alter table public.partner_workspace_templates force row level security;

alter table public.plan_versions no force row level security;
update public.plan_versions
set module_keys = array_replace(module_keys, 'catalog', 'portfolio')
where 'catalog' = any(module_keys);
alter table public.plan_versions force row level security;

-- ----------------------------------------------------------------------------
-- 2. Workspace locations (core)
-- ----------------------------------------------------------------------------
create table public.workspace_locations (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  workspace_id    uuid not null,
  name            text not null check (length(btrim(name)) between 1 and 120),
  address         jsonb not null default '{}'::jsonb
    check (jsonb_typeof(address) = 'object' and octet_length(address::text) <= 2000),
  latitude        numeric(9, 6) check (latitude is null or latitude between -90 and 90),
  longitude       numeric(9, 6) check (longitude is null or longitude between -180 and 180),
  timezone        text not null default 'America/Sao_Paulo'
    check (length(timezone) between 1 and 64),
  hours           jsonb not null default '[]'::jsonb
    check (jsonb_typeof(hours) = 'array' and octet_length(hours::text) <= 4000),
  exception_hours jsonb not null default '[]'::jsonb
    check (jsonb_typeof(exception_hours) = 'array' and octet_length(exception_hours::text) <= 8000),
  amenities       jsonb not null default '{}'::jsonb
    check (jsonb_typeof(amenities) = 'object' and octet_length(amenities::text) <= 4000),
  status          text not null default 'active' check (status in ('active', 'inactive')),
  created_by      uuid not null references public.profiles(id) on delete cascade,
  updated_by      uuid references public.profiles(id) on delete set null,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  check ((latitude is null) = (longitude is null)),
  constraint workspace_locations_id_workspace unique (id, workspace_id),
  constraint fk_workspace_locations_workspace
    foreign key (workspace_id, organization_id)
    references public.workspaces(id, organization_id) on delete cascade
);

create index workspace_locations_workspace_idx
  on public.workspace_locations (workspace_id, status, name);

alter table public.workspace_locations owner to app_migrations;
revoke all on public.workspace_locations from public, anon, authenticated;
alter table public.workspace_locations enable row level security;
alter table public.workspace_locations force row level security;

create trigger workspace_locations_touch_updated_at
  before update on public.workspace_locations
  for each row execute function private.touch_updated_at();

-- ----------------------------------------------------------------------------
-- 3. Portfolio items and variants
-- ----------------------------------------------------------------------------
create table public.portfolio_items (
  id                   uuid primary key default gen_random_uuid(),
  organization_id      uuid not null,
  workspace_id         uuid not null,
  item_type            text not null
    check (item_type in ('product', 'service', 'real_estate', 'lodging', 'event')),
  vertical             text not null default 'general'
    check (vertical ~ '^[a-z][a-z0-9_]{0,47}$'),
  title                text not null check (length(btrim(title)) between 1 and 200),
  handle               text not null
    check (length(handle) between 1 and 200 and handle ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  description          jsonb not null default '{}'::jsonb
    check (jsonb_typeof(description) = 'object' and octet_length(description::text) <= 30000),
  categories           jsonb not null default '[]'::jsonb
    check (jsonb_typeof(categories) = 'array' and octet_length(categories::text) <= 4000),
  media                jsonb not null default '[]'::jsonb
    check (jsonb_typeof(media) = 'array' and octet_length(media::text) <= 20000),
  tags                 text[] not null default '{}' check (cardinality(tags) <= 20),
  url                  text check (url is null or length(url) <= 2000),
  rating               jsonb check (rating is null or jsonb_typeof(rating) = 'object'),
  fulfillment_methods  text[] not null default '{}'
    check (fulfillment_methods <@ array['shipping', 'pickup', 'digital', 'on_site']::text[]),
  location_ids         uuid[] not null default '{}' check (cardinality(location_ids) <= 50),
  policies             jsonb not null default '[]'::jsonb
    check (jsonb_typeof(policies) = 'array' and octet_length(policies::text) <= 20000),
  links                jsonb not null default '[]'::jsonb
    check (jsonb_typeof(links) = 'array' and octet_length(links::text) <= 4000),
  price_display        text not null default 'price'
    check (price_display in ('price', 'from', 'quote')),
  details              jsonb not null default '{}'::jsonb
    check (jsonb_typeof(details) = 'object' and octet_length(details::text) <= 30000),
  -- Internal management (never exposed through UCP).
  status               text not null default 'draft'
    check (status in ('draft', 'active', 'inactive', 'archived')),
  visibility           text not null default 'public' check (visibility in ('public', 'internal')),
  priority             integer not null default 0 check (priority between -1000 and 1000),
  is_featured          boolean not null default false,
  featured_rank        integer not null default 0 check (featured_rank between 0 and 1000),
  availability_mode    text not null default 'always'
    check (availability_mode in ('always', 'schedule', 'stock', 'calendar', 'seasonal')),
  -- AI governance (never exposed through UCP).
  ai_discovery_enabled boolean not null default true,
  ai_keywords          text[] not null default '{}' check (cardinality(ai_keywords) <= 50),
  ai_aliases           text[] not null default '{}' check (cardinality(ai_aliases) <= 30),
  ai_do_not_say        text[] not null default '{}' check (cardinality(ai_do_not_say) <= 30),
  ai_safety_rules      text check (ai_safety_rules is null or length(ai_safety_rules) <= 2000),
  created_by           uuid not null references public.profiles(id) on delete cascade,
  updated_by           uuid references public.profiles(id) on delete set null,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  constraint portfolio_items_handle unique (workspace_id, handle),
  constraint portfolio_items_id_workspace unique (id, workspace_id),
  constraint fk_portfolio_items_workspace
    foreign key (workspace_id, organization_id)
    references public.workspaces(id, organization_id) on delete cascade
);

create index portfolio_items_workspace_idx
  on public.portfolio_items (workspace_id, created_at desc, id desc);
create index portfolio_items_status_idx
  on public.portfolio_items (workspace_id, status, item_type);

create table public.portfolio_variants (
  id                  uuid primary key default gen_random_uuid(),
  organization_id     uuid not null,
  workspace_id        uuid not null,
  item_id             uuid not null,
  position            integer not null default 0 check (position between 0 and 1000),
  title               text not null check (length(btrim(title)) between 1 and 200),
  sku                 text check (sku is null or length(sku) between 1 and 64),
  barcodes            jsonb not null default '[]'::jsonb
    check (jsonb_typeof(barcodes) = 'array' and octet_length(barcodes::text) <= 2000),
  price_amount        bigint check (price_amount is null or price_amount between 0 and 100000000000),
  list_price_amount   bigint check (list_price_amount is null or list_price_amount between 0 and 100000000000),
  currency            text not null default 'BRL' check (currency ~ '^[A-Z]{3}$'),
  quantity_unit       jsonb check (quantity_unit is null or jsonb_typeof(quantity_unit) = 'object'),
  unit_price          jsonb check (unit_price is null or jsonb_typeof(unit_price) = 'object'),
  options             jsonb not null default '[]'::jsonb
    check (jsonb_typeof(options) = 'array' and octet_length(options::text) <= 2000),
  media               jsonb not null default '[]'::jsonb
    check (jsonb_typeof(media) = 'array' and octet_length(media::text) <= 20000),
  availability_status text not null default 'in_stock'
    check (availability_status in ('in_stock', 'backorder', 'preorder', 'out_of_stock', 'discontinued')),
  -- Internal stock (never exposed; it feeds the UCP availability).
  track_inventory     boolean not null default false,
  stock_quantity      integer check (stock_quantity is null or stock_quantity between -1000000 and 100000000),
  min_stock_alert     integer check (min_stock_alert is null or min_stock_alert between 0 and 100000000),
  allow_backorder     boolean not null default false,
  created_by          uuid not null references public.profiles(id) on delete cascade,
  updated_by          uuid references public.profiles(id) on delete set null,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  check (list_price_amount is null or price_amount is null or list_price_amount >= price_amount),
  constraint fk_portfolio_variants_item
    foreign key (item_id, workspace_id)
    references public.portfolio_items(id, workspace_id) on delete cascade,
  constraint fk_portfolio_variants_workspace
    foreign key (workspace_id, organization_id)
    references public.workspaces(id, organization_id) on delete cascade
);

create index portfolio_variants_item_idx on public.portfolio_variants (item_id, position, created_at);
create unique index portfolio_variants_sku on public.portfolio_variants (workspace_id, sku)
  where sku is not null;

do $$
declare
  t text;
begin
  foreach t in array array['portfolio_items', 'portfolio_variants'] loop
    execute format('alter table public.%I owner to app_migrations', t);
    execute format('revoke all on public.%I from public, anon, authenticated', t);
    execute format('alter table public.%I enable row level security', t);
    execute format('alter table public.%I force row level security', t);
    execute format(
      'create trigger %I before update on public.%I for each row execute function private.touch_updated_at()',
      t || '_touch_updated_at', t
    );
  end loop;
end
$$;

-- Workspace, organization, author and creation time never change.
create function private.workspace_rows_guard_update()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if new.id is distinct from old.id
     or new.workspace_id is distinct from old.workspace_id
     or new.organization_id is distinct from old.organization_id
     or new.created_by is distinct from old.created_by
     or new.created_at is distinct from old.created_at then
    raise exception '%: workspace, author and creation time are immutable', tg_table_name
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

alter function private.workspace_rows_guard_update() owner to app_migrations;
revoke execute on function private.workspace_rows_guard_update() from public, anon, authenticated;

create trigger workspace_locations_guard_update
  before update on public.workspace_locations
  for each row execute function private.workspace_rows_guard_update();
create trigger portfolio_items_guard_update
  before update on public.portfolio_items
  for each row execute function private.workspace_rows_guard_update();
create trigger portfolio_variants_guard_update
  before update on public.portfolio_variants
  for each row execute function private.workspace_rows_guard_update();

-- A variant stays with its item.
create function private.portfolio_variants_guard_item()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if new.item_id is distinct from old.item_id then
    raise exception 'portfolio variants: the item of a variant is immutable'
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

alter function private.portfolio_variants_guard_item() owner to app_migrations;
revoke execute on function private.portfolio_variants_guard_item() from public, anon, authenticated;

create trigger portfolio_variants_guard_item
  before update on public.portfolio_variants
  for each row execute function private.portfolio_variants_guard_item();

-- ----------------------------------------------------------------------------
-- 4. Policies: members read; writers sign their rows
-- ----------------------------------------------------------------------------
-- Locations: owner and admin manage.
create policy workspace_locations_select on public.workspace_locations
  for select to app_runtime
  using (
    workspace_id = private.context_uuid('app.workspace_id')
    and organization_id = private.context_uuid('app.organization_id')
    and private.is_workspace_member(workspace_id, organization_id)
  );

create policy workspace_locations_insert on public.workspace_locations
  for insert to app_runtime
  with check (
    workspace_id = private.context_uuid('app.workspace_id')
    and organization_id = private.context_uuid('app.organization_id')
    and created_by = private.context_uuid('app.user_id')
    and updated_by is null
    and private.current_workspace_role() in ('owner', 'admin')
  );

create policy workspace_locations_update on public.workspace_locations
  for update to app_runtime
  using (
    workspace_id = private.context_uuid('app.workspace_id')
    and organization_id = private.context_uuid('app.organization_id')
    and private.current_workspace_role() in ('owner', 'admin')
  )
  with check (
    workspace_id = private.context_uuid('app.workspace_id')
    and organization_id = private.context_uuid('app.organization_id')
    and updated_by = private.context_uuid('app.user_id')
    and private.current_workspace_role() in ('owner', 'admin')
  );

grant select, insert, update on public.workspace_locations to app_runtime;

-- Items and variants: owner, admin and editor write.
do $$
declare
  t text;
begin
  foreach t in array array['portfolio_items', 'portfolio_variants'] loop
    execute format($p$
      create policy %I on public.%I for select to app_runtime
      using (
        workspace_id = private.context_uuid('app.workspace_id')
        and organization_id = private.context_uuid('app.organization_id')
        and private.is_workspace_member(workspace_id, organization_id)
      )$p$, t || '_select', t);
    execute format($p$
      create policy %I on public.%I for insert to app_runtime
      with check (
        workspace_id = private.context_uuid('app.workspace_id')
        and organization_id = private.context_uuid('app.organization_id')
        and created_by = private.context_uuid('app.user_id')
        and updated_by is null
        and private.current_workspace_role() in ('owner', 'admin', 'editor')
      )$p$, t || '_insert', t);
    execute format($p$
      create policy %I on public.%I for update to app_runtime
      using (
        workspace_id = private.context_uuid('app.workspace_id')
        and organization_id = private.context_uuid('app.organization_id')
        and private.current_workspace_role() in ('owner', 'admin', 'editor')
      )
      with check (
        workspace_id = private.context_uuid('app.workspace_id')
        and organization_id = private.context_uuid('app.organization_id')
        and updated_by = private.context_uuid('app.user_id')
        and private.current_workspace_role() in ('owner', 'admin', 'editor')
      )$p$, t || '_update', t);
  end loop;
end
$$;

-- Removing a variant (the services keep at least one per item).
create policy portfolio_variants_delete on public.portfolio_variants
  for delete to app_runtime
  using (
    workspace_id = private.context_uuid('app.workspace_id')
    and organization_id = private.context_uuid('app.organization_id')
    and private.current_workspace_role() in ('owner', 'admin', 'editor')
  );

grant select, insert, update on public.portfolio_items to app_runtime;
grant select, insert, update, delete on public.portfolio_variants to app_runtime;

-- ----------------------------------------------------------------------------
-- 5. Purge of a deleted workspace (F3e)
-- ----------------------------------------------------------------------------
do $$
declare
  t text;
begin
  foreach t in array array['workspace_locations', 'portfolio_items', 'portfolio_variants'] loop
    execute format(
      'create policy %I on public.%I for delete to app_worker using (private.workspace_purgeable(workspace_id))',
      t || '_worker_purge', t
    );
    execute format(
      'create policy %I on public.%I for select to app_worker using (private.workspace_purgeable(workspace_id))',
      t || '_worker_purge_select', t
    );
    execute format('grant select (workspace_id), delete on public.%I to app_worker', t);
  end loop;
end
$$;
