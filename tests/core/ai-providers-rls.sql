-- ============================================================================
-- SQL AI providers and models (CF6a): failed calls in the usage, the
-- partner reading its customers' usage, `private.ai_agents_overview()` and
-- `private.ai_usage_overview()`.
--   workspace A a…011 (org a…010, house partner): owner a…031
--   workspace B a…021 (org a…020, moved to partner P per block): owner a…032
--   partner P b1…001: d…004 partner_owner, d…006 partner_support
--   platform: d…003 owner (admin-seed.sql), d…007 support, d…008 operations
-- Each block prepares its fixtures as administrator, switches to
-- `app_runtime` with `set local role` and rolls back.
-- ============================================================================

create or replace function pg_temp.ctx(p_user uuid, p_ws uuid, p_org uuid, p_partner uuid default null)
returns void
language sql as $$
  select set_config('app.user_id', p_user::text, true),
         set_config('app.principal_type', 'user', true),
         set_config('app.workspace_id', coalesce(p_ws::text, ''), true),
         set_config('app.organization_id', coalesce(p_org::text, ''), true),
         set_config('app.partner_id', coalesce(p_partner::text, ''), true);
$$;

create or replace function pg_temp.fixture() returns void
language sql as $$
  insert into public.partners (id, slug, name)
  values ('b1000000-0000-4000-8000-000000000001', 'agencia-p', 'Agência P');
  insert into public.partner_members (partner_id, user_id, email, role) values
    ('b1000000-0000-4000-8000-000000000001', 'd0000000-0000-4000-8000-000000000004', 'owner@p.test', 'partner_owner'),
    ('b1000000-0000-4000-8000-000000000001', 'd0000000-0000-4000-8000-000000000006', 'sup@p.test', 'partner_support');
  insert into public.platform_admin_members (user_id, role, status) values
    ('d0000000-0000-4000-8000-000000000007', 'support', 'active'),
    ('d0000000-0000-4000-8000-000000000008', 'operations', 'active')
  on conflict (user_id) do update set role = excluded.role, status = 'active';
  update public.organizations set partner_id = 'b1000000-0000-4000-8000-000000000001'
  where id = 'a0000000-0000-4000-8000-000000000020';
  insert into public.ai_agents (id, kind, organization_id, workspace_id, created_by, status, key_state, backup_started_at, config) values
    ('c6a00000-0000-4000-8000-0000000000a1', 'guid', 'a0000000-0000-4000-8000-000000000010',
     'a0000000-0000-4000-8000-000000000011', 'a0000000-0000-4000-8000-000000000031', 'active', 'ok', null,
     '{"model": {"model_provider": "openai", "model_name": "gpt-test"}}'),
    ('c6a00000-0000-4000-8000-0000000000b1', 'guid', 'a0000000-0000-4000-8000-000000000020',
     'a0000000-0000-4000-8000-000000000021', 'a0000000-0000-4000-8000-000000000032', 'active', 'backup', now(),
     '{"model": {"model_provider": "anthropic", "model_name": "claude-test"}}');
  insert into public.ai_usage_events (execution_id, organization_id, workspace_id, agent_id, key_source, provider, model, error_code) values
    (gen_random_uuid(), 'a0000000-0000-4000-8000-000000000010', 'a0000000-0000-4000-8000-000000000011',
     'c6a00000-0000-4000-8000-0000000000a1', 'customer', 'openai', 'gpt-test', null),
    (gen_random_uuid(), 'a0000000-0000-4000-8000-000000000020', 'a0000000-0000-4000-8000-000000000021',
     'c6a00000-0000-4000-8000-0000000000b1', 'customer', 'anthropic', 'claude-test', null),
    (gen_random_uuid(), 'a0000000-0000-4000-8000-000000000020', 'a0000000-0000-4000-8000-000000000021',
     'c6a00000-0000-4000-8000-0000000000b1', 'customer', 'anthropic', 'claude-test', 'key_invalid');
$$;

-- ----------------------------------------------------------------------------
-- Test 1: the error code of a failed call
-- ----------------------------------------------------------------------------
begin;
do $$
begin
  begin
    insert into public.ai_usage_events (execution_id, organization_id, workspace_id, key_source, provider, model, error_code)
    values (gen_random_uuid(), 'a0000000-0000-4000-8000-000000000010', 'a0000000-0000-4000-8000-000000000011',
            'customer', 'openai', 'gpt-test', '');
    raise exception 'ai_usage_events: empty error code accepted';
  exception when check_violation then null;
  end;
  begin
    insert into public.ai_usage_events (execution_id, organization_id, workspace_id, key_source, provider, model, error_code)
    values (gen_random_uuid(), 'a0000000-0000-4000-8000-000000000010', 'a0000000-0000-4000-8000-000000000011',
            'customer', 'openai', 'gpt-test', repeat('x', 81));
    raise exception 'ai_usage_events: error code over 80 characters accepted';
  exception when check_violation then null;
  end;
end
$$;
rollback;

-- ----------------------------------------------------------------------------
-- Test 2: the workspace writes its failed call; the partner reads its
-- customers' usage, never another partner's
-- ----------------------------------------------------------------------------
begin;
select pg_temp.fixture();
set local role app_runtime;
do $$
begin
  -- The owner of B records a failed call of its own key (A2b policy).
  perform pg_temp.ctx('a0000000-0000-4000-8000-000000000032', 'a0000000-0000-4000-8000-000000000021',
                      'a0000000-0000-4000-8000-000000000020');
  insert into public.ai_usage_events (execution_id, organization_id, workspace_id, key_source, provider, model, error_code)
  values (gen_random_uuid(), 'a0000000-0000-4000-8000-000000000020', 'a0000000-0000-4000-8000-000000000021',
          'customer', 'anthropic', 'claude-test', 'rate_limited');

  -- Owner and support of P see the usage of B (their customer), not A's.
  perform pg_temp.ctx('d0000000-0000-4000-8000-000000000004', null, null, 'b1000000-0000-4000-8000-000000000001');
  if (select count(*) from public.ai_usage_events
      where workspace_id = 'a0000000-0000-4000-8000-000000000021') <> 3 then
    raise exception 'ai_usage_events: owner of P does not see the usage of its customer';
  end if;
  if (select count(*) from public.ai_usage_events where error_code is not null) <> 2 then
    raise exception 'ai_usage_events: owner of P does not see the failed calls of its customer';
  end if;
  if exists (select 1 from public.ai_usage_events
             where workspace_id = 'a0000000-0000-4000-8000-000000000011') then
    raise exception 'ai_usage_events: owner of P sees the usage of another partner''s customer';
  end if;
  perform pg_temp.ctx('d0000000-0000-4000-8000-000000000006', null, null, 'b1000000-0000-4000-8000-000000000001');
  if (select count(*) from public.ai_usage_events) <> 3 then
    raise exception 'ai_usage_events: support of P does not see exactly its customer''s usage';
  end if;

  -- The partner never writes its customers' usage.
  perform pg_temp.ctx('d0000000-0000-4000-8000-000000000004', null, null, 'b1000000-0000-4000-8000-000000000001');
  begin
    insert into public.ai_usage_events (execution_id, organization_id, workspace_id, key_source, provider, model)
    values (gen_random_uuid(), 'a0000000-0000-4000-8000-000000000020', 'a0000000-0000-4000-8000-000000000021',
            'customer', 'anthropic', 'claude-test');
    raise exception 'ai_usage_events: partner wrote its customer''s usage';
  exception when insufficient_privilege then null;
  end;

  -- The owner of A still sees only A.
  perform pg_temp.ctx('a0000000-0000-4000-8000-000000000031', 'a0000000-0000-4000-8000-000000000011',
                      'a0000000-0000-4000-8000-000000000010');
  if exists (select 1 from public.ai_usage_events
             where workspace_id <> 'a0000000-0000-4000-8000-000000000011') then
    raise exception 'ai_usage_events: owner of A sees another workspace';
  end if;
end
$$;
reset role;
rollback;

-- ----------------------------------------------------------------------------
-- Test 3: agents overview, aggregates for owner and operations only
-- ----------------------------------------------------------------------------
begin;
select pg_temp.fixture();
set local role app_runtime;
do $$
declare
  v_count bigint;
begin
  perform pg_temp.ctx('d0000000-0000-4000-8000-000000000003', null, null);
  select coalesce(sum(agents), 0) into v_count from private.ai_agents_overview()
  where organization_id = 'a0000000-0000-4000-8000-000000000020'
    and key_state = 'backup' and provider = 'anthropic' and model = 'claude-test';
  if v_count <> 1 then
    raise exception 'ai_agents_overview: owner does not see the GUIDS in backup (%)', v_count;
  end if;
  -- The flag does not outlive the call: the helper sees no agent after it.
  if coalesce(current_setting('app.ai_agents_overview', true), '') <> '' then
    raise exception 'ai_agents_overview: flag left on';
  end if;
  -- The platform still does not read the agents themselves.
  if exists (select 1 from public.ai_agents where id = 'c6a00000-0000-4000-8000-0000000000a1') then
    raise exception 'ai_agents: platform owner reads the GUIDS';
  end if;

  -- Usage by partner: the customer rows of B count for P.
  select coalesce(sum(requests), 0) into v_count from private.ai_usage_overview(now() - interval '1 day')
  where partner_id = 'b1000000-0000-4000-8000-000000000001' and provider = 'anthropic';
  if v_count <> 2 then
    raise exception 'ai_usage_overview: usage of P''s customer not attributed to P (%)', v_count;
  end if;
  select coalesce(sum(requests), 0) into v_count from private.ai_usage_overview(now() - interval '1 day')
  where partner_id = 'b1000000-0000-4000-8000-000000000001' and error_code = 'key_invalid';
  if v_count <> 1 then
    raise exception 'ai_usage_overview: failed call not counted (%)', v_count;
  end if;
  if exists (select 1 from private.ai_usage_overview(now() + interval '1 day')) then
    raise exception 'ai_usage_overview: period ignored';
  end if;
  if coalesce(current_setting('app.ai_usage_overview', true), '') <> '' then
    raise exception 'ai_usage_overview: flag left on';
  end if;

  perform pg_temp.ctx('d0000000-0000-4000-8000-000000000008', null, null);
  if not exists (select 1 from private.ai_agents_overview() where kind = 'guid') then
    raise exception 'ai_agents_overview: operations sees nothing';
  end if;
  if not exists (select 1 from private.ai_usage_overview(now() - interval '1 day')) then
    raise exception 'ai_usage_overview: operations sees nothing';
  end if;

  perform pg_temp.ctx('d0000000-0000-4000-8000-000000000007', null, null);
  if exists (select 1 from private.ai_agents_overview()) then
    raise exception 'ai_agents_overview: platform support sees the overview';
  end if;
  if exists (select 1 from private.ai_usage_overview(now() - interval '1 day')) then
    raise exception 'ai_usage_overview: platform support sees the usage overview';
  end if;

  perform pg_temp.ctx('d0000000-0000-4000-8000-000000000004', null, null, 'b1000000-0000-4000-8000-000000000001');
  if exists (select 1 from private.ai_agents_overview()) then
    raise exception 'ai_agents_overview: partner owner sees the overview';
  end if;
  if exists (select 1 from private.ai_usage_overview(now() - interval '1 day')) then
    raise exception 'ai_usage_overview: partner owner sees the usage overview';
  end if;

  perform pg_temp.ctx('a0000000-0000-4000-8000-000000000031', 'a0000000-0000-4000-8000-000000000011',
                      'a0000000-0000-4000-8000-000000000010');
  if exists (select 1 from private.ai_agents_overview()) then
    raise exception 'ai_agents_overview: workspace owner sees the overview';
  end if;
end
$$;
reset role;
rollback;

-- ----------------------------------------------------------------------------
-- Test 4: the overviews' grants
-- ----------------------------------------------------------------------------
do $$
begin
  if has_function_privilege('anon', 'private.ai_agents_overview()', 'execute')
     or has_function_privilege('authenticated', 'private.ai_agents_overview()', 'execute') then
    raise exception 'ai_agents_overview: executable by anon or authenticated';
  end if;
  if not has_function_privilege('app_runtime', 'private.ai_agents_overview()', 'execute') then
    raise exception 'ai_agents_overview: app_runtime cannot execute';
  end if;
  if (select prosecdef from pg_proc where oid = 'private.ai_agents_overview()'::regprocedure) is not true then
    raise exception 'ai_agents_overview: not security definer';
  end if;
  if has_function_privilege('anon', 'private.ai_usage_overview(timestamptz)', 'execute')
     or has_function_privilege('authenticated', 'private.ai_usage_overview(timestamptz)', 'execute')
     or not has_function_privilege('app_runtime', 'private.ai_usage_overview(timestamptz)', 'execute') then
    raise exception 'ai_usage_overview: wrong grants';
  end if;
end
$$;
