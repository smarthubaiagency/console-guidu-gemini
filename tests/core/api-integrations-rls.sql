-- ============================================================================
-- SQL API e Integrações (CF6b): usage per API key, the plan key of a
-- company, the Google OAuth apps and the workspace's Google account.
--   workspace A a…011 (org a…010, house partner): owner a…031, viewer a…033
--     (admin of org A), blocked a…036
--   workspace B a…021 (org a…020): owner a…032
--   partner P b6…001: d…004 partner_owner, d…006 partner_support
--   platform: d…003 owner (admin-seed.sql), d…007 support
-- Each block prepares its fixtures as administrator, switches to
-- `app_runtime` with `set local role` and rolls back.
-- ============================================================================

create or replace function pg_temp.ctx(p_user uuid, p_ws uuid, p_org uuid, p_partner uuid default null)
returns void
language sql as $$
  select set_config('app.user_id', p_user::text, true),
         set_config('app.principal_type', 'user', true),
         set_config('app.grant_id', '', true),
         set_config('app.workspace_id', coalesce(p_ws::text, ''), true),
         set_config('app.organization_id', coalesce(p_org::text, ''), true),
         set_config('app.partner_id', coalesce(p_partner::text, ''), true);
$$;

-- Context of an API key (principal `api_key`, the key as grant).
create or replace function pg_temp.key_ctx(p_key uuid, p_user uuid, p_ws uuid, p_org uuid)
returns void
language sql as $$
  select set_config('app.user_id', p_user::text, true),
         set_config('app.principal_type', 'api_key', true),
         set_config('app.grant_id', p_key::text, true),
         set_config('app.workspace_id', p_ws::text, true),
         set_config('app.organization_id', p_org::text, true),
         set_config('app.partner_id', '', true);
$$;

create or replace function pg_temp.fixture() returns void
language sql as $$
  insert into public.api_keys (id, organization_id, workspace_id, user_id, name, prefix, key_hash, scopes, expires_at) values
    ('c6b00000-0000-4000-8000-0000000000a1', 'a0000000-0000-4000-8000-000000000010', 'a0000000-0000-4000-8000-000000000011',
     'a0000000-0000-4000-8000-000000000031', 'Chave A', 'gdu_live_c6ba...', 'c6b-hash-a', array['workspace:read'], now() + interval '1 day'),
    ('c6b00000-0000-4000-8000-0000000000b1', 'a0000000-0000-4000-8000-000000000020', 'a0000000-0000-4000-8000-000000000021',
     'a0000000-0000-4000-8000-000000000032', 'Chave B', 'gdu_live_c6bb...', 'c6b-hash-b', array['workspace:read'], now() + interval '1 day');
  insert into public.partners (id, slug, name)
  values ('b6000000-0000-4000-8000-000000000001', 'agencia-c6b', 'Agência C6b');
  insert into public.partner_members (partner_id, user_id, email, role) values
    ('b6000000-0000-4000-8000-000000000001', 'd0000000-0000-4000-8000-000000000004', 'owner@c6b.test', 'partner_owner'),
    ('b6000000-0000-4000-8000-000000000001', 'd0000000-0000-4000-8000-000000000006', 'sup@c6b.test', 'partner_support');
  insert into public.platform_admin_members (user_id, role, status) values
    ('d0000000-0000-4000-8000-000000000007', 'support', 'active')
  on conflict (user_id) do update set role = excluded.role, status = 'active';
$$;

-- ----------------------------------------------------------------------------
-- Test 1: usage per key is written only by the recorder, in the key's own
-- context, and read by whoever sees the key
-- ----------------------------------------------------------------------------
begin;
select pg_temp.fixture();
set local role app_runtime;
do $$
declare
  v_calls integer;
  v_errors integer;
begin
  -- No direct write by app_runtime.
  perform pg_temp.ctx('a0000000-0000-4000-8000-000000000031', 'a0000000-0000-4000-8000-000000000011',
                      'a0000000-0000-4000-8000-000000000010');
  begin
    insert into public.api_key_usage_daily (api_key_id, organization_id, workspace_id, day, surface, calls)
    values ('c6b00000-0000-4000-8000-0000000000a1', 'a0000000-0000-4000-8000-000000000010',
            'a0000000-0000-4000-8000-000000000011', current_date, 'api', 5);
    raise exception 'api_key_usage_daily: app_runtime wrote usage directly';
  exception when insufficient_privilege then null;
  end;

  -- A user session counts nothing, even naming a key.
  perform set_config('app.grant_id', 'c6b00000-0000-4000-8000-0000000000a1', true);
  perform private.record_api_key_usage('api', false);

  -- The key's own context counts: two calls, one of them an error, and one by MCP.
  perform pg_temp.key_ctx('c6b00000-0000-4000-8000-0000000000a1', 'a0000000-0000-4000-8000-000000000031',
                          'a0000000-0000-4000-8000-000000000011', 'a0000000-0000-4000-8000-000000000010');
  perform private.record_api_key_usage('api', false);
  perform private.record_api_key_usage('api', true);
  perform private.record_api_key_usage('mcp', false);
  perform private.record_api_key_usage('other', false);
  if current_setting('app.api_key_usage', true) <> '' then
    raise exception 'record_api_key_usage: flag outlived the call';
  end if;

  -- A key of another workspace in this context counts nothing.
  perform pg_temp.key_ctx('c6b00000-0000-4000-8000-0000000000b1', 'a0000000-0000-4000-8000-000000000031',
                          'a0000000-0000-4000-8000-000000000011', 'a0000000-0000-4000-8000-000000000010');
  perform private.record_api_key_usage('api', false);

  -- The owner of A reads its key's usage.
  perform pg_temp.ctx('a0000000-0000-4000-8000-000000000031', 'a0000000-0000-4000-8000-000000000011',
                      'a0000000-0000-4000-8000-000000000010');
  select calls, errors into v_calls, v_errors from public.api_key_usage_daily
  where api_key_id = 'c6b00000-0000-4000-8000-0000000000a1' and surface = 'api';
  if v_calls <> 2 or v_errors <> 1 then
    raise exception 'api_key_usage_daily: expected 2 calls and 1 error, got % and %', v_calls, v_errors;
  end if;
  if (select count(*) from public.api_key_usage_daily) <> 2 then
    raise exception 'api_key_usage_daily: owner of A does not see exactly the api and mcp rows';
  end if;
  if exists (select 1 from public.api_key_usage_daily where api_key_id = 'c6b00000-0000-4000-8000-0000000000b1') then
    raise exception 'api_key_usage_daily: a key of B was counted in the context of A';
  end if;

  -- The owner of B sees nothing of A.
  perform pg_temp.ctx('a0000000-0000-4000-8000-000000000032', 'a0000000-0000-4000-8000-000000000021',
                      'a0000000-0000-4000-8000-000000000020');
  if exists (select 1 from public.api_key_usage_daily) then
    raise exception 'api_key_usage_daily: owner of B sees the usage of A';
  end if;
  -- B's member updates nothing either.
  begin
    update public.api_key_usage_daily set calls = 0;
    raise exception 'api_key_usage_daily: app_runtime updated usage';
  exception when insufficient_privilege then null;
  end;
end
$$;
reset role;
rollback;

-- ----------------------------------------------------------------------------
-- Test 2: the platform overview, for owner, operations and support only
-- ----------------------------------------------------------------------------
begin;
select pg_temp.fixture();
insert into public.api_key_usage_daily (api_key_id, organization_id, workspace_id, day, surface, calls, errors) values
  ('c6b00000-0000-4000-8000-0000000000a1', 'a0000000-0000-4000-8000-000000000010', 'a0000000-0000-4000-8000-000000000011',
   current_date, 'api', 7, 2),
  ('c6b00000-0000-4000-8000-0000000000b1', 'a0000000-0000-4000-8000-000000000020', 'a0000000-0000-4000-8000-000000000021',
   current_date - 40, 'api', 3, 0);
set local role app_runtime;
do $$
declare
  v_row record;
begin
  perform pg_temp.ctx('d0000000-0000-4000-8000-000000000003', null, null);
  select * into v_row from private.api_key_usage_overview(current_date - 29)
  where api_key_id = 'c6b00000-0000-4000-8000-0000000000a1';
  if v_row.calls <> 7 or v_row.errors <> 2 or v_row.key_name <> 'Chave A'
     or v_row.workspace_name <> 'Workspace A' or v_row.organization_name <> 'Organization A' then
    raise exception 'api_key_usage_overview: owner does not see the usage of key A with its names';
  end if;
  if exists (select 1 from private.api_key_usage_overview(current_date - 29)
             where api_key_id = 'c6b00000-0000-4000-8000-0000000000b1') then
    raise exception 'api_key_usage_overview: a day before the window came back';
  end if;
  if current_setting('app.api_key_usage_overview', true) <> '' then
    raise exception 'api_key_usage_overview: flag outlived the call';
  end if;
  -- The helper sees no key after the call.
  perform pg_temp.ctx('d0000000-0000-4000-8000-000000000007', null, null);
  if (select count(*) from private.api_key_usage_overview(current_date - 60)
      where api_key_id::text like 'c6b00000%') <> 2 then
    raise exception 'api_key_usage_overview: support does not see both keys';
  end if;
  -- A workspace owner gets nothing from it.
  perform pg_temp.ctx('a0000000-0000-4000-8000-000000000031', 'a0000000-0000-4000-8000-000000000011',
                      'a0000000-0000-4000-8000-000000000010');
  if exists (select 1 from private.api_key_usage_overview(current_date - 60)) then
    raise exception 'api_key_usage_overview: a workspace owner read the platform overview';
  end if;
end
$$;
reset role;
rollback;

-- ----------------------------------------------------------------------------
-- Test 3: the plan key of a company, only for itself
-- ----------------------------------------------------------------------------
begin;
insert into public.subscriptions
  (partner_id, organization_id, plan_version_id, mode, payer, billing_interval, amount_cents)
select '00000000-0000-4000-8000-000000000000', 'a0000000-0000-4000-8000-000000000010', version.id,
       'partner_pays', 'partner', 'monthly', 3000
from public.plan_versions version
join public.plans plan on plan.id = version.plan_id
where plan.key = 'essencial'
order by version.version desc
limit 1;
set local role app_runtime;
do $$
begin
  perform pg_temp.ctx('a0000000-0000-4000-8000-000000000031', 'a0000000-0000-4000-8000-000000000011',
                      'a0000000-0000-4000-8000-000000000010');
  if private.organization_plan_key('a0000000-0000-4000-8000-000000000010') is distinct from 'essencial' then
    raise exception 'organization_plan_key: the company does not read its own plan';
  end if;
  perform pg_temp.ctx('a0000000-0000-4000-8000-000000000032', 'a0000000-0000-4000-8000-000000000021',
                      'a0000000-0000-4000-8000-000000000020');
  if private.organization_plan_key('a0000000-0000-4000-8000-000000000010') is not null then
    raise exception 'organization_plan_key: another company read the plan';
  end if;
end
$$;
reset role;
rollback;

-- ----------------------------------------------------------------------------
-- Test 4: Google OAuth apps: platform row by owner and operations, partner
-- row by its owner and admin; the ciphertext never selected
-- ----------------------------------------------------------------------------
begin;
select pg_temp.fixture();
set local role app_runtime;
do $$
begin
  -- The platform owner writes the platform app.
  perform pg_temp.ctx('d0000000-0000-4000-8000-000000000003', null, null);
  insert into public.google_oauth_apps (client_id, client_secret_masked, client_secret_encrypted, updated_by)
  values ('platform.apps.googleusercontent.com', 'GOCS...abcd', '{"cipher":"p"}', 'd0000000-0000-4000-8000-000000000003');
  begin
    insert into public.google_oauth_apps (client_id, client_secret_masked, client_secret_encrypted, updated_by)
    values ('second.apps.googleusercontent.com', 'GOCS...abcd', '{"cipher":"p2"}', 'd0000000-0000-4000-8000-000000000003');
    raise exception 'google_oauth_apps: a second platform app accepted';
  exception when unique_violation then null;
  end;
  begin
    perform client_secret_encrypted from public.google_oauth_apps;
    raise exception 'google_oauth_apps: app_runtime selected the ciphertext';
  exception when insufficient_privilege then null;
  end;
  begin
    insert into public.google_oauth_apps (client_id, client_secret_masked, client_secret_encrypted, updated_by)
    values ('bad id with spaces', 'x', 'y', 'd0000000-0000-4000-8000-000000000003');
    raise exception 'google_oauth_apps: invalid client id accepted';
  exception when check_violation then null;
  end;

  -- Platform support reads, does not write.
  perform pg_temp.ctx('d0000000-0000-4000-8000-000000000007', null, null);
  if (select count(*) from public.google_oauth_apps where partner_id is null) <> 1 then
    raise exception 'google_oauth_apps: platform support does not read the platform app';
  end if;
  update public.google_oauth_apps set verification_status = 'verified',
    updated_by = 'd0000000-0000-4000-8000-000000000007' where partner_id is null;
  if exists (select 1 from public.google_oauth_apps where verification_status = 'verified') then
    raise exception 'google_oauth_apps: platform support changed the platform app';
  end if;

  -- The partner owner writes its own app, never the platform's.
  perform pg_temp.ctx('d0000000-0000-4000-8000-000000000004', null, null, 'b6000000-0000-4000-8000-000000000001');
  insert into public.google_oauth_apps (partner_id, client_id, client_secret_masked, client_secret_encrypted, updated_by)
  values ('b6000000-0000-4000-8000-000000000001', 'partner.apps.googleusercontent.com', 'GOCS...wxyz', '{"cipher":"q"}',
          'd0000000-0000-4000-8000-000000000004');
  if exists (select 1 from public.google_oauth_apps where partner_id is null) then
    raise exception 'google_oauth_apps: the partner reads the platform app';
  end if;
  begin
    insert into public.google_oauth_apps (client_id, client_secret_masked, client_secret_encrypted, updated_by)
    values ('x.apps.googleusercontent.com', 'GOCS...abcd', '{"cipher":"x"}', 'd0000000-0000-4000-8000-000000000004');
    raise exception 'google_oauth_apps: the partner wrote a platform app';
  exception when insufficient_privilege then null;
  end;

  -- Partner support reads its app, does not change or remove it.
  perform pg_temp.ctx('d0000000-0000-4000-8000-000000000006', null, null, 'b6000000-0000-4000-8000-000000000001');
  if (select count(*) from public.google_oauth_apps) <> 1 then
    raise exception 'google_oauth_apps: partner support does not read exactly its app';
  end if;
  delete from public.google_oauth_apps;
  perform pg_temp.ctx('d0000000-0000-4000-8000-000000000004', null, null, 'b6000000-0000-4000-8000-000000000001');
  if (select count(*) from public.google_oauth_apps) <> 1 then
    raise exception 'google_oauth_apps: partner support removed the app';
  end if;

  -- A workspace member reads no app.
  perform pg_temp.ctx('a0000000-0000-4000-8000-000000000031', 'a0000000-0000-4000-8000-000000000011',
                      'a0000000-0000-4000-8000-000000000010');
  if exists (select 1 from public.google_oauth_apps) then
    raise exception 'google_oauth_apps: a workspace member reads the apps';
  end if;
end
$$;
reset role;
rollback;

-- ----------------------------------------------------------------------------
-- Test 5: the app of a workspace (partner's first, else the platform's),
-- for owner and admin only
-- ----------------------------------------------------------------------------
begin;
select pg_temp.fixture();
insert into public.google_oauth_apps (client_id, client_secret_masked, client_secret_encrypted, updated_by)
values ('platform.apps.googleusercontent.com', 'GOCS...abcd', '{"cipher":"p"}', 'd0000000-0000-4000-8000-000000000003');
insert into public.google_oauth_apps (partner_id, client_id, client_secret_masked, client_secret_encrypted, updated_by)
values ('b6000000-0000-4000-8000-000000000001', 'partner.apps.googleusercontent.com', 'GOCS...wxyz', '{"cipher":"q"}',
        'd0000000-0000-4000-8000-000000000004');
set local role app_runtime;
do $$
declare
  v_row record;
begin
  perform pg_temp.ctx('a0000000-0000-4000-8000-000000000031', 'a0000000-0000-4000-8000-000000000011',
                      'a0000000-0000-4000-8000-000000000010');
  select * into v_row from private.google_oauth_app_for_workspace();
  if v_row.source <> 'platform' or v_row.client_secret_encrypted <> '{"cipher":"p"}' then
    raise exception 'google_oauth_app_for_workspace: A does not get the platform app';
  end if;
  if current_setting('app.google_oauth_app', true) <> '' then
    raise exception 'google_oauth_app_for_workspace: flag outlived the call';
  end if;
  if exists (select 1 from public.google_oauth_apps) then
    raise exception 'google_oauth_apps: the owner reads the apps after the call';
  end if;
  -- The viewer of A gets nothing.
  perform pg_temp.ctx('a0000000-0000-4000-8000-000000000033', 'a0000000-0000-4000-8000-000000000011',
                      'a0000000-0000-4000-8000-000000000010');
  if exists (select 1 from private.google_oauth_app_for_workspace()) then
    raise exception 'google_oauth_app_for_workspace: a viewer got the app';
  end if;
end
$$;
reset role;
-- B moves to partner P: its workspace now uses P's app.
update public.organizations set partner_id = 'b6000000-0000-4000-8000-000000000001'
where id = 'a0000000-0000-4000-8000-000000000020';
set local role app_runtime;
do $$
declare
  v_row record;
begin
  perform pg_temp.ctx('a0000000-0000-4000-8000-000000000032', 'a0000000-0000-4000-8000-000000000021',
                      'a0000000-0000-4000-8000-000000000020');
  select * into v_row from private.google_oauth_app_for_workspace();
  if v_row.source <> 'partner' or v_row.client_id <> 'partner.apps.googleusercontent.com' then
    raise exception 'google_oauth_app_for_workspace: B does not get its partner''s app';
  end if;
end
$$;
reset role;
rollback;

-- ----------------------------------------------------------------------------
-- Test 6: the workspace's Google account: owner and admin only, tokens
-- never selected, read through the function
-- ----------------------------------------------------------------------------
begin;
select pg_temp.fixture();
set local role app_runtime;
do $$
declare
  v_row record;
begin
  perform pg_temp.ctx('a0000000-0000-4000-8000-000000000031', 'a0000000-0000-4000-8000-000000000011',
                      'a0000000-0000-4000-8000-000000000010');
  insert into public.workspace_google_connections
    (organization_id, workspace_id, app_source, account_email, scopes, access_token_encrypted,
     refresh_token_encrypted, connected_by)
  values ('a0000000-0000-4000-8000-000000000010', 'a0000000-0000-4000-8000-000000000011', 'platform',
          'conta@example.com', array['spreadsheets'], '{"cipher":"a"}', '{"cipher":"r"}',
          'a0000000-0000-4000-8000-000000000031');
  begin
    perform access_token_encrypted from public.workspace_google_connections;
    raise exception 'workspace_google_connections: app_runtime selected a token';
  exception when insufficient_privilege then null;
  end;
  select * into v_row from private.workspace_google_tokens();
  if v_row.refresh_token_encrypted <> '{"cipher":"r"}' then
    raise exception 'workspace_google_tokens: the owner does not read the tokens';
  end if;
  begin
    update public.workspace_google_connections set scopes = array['gmail'];
    raise exception 'workspace_google_connections: unknown scope accepted';
  exception when check_violation then null;
  end;
  begin
    insert into public.workspace_google_connections
      (organization_id, workspace_id, app_source, account_email, access_token_encrypted, connected_by)
    values ('a0000000-0000-4000-8000-000000000010', 'a0000000-0000-4000-8000-000000000011', 'platform',
            'outra@example.com', '{"cipher":"b"}', 'a0000000-0000-4000-8000-000000000031');
    raise exception 'workspace_google_connections: a second account in the workspace';
  exception when unique_violation then null;
  end;

  -- Connecting in the name of someone else is refused.
  begin
    update public.workspace_google_connections set connected_by = 'a0000000-0000-4000-8000-000000000033';
    raise exception 'workspace_google_connections: connected_by forged';
  exception when insufficient_privilege then null;
  end;

  -- The viewer of A sees nothing and gets no token.
  perform pg_temp.ctx('a0000000-0000-4000-8000-000000000033', 'a0000000-0000-4000-8000-000000000011',
                      'a0000000-0000-4000-8000-000000000010');
  if exists (select 1 from public.workspace_google_connections) then
    raise exception 'workspace_google_connections: a viewer sees the account';
  end if;
  if exists (select 1 from private.workspace_google_tokens()) then
    raise exception 'workspace_google_tokens: a viewer got the tokens';
  end if;
  delete from public.workspace_google_connections;

  -- The owner of B sees nothing of A.
  perform pg_temp.ctx('a0000000-0000-4000-8000-000000000032', 'a0000000-0000-4000-8000-000000000021',
                      'a0000000-0000-4000-8000-000000000020');
  if exists (select 1 from public.workspace_google_connections) then
    raise exception 'workspace_google_connections: owner of B sees the account of A';
  end if;
  if exists (select 1 from private.workspace_google_tokens()) then
    raise exception 'workspace_google_tokens: owner of B got the tokens of A';
  end if;

  -- The owner of A disconnects.
  perform pg_temp.ctx('a0000000-0000-4000-8000-000000000031', 'a0000000-0000-4000-8000-000000000011',
                      'a0000000-0000-4000-8000-000000000010');
  if (select count(*) from public.workspace_google_connections) <> 1 then
    raise exception 'workspace_google_connections: the viewer removed the account';
  end if;
  delete from public.workspace_google_connections;
  if exists (select 1 from public.workspace_google_connections) then
    raise exception 'workspace_google_connections: the owner could not disconnect';
  end if;
end
$$;
reset role;
rollback;

-- ----------------------------------------------------------------------------
-- Test 7: RLS forced and no grants to anon/authenticated on the new tables
-- ----------------------------------------------------------------------------
do $$
declare
  v_table text;
begin
  foreach v_table in array array['api_key_usage_daily', 'google_oauth_apps', 'workspace_google_connections'] loop
    if not (select relforcerowsecurity and relrowsecurity from pg_class
            where oid = format('public.%I', v_table)::regclass) then
      raise exception '%: RLS not forced', v_table;
    end if;
    if has_table_privilege('anon', format('public.%I', v_table), 'select')
       or has_table_privilege('authenticated', format('public.%I', v_table), 'select') then
      raise exception '%: anon or authenticated can read', v_table;
    end if;
  end loop;
end
$$;
