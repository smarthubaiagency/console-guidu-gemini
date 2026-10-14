-- ============================================================================
-- Migration: 20261114090000_cf4_plans_limits.sql
-- Module: CF4 — Planos e limites: one catalog of quota keys with the
--         platform ceiling and the value of each plan
--         (/mnt/project-files/configuracoes/levantamento.md, closing list
--         item 1; menus-admin-app.md, CF4)
--
-- Maintenance Rationale:
-- 1. The quota keys themselves (label, unit, scope, enforced or planned)
--    live in the code catalog (`src/core/entitlements/catalog.ts`); the
--    value of each plan stays in `plan_versions.limits` (F3b), insert-only
--    as before. A plan value may now be JSON null: "sem limite".
-- 2. `public.quota_ceilings`: the platform ceiling per quota key. A key
--    without a row has no ceiling. It is a table, not a key of the settings
--    cascade, because the keys are many and dynamic (modules declare
--    theirs), only the platform sets them, and the people who set them are
--    the billing managers (owner and billing), not the settings managers.
--    Readable by any signed-in context, like the plan catalog.
-- 3. Two guards repeat the rule of the application in the database:
--    - a plan version may not hold a value above the ceiling of its key,
--      nor "sem limite" (null) where a ceiling exists, and every value is
--      a whole number from 0 to 1,000,000 or null;
--    - a ceiling may not go below the current version of an active plan
--      (or under its "sem limite"). Older versions, kept by their
--      subscriptions, are not checked: they were valid when published.
--    Both are security invoker: the caller reads the ceilings and the plan
--    catalog through their own policies (any signed-in context).
-- Owner app_migrations, ENABLE + FORCE RLS, no grants to anon/authenticated.
-- ============================================================================

create table public.quota_ceilings (
  quota_key  text primary key
               check (quota_key ~ '^[a-z][a-z0-9-]*(\.[a-z][a-z0-9_]*)+$'
                      and length(quota_key) <= 80),
  ceiling    integer not null check (ceiling between 0 and 1000000),
  updated_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.quota_ceilings owner to app_migrations;
revoke all on public.quota_ceilings from public, anon, authenticated;
alter table public.quota_ceilings enable row level security;
alter table public.quota_ceilings force row level security;

create trigger quota_ceilings_touch_updated_at
  before update on public.quota_ceilings
  for each row execute function private.touch_updated_at();

-- The ceilings are not secret: plans and their limits are shown to
-- partners, and the platform pages read them.
create policy quota_ceilings_select on public.quota_ceilings
  for select to app_runtime
  using (private.context_uuid('app.user_id') is not null);

create policy quota_ceilings_insert on public.quota_ceilings
  for insert to app_runtime
  with check (
    private.can_manage_platform_billing()
    and updated_by = private.context_uuid('app.user_id')
  );

create policy quota_ceilings_update on public.quota_ceilings
  for update to app_runtime
  using (private.can_manage_platform_billing())
  with check (
    private.can_manage_platform_billing()
    and updated_by = private.context_uuid('app.user_id')
  );

create policy quota_ceilings_delete on public.quota_ceilings
  for delete to app_runtime
  using (private.can_manage_platform_billing());

-- The key never changes: removing the ceiling deletes the row.
grant select, insert, delete on public.quota_ceilings to app_runtime;
grant update (ceiling, updated_by, updated_at) on public.quota_ceilings to app_runtime;

-- ----------------------------------------------------------------------------
-- Plan versions within the ceilings
-- ----------------------------------------------------------------------------
create function private.plan_versions_check_limits()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_key     text;
  v_value   jsonb;
  v_ceiling integer;
begin
  -- Not an object: the check constraint of the column refuses it.
  if jsonb_typeof(new.limits) <> 'object' then
    return new;
  end if;
  for v_key, v_value in select key, value from jsonb_each(new.limits) loop
    if jsonb_typeof(v_value) = 'null' then
      select ceiling into v_ceiling from public.quota_ceilings where quota_key = v_key;
      if found then
        raise exception 'plan limit % cannot be unlimited under the ceiling %', v_key, v_ceiling
          using errcode = 'check_violation';
      end if;
      continue;
    end if;
    if jsonb_typeof(v_value) <> 'number'
       or v_value::text !~ '^[0-9]+$'
       or v_value::numeric > 1000000 then
      raise exception 'plan limit % must be a whole number from 0 to 1000000 or null', v_key
        using errcode = 'check_violation';
    end if;
    select ceiling into v_ceiling from public.quota_ceilings where quota_key = v_key;
    if found and v_value::numeric > v_ceiling then
      raise exception 'plan limit % above the ceiling %', v_key, v_ceiling
        using errcode = 'check_violation';
    end if;
  end loop;
  return new;
end;
$$;

alter function private.plan_versions_check_limits() owner to app_migrations;
revoke execute on function private.plan_versions_check_limits() from public, anon, authenticated;

create trigger plan_versions_check_limits
  before insert on public.plan_versions
  for each row execute function private.plan_versions_check_limits();

-- ----------------------------------------------------------------------------
-- Ceilings above the plans on sale
-- ----------------------------------------------------------------------------
create function private.quota_ceilings_check_plans()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_plan text;
begin
  select plan.name into v_plan
  from public.plans plan
  cross join lateral (
    select version.limits
    from public.plan_versions version
    where version.plan_id = plan.id
    order by version.version desc
    limit 1
  ) current_version
  where plan.status = 'active'
    and current_version.limits ? new.quota_key
    and (jsonb_typeof(current_version.limits -> new.quota_key) = 'null'
         or (jsonb_typeof(current_version.limits -> new.quota_key) = 'number'
             and (current_version.limits ->> new.quota_key)::numeric > new.ceiling))
  limit 1;
  if found then
    raise exception 'ceiling of % below the current version of plan %', new.quota_key, v_plan
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

alter function private.quota_ceilings_check_plans() owner to app_migrations;
revoke execute on function private.quota_ceilings_check_plans() from public, anon, authenticated;

create trigger quota_ceilings_check_plans
  before insert or update of ceiling on public.quota_ceilings
  for each row execute function private.quota_ceilings_check_plans();
