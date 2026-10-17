-- ============================================================================
-- Migration: 20261128090000_in3_matrix_core.sql
-- Module: IN3 — Matrix core of the Inbox (ADR 0023; docs/modules/inbox/
--         plano.md; prova-de-conceito.md, "Conclusão")
--
-- Maintenance Rationale:
-- 1. Conversations live in Synapse; the console keeps only what is its own,
--    linked by `room_id` (ADR 0023, rule 6): one Matrix account per person
--    (`matrix_accounts`, opaque localpart `u_...`, never the internal id),
--    the rooms of each workspace with the conversation status and assignee
--    mirrored from the room state (`matrix_rooms`), and who is in each room
--    (`matrix_room_members`). No message is copied.
-- 2. The Application Service has no user: the route checks the hs_token and
--    reaches the database only through `private.matrix_as_ingest` (owner
--    app_rls_helper), which records the transaction, the relevant events
--    (unique `event_id`, ADR 0011 rule 1) and one pending processing run.
--    Tables are visible to it only while it runs (flag `app.matrix_ingest`).
-- 3. Everything else is the worker's (platform jobs as app_worker): it
--    processes events, creates rooms, provisions accounts and purges.
--    Members with `inbox.view` read the rooms of their workspace; a person
--    reads (and, when eligible, creates or reactivates) only their own
--    account. The roles that hold `inbox.view` are listed once, in
--    `private.matrix_inbox_roles()`; the AT1 Attendant joins that list.
-- 4. Who may have an account is computed by the database, not the caller:
--    `private.matrix_user_memberships` and `private.matrix_workspace_people`
--    (owner app_rls_helper, flag `app.matrix_lookup`) return the active,
--    non-support memberships of active workspaces, the organization owner
--    standing in as workspace owner, as `getEffectiveWorkspaceRole` does.
-- 5. Jobs of the Matrix core are platform runs; web code and the worker
--    enqueue them through `private.matrix_enqueue` (one pending run per
--    kind and payload). They reconcile from the database, so enqueueing
--    one is harmless; logging out devices is allowed only for oneself.
-- 6. Purge of a deleted workspace (F3e): rooms and members are rows of the
--    workspace; the worker deletes them like every other table.
-- Owner app_migrations, ENABLE + FORCE RLS, no grants to anon/authenticated.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Tables
-- ----------------------------------------------------------------------------
create table public.matrix_accounts (
  profile_id     uuid primary key references public.profiles(id) on delete cascade,
  -- Opaque localpart: `u_` and 24 random base32 characters.
  localpart      text not null unique check (localpart ~ '^u_[a-z2-7]{24}$'),
  mxid           text not null unique check (length(mxid) between 4 and 255 and mxid like '@u\_%:%'),
  status         text not null default 'active' check (status in ('active', 'deactivated')),
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  deactivated_at timestamptz,
  constraint matrix_accounts_mxid_localpart check (mxid like '@' || localpart || ':%'),
  constraint matrix_accounts_deactivated check ((status = 'deactivated') = (deactivated_at is not null))
);

create table public.matrix_rooms (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  workspace_id    uuid not null,
  -- Null only while the room is being created on Synapse.
  room_id         text unique check (room_id is null or room_id ~ '^![^:]{1,200}(:.{1,255})?$'),
  origin          text not null check (origin in ('matrix', 'meta')),
  -- creating: row first, room on Synapse next; active: attendants in;
  -- blocked: workspace in soft deletion, attendants removed; closed: the
  -- room was deleted on Synapse.
  state           text not null default 'creating' check (state in ('creating', 'active', 'blocked', 'closed')),
  -- Mirror of the `chat.guidu.conversation` state event (the room owns it).
  status          text not null default 'pending' check (status in ('open', 'pending', 'resolved')),
  assignee        text check (assignee is null or (length(assignee) between 4 and 255 and assignee like '@%:%')),
  status_event_id text check (status_event_id is null or length(status_event_id) between 1 and 255),
  status_event_ts bigint,
  consumer_mxid   text check (consumer_mxid is null or (length(consumer_mxid) between 4 and 255 and consumer_mxid like '@%:%')),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  closed_at       timestamptz,
  constraint matrix_rooms_id_workspace_key unique (id, workspace_id),
  constraint matrix_rooms_room_id_present check (state = 'creating' or room_id is not null),
  constraint fk_matrix_rooms_workspace
    foreign key (workspace_id, organization_id)
    references public.workspaces(id, organization_id) on delete cascade
);

create index matrix_rooms_workspace_idx on public.matrix_rooms (workspace_id, state, updated_at desc);
create index matrix_rooms_assignee_idx on public.matrix_rooms (workspace_id, assignee) where assignee is not null;

create table public.matrix_room_members (
  room_id         text not null references public.matrix_rooms(room_id) on delete cascade,
  organization_id uuid not null,
  workspace_id    uuid not null,
  user_mxid       text not null check (length(user_mxid) between 4 and 255 and user_mxid like '@%:%'),
  membership      text not null check (membership in ('invite', 'join', 'leave', 'ban', 'knock')),
  event_ts        bigint,
  updated_at      timestamptz not null default now(),
  primary key (room_id, user_mxid),
  constraint fk_matrix_room_members_workspace
    foreign key (workspace_id, organization_id)
    references public.workspaces(id, organization_id) on delete cascade
);

create index matrix_room_members_user_idx on public.matrix_room_members (user_mxid, membership);
create index matrix_room_members_workspace_idx on public.matrix_room_members (workspace_id);

-- Bookkeeping of the Application Service transactions. With Synapse on
-- Postgres the txnId is a real sequence; events are deduplicated by their
-- own id anyway (SQLite restarts the txnId, prova-de-conceito.md §1).
create table public.matrix_as_transactions (
  txn_id      text primary key check (length(txn_id) between 1 and 255),
  event_count integer not null check (event_count >= 0),
  stored      integer not null check (stored >= 0),
  received_at timestamptz not null default now()
);

-- Relevant events only (membership and the conversation state), never a
-- message body: content keeps the few fields the processing reads.
create table public.matrix_events (
  event_id         text primary key check (length(event_id) between 1 and 255),
  txn_id           text not null check (length(txn_id) between 1 and 255),
  room_id          text not null check (length(room_id) between 1 and 255),
  type             text not null check (type in ('m.room.member', 'chat.guidu.conversation')),
  state_key        text check (state_key is null or length(state_key) <= 255),
  sender           text not null check (length(sender) between 1 and 255),
  content          jsonb not null check (jsonb_typeof(content) = 'object' and pg_column_size(content) <= 2048),
  origin_server_ts bigint,
  status           text not null default 'pending' check (status in ('pending', 'processed', 'ignored', 'failed')),
  attempts         integer not null default 0 check (attempts >= 0),
  last_error       text check (last_error is null or length(last_error) <= 300),
  received_at      timestamptz not null default now(),
  processed_at     timestamptz
);

create index matrix_events_pending_idx on public.matrix_events (received_at) where status = 'pending';
create index matrix_events_room_idx on public.matrix_events (room_id);

do $$
declare
  t text;
begin
  foreach t in array array['matrix_accounts', 'matrix_rooms', 'matrix_room_members', 'matrix_as_transactions', 'matrix_events'] loop
    execute format('alter table public.%I owner to app_migrations', t);
    execute format('revoke all on public.%I from public, anon, authenticated', t);
    execute format('alter table public.%I enable row level security', t);
    execute format('alter table public.%I force row level security', t);
  end loop;
  foreach t in array array['matrix_accounts', 'matrix_rooms'] loop
    execute format(
      'create trigger %I before update on public.%I for each row execute function private.touch_updated_at()',
      t || '_touch_updated_at', t
    );
  end loop;
end
$$;

-- Owner, room id, mxid and creation time never change.
create function private.matrix_guard_update()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if tg_table_name = 'matrix_accounts' then
    if new.profile_id is distinct from old.profile_id
       or new.localpart is distinct from old.localpart
       or new.mxid is distinct from old.mxid
       or new.created_at is distinct from old.created_at then
      raise exception 'matrix: an account keeps its person and mxid'
        using errcode = 'check_violation';
    end if;
  elsif tg_table_name = 'matrix_rooms' then
    if new.id is distinct from old.id
       or new.workspace_id is distinct from old.workspace_id
       or new.organization_id is distinct from old.organization_id
       or new.origin is distinct from old.origin
       or new.created_at is distinct from old.created_at
       or (old.room_id is not null and new.room_id is distinct from old.room_id) then
      raise exception 'matrix: a room keeps its workspace, origin and room id'
        using errcode = 'check_violation';
    end if;
  end if;
  return new;
end;
$$;

alter function private.matrix_guard_update() owner to app_migrations;
revoke execute on function private.matrix_guard_update() from public, anon, authenticated;

create trigger matrix_accounts_guard_update
  before update on public.matrix_accounts
  for each row execute function private.matrix_guard_update();
create trigger matrix_rooms_guard_update
  before update on public.matrix_rooms
  for each row execute function private.matrix_guard_update();

-- ----------------------------------------------------------------------------
-- 2. Who may have an account (owner app_rls_helper)
-- ----------------------------------------------------------------------------
-- Workspace roles holding `inbox.view` (src/core/permissions/matrix.ts).
-- The application checks the matrix; this list backs the policies.
create function private.matrix_inbox_roles()
returns text[]
language sql
immutable
set search_path = ''
as $$
  select array['owner', 'admin', 'editor']::text[];
$$;

alter function private.matrix_inbox_roles() owner to app_migrations;
revoke execute on function private.matrix_inbox_roles() from public, anon, authenticated;
grant execute on function private.matrix_inbox_roles() to app_runtime, app_worker, app_rls_helper;

create policy workspace_members_matrix_lookup on public.workspace_members
  for select to app_rls_helper
  using (current_setting('app.matrix_lookup', true) = 'on');
create policy organization_members_matrix_lookup on public.organization_members
  for select to app_rls_helper
  using (current_setting('app.matrix_lookup', true) = 'on');
create policy workspaces_matrix_lookup on public.workspaces
  for select to app_rls_helper
  using (current_setting('app.matrix_lookup', true) = 'on');
-- profiles keeps a single helper policy (tests/auth/profiles-rls.sql): the
-- one of the I5 plus the Matrix lookup.
drop policy profiles_admin_helper_select on public.profiles;
create policy profiles_admin_helper_select on public.profiles
  for select to app_rls_helper
  using (
    private.is_platform_admin()
    or exists (
      select 1 from public.partner_members m
      where m.user_id = profiles.id
        and m.status = 'active'
        and m.email = nullif(current_setting('app.notification_email', true), '')
    )
    or current_setting('app.matrix_lookup', true) = 'on'
  );

grant select (id, organization_id, status) on public.workspaces to app_rls_helper;
grant select (id, full_name, status) on public.profiles to app_rls_helper;

-- Memberships of one person that can give an account: active, not a
-- support membership, active workspace, active profile. An active owner of
-- the organization counts as owner of each workspace where they have no
-- membership row (as getEffectiveWorkspaceRole).
create function private.matrix_user_memberships(p_user_id uuid)
returns table(workspace_id uuid, organization_id uuid, role text, full_name text)
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_previous text := current_setting('app.matrix_lookup', true);
begin
  perform set_config('app.matrix_lookup', 'on', true);
  return query
    select member.workspace_id, member.organization_id, member.role, profile.full_name
    from public.workspace_members member
    join public.workspaces workspace
      on workspace.id = member.workspace_id
     and workspace.organization_id = member.organization_id
    join public.profiles profile on profile.id = member.user_id
    where member.user_id = p_user_id
      and member.status = 'active'
      and member.support_grant_id is null
      and workspace.status = 'active'
      and profile.status = 'active'
    union all
    select workspace.id, workspace.organization_id, 'owner'::text, profile.full_name
    from public.organization_members org_member
    join public.workspaces workspace on workspace.organization_id = org_member.organization_id
    join public.profiles profile on profile.id = org_member.user_id
    where org_member.user_id = p_user_id
      and org_member.status = 'active'
      and org_member.role = 'owner'
      and workspace.status = 'active'
      and profile.status = 'active'
      and not exists (
        select 1 from public.workspace_members member
        where member.workspace_id = workspace.id and member.user_id = p_user_id
      );
  perform set_config('app.matrix_lookup', coalesce(v_previous, ''), true);
end;
$$;

-- The people of one active workspace that can have an account, with the
-- name shown on Matrix.
create function private.matrix_workspace_people(p_workspace_id uuid)
returns table(user_id uuid, role text, full_name text)
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_previous text := current_setting('app.matrix_lookup', true);
begin
  perform set_config('app.matrix_lookup', 'on', true);
  return query
    select member.user_id, member.role, profile.full_name
    from public.workspace_members member
    join public.workspaces workspace
      on workspace.id = member.workspace_id
     and workspace.organization_id = member.organization_id
    join public.profiles profile on profile.id = member.user_id
    where member.workspace_id = p_workspace_id
      and member.status = 'active'
      and member.support_grant_id is null
      and workspace.status = 'active'
      and profile.status = 'active'
    union all
    select org_member.user_id, 'owner'::text, profile.full_name
    from public.workspaces workspace
    join public.organization_members org_member on org_member.organization_id = workspace.organization_id
    join public.profiles profile on profile.id = org_member.user_id
    where workspace.id = p_workspace_id
      and workspace.status = 'active'
      and org_member.status = 'active'
      and org_member.role = 'owner'
      and profile.status = 'active'
      and not exists (
        select 1 from public.workspace_members member
        where member.workspace_id = workspace.id and member.user_id = org_member.user_id
      );
  perform set_config('app.matrix_lookup', coalesce(v_previous, ''), true);
end;
$$;

-- Organization and status of a workspace, for the worker to create, block
-- or restore its rooms.
create function private.matrix_workspace(p_workspace_id uuid)
returns table(organization_id uuid, status text)
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_previous text := current_setting('app.matrix_lookup', true);
begin
  perform set_config('app.matrix_lookup', 'on', true);
  return query
    select workspace.organization_id, workspace.status
    from public.workspaces workspace where workspace.id = p_workspace_id;
  perform set_config('app.matrix_lookup', coalesce(v_previous, ''), true);
end;
$$;

-- The context person's own memberships (web).
create function private.matrix_my_memberships()
returns table(workspace_id uuid, organization_id uuid, role text, full_name text)
language sql
volatile
security definer
set search_path = ''
as $$
  select m.workspace_id, m.organization_id, m.role, m.full_name
  from private.matrix_user_memberships(private.context_uuid('app.user_id')) m
  where private.context_uuid('app.user_id') is not null;
$$;

create function private.matrix_my_eligible()
returns boolean
language sql
volatile
security definer
set search_path = ''
as $$
  select exists (
    select 1 from private.matrix_my_memberships() m
    where m.role = any(private.matrix_inbox_roles())
  );
$$;

revoke execute on function private.matrix_user_memberships(uuid) from public, anon, authenticated;
revoke execute on function private.matrix_workspace_people(uuid) from public, anon, authenticated;
revoke execute on function private.matrix_my_memberships() from public, anon, authenticated;
revoke execute on function private.matrix_my_eligible() from public, anon, authenticated;
revoke execute on function private.matrix_workspace(uuid) from public, anon, authenticated;
grant execute on function private.matrix_user_memberships(uuid) to app_worker;
grant execute on function private.matrix_workspace_people(uuid) to app_worker;
grant execute on function private.matrix_my_memberships() to app_runtime;
grant execute on function private.matrix_my_eligible() to app_runtime;
grant execute on function private.matrix_workspace(uuid) to app_worker;
alter function private.matrix_user_memberships(uuid) owner to app_rls_helper;
alter function private.matrix_workspace_people(uuid) owner to app_rls_helper;
alter function private.matrix_my_memberships() owner to app_rls_helper;
alter function private.matrix_my_eligible() owner to app_rls_helper;
alter function private.matrix_workspace(uuid) owner to app_rls_helper;

-- ----------------------------------------------------------------------------
-- 3. Policies of the web (app_runtime)
-- ----------------------------------------------------------------------------
create policy matrix_accounts_select_own on public.matrix_accounts
  for select to app_runtime
  using (profile_id = private.context_uuid('app.user_id'));

-- The session route creates the account of an eligible person, or brings a
-- deactivated one back; deactivation is the worker's.
create policy matrix_accounts_insert_own on public.matrix_accounts
  for insert to app_runtime
  with check (
    profile_id = private.context_uuid('app.user_id')
    and status = 'active'
    and deactivated_at is null
    and private.matrix_my_eligible()
  );

create policy matrix_accounts_update_own on public.matrix_accounts
  for update to app_runtime
  using (profile_id = private.context_uuid('app.user_id'))
  with check (
    profile_id = private.context_uuid('app.user_id')
    and status = 'active'
    and deactivated_at is null
    and private.matrix_my_eligible()
  );

grant select on public.matrix_accounts to app_runtime;
grant insert (profile_id, localpart, mxid, status) on public.matrix_accounts to app_runtime;
grant update (status, deactivated_at, updated_at) on public.matrix_accounts to app_runtime;

create policy matrix_rooms_select on public.matrix_rooms
  for select to app_runtime
  using (
    workspace_id = private.context_uuid('app.workspace_id')
    and organization_id = private.context_uuid('app.organization_id')
    and private.current_workspace_role() = any(private.matrix_inbox_roles())
  );

create policy matrix_room_members_select on public.matrix_room_members
  for select to app_runtime
  using (
    workspace_id = private.context_uuid('app.workspace_id')
    and organization_id = private.context_uuid('app.organization_id')
    and private.current_workspace_role() = any(private.matrix_inbox_roles())
  );

grant select on public.matrix_rooms, public.matrix_room_members to app_runtime;

-- ----------------------------------------------------------------------------
-- 4. The worker (app_worker): the Matrix core runs as platform jobs
-- ----------------------------------------------------------------------------
do $$
declare
  t text;
begin
  foreach t in array array['matrix_accounts', 'matrix_rooms', 'matrix_room_members', 'matrix_as_transactions', 'matrix_events'] loop
    execute format('create policy %I on public.%I for all to app_worker using (true) with check (true)', t || '_worker', t);
    execute format('grant select, insert, update, delete on public.%I to app_worker', t);
  end loop;
end
$$;


-- ----------------------------------------------------------------------------
-- 5. Jobs of the Matrix core (owner app_rls_helper)
-- ----------------------------------------------------------------------------
create policy job_runs_matrix_select on public.job_runs
  for select to app_rls_helper
  using (current_setting('app.matrix_jobs', true) = 'on' and kind like 'matrix.%');

create policy job_runs_matrix_insert on public.job_runs
  for insert to app_rls_helper
  with check (
    current_setting('app.matrix_jobs', true) = 'on'
    and kind in ('matrix.process-events', 'matrix.sync-account', 'matrix.sync-workspace', 'matrix.logout-devices')
    and scope = 'platform'
    and status = 'pending'
    and attempts = 0
    and partner_id is null
    and organization_id is null
    and workspace_id is null
  );

-- One pending run per kind and payload. Returns the run id (new or
-- pending). `matrix.logout-devices` only for the context person.
create function private.matrix_enqueue(p_kind text, p_payload jsonb, p_run_after timestamptz default null)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_previous text := current_setting('app.matrix_jobs', true);
  v_user uuid := private.context_uuid('app.user_id');
  v_id uuid;
begin
  if p_kind not in ('matrix.process-events', 'matrix.sync-account', 'matrix.sync-workspace', 'matrix.logout-devices') then
    raise exception 'matrix_enqueue: unknown kind' using errcode = 'invalid_parameter_value';
  end if;
  if jsonb_typeof(p_payload) is distinct from 'object' or pg_column_size(p_payload) > 1024 then
    raise exception 'matrix_enqueue: invalid payload' using errcode = 'invalid_parameter_value';
  end if;
  if p_kind = 'matrix.logout-devices'
     and (v_user is null or p_payload->>'userId' is distinct from v_user::text) then
    raise exception 'matrix_enqueue: devices of another person' using errcode = 'insufficient_privilege';
  end if;
  perform set_config('app.matrix_jobs', 'on', true);
  perform pg_advisory_xact_lock(hashtext('matrix_enqueue:' || p_kind || ':' || p_payload::text));
  select run.id into v_id
  from public.job_runs run
  where run.kind = p_kind and run.status = 'pending' and run.payload = p_payload
  limit 1;
  if v_id is null then
    insert into public.job_runs
      (kind, scope, requested_by, payload, idempotency_key, max_attempts, run_after)
    values
      (p_kind, 'platform', v_user, p_payload,
       left(p_kind || ':' || gen_random_uuid()::text, 200), 5,
       coalesce(p_run_after, now()))
    returning id into v_id;
  end if;
  perform set_config('app.matrix_jobs', coalesce(v_previous, ''), true);
  return v_id;
end;
$$;

revoke execute on function private.matrix_enqueue(text, jsonb, timestamptz) from public, anon, authenticated;
grant execute on function private.matrix_enqueue(text, jsonb, timestamptz) to app_runtime, app_worker;
alter function private.matrix_enqueue(text, jsonb, timestamptz) owner to app_rls_helper;

-- ----------------------------------------------------------------------------
-- 6. Ingestion of the Application Service (owner app_rls_helper)
-- ----------------------------------------------------------------------------
create policy matrix_as_transactions_ingest on public.matrix_as_transactions
  for all to app_rls_helper
  using (current_setting('app.matrix_ingest', true) = 'on')
  with check (current_setting('app.matrix_ingest', true) = 'on');
create policy matrix_events_ingest on public.matrix_events
  for all to app_rls_helper
  using (current_setting('app.matrix_ingest', true) = 'on')
  with check (current_setting('app.matrix_ingest', true) = 'on' and status = 'pending' and attempts = 0);

grant select, insert on public.matrix_as_transactions to app_rls_helper;
grant select, insert on public.matrix_events to app_rls_helper;

-- Records one transaction pushed by Synapse. Each element of p_events:
-- { event_id, room_id, type, state_key?, sender, content, origin_server_ts? },
-- already reduced by the route. A retried transaction or event writes
-- nothing again. Returns how many events were new.
create function private.matrix_as_ingest(p_txn_id text, p_event_count integer, p_events jsonb)
returns integer
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_previous text := current_setting('app.matrix_ingest', true);
  v_event jsonb;
  v_id text;
  v_stored integer := 0;
begin
  if jsonb_typeof(p_events) is distinct from 'array' then
    raise exception 'matrix_as_ingest: events must be an array' using errcode = 'invalid_parameter_value';
  end if;
  perform set_config('app.matrix_ingest', 'on', true);
  for v_event in select value from jsonb_array_elements(p_events) loop
    v_id := null;
    insert into public.matrix_events
      (event_id, txn_id, room_id, type, state_key, sender, content, origin_server_ts)
    values
      (v_event->>'event_id', p_txn_id, v_event->>'room_id', v_event->>'type',
       v_event->>'state_key', v_event->>'sender', coalesce(v_event->'content', '{}'::jsonb),
       (v_event->>'origin_server_ts')::bigint)
    on conflict (event_id) do nothing
    returning event_id into v_id;
    if v_id is not null then
      v_stored := v_stored + 1;
    end if;
  end loop;
  insert into public.matrix_as_transactions (txn_id, event_count, stored)
  values (p_txn_id, greatest(coalesce(p_event_count, 0), 0), v_stored)
  on conflict (txn_id) do nothing;
  perform set_config('app.matrix_ingest', coalesce(v_previous, ''), true);
  if v_stored > 0 then
    perform private.matrix_enqueue('matrix.process-events', '{}'::jsonb);
  end if;
  return v_stored;
end;
$$;

revoke execute on function private.matrix_as_ingest(text, integer, jsonb) from public, anon, authenticated;
grant execute on function private.matrix_as_ingest(text, integer, jsonb) to app_runtime;
alter function private.matrix_as_ingest(text, integer, jsonb) owner to app_rls_helper;
