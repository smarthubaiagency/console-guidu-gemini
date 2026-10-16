-- ============================================================================
-- Migration: 20261124090000_gb1b_maps_intelligence.sql
-- Module: GB1b — Saúde no Maps do agente GMN
--         (docs/modules/google-business/especificacao.md §6.2, §7 e §12;
--          contrato com a GB1a em docs/modules/google-business/contrato-analises.md)
--
-- Maintenance Rationale:
-- 1. The maps data of a unit hangs on `public.workspace_locations` (the
--    unit), not on the GB1a `gb_locations` table, so this step does not
--    depend on the GB1a migration (analyses contract).
-- 2. `public.gb_maps_keywords`: keywords monitored on the map, chosen by the
--    agent from the category (`source = 'agent'`) or by whoever operates
--    (`'user'`). Paused keywords stay for the history and do not count in
--    the plan quota. The keyword text is immutable (a new one is a new row).
-- 3. `public.gb_maps_competitors`: reference competitors of the unit, by
--    Google `place_id` only (the Google Maps Platform terms allow keeping the
--    place id indefinitely; names and ratings live only in the measurements,
--    which come from DataForSEO, never copied from Places).
-- 4. `public.gb_maps_scans`: one measurement of the map of a unit (grid,
--    radius, health score 0-100 with its breakdown, review statistics,
--    provider, API calls and estimated cost). The first one is the starting
--    point (`is_baseline`, one per unit) and does not consume the monthly
--    quota. Append-only: no update, no delete.
-- 5. `public.gb_maps_scan_results`: the result of one keyword in a
--    measurement (positions per grid point, SoLV, average position, top
--    competitors in the radius, neighbourhood vocabulary). No coordinates are
--    stored: the grid is rebuilt from size and radius when needed, and the
--    centre comes from the unit, so no latitude or longitude from Google
--    outlives the request (30-day rule of the terms).
-- 6. Members of the workspace read; owner and admin write, signing the rows
--    (same rule as the units). The onboarding runs the analyses with the
--    context of whoever started it (GB1a).
-- 7. Workspace deletion (F3e) purges all of it through the module data
--    contract (app_worker, `private.workspace_purgeable`).
-- Owner app_migrations, ENABLE + FORCE RLS, no grants to anon/authenticated.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Tables
-- ----------------------------------------------------------------------------
create table public.gb_maps_keywords (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  workspace_id    uuid not null,
  location_id     uuid not null,
  keyword         text not null check (length(btrim(keyword)) between 2 and 80),
  normalized      text generated always as (lower(btrim(keyword))) stored,
  source          text not null check (source in ('agent', 'user')),
  status          text not null default 'active' check (status in ('active', 'paused')),
  created_by      uuid not null references public.profiles(id) on delete cascade,
  updated_by      uuid references public.profiles(id) on delete set null,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  constraint gb_maps_keywords_id_workspace unique (id, workspace_id),
  constraint gb_maps_keywords_unique unique (location_id, normalized),
  constraint fk_gb_maps_keywords_location
    foreign key (location_id, workspace_id)
    references public.workspace_locations(id, workspace_id) on delete cascade,
  constraint fk_gb_maps_keywords_workspace
    foreign key (workspace_id, organization_id)
    references public.workspaces(id, organization_id) on delete cascade
);

create index gb_maps_keywords_location_idx
  on public.gb_maps_keywords (workspace_id, location_id, status, created_at);

create table public.gb_maps_competitors (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  workspace_id    uuid not null,
  location_id     uuid not null,
  place_id        text not null
    check (length(place_id) between 3 and 300 and place_id ~ '^[A-Za-z0-9_:-]+$'),
  source          text not null check (source in ('agent', 'user')),
  status          text not null default 'active' check (status in ('active', 'removed')),
  created_by      uuid not null references public.profiles(id) on delete cascade,
  updated_by      uuid references public.profiles(id) on delete set null,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  constraint gb_maps_competitors_unique unique (location_id, place_id),
  constraint fk_gb_maps_competitors_location
    foreign key (location_id, workspace_id)
    references public.workspace_locations(id, workspace_id) on delete cascade,
  constraint fk_gb_maps_competitors_workspace
    foreign key (workspace_id, organization_id)
    references public.workspaces(id, organization_id) on delete cascade
);

create index gb_maps_competitors_location_idx
  on public.gb_maps_competitors (workspace_id, location_id, status);

create table public.gb_maps_scans (
  id                   uuid primary key default gen_random_uuid(),
  organization_id      uuid not null,
  workspace_id         uuid not null,
  location_id          uuid not null,
  is_baseline          boolean not null default false,
  grid_size            smallint not null
    check (grid_size between 3 and 13 and grid_size % 2 = 1),
  radius_m             integer not null check (radius_m between 500 and 50000),
  keyword_count        smallint not null check (keyword_count between 1 and 20),
  score                smallint check (score is null or score between 0 and 100),
  score_breakdown      jsonb not null default '[]'::jsonb
    check (jsonb_typeof(score_breakdown) = 'array' and octet_length(score_breakdown::text) <= 8000),
  review_stats         jsonb not null default '{}'::jsonb
    check (jsonb_typeof(review_stats) = 'object' and octet_length(review_stats::text) <= 8000),
  provider             text not null check (provider in ('dataforseo', 'fake')),
  api_calls            integer not null default 0 check (api_calls between 0 and 100000),
  cost_estimate_micros bigint not null default 0 check (cost_estimate_micros between 0 and 1000000000),
  created_by           uuid not null references public.profiles(id) on delete cascade,
  created_at           timestamptz not null default now(),
  constraint gb_maps_scans_id_workspace unique (id, workspace_id),
  constraint fk_gb_maps_scans_location
    foreign key (location_id, workspace_id)
    references public.workspace_locations(id, workspace_id) on delete cascade,
  constraint fk_gb_maps_scans_workspace
    foreign key (workspace_id, organization_id)
    references public.workspaces(id, organization_id) on delete cascade
);

create index gb_maps_scans_location_idx
  on public.gb_maps_scans (workspace_id, location_id, created_at desc);
-- One starting point per unit.
create unique index gb_maps_scans_baseline
  on public.gb_maps_scans (location_id) where is_baseline;

create table public.gb_maps_scan_results (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  workspace_id    uuid not null,
  scan_id         uuid not null,
  keyword_id      uuid not null,
  keyword         text not null check (length(btrim(keyword)) between 2 and 80),
  ranks           jsonb not null
    check (jsonb_typeof(ranks) = 'array' and octet_length(ranks::text) <= 4000),
  solv            numeric(5, 2) not null check (solv between 0 and 100),
  average_rank    numeric(5, 2) check (average_rank is null or average_rank >= 1),
  found_points    smallint not null check (found_points >= 0),
  total_points    smallint not null check (total_points between 9 and 169 and found_points <= total_points),
  competitors     jsonb not null default '[]'::jsonb
    check (jsonb_typeof(competitors) = 'array' and octet_length(competitors::text) <= 40000),
  neighborhoods   jsonb not null default '[]'::jsonb
    check (jsonb_typeof(neighborhoods) = 'array' and octet_length(neighborhoods::text) <= 4000),
  created_at      timestamptz not null default now(),
  constraint gb_maps_scan_results_unique unique (scan_id, keyword_id),
  constraint fk_gb_maps_scan_results_scan
    foreign key (scan_id, workspace_id)
    references public.gb_maps_scans(id, workspace_id) on delete cascade,
  constraint fk_gb_maps_scan_results_keyword
    foreign key (keyword_id, workspace_id)
    references public.gb_maps_keywords(id, workspace_id) on delete cascade,
  constraint fk_gb_maps_scan_results_workspace
    foreign key (workspace_id, organization_id)
    references public.workspaces(id, organization_id) on delete cascade
);

create index gb_maps_scan_results_scan_idx
  on public.gb_maps_scan_results (workspace_id, scan_id);

do $$
declare
  t text;
begin
  foreach t in array array['gb_maps_keywords', 'gb_maps_competitors', 'gb_maps_scans', 'gb_maps_scan_results'] loop
    execute format('alter table public.%I owner to app_migrations', t);
    execute format('revoke all on public.%I from public, anon, authenticated', t);
    execute format('alter table public.%I enable row level security', t);
    execute format('alter table public.%I force row level security', t);
  end loop;
  foreach t in array array['gb_maps_keywords', 'gb_maps_competitors'] loop
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

-- The unit, the keyword and the place of a row never change.
create function private.gb_maps_guard_identity()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if new.location_id is distinct from old.location_id then
    raise exception '%: the unit of a row is immutable', tg_table_name
      using errcode = 'check_violation';
  end if;
  -- Nested: a record field is resolved only on the table that has it.
  if tg_table_name = 'gb_maps_keywords' then
    if new.keyword is distinct from old.keyword then
      raise exception 'gb_maps_keywords: the keyword text is immutable'
        using errcode = 'check_violation';
    end if;
  elsif tg_table_name = 'gb_maps_competitors' then
    if new.place_id is distinct from old.place_id then
      raise exception 'gb_maps_competitors: the place id is immutable'
        using errcode = 'check_violation';
    end if;
  end if;
  return new;
end;
$$;

alter function private.gb_maps_guard_identity() owner to app_migrations;
revoke execute on function private.gb_maps_guard_identity() from public, anon, authenticated;

create trigger gb_maps_keywords_guard_identity
  before update on public.gb_maps_keywords
  for each row execute function private.gb_maps_guard_identity();
create trigger gb_maps_competitors_guard_identity
  before update on public.gb_maps_competitors
  for each row execute function private.gb_maps_guard_identity();

-- ----------------------------------------------------------------------------
-- 2. Policies: members (or the managing partner, ADR 0020) read; owner and
-- admin (or the managing partner) write, signing the rows
-- ----------------------------------------------------------------------------
do $$
declare
  t text;
begin
  foreach t in array array['gb_maps_keywords', 'gb_maps_competitors', 'gb_maps_scans', 'gb_maps_scan_results'] loop
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
  end loop;

  foreach t in array array['gb_maps_keywords', 'gb_maps_competitors'] loop
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
    execute format('grant select, insert, update on public.%I to app_runtime', t);
  end loop;
end
$$;

create policy gb_maps_scans_insert on public.gb_maps_scans
  for insert to app_runtime
  with check (
    workspace_id = private.context_uuid('app.workspace_id')
    and organization_id = private.context_uuid('app.organization_id')
    and created_by = private.context_uuid('app.user_id')
    and (
          private.current_workspace_role() in ('owner', 'admin')
          or private.partner_manages_organization(organization_id)
        )
  );

create policy gb_maps_scan_results_insert on public.gb_maps_scan_results
  for insert to app_runtime
  with check (
    workspace_id = private.context_uuid('app.workspace_id')
    and organization_id = private.context_uuid('app.organization_id')
    and (
          private.current_workspace_role() in ('owner', 'admin')
          or private.partner_manages_organization(organization_id)
        )
  );

grant select, insert on public.gb_maps_scans, public.gb_maps_scan_results to app_runtime;

-- ----------------------------------------------------------------------------
-- 3. Purge of a deleted workspace (F3e)
-- ----------------------------------------------------------------------------
do $$
declare
  t text;
begin
  foreach t in array array['gb_maps_scan_results', 'gb_maps_scans', 'gb_maps_competitors', 'gb_maps_keywords'] loop
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
