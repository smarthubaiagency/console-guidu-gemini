-- ============================================================================
-- Migration: 20261119090000_cf6a_ai_providers.sql
-- Module: CF6a — IA: provedores e modelos (/mnt/project-files/configuracoes/
--         plano-cf6a.md, levantamento item 11)
--
-- Maintenance Rationale:
-- 1. The providers, the model catalog and the platform's base URLs are keys
--    of the settings cascade (ADR 0018, `ai.providers`, `ai.models`,
--    `ai.base_urls`): no table here.
-- 2. `ai_usage_events.error_code`: a model call that failed is recorded as
--    usage with zero tokens and the error code, so the AI dashboard counts
--    requests and errors by provider and by partner from the same rows.
--    No screen sums usage rows, so the customer's consumption is unchanged.
--    The insert policy of the A2b already covers these rows.
-- 3. The partner reads the usage of the workspaces of its customers
--    (owner, admin, finance and support), for the dashboard of its
--    customers. The admin key usage policy of the A2a stays as it is.
-- 4. `private.ai_agents_overview()`: the dashboard of the platform counts
--    the agents by state, provider and model (aggregates only: no names,
--    no configuration), for the house's owner and operations. Security
--    definer (app_rls_helper); the helper sees the agents only while the
--    function runs, by a flag set and restored inside it (I5 pattern).
-- 5. `private.ai_usage_overview(since)`: usage and errors by partner and
--    provider for the same roles, with the partner of each customer row
--    taken from its organization (customer rows carry no partner). Same
--    flag pattern; organizations are read by the helper policy of the
--    platform admins (sma100).
-- Owner app_migrations. Functions owned by app_rls_helper get their grants
-- before the ownership transfer (app_migrations is NOINHERIT).
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Failed calls in the usage
-- ----------------------------------------------------------------------------
alter table public.ai_usage_events
  add column error_code text
    check (error_code is null or length(error_code) between 1 and 80);

create index ai_usage_events_created_idx
  on public.ai_usage_events (created_at desc);

-- ----------------------------------------------------------------------------
-- 2. The partner reads its customers' usage
-- ----------------------------------------------------------------------------
create policy ai_usage_events_partner_customers_select on public.ai_usage_events
  for select to app_runtime
  using (
    organization_id is not null
    and private.current_partner_role() in ('partner_owner', 'partner_admin', 'partner_finance', 'partner_support')
    and private.is_partner_organization(organization_id)
  );

-- ----------------------------------------------------------------------------
-- 3. Agents by state, provider and model, for the platform's dashboard
-- ----------------------------------------------------------------------------
create policy ai_agents_overview_helper_select on public.ai_agents
  for select to app_rls_helper
  using (current_setting('app.ai_agents_overview', true) = 'on');

grant select (kind, partner_id, organization_id, status, key_state, config)
  on public.ai_agents to app_rls_helper;

create function private.ai_agents_overview()
returns table(
  kind text,
  partner_id uuid,
  organization_id uuid,
  status text,
  key_state text,
  provider text,
  model text,
  agents bigint
)
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_previous text := current_setting('app.ai_agents_overview', true);
begin
  if coalesce(private.current_platform_admin_role() in ('owner', 'operations'), false) is not true then
    return;
  end if;
  perform set_config('app.ai_agents_overview', 'on', true);
  return query
    select agent.kind, agent.partner_id, agent.organization_id, agent.status, agent.key_state,
           nullif(agent.config -> 'model' ->> 'model_provider', ''),
           nullif(agent.config -> 'model' ->> 'model_name', ''),
           count(*)
    from public.ai_agents agent
    group by 1, 2, 3, 4, 5, 6, 7;
  perform set_config('app.ai_agents_overview', coalesce(v_previous, ''), true);
end;
$$;

revoke execute on function private.ai_agents_overview() from public, anon, authenticated;
grant execute on function private.ai_agents_overview() to app_runtime;
alter function private.ai_agents_overview() owner to app_rls_helper;

-- ----------------------------------------------------------------------------
-- 4. Usage by partner and provider, for the platform's dashboard
-- ----------------------------------------------------------------------------
create policy ai_usage_events_overview_helper_select on public.ai_usage_events
  for select to app_rls_helper
  using (current_setting('app.ai_usage_overview', true) = 'on');

grant select (partner_id, organization_id, key_source, provider, model, input_tokens, output_tokens, error_code, created_at)
  on public.ai_usage_events to app_rls_helper;

create function private.ai_usage_overview(p_since timestamptz)
returns table(
  partner_id uuid,
  provider text,
  key_source text,
  error_code text,
  requests bigint,
  input_tokens bigint,
  output_tokens bigint
)
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_previous text := current_setting('app.ai_usage_overview', true);
begin
  if coalesce(private.current_platform_admin_role() in ('owner', 'operations'), false) is not true then
    return;
  end if;
  perform set_config('app.ai_usage_overview', 'on', true);
  return query
    select coalesce(usage.partner_id, organization.partner_id), usage.provider, usage.key_source,
           usage.error_code, count(*), coalesce(sum(usage.input_tokens), 0)::bigint,
           coalesce(sum(usage.output_tokens), 0)::bigint
    from public.ai_usage_events usage
    left join public.organizations organization on organization.id = usage.organization_id
    where usage.created_at >= p_since
    group by 1, 2, 3, 4;
  perform set_config('app.ai_usage_overview', coalesce(v_previous, ''), true);
end;
$$;

revoke execute on function private.ai_usage_overview(timestamptz) from public, anon, authenticated;
grant execute on function private.ai_usage_overview(timestamptz) to app_runtime;
alter function private.ai_usage_overview(timestamptz) owner to app_rls_helper;
