-- ============================================================================
-- Migration: 20261130090000_in4a_inbox_attendants.sql
-- Module: IN4a — the Inbox window (docs/modules/inbox/plano-in4.md)
--
-- Maintenance Rationale:
-- 1. Decision of Marcelo (17/10/2026, plano-in4.md §6, answer 3): only who
--    is marked as attendant answers, whatever the role. The mark is a row
--    of `inbox_attendants` (workspace, person); the Attendant role (AT1) is
--    always an attendant without a row. A row is kept when the person's
--    role later changes: it counts only while the role is owner, admin or
--    editor. Owners and admins who are not attendants open the Inbox read
--    only (they read and assign, never answer). An unmarked editor and the
--    viewer do not open it.
-- 2. The level of each person in each workspace is computed once, by the
--    database (`private.matrix_access`): 'reply' (marked), 'read' (owner or
--    admin, unmarked) or none. The IN3 functions that listed accounts by
--    role are kept for compatibility; the core reads the new ones
--    (`matrix_user_access`, `matrix_workspace_access`, `matrix_my_access`).
-- 3. Rooms and members are read by whoever has a level in the context
--    workspace (policies of the IN3 replaced). The power a person has in
--    each room is followed in `matrix_room_members.power`, so a change of
--    level (mark or unmark) updates the room without leaving it.
-- 4. Each workspace has its own address on the chat (a user of the reserved
--    namespace, `@_guidu_w_<16 base32>:<server>`): a consumer who invites it
--    gets a room opened by the core (the room the consumer created is still
--    refused, IN3). `matrix_workspace_addresses` keeps it; the worker
--    registers it on Synapse.
-- 5. Rooms keep the consumer's display name (`consumer_name`) for the
--    search of the Inbox, mirrored from their membership events.
-- 6. Purge of a deleted workspace (WS1): marks and the address are rows of
--    the workspace; the worker deletes them like the rooms.
-- Owner app_migrations, ENABLE + FORCE RLS, no grants to anon/authenticated.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Tables
-- ----------------------------------------------------------------------------
create table public.inbox_attendants (
  workspace_id    uuid not null,
  organization_id uuid not null,
  user_id         uuid not null references public.profiles(id) on delete cascade,
  created_by      uuid references public.profiles(id) on delete set null,
  created_at      timestamptz not null default now(),
  primary key (workspace_id, user_id),
  constraint fk_inbox_attendants_workspace
    foreign key (workspace_id, organization_id)
    references public.workspaces(id, organization_id) on delete cascade
);

create index inbox_attendants_user_idx on public.inbox_attendants (user_id);

create table public.matrix_workspace_addresses (
  workspace_id    uuid primary key,
  organization_id uuid not null,
  localpart       text not null unique check (localpart ~ '^_guidu_w_[a-z2-7]{16}$'),
  mxid            text not null unique check (length(mxid) between 4 and 255 and mxid like '@\_guidu\_w\_%:%'),
  -- pending: row first, user on Synapse next; active: registered.
  state           text not null default 'pending' check (state in ('pending', 'active')),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  constraint matrix_workspace_addresses_mxid_localpart check (mxid like '@' || localpart || ':%'),
  constraint fk_matrix_workspace_addresses_workspace
    foreign key (workspace_id, organization_id)
    references public.workspaces(id, organization_id) on delete cascade
);

do $$
declare
  t text;
begin
  foreach t in array array['inbox_attendants', 'matrix_workspace_addresses'] loop
    execute format('alter table public.%I owner to app_migrations', t);
    execute format('revoke all on public.%I from public, anon, authenticated', t);
    execute format('alter table public.%I enable row level security', t);
    execute format('alter table public.%I force row level security', t);
    execute format('create policy %I on public.%I for all to app_worker using (true) with check (true)', t || '_worker', t);
    execute format('grant select, insert, update, delete on public.%I to app_worker', t);
  end loop;
end
$$;

create trigger matrix_workspace_addresses_touch_updated_at
  before update on public.matrix_workspace_addresses
  for each row execute function private.touch_updated_at();

alter table public.matrix_room_members
  add column power smallint check (power is null or power between 0 and 100);

alter table public.matrix_rooms
  add column consumer_name text check (consumer_name is null or length(consumer_name) between 1 and 255);

create index matrix_rooms_consumer_idx on public.matrix_rooms (workspace_id, consumer_mxid)
  where consumer_mxid is not null;

-- ----------------------------------------------------------------------------
-- 2. Level of a person (owner app_rls_helper)
-- ----------------------------------------------------------------------------
-- 'reply' for the Attendant and for a marked owner, admin or editor; 'read'
-- for an unmarked owner or admin; null otherwise.
create function private.matrix_access(p_role text, p_marked boolean)
returns text
language sql
immutable
set search_path = ''
as $$
  select case
    when p_role = 'attendant' then 'reply'
    when p_marked and p_role in ('owner', 'admin', 'editor') then 'reply'
    when p_role in ('owner', 'admin') then 'read'
    else null
  end;
$$;

alter function private.matrix_access(text, boolean) owner to app_migrations;
revoke execute on function private.matrix_access(text, boolean) from public, anon, authenticated;
grant execute on function private.matrix_access(text, boolean) to app_runtime, app_worker, app_rls_helper;

create policy inbox_attendants_matrix_lookup on public.inbox_attendants
  for select to app_rls_helper
  using (current_setting('app.matrix_lookup', true) = 'on');
grant select on public.inbox_attendants to app_rls_helper;
grant select (id, organization_id, status, name) on public.workspaces to app_rls_helper;

-- Workspaces where a person has a level, with it. Built on the IN3 list of
-- memberships (active, not support, active workspace and profile, the
-- organization owner standing in as owner).
create function private.matrix_user_access(p_user_id uuid)
returns table(workspace_id uuid, organization_id uuid, role text, access text, full_name text)
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
    select m.workspace_id, m.organization_id, m.role,
           private.matrix_access(m.role, exists (
             select 1 from public.inbox_attendants mark
             where mark.workspace_id = m.workspace_id and mark.user_id = p_user_id
           )),
           m.full_name
    from private.matrix_user_memberships(p_user_id) m;
  perform set_config('app.matrix_lookup', coalesce(v_previous, ''), true);
end;
$$;

create function private.matrix_workspace_access(p_workspace_id uuid)
returns table(user_id uuid, role text, access text, full_name text)
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
    select p.user_id, p.role,
           private.matrix_access(p.role, exists (
             select 1 from public.inbox_attendants mark
             where mark.workspace_id = p_workspace_id and mark.user_id = p.user_id
           )),
           p.full_name
    from private.matrix_workspace_people(p_workspace_id) p;
  perform set_config('app.matrix_lookup', coalesce(v_previous, ''), true);
end;
$$;

-- Organization, status and name of a workspace (the name is shown by the
-- address of the store on the chat).
create function private.matrix_workspace_info(p_workspace_id uuid)
returns table(organization_id uuid, status text, name text)
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
    select workspace.organization_id, workspace.status, workspace.name
    from public.workspaces workspace where workspace.id = p_workspace_id;
  perform set_config('app.matrix_lookup', coalesce(v_previous, ''), true);
end;
$$;

-- The context person's levels (web).
create function private.matrix_my_access()
returns table(workspace_id uuid, organization_id uuid, role text, access text, full_name text)
language sql
volatile
security definer
set search_path = ''
as $$
  select a.workspace_id, a.organization_id, a.role, a.access, a.full_name
  from private.matrix_user_access(private.context_uuid('app.user_id')) a
  where private.context_uuid('app.user_id') is not null;
$$;

-- Level of the context person in the context workspace, or null.
create function private.inbox_my_level()
returns text
language sql
volatile
security definer
set search_path = ''
as $$
  select a.access
  from private.matrix_my_access() a
  where a.workspace_id = private.context_uuid('app.workspace_id')
    and a.organization_id = private.context_uuid('app.organization_id')
  limit 1;
$$;

-- Whether the context person manages the Inbox of the context workspace
-- (`inbox.manage`: owner or admin, the organization owner standing in).
create function private.inbox_my_manages()
returns boolean
language sql
volatile
security definer
set search_path = ''
as $$
  select exists (
    select 1 from private.matrix_my_access() a
    where a.workspace_id = private.context_uuid('app.workspace_id')
      and a.organization_id = private.context_uuid('app.organization_id')
      and a.role in ('owner', 'admin')
  );
$$;

-- Whether a person can be marked in a workspace: owner, admin or editor.
create function private.inbox_markable(p_workspace_id uuid, p_user_id uuid)
returns boolean
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_previous text := current_setting('app.matrix_lookup', true);
  v_ok boolean;
begin
  perform set_config('app.matrix_lookup', 'on', true);
  select exists (
    select 1 from private.matrix_workspace_people(p_workspace_id) p
    where p.user_id = p_user_id and p.role in ('owner', 'admin', 'editor')
  ) into v_ok;
  perform set_config('app.matrix_lookup', coalesce(v_previous, ''), true);
  return v_ok;
end;
$$;

revoke execute on function private.matrix_user_access(uuid) from public, anon, authenticated;
revoke execute on function private.matrix_workspace_access(uuid) from public, anon, authenticated;
revoke execute on function private.matrix_workspace_info(uuid) from public, anon, authenticated;
revoke execute on function private.matrix_my_access() from public, anon, authenticated;
revoke execute on function private.inbox_my_level() from public, anon, authenticated;
revoke execute on function private.inbox_my_manages() from public, anon, authenticated;
revoke execute on function private.inbox_markable(uuid, uuid) from public, anon, authenticated;
grant execute on function private.matrix_user_access(uuid) to app_worker;
grant execute on function private.matrix_workspace_access(uuid) to app_worker;
grant execute on function private.matrix_workspace_info(uuid) to app_worker;
grant execute on function private.matrix_my_access() to app_runtime;
grant execute on function private.inbox_my_level() to app_runtime;
grant execute on function private.inbox_my_manages() to app_runtime;
grant execute on function private.inbox_markable(uuid, uuid) to app_runtime;
-- The new functions call the IN3 ones as their owner (app_rls_helper),
-- which already owns them; nothing else to grant.
alter function private.matrix_user_access(uuid) owner to app_rls_helper;
alter function private.matrix_workspace_access(uuid) owner to app_rls_helper;
alter function private.matrix_workspace_info(uuid) owner to app_rls_helper;
alter function private.matrix_my_access() owner to app_rls_helper;
alter function private.inbox_my_level() owner to app_rls_helper;
alter function private.inbox_my_manages() owner to app_rls_helper;
alter function private.inbox_markable(uuid, uuid) owner to app_rls_helper;

-- An account is open to whoever has a level somewhere (IN3 asked for
-- `inbox.view` by role). Replaced as its owner: app_migrations is NOINHERIT.
set local role app_rls_helper;
create or replace function private.matrix_my_eligible()
returns boolean
language sql
volatile
security definer
set search_path = ''
as $$
  select exists (
    select 1 from private.matrix_my_access() m where m.access is not null
  );
$$;
reset role;

-- ----------------------------------------------------------------------------
-- 3. Policies of the web (app_runtime)
-- ----------------------------------------------------------------------------
drop policy matrix_rooms_select on public.matrix_rooms;
create policy matrix_rooms_select on public.matrix_rooms
  for select to app_runtime
  using (
    workspace_id = private.context_uuid('app.workspace_id')
    and organization_id = private.context_uuid('app.organization_id')
    and (select private.inbox_my_level()) is not null
  );

drop policy matrix_room_members_select on public.matrix_room_members;
create policy matrix_room_members_select on public.matrix_room_members
  for select to app_runtime
  using (
    workspace_id = private.context_uuid('app.workspace_id')
    and organization_id = private.context_uuid('app.organization_id')
    and (select private.inbox_my_level()) is not null
  );

create policy matrix_workspace_addresses_select on public.matrix_workspace_addresses
  for select to app_runtime
  using (
    workspace_id = private.context_uuid('app.workspace_id')
    and organization_id = private.context_uuid('app.organization_id')
    and (select private.inbox_my_level()) is not null
  );
grant select on public.matrix_workspace_addresses to app_runtime;

-- Marks: the managers of the Inbox read and change them; each person reads
-- their own.
create policy inbox_attendants_select on public.inbox_attendants
  for select to app_runtime
  using (
    workspace_id = private.context_uuid('app.workspace_id')
    and organization_id = private.context_uuid('app.organization_id')
    and (user_id = private.context_uuid('app.user_id') or (select private.inbox_my_manages()))
  );

create policy inbox_attendants_insert on public.inbox_attendants
  for insert to app_runtime
  with check (
    workspace_id = private.context_uuid('app.workspace_id')
    and organization_id = private.context_uuid('app.organization_id')
    and created_by = private.context_uuid('app.user_id')
    and private.inbox_my_manages()
    and private.inbox_markable(workspace_id, user_id)
  );

create policy inbox_attendants_delete on public.inbox_attendants
  for delete to app_runtime
  using (
    workspace_id = private.context_uuid('app.workspace_id')
    and organization_id = private.context_uuid('app.organization_id')
    and private.inbox_my_manages()
  );

grant select, delete on public.inbox_attendants to app_runtime;
grant insert (workspace_id, organization_id, user_id, created_by) on public.inbox_attendants to app_runtime;
