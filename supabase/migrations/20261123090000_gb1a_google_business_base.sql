-- ============================================================================
-- Migration: 20261123090000_gb1a_google_business_base.sql
-- Module: GB1a — Google Meu Negócio: onboarding "Adicionar local" and the
--         automation page (docs/modules/google-business/especificacao.md,
--         sections 3, 7 and 17; ADRs 0019 and 0020)
--
-- Maintenance Rationale:
-- 1. `public.organization_service_modes` (ADR 0020, minimum): the service
--    mode of a company (`padrao` or `gerenciado`) and the partner that
--    manages it. No row means `padrao` (whoever signs up alone). The
--    partner's owner and admin write it when they register the customer;
--    the company's members and the partner's members read it. The request
--    by secure link and the way back to `padrao` come in a later stage.
-- 2. `private.partner_manages_organization(org)`: the single helper of
--    ADR 0020. True when the person of the context is an active
--    `partner_owner`, `partner_admin` or `partner_support` of the context
--    partner, the company belongs to that partner and its mode is
--    `gerenciado` with that partner. Used by every policy this stage
--    touches (`workspace_locations`, the `gb_*` tables, the workspaces and
--    the job runs of the module); the other modules join in later.
-- 3. `public.workspace_locations`: the managing partner reads, creates and
--    changes the units of a managed company, in the context of its
--    workspace (the onboarding creates the unit from the ficha).
-- 4. `public.gb_locations`: a Google ficha linked to a unit (one ficha per
--    unit): provider, external id, `place_id`, connection and onboarding
--    state, and the first review of the automation page (`reviewed_at`),
--    which lifts the "suggest only" lock.
-- 5. `public.gb_snapshots`: versions of the ficha (append only). The
--    `initial` one is written by the onboarding and is the base of the
--    defense; it keeps the public review data read with it.
-- 6. `public.gb_analysis_runs`: one row per analysis of the registry and
--    ficha (the `AnalysisResult` of the contract, GB1a and GB1b), with its
--    phase and state.
-- 7. `public.gb_area_settings`: the ficha level of the agent settings
--    (switch and autonomy per area) and the approval of each area on the
--    automation page. The levels above live in `settings` (ADR 0018).
-- 8. `public.job_runs`: the managing partner queues and reads the module's
--    background analyses (`google-business.*`) of a managed workspace.
-- 9. `private.post_google_business_notice(...)`: the bell notice "análises
--    concluídas" that the background job (running as app_runtime in the
--    worker) posts to the person who started the onboarding, only to the
--    person of the context and only with this event (I5 flag pattern).
-- 10. Purge of a deleted workspace (F3e) as the worker.
-- Readers of the module data: members of the workspace and the managing
-- partner; writers: owner and admin of the workspace and the managing
-- partner. Owner app_migrations, ENABLE + FORCE RLS, no grants to
-- anon/authenticated. Functions owned by app_rls_helper get their grants
-- before the ownership transfer (app_migrations is NOINHERIT).
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Service mode of a company
-- ----------------------------------------------------------------------------
create table public.organization_service_modes (
  organization_id uuid primary key references public.organizations(id) on delete cascade,
  partner_id      uuid not null references public.partners(id) on delete cascade,
  mode            text not null check (mode in ('padrao', 'gerenciado')),
  set_by          uuid references public.profiles(id) on delete set null,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create index organization_service_modes_partner_idx
  on public.organization_service_modes (partner_id, mode);

alter table public.organization_service_modes owner to app_migrations;
revoke all on public.organization_service_modes from public, anon, authenticated;
alter table public.organization_service_modes enable row level security;
alter table public.organization_service_modes force row level security;

create trigger organization_service_modes_touch_updated_at
  before update on public.organization_service_modes
  for each row execute function private.touch_updated_at();

-- The company of the context: its members (company or workspace) read.
create policy organization_service_modes_member_select on public.organization_service_modes
  for select to app_runtime
  using (
    organization_id = private.context_uuid('app.organization_id')
    and (
      private.is_organization_member(organization_id)
      or private.current_workspace_role() is not null
    )
  );

-- The partner's members read the modes of its companies.
create policy organization_service_modes_partner_select on public.organization_service_modes
  for select to app_runtime
  using (
    private.current_partner_role() is not null
    and partner_id = private.current_partner_id()
    and private.is_partner_organization(organization_id)
  );

-- The partner's owner and admin set the mode of its companies.
create policy organization_service_modes_partner_insert on public.organization_service_modes
  for insert to app_runtime
  with check (
    private.current_partner_role() in ('partner_owner', 'partner_admin')
    and partner_id = private.current_partner_id()
    and private.is_partner_organization(organization_id)
    and set_by = private.context_uuid('app.user_id')
  );

create policy organization_service_modes_partner_update on public.organization_service_modes
  for update to app_runtime
  using (
    private.current_partner_role() in ('partner_owner', 'partner_admin')
    and partner_id = private.current_partner_id()
    and private.is_partner_organization(organization_id)
  )
  with check (
    private.current_partner_role() in ('partner_owner', 'partner_admin')
    and partner_id = private.current_partner_id()
    and private.is_partner_organization(organization_id)
    and set_by = private.context_uuid('app.user_id')
  );

grant select, insert, update on public.organization_service_modes to app_runtime;

-- The helper reads the modes of the context partner's companies.
create policy organization_service_modes_helper_select on public.organization_service_modes
  for select to app_rls_helper
  using (partner_id = private.current_partner_id());

grant select on public.organization_service_modes to app_rls_helper;

-- ----------------------------------------------------------------------------
-- 2. The single helper of ADR 0020
-- ----------------------------------------------------------------------------
create function private.partner_manages_organization(p_organization_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    private.current_partner_role() in ('partner_owner', 'partner_admin', 'partner_support')
    and exists (
      select 1
      from public.organizations organization
      join public.organization_service_modes service_mode
        on service_mode.organization_id = organization.id
      where organization.id = p_organization_id
        and organization.partner_id = private.current_partner_id()
        and service_mode.partner_id = organization.partner_id
        and service_mode.mode = 'gerenciado'
    ),
    false
  );
$$;

revoke execute on function private.partner_manages_organization(uuid) from public, anon, authenticated;
grant execute on function private.partner_manages_organization(uuid) to app_runtime;
alter function private.partner_manages_organization(uuid) owner to app_rls_helper;

-- ----------------------------------------------------------------------------
-- 3. Units and workspaces of a managed company
-- ----------------------------------------------------------------------------
create policy workspace_locations_partner_managed_select on public.workspace_locations
  for select to app_runtime
  using (
    workspace_id = private.context_uuid('app.workspace_id')
    and organization_id = private.context_uuid('app.organization_id')
    and private.partner_manages_organization(organization_id)
  );

create policy workspace_locations_partner_managed_insert on public.workspace_locations
  for insert to app_runtime
  with check (
    workspace_id = private.context_uuid('app.workspace_id')
    and organization_id = private.context_uuid('app.organization_id')
    and created_by = private.context_uuid('app.user_id')
    and updated_by is null
    and private.partner_manages_organization(organization_id)
  );

create policy workspace_locations_partner_managed_update on public.workspace_locations
  for update to app_runtime
  using (
    workspace_id = private.context_uuid('app.workspace_id')
    and organization_id = private.context_uuid('app.organization_id')
    and private.partner_manages_organization(organization_id)
  )
  with check (
    workspace_id = private.context_uuid('app.workspace_id')
    and organization_id = private.context_uuid('app.organization_id')
    and updated_by = private.context_uuid('app.user_id')
    and private.partner_manages_organization(organization_id)
  );

-- The managing partner lists the workspaces of a managed company.
create policy workspaces_partner_managed_select on public.workspaces
  for select to app_runtime
  using (private.partner_manages_organization(organization_id));

-- ----------------------------------------------------------------------------
-- 4. Ficha linked to a unit
-- ----------------------------------------------------------------------------
create table public.gb_locations (
  id                uuid primary key default gen_random_uuid(),
  organization_id   uuid not null,
  workspace_id      uuid not null,
  -- The unit; null only while the onboarding asks which unit to use.
  unit_id           uuid,
  provider          text not null check (provider in ('zernio', 'google', 'fake')),
  external_id       text not null check (length(external_id) between 1 and 300),
  account_ref       text check (account_ref is null or length(account_ref) <= 300),
  place_id          text check (place_id is null or length(place_id) <= 300),
  name              text not null check (length(btrim(name)) between 1 and 200),
  connection_status text not null default 'connected'
    check (connection_status in ('connected', 'disconnected')),
  onboarding_status text not null default 'reading'
    check (onboarding_status in ('reading', 'analyzing', 'ready')),
  -- First review of the automation page: until then the agent only suggests.
  reviewed_at       timestamptz,
  reviewed_by       uuid references public.profiles(id) on delete set null,
  created_by        uuid not null references public.profiles(id) on delete cascade,
  updated_by        uuid references public.profiles(id) on delete set null,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  constraint gb_locations_id_workspace unique (id, workspace_id),
  constraint gb_locations_external unique (workspace_id, provider, external_id),
  constraint gb_locations_unit unique (unit_id),
  constraint fk_gb_locations_workspace
    foreign key (workspace_id, organization_id)
    references public.workspaces(id, organization_id) on delete cascade,
  constraint fk_gb_locations_unit
    foreign key (unit_id, workspace_id)
    references public.workspace_locations(id, workspace_id) on delete restrict
);

create index gb_locations_workspace_idx on public.gb_locations (workspace_id, created_at);

-- ----------------------------------------------------------------------------
-- 5. Versions of the ficha (append only)
-- ----------------------------------------------------------------------------
create table public.gb_snapshots (
  id              uuid primary key default gen_random_uuid(),
  gb_location_id  uuid not null,
  organization_id uuid not null,
  workspace_id    uuid not null,
  kind            text not null check (kind in ('initial', 'approved')),
  data            jsonb not null
    check (jsonb_typeof(data) = 'object' and octet_length(data::text) <= 200000),
  -- Public review data read with the ficha (what Google shows to anyone).
  reviews         jsonb not null default '[]'::jsonb
    check (jsonb_typeof(reviews) = 'array' and octet_length(reviews::text) <= 400000),
  created_by      uuid not null references public.profiles(id) on delete cascade,
  created_at      timestamptz not null default now(),
  constraint fk_gb_snapshots_location
    foreign key (gb_location_id, workspace_id)
    references public.gb_locations(id, workspace_id) on delete cascade,
  constraint fk_gb_snapshots_workspace
    foreign key (workspace_id, organization_id)
    references public.workspaces(id, organization_id) on delete cascade
);

create unique index gb_snapshots_one_initial
  on public.gb_snapshots (gb_location_id) where kind = 'initial';
create index gb_snapshots_location_idx on public.gb_snapshots (gb_location_id, created_at desc);

-- ----------------------------------------------------------------------------
-- 6. Results of the analyses
-- ----------------------------------------------------------------------------
create table public.gb_analysis_runs (
  id              uuid primary key default gen_random_uuid(),
  gb_location_id  uuid not null,
  organization_id uuid not null,
  workspace_id    uuid not null,
  analysis_key    text not null
    check (length(analysis_key) <= 80 and analysis_key ~ '^[a-z][a-z0-9]*(-[a-z0-9]+)*$'),
  area            text not null
    check (area in ('info', 'hours', 'reviews', 'posts', 'photos', 'services', 'defense', 'maps')),
  phase           text not null check (phase in ('blocking', 'background')),
  status          text not null default 'pending'
    check (status in ('pending', 'running', 'done', 'failed', 'skipped')),
  findings        jsonb not null default '[]'::jsonb
    check (jsonb_typeof(findings) = 'array' and octet_length(findings::text) <= 200000),
  metrics         jsonb not null default '{}'::jsonb
    check (jsonb_typeof(metrics) = 'object' and octet_length(metrics::text) <= 20000),
  error           text check (error is null or length(error) <= 500),
  started_at      timestamptz,
  finished_at     timestamptz,
  created_by      uuid not null references public.profiles(id) on delete cascade,
  updated_by      uuid references public.profiles(id) on delete set null,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  constraint gb_analysis_runs_key unique (gb_location_id, analysis_key),
  constraint fk_gb_analysis_runs_location
    foreign key (gb_location_id, workspace_id)
    references public.gb_locations(id, workspace_id) on delete cascade,
  constraint fk_gb_analysis_runs_workspace
    foreign key (workspace_id, organization_id)
    references public.workspaces(id, organization_id) on delete cascade
);

-- ----------------------------------------------------------------------------
-- 7. Ficha level of the agent settings and approval per area
-- ----------------------------------------------------------------------------
create table public.gb_area_settings (
  gb_location_id  uuid not null,
  organization_id uuid not null,
  workspace_id    uuid not null,
  area            text not null
    check (area in ('reviews', 'defense', 'info', 'hours', 'posts', 'photos')),
  enabled         boolean not null,
  autonomy        text not null check (autonomy in ('suggest', 'approval', 'auto')),
  approved_at     timestamptz,
  approved_by     uuid references public.profiles(id) on delete set null,
  updated_by      uuid not null references public.profiles(id) on delete cascade,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  primary key (gb_location_id, area),
  constraint fk_gb_area_settings_location
    foreign key (gb_location_id, workspace_id)
    references public.gb_locations(id, workspace_id) on delete cascade,
  constraint fk_gb_area_settings_workspace
    foreign key (workspace_id, organization_id)
    references public.workspaces(id, organization_id) on delete cascade
);

-- ----------------------------------------------------------------------------
-- Ownership, RLS, triggers
-- ----------------------------------------------------------------------------
do $$
declare
  t text;
begin
  foreach t in array array['gb_locations', 'gb_snapshots', 'gb_analysis_runs', 'gb_area_settings'] loop
    execute format('alter table public.%I owner to app_migrations', t);
    execute format('revoke all on public.%I from public, anon, authenticated', t);
    execute format('alter table public.%I enable row level security', t);
    execute format('alter table public.%I force row level security', t);
  end loop;
  foreach t in array array['gb_locations', 'gb_analysis_runs', 'gb_area_settings'] loop
    execute format(
      'create trigger %I before update on public.%I for each row execute function private.touch_updated_at()',
      t || '_touch_updated_at', t
    );
  end loop;
end
$$;

-- Workspace, company and author never move.
create function private.gb_rows_guard_update()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if new.workspace_id is distinct from old.workspace_id
     or new.organization_id is distinct from old.organization_id
     or new.gb_location_id is distinct from old.gb_location_id then
    raise exception '%: workspace and ficha are immutable', tg_table_name
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

alter function private.gb_rows_guard_update() owner to app_migrations;
revoke execute on function private.gb_rows_guard_update() from public, anon, authenticated;

create trigger gb_analysis_runs_guard_update
  before update on public.gb_analysis_runs
  for each row execute function private.gb_rows_guard_update();
create trigger gb_area_settings_guard_update
  before update on public.gb_area_settings
  for each row execute function private.gb_rows_guard_update();

-- A ficha keeps its workspace, provider and external id; the unit is set
-- once (null to a unit) and never changes after.
create function private.gb_locations_guard_update()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if new.workspace_id is distinct from old.workspace_id
     or new.organization_id is distinct from old.organization_id
     or new.provider is distinct from old.provider
     or new.external_id is distinct from old.external_id
     or new.created_by is distinct from old.created_by
     or new.created_at is distinct from old.created_at
     or (old.unit_id is not null and new.unit_id is distinct from old.unit_id)
     or (old.reviewed_at is not null and new.reviewed_at is distinct from old.reviewed_at) then
    raise exception 'gb_locations: workspace, provider, ficha, unit and first review are immutable'
      using errcode = 'check_violation';
  end if;
  -- The first review is signed by whoever writes it.
  if old.reviewed_at is null and new.reviewed_at is not null
     and new.reviewed_by is distinct from new.updated_by then
    raise exception 'gb_locations: the first review is signed by its author'
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

alter function private.gb_locations_guard_update() owner to app_migrations;
revoke execute on function private.gb_locations_guard_update() from public, anon, authenticated;

create trigger gb_locations_guard_update
  before update on public.gb_locations
  for each row execute function private.gb_locations_guard_update();

-- ----------------------------------------------------------------------------
-- Policies of the gb_* tables
-- ----------------------------------------------------------------------------
-- Read: members of the context workspace, or the managing partner.
do $$
declare
  t text;
begin
  foreach t in array array['gb_locations', 'gb_snapshots', 'gb_analysis_runs', 'gb_area_settings'] loop
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
end
$$;

-- Write: owner and admin of the workspace, or the managing partner, always
-- signing the row.
create policy gb_locations_insert on public.gb_locations
  for insert to app_runtime
  with check (
    workspace_id = private.context_uuid('app.workspace_id')
    and organization_id = private.context_uuid('app.organization_id')
    and created_by = private.context_uuid('app.user_id')
    and updated_by is null
    and reviewed_at is null
    and (
      private.current_workspace_role() in ('owner', 'admin')
      or private.partner_manages_organization(organization_id)
    )
  );

create policy gb_locations_update on public.gb_locations
  for update to app_runtime
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
  );

create policy gb_snapshots_insert on public.gb_snapshots
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

create policy gb_analysis_runs_insert on public.gb_analysis_runs
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

create policy gb_analysis_runs_update on public.gb_analysis_runs
  for update to app_runtime
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
  );

create policy gb_area_settings_insert on public.gb_area_settings
  for insert to app_runtime
  with check (
    workspace_id = private.context_uuid('app.workspace_id')
    and organization_id = private.context_uuid('app.organization_id')
    and updated_by = private.context_uuid('app.user_id')
    and (approved_by is null or approved_by = private.context_uuid('app.user_id'))
    and (
      private.current_workspace_role() in ('owner', 'admin')
      or private.partner_manages_organization(organization_id)
    )
  );

create policy gb_area_settings_update on public.gb_area_settings
  for update to app_runtime
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
  );

grant select, insert, update on public.gb_locations to app_runtime;
grant select, insert on public.gb_snapshots to app_runtime;
grant select, insert, update on public.gb_analysis_runs to app_runtime;
grant select, insert, update on public.gb_area_settings to app_runtime;

-- ----------------------------------------------------------------------------
-- 8. Background analyses queued by the managing partner
-- ----------------------------------------------------------------------------
create policy job_runs_partner_managed_insert on public.job_runs
  for insert to app_runtime
  with check (
    scope = 'workspace'
    and status = 'pending'
    and attempts = 0
    and kind like 'google-business.%'
    and requested_by = private.context_uuid('app.user_id')
    and workspace_id = private.context_uuid('app.workspace_id')
    and organization_id = private.context_uuid('app.organization_id')
    and private.partner_manages_organization(organization_id)
  );

create policy job_runs_partner_managed_select on public.job_runs
  for select to app_runtime
  using (
    kind like 'google-business.%'
    and workspace_id = private.context_uuid('app.workspace_id')
    and organization_id = private.context_uuid('app.organization_id')
    and private.partner_manages_organization(organization_id)
  );

-- ----------------------------------------------------------------------------
-- 9. Bell notice of the background analyses
-- ----------------------------------------------------------------------------
create policy user_notifications_gb_helper_insert on public.user_notifications
  for insert to app_rls_helper
  with check (
    read_at is null
    and event_type = 'google_business.analyses_done'
    and user_id = private.context_uuid('app.user_id')
    and current_setting('app.gb_notice', true) = 'on'
  );

-- `on conflict` checks the new row against the select policies too.
create policy user_notifications_gb_helper_select on public.user_notifications
  for select to app_rls_helper
  using (
    event_type = 'google_business.analyses_done'
    and user_id = private.context_uuid('app.user_id')
    and current_setting('app.gb_notice', true) = 'on'
  );

grant insert on public.user_notifications to app_rls_helper;

create function private.post_google_business_notice(
  p_data jsonb,
  p_link_url text,
  p_idempotency_key text
)
returns integer
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_count integer;
  v_user uuid := private.context_uuid('app.user_id');
begin
  if v_user is null then
    return 0;
  end if;
  perform set_config('app.gb_notice', 'on', true);
  insert into public.user_notifications (user_id, event_type, data, link_url, idempotency_key)
  values (v_user, 'google_business.analyses_done', p_data, p_link_url, p_idempotency_key)
  on conflict (idempotency_key) do nothing;
  get diagnostics v_count = row_count;
  perform set_config('app.gb_notice', '', true);
  return v_count;
end;
$$;

revoke execute on function private.post_google_business_notice(jsonb, text, text) from public, anon, authenticated;
grant execute on function private.post_google_business_notice(jsonb, text, text) to app_runtime;
alter function private.post_google_business_notice(jsonb, text, text) owner to app_rls_helper;

-- ----------------------------------------------------------------------------
-- 10. Purge of a deleted workspace (F3e)
-- ----------------------------------------------------------------------------
do $$
declare
  t text;
begin
  foreach t in array array['gb_locations', 'gb_snapshots', 'gb_analysis_runs', 'gb_area_settings'] loop
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
