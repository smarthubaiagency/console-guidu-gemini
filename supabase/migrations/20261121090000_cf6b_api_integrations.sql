-- ============================================================================
-- Migration: 20261121090000_cf6b_api_integrations.sql
-- Module: CF6b — API e Integrações (docs/configuracoes/plano-cf6b.md,
--         levantamento items 12 and 13)
--
-- Maintenance Rationale:
-- 1. The emergency switches of the REST API and of the MCP, the scopes each
--    plan allows and the Google scopes offered (platform turns on, partner
--    narrows) are keys of the settings cascade (ADR 0018): no table here.
--    The three limits per minute are quota keys of the CF4 catalog: the
--    platform ceiling in `quota_ceilings`, the plan value in
--    `plan_versions.limits`; the environment is only the default.
-- 2. `public.api_key_usage_daily`: calls and errors per workspace API key,
--    per day (America/Sao_Paulo) and surface (`api` or `mcp`). Written only
--    by `private.record_api_key_usage(surface, error)`, which takes the key
--    from the request context of that very key (principal `api_key`), so
--    no caller counts for another key. Whoever sees the key sees its usage
--    (the policy reads `api_keys` through its own RLS). The platform reads
--    every key through `private.api_key_usage_overview(since)`: aggregates
--    plus the key's name and prefix, never its hash, for owner, operations
--    and support. Rows go with their key (FK cascade).
-- 3. `private.organization_plan_key(org)`: the key of the company's plan
--    (open subscription, else the latest canceled one, as
--    `organization_contract`), for the scopes of the plan. Only for the
--    context's own company (the helper's policies of the subscriptions
--    also require a member of it).
-- 4. `public.google_oauth_apps`: the Google OAuth app of the platform (one
--    row, `partner_id` null) and, optionally, one per partner. The client
--    secret is stored encrypted (AES-256-GCM by the application) with a
--    masked copy; app_runtime never selects the ciphertext.
--    The platform's settings managers (owner, operations) write the
--    platform row, support reads it; the partner's owner and admin write
--    their own, every partner role reads it.
-- 5. `public.workspace_google_connections`: the Google account connected
--    by a workspace (one per workspace): account, granted scopes and the
--    encrypted tokens. Owner and admin of the workspace read (without the
--    tokens), connect and disconnect. The tokens are read only through
--    `private.workspace_google_tokens()`, for the same roles.
-- 6. `private.google_oauth_app_for_workspace()`: the app a workspace uses
--    to connect, for its owner and admin: the partner's when it has one,
--    else the platform's, with the ciphertext of the secret for the
--    exchange of the code on the server.
-- 7. Purge of a deleted workspace (F3e) as the worker.
-- Owner app_migrations, ENABLE + FORCE RLS, no grants to anon/authenticated.
-- Functions owned by app_rls_helper get their grants before the ownership
-- transfer (app_migrations is NOINHERIT); the helper reads only while a
-- flag set and restored inside each function is on (I5 pattern).
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Usage per API key and day
-- ----------------------------------------------------------------------------
create table public.api_key_usage_daily (
  api_key_id      uuid not null references public.api_keys(id) on delete cascade,
  organization_id uuid not null,
  workspace_id    uuid not null,
  day             date not null,
  surface         text not null check (surface in ('api', 'mcp')),
  calls           integer not null default 0 check (calls >= 0),
  errors          integer not null default 0 check (errors >= 0 and errors <= calls),
  updated_at      timestamptz not null default now(),
  primary key (api_key_id, day, surface),
  constraint fk_api_key_usage_daily_workspace
    foreign key (workspace_id, organization_id)
    references public.workspaces(id, organization_id) on delete cascade
);

create index api_key_usage_daily_workspace_idx
  on public.api_key_usage_daily (workspace_id, day desc);
create index api_key_usage_daily_day_idx
  on public.api_key_usage_daily (day desc);

alter table public.api_key_usage_daily owner to app_migrations;
revoke all on public.api_key_usage_daily from public, anon, authenticated;
alter table public.api_key_usage_daily enable row level security;
alter table public.api_key_usage_daily force row level security;

-- Whoever sees the key (its owner, or owner and admin of the workspace or
-- the company, by the api_keys policy) sees its usage.
create policy api_key_usage_daily_select on public.api_key_usage_daily
  for select to app_runtime
  using (
    workspace_id = private.context_uuid('app.workspace_id')
    and organization_id = private.context_uuid('app.organization_id')
    and exists (select 1 from public.api_keys k where k.id = api_key_id)
  );

grant select on public.api_key_usage_daily to app_runtime;

-- The recorder (helper) touches only the row of the key it is counting.
create policy api_key_usage_daily_helper_select on public.api_key_usage_daily
  for select to app_rls_helper
  using (
    api_key_id::text = current_setting('app.api_key_usage', true)
    or current_setting('app.api_key_usage_overview', true) = 'on'
  );

create policy api_key_usage_daily_helper_insert on public.api_key_usage_daily
  for insert to app_rls_helper
  with check (api_key_id::text = current_setting('app.api_key_usage', true));

create policy api_key_usage_daily_helper_update on public.api_key_usage_daily
  for update to app_rls_helper
  using (api_key_id::text = current_setting('app.api_key_usage', true))
  with check (api_key_id::text = current_setting('app.api_key_usage', true));

grant select, insert, update on public.api_key_usage_daily to app_rls_helper;

-- The helper reads the key being counted, or every key for the overview.
create policy api_keys_usage_helper_select on public.api_keys
  for select to app_rls_helper
  using (
    id::text = current_setting('app.api_key_usage', true)
    or current_setting('app.api_key_usage_overview', true) = 'on'
  );

grant select (id, workspace_id, organization_id, name, prefix, status)
  on public.api_keys to app_rls_helper;

create function private.record_api_key_usage(p_surface text, p_error boolean)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_key      uuid := private.context_uuid('app.grant_id');
  v_previous text := current_setting('app.api_key_usage', true);
  v_ws       uuid;
  v_org      uuid;
begin
  if coalesce(current_setting('app.principal_type', true), '') <> 'api_key'
     or v_key is null
     or p_surface is null
     or p_surface not in ('api', 'mcp') then
    return;
  end if;
  perform set_config('app.api_key_usage', v_key::text, true);
  select k.workspace_id, k.organization_id into v_ws, v_org
  from public.api_keys k
  where k.id = v_key
    and k.workspace_id = private.context_uuid('app.workspace_id')
    and k.organization_id = private.context_uuid('app.organization_id');
  if found then
    insert into public.api_key_usage_daily as usage
      (api_key_id, organization_id, workspace_id, day, surface, calls, errors)
    values
      (v_key, v_org, v_ws, (now() at time zone 'America/Sao_Paulo')::date, p_surface, 1,
       case when coalesce(p_error, false) then 1 else 0 end)
    on conflict (api_key_id, day, surface) do update
      set calls = usage.calls + 1,
          errors = usage.errors + case when coalesce(p_error, false) then 1 else 0 end,
          updated_at = now();
  end if;
  perform set_config('app.api_key_usage', coalesce(v_previous, ''), true);
end;
$$;

revoke execute on function private.record_api_key_usage(text, boolean) from public, anon, authenticated;
grant execute on function private.record_api_key_usage(text, boolean) to app_runtime;
alter function private.record_api_key_usage(text, boolean) owner to app_rls_helper;

-- Every workspace key's usage for the platform: aggregates per key, day and
-- surface, with the key's name and prefix and where it lives.
create function private.api_key_usage_overview(p_since date)
returns table(
  api_key_id        uuid,
  key_name          text,
  key_prefix        text,
  key_status        text,
  workspace_id      uuid,
  workspace_name    text,
  organization_id   uuid,
  organization_name text,
  day               date,
  surface           text,
  calls             integer,
  errors            integer
)
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_previous text := current_setting('app.api_key_usage_overview', true);
begin
  if coalesce(private.current_platform_admin_role() in ('owner', 'operations', 'support'), false) is not true then
    return;
  end if;
  perform set_config('app.api_key_usage_overview', 'on', true);
  return query
    select usage.api_key_id, k.name, k.prefix, k.status, usage.workspace_id, w.name,
           usage.organization_id, o.name, usage.day, usage.surface, usage.calls, usage.errors
    from public.api_key_usage_daily usage
    join public.api_keys k on k.id = usage.api_key_id
    left join public.workspaces w on w.id = usage.workspace_id
    left join public.organizations o on o.id = usage.organization_id
    where usage.day >= p_since;
  perform set_config('app.api_key_usage_overview', coalesce(v_previous, ''), true);
end;
$$;

revoke execute on function private.api_key_usage_overview(date) from public, anon, authenticated;
grant execute on function private.api_key_usage_overview(date) to app_runtime;
alter function private.api_key_usage_overview(date) owner to app_rls_helper;

-- ----------------------------------------------------------------------------
-- 2. The plan of a company, for the scopes of the plan
-- ----------------------------------------------------------------------------
create function private.organization_plan_key(p_organization_id uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select plan.key
  from public.subscriptions subscription
  join public.plan_versions version on version.id = subscription.plan_version_id
  join public.plans plan on plan.id = version.plan_id
  where subscription.organization_id = p_organization_id
    and p_organization_id = private.context_uuid('app.organization_id')
  order by (subscription.status <> 'canceled') desc, subscription.created_at desc
  limit 1;
$$;

revoke execute on function private.organization_plan_key(uuid) from public, anon, authenticated;
grant execute on function private.organization_plan_key(uuid) to app_runtime;
alter function private.organization_plan_key(uuid) owner to app_rls_helper;

-- ----------------------------------------------------------------------------
-- 3. Google OAuth apps: the platform's and the partners'
-- ----------------------------------------------------------------------------
create table public.google_oauth_apps (
  id                      uuid primary key default gen_random_uuid(),
  partner_id              uuid references public.partners(id) on delete cascade,
  client_id               text not null
                            check (char_length(client_id) between 1 and 255
                                   and client_id ~ '^[A-Za-z0-9._-]+$'),
  client_secret_masked    text not null check (char_length(client_secret_masked) between 1 and 40),
  client_secret_encrypted text not null check (char_length(client_secret_encrypted) between 1 and 4096),
  verification_status     text not null default 'testing'
                            check (verification_status in ('testing', 'unverified', 'in_review', 'verified')),
  updated_by              uuid not null references public.profiles(id),
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now()
);

create unique index google_oauth_apps_platform_key
  on public.google_oauth_apps ((partner_id is null)) where partner_id is null;
create unique index google_oauth_apps_partner_key
  on public.google_oauth_apps (partner_id) where partner_id is not null;

alter table public.google_oauth_apps owner to app_migrations;
revoke all on public.google_oauth_apps from public, anon, authenticated;
alter table public.google_oauth_apps enable row level security;
alter table public.google_oauth_apps force row level security;

create trigger google_oauth_apps_touch_updated_at
  before update on public.google_oauth_apps
  for each row execute function private.touch_updated_at();

create policy google_oauth_apps_select on public.google_oauth_apps
  for select to app_runtime
  using (
    (partner_id is null
     and private.current_platform_admin_role() in ('owner', 'operations', 'support'))
    or (partner_id = private.current_partner_id()
        and private.current_partner_role() is not null)
  );

create policy google_oauth_apps_insert on public.google_oauth_apps
  for insert to app_runtime
  with check (
    updated_by = private.context_uuid('app.user_id')
    and (
      (partner_id is null
       and private.current_platform_admin_role() in ('owner', 'operations'))
      or (partner_id = private.current_partner_id()
          and private.current_partner_role() in ('partner_owner', 'partner_admin'))
    )
  );

create policy google_oauth_apps_update on public.google_oauth_apps
  for update to app_runtime
  using (
    (partner_id is null
     and private.current_platform_admin_role() in ('owner', 'operations'))
    or (partner_id = private.current_partner_id()
        and private.current_partner_role() in ('partner_owner', 'partner_admin'))
  )
  with check (
    updated_by = private.context_uuid('app.user_id')
    and (
      (partner_id is null
       and private.current_platform_admin_role() in ('owner', 'operations'))
      or (partner_id = private.current_partner_id()
          and private.current_partner_role() in ('partner_owner', 'partner_admin'))
    )
  );

create policy google_oauth_apps_delete on public.google_oauth_apps
  for delete to app_runtime
  using (
    (partner_id is null
     and private.current_platform_admin_role() in ('owner', 'operations'))
    or (partner_id = private.current_partner_id()
        and private.current_partner_role() in ('partner_owner', 'partner_admin'))
  );

-- The ciphertext is written, never selected, by app_runtime.
grant select (id, partner_id, client_id, client_secret_masked, verification_status,
              updated_by, created_at, updated_at)
  on public.google_oauth_apps to app_runtime;
grant insert (partner_id, client_id, client_secret_masked, client_secret_encrypted,
              verification_status, updated_by)
  on public.google_oauth_apps to app_runtime;
grant update (client_id, client_secret_masked, client_secret_encrypted,
              verification_status, updated_by, updated_at)
  on public.google_oauth_apps to app_runtime;
grant delete on public.google_oauth_apps to app_runtime;

create policy google_oauth_apps_helper_select on public.google_oauth_apps
  for select to app_rls_helper
  using (current_setting('app.google_oauth_app', true) = 'on');

grant select on public.google_oauth_apps to app_rls_helper;

-- ----------------------------------------------------------------------------
-- 4. The Google account of a workspace
-- ----------------------------------------------------------------------------
create table public.workspace_google_connections (
  id                       uuid primary key default gen_random_uuid(),
  organization_id          uuid not null,
  workspace_id             uuid not null unique,
  app_source               text not null check (app_source in ('platform', 'partner')),
  app_id                   uuid references public.google_oauth_apps(id) on delete set null,
  account_email            text not null check (char_length(account_email) between 3 and 320),
  account_subject          text check (account_subject is null or char_length(account_subject) between 1 and 255),
  scopes                   text[] not null default '{}'
                             check (scopes <@ array['drive.file', 'spreadsheets', 'calendar.events']::text[]),
  access_token_encrypted   text not null check (char_length(access_token_encrypted) between 1 and 16384),
  refresh_token_encrypted  text check (refresh_token_encrypted is null
                                       or char_length(refresh_token_encrypted) between 1 and 16384),
  access_expires_at        timestamptz,
  connected_by             uuid not null references public.profiles(id),
  created_at               timestamptz not null default now(),
  updated_at               timestamptz not null default now(),
  constraint fk_workspace_google_connections_workspace
    foreign key (workspace_id, organization_id)
    references public.workspaces(id, organization_id) on delete cascade
);

alter table public.workspace_google_connections owner to app_migrations;
revoke all on public.workspace_google_connections from public, anon, authenticated;
alter table public.workspace_google_connections enable row level security;
alter table public.workspace_google_connections force row level security;

create trigger workspace_google_connections_touch_updated_at
  before update on public.workspace_google_connections
  for each row execute function private.touch_updated_at();

-- Owner and admin of the workspace (workspace.settings.update).
create policy workspace_google_connections_select on public.workspace_google_connections
  for select to app_runtime
  using (
    workspace_id = private.context_uuid('app.workspace_id')
    and organization_id = private.context_uuid('app.organization_id')
    and private.current_workspace_role() in ('owner', 'admin')
  );

create policy workspace_google_connections_insert on public.workspace_google_connections
  for insert to app_runtime
  with check (
    workspace_id = private.context_uuid('app.workspace_id')
    and organization_id = private.context_uuid('app.organization_id')
    and connected_by = private.context_uuid('app.user_id')
    and private.current_workspace_role() in ('owner', 'admin')
  );

create policy workspace_google_connections_update on public.workspace_google_connections
  for update to app_runtime
  using (
    workspace_id = private.context_uuid('app.workspace_id')
    and organization_id = private.context_uuid('app.organization_id')
    and private.current_workspace_role() in ('owner', 'admin')
  )
  with check (
    workspace_id = private.context_uuid('app.workspace_id')
    and organization_id = private.context_uuid('app.organization_id')
    and connected_by = private.context_uuid('app.user_id')
    and private.current_workspace_role() in ('owner', 'admin')
  );

create policy workspace_google_connections_delete on public.workspace_google_connections
  for delete to app_runtime
  using (
    workspace_id = private.context_uuid('app.workspace_id')
    and organization_id = private.context_uuid('app.organization_id')
    and private.current_workspace_role() in ('owner', 'admin')
  );

-- The tokens are written, never selected, by app_runtime.
grant select (id, organization_id, workspace_id, app_source, app_id, account_email,
              account_subject, scopes, access_expires_at, connected_by, created_at, updated_at)
  on public.workspace_google_connections to app_runtime;
grant insert (organization_id, workspace_id, app_source, app_id, account_email,
              account_subject, scopes, access_token_encrypted, refresh_token_encrypted,
              access_expires_at, connected_by)
  on public.workspace_google_connections to app_runtime;
grant update (app_source, app_id, account_email, account_subject, scopes,
              access_token_encrypted, refresh_token_encrypted, access_expires_at,
              connected_by, updated_at)
  on public.workspace_google_connections to app_runtime;
grant delete on public.workspace_google_connections to app_runtime;

create policy workspace_google_connections_helper_select on public.workspace_google_connections
  for select to app_rls_helper
  using (
    current_setting('app.workspace_google_tokens', true) = 'on'
    and workspace_id = private.context_uuid('app.workspace_id')
    and organization_id = private.context_uuid('app.organization_id')
  );

grant select on public.workspace_google_connections to app_rls_helper;

-- Purge of a deleted workspace (F3e).
create policy workspace_google_connections_worker_purge on public.workspace_google_connections
  for delete to app_worker
  using (private.workspace_purgeable(workspace_id));
create policy workspace_google_connections_worker_purge_select on public.workspace_google_connections
  for select to app_worker
  using (private.workspace_purgeable(workspace_id));
grant select (workspace_id), delete on public.workspace_google_connections to app_worker;

-- ----------------------------------------------------------------------------
-- 5. The app a workspace connects with, and its tokens
-- ----------------------------------------------------------------------------
create function private.google_oauth_app_for_workspace()
returns table(
  source                  text,
  app_id                  uuid,
  partner_id              uuid,
  client_id               text,
  client_secret_encrypted text,
  verification_status     text
)
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_previous text := current_setting('app.google_oauth_app', true);
  v_partner  uuid;
begin
  if coalesce(private.current_workspace_role() in ('owner', 'admin'), false) is not true then
    return;
  end if;
  select o.partner_id into v_partner
  from public.organizations o
  where o.id = private.context_uuid('app.organization_id');
  perform set_config('app.google_oauth_app', 'on', true);
  return query
    select case when a.partner_id is null then 'platform' else 'partner' end,
           a.id, a.partner_id, a.client_id, a.client_secret_encrypted, a.verification_status
    from public.google_oauth_apps a
    where a.partner_id is null or (v_partner is not null and a.partner_id = v_partner)
    order by (a.partner_id is null)
    limit 1;
  perform set_config('app.google_oauth_app', coalesce(v_previous, ''), true);
end;
$$;

revoke execute on function private.google_oauth_app_for_workspace() from public, anon, authenticated;
grant execute on function private.google_oauth_app_for_workspace() to app_runtime;
alter function private.google_oauth_app_for_workspace() owner to app_rls_helper;

create function private.workspace_google_tokens()
returns table(
  access_token_encrypted  text,
  refresh_token_encrypted text
)
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_previous text := current_setting('app.workspace_google_tokens', true);
begin
  if coalesce(private.current_workspace_role() in ('owner', 'admin'), false) is not true then
    return;
  end if;
  perform set_config('app.workspace_google_tokens', 'on', true);
  return query
    select c.access_token_encrypted, c.refresh_token_encrypted
    from public.workspace_google_connections c
    where c.workspace_id = private.context_uuid('app.workspace_id')
      and c.organization_id = private.context_uuid('app.organization_id');
  perform set_config('app.workspace_google_tokens', coalesce(v_previous, ''), true);
end;
$$;

revoke execute on function private.workspace_google_tokens() from public, anon, authenticated;
grant execute on function private.workspace_google_tokens() to app_runtime;
alter function private.workspace_google_tokens() owner to app_rls_helper;
