-- ============================================================================
-- F5c — Lodging in the Portfolio (UCP lodging)
--
-- A lodging item (`item_type = 'lodging'`) is the listing of one property;
-- the property itself is a workspace location (UCP Property = Location).
-- Register only: booking (`create_booking_session`...) comes later.
--
-- 1. `public.portfolio_accommodation_types`: UCP AccommodationType (title,
--    description, capacity, media) plus the GUIDU extension (kind,
--    bedrooms, beds, bathrooms, amenities).
-- 2. `public.portfolio_rate_plans`: UCP RatePlan (title, description) with
--    the cancellation policy (`dev.ucp.lodging.policy.cancellation`) and the
--    GUIDU extension (board, free cancellation window).
-- 3. A lodging variant prices one accommodation type under one rate plan
--    (per night). Composite foreign keys keep both on the variant's item.
-- 4. Members read; owner, admin and editor write, signing the rows, and may
--    delete a type or plan that no variant uses. Workspace deletion (F3e)
--    purges all of it.
-- Owner app_migrations, ENABLE + FORCE RLS, no grants to anon/authenticated.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Accommodation types and rate plans
-- ----------------------------------------------------------------------------
create table public.portfolio_accommodation_types (
  id                 uuid primary key default gen_random_uuid(),
  organization_id    uuid not null,
  workspace_id       uuid not null,
  item_id            uuid not null,
  position           integer not null default 0 check (position between 0 and 1000),
  title              text not null check (length(btrim(title)) between 1 and 200),
  description        text check (description is null or length(description) <= 5000),
  capacity           jsonb not null default '{}'::jsonb
    check (jsonb_typeof(capacity) = 'object' and octet_length(capacity::text) <= 2000),
  media              jsonb not null default '[]'::jsonb
    check (jsonb_typeof(media) = 'array' and octet_length(media::text) <= 20000),
  accommodation_kind text check (accommodation_kind is null or accommodation_kind in (
    'entire_home', 'private_room', 'shared_room', 'hotel_room', 'suite', 'chalet', 'campsite'
  )),
  bedrooms           integer check (bedrooms is null or bedrooms between 0 and 100),
  beds_count         integer check (beds_count is null or beds_count between 0 and 200),
  bathrooms          integer check (bathrooms is null or bathrooms between 0 and 100),
  amenities          text[] not null default '{}' check (cardinality(amenities) <= 50),
  created_by         uuid not null references public.profiles(id) on delete cascade,
  updated_by         uuid references public.profiles(id) on delete set null,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  constraint portfolio_accommodation_types_id_item unique (id, item_id),
  constraint fk_portfolio_accommodation_types_item
    foreign key (item_id, workspace_id)
    references public.portfolio_items(id, workspace_id) on delete cascade,
  constraint fk_portfolio_accommodation_types_workspace
    foreign key (workspace_id, organization_id)
    references public.workspaces(id, organization_id) on delete cascade
);

create index portfolio_accommodation_types_item_idx
  on public.portfolio_accommodation_types (item_id, position, created_at);

create table public.portfolio_rate_plans (
  id                      uuid primary key default gen_random_uuid(),
  organization_id         uuid not null,
  workspace_id            uuid not null,
  item_id                 uuid not null,
  position                integer not null default 0 check (position between 0 and 1000),
  title                   text not null check (length(btrim(title)) between 1 and 200),
  description             text check (description is null or length(description) <= 5000),
  refundability           text not null default 'refundable'
    check (refundability in ('refundable', 'partially_refundable', 'non_refundable')),
  cancellation_policy     text check (cancellation_policy is null or length(cancellation_policy) between 1 and 2000),
  free_cancellation_hours integer
    check (free_cancellation_hours is null or free_cancellation_hours between 0 and 8760),
  board                   text not null default 'room_only'
    check (board in ('room_only', 'breakfast', 'half_board', 'full_board', 'all_inclusive')),
  created_by              uuid not null references public.profiles(id) on delete cascade,
  updated_by              uuid references public.profiles(id) on delete set null,
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now(),
  constraint portfolio_rate_plans_id_item unique (id, item_id),
  constraint fk_portfolio_rate_plans_item
    foreign key (item_id, workspace_id)
    references public.portfolio_items(id, workspace_id) on delete cascade,
  constraint fk_portfolio_rate_plans_workspace
    foreign key (workspace_id, organization_id)
    references public.workspaces(id, organization_id) on delete cascade
);

create index portfolio_rate_plans_item_idx
  on public.portfolio_rate_plans (item_id, position, created_at);

do $$
declare
  t text;
begin
  foreach t in array array['portfolio_accommodation_types', 'portfolio_rate_plans'] loop
    execute format('alter table public.%I owner to app_migrations', t);
    execute format('revoke all on public.%I from public, anon, authenticated', t);
    execute format('alter table public.%I enable row level security', t);
    execute format('alter table public.%I force row level security', t);
    execute format(
      'create trigger %I before update on public.%I for each row execute function private.touch_updated_at()',
      t || '_touch_updated_at', t
    );
    execute format(
      'create trigger %I before update on public.%I for each row execute function private.workspace_rows_guard_update()',
      t || '_guard_update', t
    );
  end loop;
end
$$;

-- Accommodation types and rate plans belong to one lodging item for good.
create function private.portfolio_lodging_guard_item()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' then
    if new.item_id is distinct from old.item_id then
      raise exception '%: the item is immutable', tg_table_name
        using errcode = 'check_violation';
    end if;
    return new;
  end if;
  if not exists (
    select 1 from public.portfolio_items i
    where i.id = new.item_id and i.workspace_id = new.workspace_id
      and i.item_type = 'lodging'
  ) then
    raise exception '%: only lodging items have accommodation types and rate plans', tg_table_name
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

alter function private.portfolio_lodging_guard_item() owner to app_migrations;
revoke execute on function private.portfolio_lodging_guard_item() from public, anon, authenticated;

create trigger portfolio_accommodation_types_guard_item
  before insert or update on public.portfolio_accommodation_types
  for each row execute function private.portfolio_lodging_guard_item();
create trigger portfolio_rate_plans_guard_item
  before insert or update on public.portfolio_rate_plans
  for each row execute function private.portfolio_lodging_guard_item();

-- ----------------------------------------------------------------------------
-- 2. A lodging variant = accommodation type x rate plan of the same item
-- ----------------------------------------------------------------------------
alter table public.portfolio_variants
  add column accommodation_type_id uuid,
  add column rate_plan_id uuid,
  add constraint fk_portfolio_variants_accommodation_type
    foreign key (accommodation_type_id, item_id)
    references public.portfolio_accommodation_types(id, item_id),
  add constraint fk_portfolio_variants_rate_plan
    foreign key (rate_plan_id, item_id)
    references public.portfolio_rate_plans(id, item_id);

create index portfolio_variants_accommodation_type_idx
  on public.portfolio_variants (accommodation_type_id) where accommodation_type_id is not null;
create index portfolio_variants_rate_plan_idx
  on public.portfolio_variants (rate_plan_id) where rate_plan_id is not null;

-- ----------------------------------------------------------------------------
-- 3. Policies: members read; writers sign their rows
-- ----------------------------------------------------------------------------
do $$
declare
  t text;
begin
  foreach t in array array['portfolio_accommodation_types', 'portfolio_rate_plans'] loop
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
    execute format($p$
      create policy %I on public.%I for delete to app_runtime
      using (
        workspace_id = private.context_uuid('app.workspace_id')
        and organization_id = private.context_uuid('app.organization_id')
        and private.current_workspace_role() in ('owner', 'admin', 'editor')
      )$p$, t || '_delete', t);
    execute format('grant select, insert, update, delete on public.%I to app_runtime', t);

    -- Purge of a deleted workspace (F3e).
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
