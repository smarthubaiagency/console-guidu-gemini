-- ============================================================================
-- Migration: 20261014090000_f3b_contract_and_limits.sql
-- Module: F3b — Contracting in module access and quotas (plano F3,
--         decision 3; Especificação §18; AC08)
--
-- Maintenance Rationale:
-- 1. `plan_versions.limits`: quota limits per version, `{ "<key>": n }`
--    (e.g. `core.seats`, `hello-world.records`). Versions stay insert-only;
--    existing rows get `{}` (no limit from the plan; defaults apply).
-- 2. `private.organization_contract(org)`: the plan contract of a company,
--    for every member of it, not only owners/admins (who alone read
--    `subscriptions` through RLS). It returns the open subscription, or the
--    latest canceled one when none is open, or no row (legacy: no
--    subscription). Security definer owned by app_rls_helper, which reads
--    subscriptions only of companies the context user belongs to.
-- Owner app_migrations; function grants come before the ownership transfer.
-- ============================================================================

alter table public.plan_versions
  add column limits jsonb not null default '{}'::jsonb
    check (jsonb_typeof(limits) = 'object' and pg_column_size(limits) <= 4096);

-- ----------------------------------------------------------------------------
-- Helper principal reads, scoped to the context user's companies
-- ----------------------------------------------------------------------------
create policy subscriptions_helper_select on public.subscriptions
  for select to app_rls_helper
  using (
    exists (
      select 1 from public.organization_members member
      where member.organization_id = subscriptions.organization_id
        and member.user_id = private.context_uuid('app.user_id')
        and member.status = 'active'
    )
    or exists (
      select 1 from public.workspace_members member
      where member.organization_id = subscriptions.organization_id
        and member.user_id = private.context_uuid('app.user_id')
        and member.status = 'active'
    )
  );

create policy plans_helper_select on public.plans
  for select to app_rls_helper
  using (true);

create policy plan_versions_helper_select on public.plan_versions
  for select to app_rls_helper
  using (true);

grant select on public.subscriptions, public.plans, public.plan_versions to app_rls_helper;

create function private.organization_contract(p_organization_id uuid)
returns table(
  status       text,
  plan_name    text,
  plan_version integer,
  module_keys  text[],
  limits       jsonb,
  provisional  boolean
)
language sql
stable
security definer
set search_path = ''
as $$
  select subscription.status, plan.name, version.version, version.module_keys,
         version.limits, version.provisional
  from public.subscriptions subscription
  join public.plan_versions version on version.id = subscription.plan_version_id
  join public.plans plan on plan.id = version.plan_id
  where subscription.organization_id = p_organization_id
  order by (subscription.status <> 'canceled') desc, subscription.created_at desc
  limit 1;
$$;

revoke execute on function private.organization_contract(uuid) from public, anon, authenticated;
grant execute on function private.organization_contract(uuid) to app_runtime;
alter function private.organization_contract(uuid) owner to app_rls_helper;
