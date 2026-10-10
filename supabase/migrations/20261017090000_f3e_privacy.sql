-- ============================================================================
-- Migration: 20261017090000_f3e_privacy.sql
-- Module: F3e — Privacy and recovery: workspace export, workspace deletion
--         with a 30-day grace period, retention by category (plano F3,
--         etapa F3e; Especificação §19, §20, AC12)
--
-- Maintenance Rationale:
-- 1. Workspace deletion is logical first (decision of 17/10/2026): the owner
--    asks for it, the workspace becomes `deletion_scheduled` and nobody
--    reaches its data for 30 days, while the owner may cancel. Afterwards a
--    platform job purges every workspace-scoped row and keeps the workspace
--    row as a tombstone (`deleted`, anonymized), so audit events and the
--    deletion record (`workspace_deletions`) keep pointing at it.
-- 2. `private.is_workspace_member` and `private.current_workspace_role`
--    now require an active workspace: every RLS policy built on them closes
--    a scheduled or deleted workspace at once, for the web, API keys, MCP
--    and the worker alike.
-- 3. Scheduling, cancelling and listing scheduled deletions go through
--    security definer functions owned by app_rls_helper, which check that
--    the caller is an active owner (never a support membership); the helper
--    already sees its members' workspaces and gets only the narrow update
--    and insert rights these functions need.
-- 4. `workspace_exports`: the export file lives in the database (bytea, up
--    to 25 MB; decision of 17/10/2026) and is served by an app route that
--    re-checks permission. Owner and admin ask; the export job writes the
--    file in the requester's context; files expire after 24 hours.
-- 5. Purge as app_worker: delete policies on each workspace-scoped table,
--    allowed only for a workspace past its grace period
--    (`private.workspace_purgeable`). Foreign key cascades below them run as
--    referential actions.
-- 6. `retention_policies`: one row per data category, all disabled until
--    the legal rules exist. Worker deletes of job runs and notices are
--    allowed only while their category is enabled (`private.retention_days`
--    returns null otherwise), so the database itself keeps retention off.
-- Owner app_migrations, ENABLE + FORCE RLS, no grants to anon/authenticated.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Workspace lifecycle columns
-- ----------------------------------------------------------------------------
alter table public.workspaces drop constraint workspaces_status_check;
alter table public.workspaces add constraint workspaces_status_check
  check (status in ('active', 'suspended', 'inactive', 'deletion_scheduled', 'deleted'));

alter table public.workspaces
  add column deletion_requested_at timestamptz,
  add column deletion_requested_by uuid references public.profiles(id) on delete set null,
  add column purge_after           timestamptz,
  add column deleted_at            timestamptz,
  add constraint workspaces_deletion_state_check check (
    (status = 'deletion_scheduled' and purge_after is not null and deletion_requested_at is not null)
    or (status = 'deleted' and deleted_at is not null)
    or (status not in ('deletion_scheduled', 'deleted') and purge_after is null and deleted_at is null)
  );

create index workspaces_purge_idx on public.workspaces (purge_after)
  where status = 'deletion_scheduled';

-- ----------------------------------------------------------------------------
-- 2. Deletion records (kept after the purge)
-- ----------------------------------------------------------------------------
create table public.workspace_deletions (
  id              uuid primary key default gen_random_uuid(),
  workspace_id    uuid not null,
  organization_id uuid not null,
  workspace_slug  text not null,
  workspace_name  text not null,
  requested_by    uuid references public.profiles(id) on delete set null,
  requested_at    timestamptz not null default now(),
  purge_after     timestamptz not null,
  canceled_at     timestamptz,
  canceled_by     uuid references public.profiles(id) on delete set null,
  purged_at       timestamptz,
  purge_summary   jsonb check (purge_summary is null or pg_column_size(purge_summary) <= 4096),
  foreign key (workspace_id, organization_id)
    references public.workspaces(id, organization_id),
  check (canceled_at is null or purged_at is null)
);

create unique index workspace_deletions_open_idx on public.workspace_deletions (workspace_id)
  where canceled_at is null and purged_at is null;

alter table public.workspace_deletions owner to app_migrations;
revoke all on public.workspace_deletions from public, anon, authenticated;
alter table public.workspace_deletions enable row level security;
alter table public.workspace_deletions force row level security;

create policy workspace_deletions_platform_select on public.workspace_deletions
  for select to app_runtime
  using (private.current_platform_admin_role() is not null);

grant select on public.workspace_deletions to app_runtime;

-- Definer functions (owned by app_rls_helper) schedule and cancel.
create policy workspace_deletions_helper_select on public.workspace_deletions
  for select to app_rls_helper
  using (true);

create policy workspace_deletions_helper_insert on public.workspace_deletions
  for insert to app_rls_helper
  with check (
    requested_by = private.context_uuid('app.user_id')
    and canceled_at is null and purged_at is null
  );

create policy workspace_deletions_helper_update on public.workspace_deletions
  for update to app_rls_helper
  using (canceled_at is null and purged_at is null)
  with check (canceled_by = private.context_uuid('app.user_id') and purged_at is null);

grant select, insert, update on public.workspace_deletions to app_rls_helper;

-- The purge job closes the record.
create policy workspace_deletions_worker_select on public.workspace_deletions
  for select to app_worker
  using (true);

create policy workspace_deletions_worker_update on public.workspace_deletions
  for update to app_worker
  using (canceled_at is null and purged_at is null)
  with check (purged_at is not null and canceled_at is null);

grant select on public.workspace_deletions to app_worker;
grant update (purged_at, purge_summary) on public.workspace_deletions to app_worker;

-- ----------------------------------------------------------------------------
-- 3. Workspace transitions for the definer functions and the worker
-- ----------------------------------------------------------------------------
create policy workspaces_helper_schedule_deletion on public.workspaces
  for update to app_rls_helper
  using (status in ('active', 'deletion_scheduled'))
  with check (status in ('active', 'deletion_scheduled'));

grant update (status, deletion_requested_at, deletion_requested_by, purge_after, updated_at)
  on public.workspaces to app_rls_helper;

create policy workspaces_worker_select on public.workspaces
  for select to app_worker
  using (status in ('deletion_scheduled', 'deleted'));

create policy workspaces_worker_purge on public.workspaces
  for update to app_worker
  using (status = 'deletion_scheduled' and purge_after <= now())
  with check (status = 'deleted' and deleted_at is not null and purge_after is null);

grant select (id, organization_id, slug, name, status, purge_after, deleted_at)
  on public.workspaces to app_worker;
grant update (status, name, slug, purge_after, deleted_at, updated_at)
  on public.workspaces to app_worker;

-- A workspace whose grace period is over; evaluated as app_worker.
-- Policies and triggers below call private functions as app_worker. No
-- private function is executable by PUBLIC, so usage alone opens nothing.
grant usage on schema private to app_worker;

create function private.workspace_purgeable(p_workspace_id uuid)
returns boolean
language sql
stable
security invoker
set search_path = ''
as $$
  select exists (
    select 1 from public.workspaces w
    where w.id = p_workspace_id
      and w.status = 'deletion_scheduled'
      and w.purge_after <= now()
  );
$$;

alter function private.workspace_purgeable(uuid) owner to app_migrations;
revoke execute on function private.workspace_purgeable(uuid) from public, anon, authenticated;
grant execute on function private.workspace_purgeable(uuid) to app_worker;

do $$
declare
  t text;
begin
  foreach t in array array[
    'workspace_members', 'invitations', 'api_keys', 'credentials', 'workspace_modules',
    'job_runs', 'partner_support_grants', 'hello_world_records',
    'agent_messages', 'agent_sessions', 'agent_configs'
  ] loop
    execute format(
      'create policy %I on public.%I for delete to app_worker using (private.workspace_purgeable(workspace_id))',
      t || '_worker_purge', t
    );
    -- A delete with a filter also needs the rows visible to the worker.
    execute format(
      'create policy %I on public.%I for select to app_worker using (private.workspace_purgeable(workspace_id))',
      t || '_worker_purge_select', t
    );
    execute format('grant select (workspace_id), delete on public.%I to app_worker', t);
  end loop;
end
$$;

-- The membership invariants (AC04) protect the last owner from people; the
-- purge of a workspace past its grace period removes every member.
create or replace function private.enforce_workspace_members_invariants()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $fn$
declare
  v_actor_ws_role text;
  v_actor_org_role text;
  v_is_owner boolean;
  v_actor_user_id uuid;
  v_has_valid_invitation boolean;
  v_old_rank integer;
  v_new_rank integer;
  remaining_owners integer;
begin
  if current_user = 'app_worker' then
    if tg_op = 'DELETE' and private.workspace_purgeable(old.workspace_id) then
      return old;
    end if;
    raise exception 'workspace members: the worker only purges deleted workspaces'
      using errcode = 'insufficient_privilege';
  end if;

  -- Skip enforcement if maintenance is run by migration administrator without tenant context
  if current_user in ('app_migrations', 'postgres') and private.context_uuid('app.workspace_id') is null then
    return coalesce(new, old);
  end if;

  v_actor_ws_role := private.current_workspace_role();
  v_actor_org_role := private.current_organization_role();
  v_is_owner := (v_actor_ws_role = 'owner' or v_actor_org_role = 'owner');
  v_actor_user_id := private.context_uuid('app.user_id');

  -- 1. Check assigning role = 'owner' (INSERT or UPDATE)
  if tg_op in ('INSERT', 'UPDATE') and new.role = 'owner' then
    v_has_valid_invitation := (
      current_setting('app.invitation_token_hash', true) is not null
      and current_setting('app.invitation_token_hash', true) <> ''
      and exists (
        select 1
        from public.invitations inv
        where inv.organization_id = new.organization_id
          and inv.workspace_id = new.workspace_id
          and inv.token_hash = current_setting('app.invitation_token_hash', true)
          and inv.role = 'owner'
          and inv.status = 'pending'
          and inv.expires_at > now()
      )
    );

    if not v_is_owner and not v_has_valid_invitation then
      raise exception 'Only an owner can assign the owner role (AC04)'
        using errcode = 'P0001';
    end if;
  end if;

  -- 2. Check modifying or removing an existing owner (UPDATE or DELETE)
  if tg_op in ('UPDATE', 'DELETE') and old.role = 'owner' then
    if not v_is_owner then
      raise exception 'Only an owner can modify or remove an owner (AC04)'
        using errcode = 'P0001';
    end if;
  end if;

  -- 3. Check escalating own role upwards (UPDATE)
  if tg_op = 'UPDATE' and v_actor_user_id is not null and old.user_id = v_actor_user_id then
    v_old_rank := case old.role
      when 'owner' then 4
      when 'admin' then 3
      when 'editor' then 2
      when 'viewer' then 1
      else 0
    end;

    v_new_rank := case new.role
      when 'owner' then 4
      when 'admin' then 3
      when 'editor' then 2
      when 'viewer' then 1
      else 0
    end;

    if v_new_rank > v_old_rank then
      raise exception 'Cannot escalate own role (AC04)'
        using errcode = 'P0001';
    end if;
  end if;

  -- 4. Check protecting the last active owner of the workspace (UPDATE or DELETE)
  if tg_op in ('UPDATE', 'DELETE') and old.role = 'owner' and old.status = 'active' then
    -- If UPDATE leaves the record as an active owner, no demotion or deactivation occurs
    if tg_op = 'UPDATE' and new.role = 'owner' and new.status = 'active' then
      return new;
    end if;

    select count(*)
    into remaining_owners
    from public.workspace_members
    where workspace_id = old.workspace_id
      and user_id <> old.user_id
      and role = 'owner'
      and status = 'active';

    if remaining_owners < 1 then
      raise exception 'Cannot remove, revoke or demote the last active owner of a workspace (AC04)'
        using errcode = 'P0001';
    end if;
  end if;

  if tg_op = 'DELETE' then
    return old;
  else
    return new;
  end if;
end;
$fn$;

-- ----------------------------------------------------------------------------
-- 4. Workspace exports
-- ----------------------------------------------------------------------------
create table public.workspace_exports (
  id              uuid primary key default gen_random_uuid(),
  workspace_id    uuid not null,
  organization_id uuid not null,
  requested_by    uuid not null references public.profiles(id) on delete cascade,
  status          text not null default 'pending'
                    check (status in ('pending', 'running', 'ready', 'failed', 'expired')),
  file            bytea check (file is null or octet_length(file) <= 26214400),
  file_size       integer check (file_size is null or file_size >= 0),
  sha256          text check (sha256 is null or sha256 ~ '^[0-9a-f]{64}$'),
  error           text check (error is null or length(error) <= 500),
  expires_at      timestamptz,
  created_at      timestamptz not null default now(),
  finished_at     timestamptz,
  updated_at      timestamptz not null default now(),
  foreign key (workspace_id, organization_id)
    references public.workspaces(id, organization_id) on delete cascade,
  check ((status = 'ready') = (file is not null)),
  check (status <> 'ready' or (expires_at is not null and sha256 is not null and file_size is not null))
);

create index workspace_exports_workspace_idx on public.workspace_exports (workspace_id, created_at desc);
create index workspace_exports_expiry_idx on public.workspace_exports (expires_at) where status = 'ready';

alter table public.workspace_exports owner to app_migrations;
revoke all on public.workspace_exports from public, anon, authenticated;
alter table public.workspace_exports enable row level security;
alter table public.workspace_exports force row level security;

create trigger workspace_exports_touch_updated_at
  before update on public.workspace_exports
  for each row execute function private.touch_updated_at();

create policy workspace_exports_select on public.workspace_exports
  for select to app_runtime
  using (
    private.is_workspace_member(workspace_id, organization_id)
    and private.current_workspace_role() in ('owner', 'admin')
  );

create policy workspace_exports_insert on public.workspace_exports
  for insert to app_runtime
  with check (
    status = 'pending'
    and file is null
    and requested_by = private.context_uuid('app.user_id')
    and private.is_workspace_member(workspace_id, organization_id)
    and private.current_workspace_role() in ('owner', 'admin')
  );

-- The export job runs in the requester's context and writes the file once.
create policy workspace_exports_job_update on public.workspace_exports
  for update to app_runtime
  using (
    status in ('pending', 'running')
    and requested_by = private.context_uuid('app.user_id')
    and private.is_workspace_member(workspace_id, organization_id)
    and private.current_workspace_role() in ('owner', 'admin')
  )
  with check (
    status in ('running', 'ready', 'failed')
    and requested_by = private.context_uuid('app.user_id')
    and private.is_workspace_member(workspace_id, organization_id)
    and private.current_workspace_role() in ('owner', 'admin')
  );

grant select, insert, update on public.workspace_exports to app_runtime;

-- Expiry: the worker drops files past their date.
create policy workspace_exports_worker_select on public.workspace_exports
  for select to app_worker
  using (true);

create policy workspace_exports_worker_expire on public.workspace_exports
  for update to app_worker
  using (status = 'ready' and expires_at <= now())
  with check (status = 'expired' and file is null);

grant select (id, workspace_id, status, expires_at) on public.workspace_exports to app_worker;
grant update (status, file, updated_at) on public.workspace_exports to app_worker;

create policy workspace_exports_worker_purge on public.workspace_exports
  for delete to app_worker
  using (private.workspace_purgeable(workspace_id));

grant delete on public.workspace_exports to app_worker;

-- ----------------------------------------------------------------------------
-- 5. Retention by category (all disabled)
-- ----------------------------------------------------------------------------
create table public.retention_policies (
  category    text primary key check (category ~ '^[a-z][a-z_]*$' and length(category) <= 48),
  description text not null check (length(description) between 1 and 200),
  retain_days integer check (retain_days is null or retain_days between 1 and 3650),
  enabled     boolean not null default false,
  automated   boolean not null,
  legal_basis text check (legal_basis is null or length(legal_basis) <= 500),
  updated_at  timestamptz not null default now(),
  check (not enabled or (retain_days is not null and legal_basis is not null and automated))
);

insert into public.retention_policies (category, description, automated) values
  ('job_runs', 'Execuções de jobs concluídas (tela de Execuções e operações).', true),
  ('notification_deliveries', 'Registros de avisos enviados ou não enviados.', true),
  ('audit_events', 'Eventos de auditoria; remoção só por processo restrito.', false),
  ('workspace_deletions', 'Registros de exclusão de workspaces.', false);

alter table public.retention_policies owner to app_migrations;
revoke all on public.retention_policies from public, anon, authenticated;
alter table public.retention_policies enable row level security;
alter table public.retention_policies force row level security;

-- Changes come by migration, once the legal rules exist.
create policy retention_policies_platform_select on public.retention_policies
  for select to app_runtime
  using (private.current_platform_admin_role() is not null);

create policy retention_policies_worker_select on public.retention_policies
  for select to app_worker
  using (true);

grant select on public.retention_policies to app_runtime, app_worker;

-- Days to keep a category, or null when its retention is off.
create function private.retention_days(p_category text)
returns integer
language sql
stable
security invoker
set search_path = ''
as $$
  select r.retain_days
  from public.retention_policies r
  where r.category = p_category and r.enabled and r.automated;
$$;

alter function private.retention_days(text) owner to app_migrations;
revoke execute on function private.retention_days(text) from public, anon, authenticated;
grant execute on function private.retention_days(text) to app_worker;

create policy job_runs_worker_retention on public.job_runs
  for delete to app_worker
  using (
    status in ('succeeded', 'failed', 'skipped', 'canceled')
    and finished_at < now() - make_interval(days => private.retention_days('job_runs'))
  );

create policy notification_deliveries_worker_retention on public.notification_deliveries
  for delete to app_worker
  using (
    status <> 'pending'
    and created_at < now() - make_interval(days => private.retention_days('notification_deliveries'))
  );

grant delete on public.notification_deliveries to app_worker;

-- ----------------------------------------------------------------------------
-- 6. Membership helpers require an active workspace; deletion functions
-- ----------------------------------------------------------------------------
set local role app_rls_helper;

create or replace function private.is_workspace_member(
  p_workspace_id uuid,
  p_organization_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select p_workspace_id = private.context_uuid('app.workspace_id')
    and p_organization_id = private.context_uuid('app.organization_id')
    and exists (
      select 1
      from public.workspace_members member
      join public.workspaces workspace
        on workspace.id = member.workspace_id
       and workspace.organization_id = member.organization_id
      where member.workspace_id = p_workspace_id
        and member.organization_id = p_organization_id
        and member.user_id = private.context_uuid('app.user_id')
        and member.status = 'active'
        and workspace.status = 'active'
        and (
          member.support_grant_id is null
          or private.support_grant_valid(member.support_grant_id, member.user_id, member.workspace_id)
        )
    );
$$;

create or replace function private.current_workspace_role()
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select member.role
  from public.workspace_members member
  join public.workspaces workspace
    on workspace.id = member.workspace_id
   and workspace.organization_id = member.organization_id
  where member.workspace_id = private.context_uuid('app.workspace_id')
    and member.organization_id = private.context_uuid('app.organization_id')
    and member.user_id = private.context_uuid('app.user_id')
    and member.status = 'active'
    and workspace.status = 'active'
    and (
      member.support_grant_id is null
      or private.support_grant_valid(member.support_grant_id, member.user_id, member.workspace_id)
    );
$$;

-- Schedules the deletion of the context workspace; only its active owner
-- (never a support membership). Returns the deletion record id.
create function private.request_workspace_deletion(p_grace_days integer)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_workspace public.workspaces%rowtype;
  v_id uuid;
begin
  if p_grace_days is distinct from 30 then
    raise exception 'workspace deletion: grace period must be 30 days' using errcode = 'check_violation';
  end if;
  select w.* into v_workspace
  from public.workspaces w
  where w.id = private.context_uuid('app.workspace_id')
    and w.organization_id = private.context_uuid('app.organization_id')
    and w.status = 'active'
  for update;
  if not found or not exists (
    select 1 from public.workspace_members member
    where member.workspace_id = v_workspace.id
      and member.organization_id = v_workspace.organization_id
      and member.user_id = private.context_uuid('app.user_id')
      and member.status = 'active'
      and member.role = 'owner'
      and member.support_grant_id is null
  ) then
    raise exception 'workspace deletion: only an active owner may ask' using errcode = 'insufficient_privilege';
  end if;

  update public.workspaces
  set status = 'deletion_scheduled',
      deletion_requested_at = now(),
      deletion_requested_by = private.context_uuid('app.user_id'),
      purge_after = now() + make_interval(days => p_grace_days)
  where id = v_workspace.id;

  insert into public.workspace_deletions
    (workspace_id, organization_id, workspace_slug, workspace_name, requested_by, purge_after)
  values
    (v_workspace.id, v_workspace.organization_id, v_workspace.slug, v_workspace.name,
     private.context_uuid('app.user_id'), now() + make_interval(days => p_grace_days))
  returning id into v_id;
  return v_id;
end;
$$;

-- Cancels a scheduled deletion during the grace period; active owner only.
create function private.cancel_workspace_deletion(p_workspace_id uuid)
returns boolean
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_workspace public.workspaces%rowtype;
begin
  select w.* into v_workspace
  from public.workspaces w
  where w.id = p_workspace_id
    and w.status = 'deletion_scheduled'
    and w.purge_after > now()
    and exists (
      select 1 from public.workspace_members member
      where member.workspace_id = w.id
        and member.organization_id = w.organization_id
        and member.user_id = private.context_uuid('app.user_id')
        and member.status = 'active'
        and member.role = 'owner'
        and member.support_grant_id is null
    )
  for update;
  if not found then
    return false;
  end if;

  update public.workspaces
  set status = 'active',
      deletion_requested_at = null,
      deletion_requested_by = null,
      purge_after = null
  where id = v_workspace.id;

  update public.workspace_deletions
  set canceled_at = now(), canceled_by = private.context_uuid('app.user_id')
  where workspace_id = v_workspace.id and canceled_at is null and purged_at is null;
  return true;
end;
$$;

-- Scheduled deletions the caller may cancel, on the request's partner.
create function private.list_scheduled_deletions()
returns table(
  workspace_id uuid,
  organization_id uuid,
  workspace_name text,
  workspace_slug text,
  requested_at timestamptz,
  purge_after timestamptz
)
language sql
stable
security definer
set search_path = ''
as $$
  select w.id, w.organization_id, w.name, w.slug, w.deletion_requested_at, w.purge_after
  from public.workspaces w
  join public.organizations o on o.id = w.organization_id
  where w.status = 'deletion_scheduled'
    and w.purge_after > now()
    and o.partner_id = private.current_partner_id()
    and exists (
      select 1 from public.workspace_members member
      where member.workspace_id = w.id
        and member.organization_id = w.organization_id
        and member.user_id = private.context_uuid('app.user_id')
        and member.status = 'active'
        and member.role = 'owner'
        and member.support_grant_id is null
    )
  order by w.purge_after;
$$;

revoke execute on function private.request_workspace_deletion(integer) from public, anon, authenticated;
revoke execute on function private.cancel_workspace_deletion(uuid) from public, anon, authenticated;
revoke execute on function private.list_scheduled_deletions() from public, anon, authenticated;
grant execute on function private.request_workspace_deletion(integer) to app_runtime;
grant execute on function private.cancel_workspace_deletion(uuid) to app_runtime;
grant execute on function private.list_scheduled_deletions() to app_runtime;

reset role;
