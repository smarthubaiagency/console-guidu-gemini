-- ============================================================================
-- Migration: 20261104090000_a4b_guid_test.sql
-- Module: A4b — "Testar agente" (especificação v1.0 §5.3; plano-a4.md)
--
-- Maintenance Rationale:
-- 1. A GUIDS is turned on only after a successful test of its current
--    configuration (decision of 13/10/2026). The agent keeps the version it
--    passed with: `tested_config_hash` is `md5(config::text)` of the
--    configuration the test answered with (jsonb's text is canonical, so
--    the same document always gives the same hash), and `tested_at` says
--    when. Any change of the configuration, by the customer or the partner,
--    makes the hash differ and asks for a new test.
-- 2. The test is a turn of the engine, run as the person who talks, who may
--    be an editor (`ai_agents.use`), who does not update agents. A security
--    definer function (owner app_rls_helper, like the backup of the A2c)
--    records the pass, only on a GUIDS of the context's workspace and only
--    when the configuration is still the one tested. The turn answered with
--    the customer's key, so the same call ends a backup or a failed key
--    (`key_state = ok`), as a successful key test does.
-- 3. Nobody else writes those two columns: a trigger refuses the change from
--    app_runtime (the web and the worker), so an owner cannot mark an
--    untested configuration as tested.
-- ============================================================================

alter table public.ai_agents
  add column tested_config_hash text check (tested_config_hash ~ '^[0-9a-f]{32}$'),
  add column tested_at timestamptz,
  add constraint ai_agents_tested_check check ((tested_config_hash is null) = (tested_at is null));

comment on column public.ai_agents.tested_config_hash is
  'md5(config::text) of the configuration of the last successful test (A4b).';

-- ----------------------------------------------------------------------------
-- 1. Only the function below records a test
-- ----------------------------------------------------------------------------
create function private.ai_agents_guard_test()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if (new.tested_config_hash is distinct from old.tested_config_hash
      or new.tested_at is distinct from old.tested_at)
     and current_user in ('app_runtime', 'app_worker') then
    raise exception 'ai agents: the test is recorded only by the engine'
      using errcode = 'insufficient_privilege';
  end if;
  return new;
end;
$$;

alter function private.ai_agents_guard_test() owner to app_migrations;
revoke execute on function private.ai_agents_guard_test() from public, anon, authenticated;

create trigger ai_agents_guard_test
  before update on public.ai_agents
  for each row execute function private.ai_agents_guard_test();

-- A new agent starts untested.
create function private.ai_agents_untested_insert()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if current_user in ('app_runtime', 'app_worker') then
    new.tested_config_hash := null;
    new.tested_at := null;
  end if;
  return new;
end;
$$;

alter function private.ai_agents_untested_insert() owner to app_migrations;
revoke execute on function private.ai_agents_untested_insert() from public, anon, authenticated;

create trigger ai_agents_untested_insert
  before insert on public.ai_agents
  for each row execute function private.ai_agents_untested_insert();

-- ----------------------------------------------------------------------------
-- 2. The pass, from the turn (owned by app_rls_helper)
-- ----------------------------------------------------------------------------
-- Only while the function runs (flag set and restored, I5 pattern), on a
-- GUIDS of the context's workspace, for who may talk to it.
create policy ai_agents_test_helper_update on public.ai_agents
  for update to app_rls_helper
  using (
    kind = 'guid'
    and current_setting('app.ai_test_pass', true) = 'on'
    and workspace_id = private.context_uuid('app.workspace_id')
    and organization_id = private.context_uuid('app.organization_id')
    and private.current_workspace_role() in ('owner', 'admin', 'editor')
  )
  with check (
    kind = 'guid'
    and key_state = 'ok'
    and backup_started_at is null
    and tested_config_hash is not null
    and workspace_id = private.context_uuid('app.workspace_id')
    and organization_id = private.context_uuid('app.organization_id')
  );

grant update (tested_config_hash, tested_at) on public.ai_agents to app_rls_helper;

-- Records that the configuration with this hash answered a test with the
-- customer's key. False when the configuration changed meanwhile or the
-- agent is not of the context's workspace.
create function private.ai_agent_test_passed(p_agent_id uuid, p_config_hash text)
returns boolean
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_previous text := current_setting('app.ai_test_pass', true);
  v_count integer;
begin
  perform set_config('app.ai_test_pass', 'on', true);
  update public.ai_agents agent
  set tested_config_hash = p_config_hash,
      tested_at = now(),
      key_state = 'ok',
      backup_started_at = null
  where agent.id = p_agent_id
    and agent.kind = 'guid'
    and md5(agent.config::text) = p_config_hash;
  get diagnostics v_count = row_count;
  perform set_config('app.ai_test_pass', coalesce(v_previous, ''), true);
  return v_count = 1;
end;
$$;

revoke execute on function private.ai_agent_test_passed(uuid, text) from public, anon, authenticated;
grant execute on function private.ai_agent_test_passed(uuid, text) to app_runtime;
alter function private.ai_agent_test_passed(uuid, text) owner to app_rls_helper;
