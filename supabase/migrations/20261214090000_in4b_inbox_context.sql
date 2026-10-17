-- ============================================================================
-- Migration: 20261214090000_in4b_inbox_context.sql
-- Module: IN4b — context, labels and notices of the Inbox
--         (docs/modules/inbox/plano-in4b-in6.md)
--
-- Maintenance Rationale:
-- 1. Message marks (shared with the IN6): the core records WHEN a message
--    arrived in a room and FROM WHOM (consumer, team or agent), never its
--    text, which stays on Synapse (ADR 0023, rule 6). `matrix_events`
--    accepts `m.room.message` with an empty content; `matrix_rooms` keeps
--    the last time of each side. The notice "no answer" (IN4b) and the
--    GUIDS's turn (IN6) read them.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Message marks
-- ----------------------------------------------------------------------------
alter table public.matrix_events drop constraint matrix_events_type_check;
alter table public.matrix_events
  add constraint matrix_events_type_check
  check (type in ('m.room.member', 'chat.guidu.conversation', 'm.room.message'));
-- A message is recorded without its body: only the kind of message.
alter table public.matrix_events
  add constraint matrix_events_message_without_body
  check (type <> 'm.room.message' or not (content ? 'body'));

alter table public.matrix_rooms
  add column last_consumer_message_at timestamptz,
  add column last_team_message_at timestamptz,
  add column last_agent_message_at timestamptz;

-- ----------------------------------------------------------------------------
-- 2. Labels (internal: never in the room, ADR 0023 rule 6)
-- ----------------------------------------------------------------------------
-- The catalog of the workspace is kept by who manages the Inbox (owner and
-- admin); who answers puts labels on conversations and takes them off.
create table public.inbox_labels (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  workspace_id    uuid not null,
  name            text not null check (length(btrim(name)) between 1 and 40),
  color           text not null default 'neutral'
                  check (color in ('neutral', 'info', 'success', 'warning', 'danger')),
  created_by      uuid references public.profiles(id) on delete set null,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  constraint inbox_labels_id_workspace_key unique (id, workspace_id),
  constraint fk_inbox_labels_workspace
    foreign key (workspace_id, organization_id)
    references public.workspaces(id, organization_id) on delete cascade
);

create unique index inbox_labels_name_key on public.inbox_labels (workspace_id, lower(btrim(name)));

create table public.inbox_room_labels (
  room_id         text not null references public.matrix_rooms(room_id) on delete cascade,
  label_id        uuid not null,
  organization_id uuid not null,
  workspace_id    uuid not null,
  created_by      uuid references public.profiles(id) on delete set null,
  created_at      timestamptz not null default now(),
  primary key (room_id, label_id),
  constraint fk_inbox_room_labels_label
    foreign key (label_id, workspace_id)
    references public.inbox_labels(id, workspace_id) on delete cascade,
  constraint fk_inbox_room_labels_workspace
    foreign key (workspace_id, organization_id)
    references public.workspaces(id, organization_id) on delete cascade
);

create index inbox_room_labels_label_idx on public.inbox_room_labels (label_id);
create index inbox_room_labels_workspace_idx on public.inbox_room_labels (workspace_id);

-- ----------------------------------------------------------------------------
-- 3. The CRM contact of a conversation
-- ----------------------------------------------------------------------------
-- Made when the room opens (job of the Inbox module, through the CRM's
-- public service); `contact_state` says why there is none: still being
-- made, or the plan's contact quota was full.
create table public.inbox_conversations (
  room_id         text primary key references public.matrix_rooms(room_id) on delete cascade,
  organization_id uuid not null,
  workspace_id    uuid not null,
  contact_id      uuid references public.crm_contacts(id) on delete set null,
  contact_state   text not null default 'pending'
                  check (contact_state in ('pending', 'linked', 'quota', 'none')),
  updated_by      uuid references public.profiles(id) on delete set null,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  constraint inbox_conversations_linked check ((contact_state = 'linked') = (contact_id is not null)),
  constraint fk_inbox_conversations_workspace
    foreign key (workspace_id, organization_id)
    references public.workspaces(id, organization_id) on delete cascade
);

create index inbox_conversations_workspace_idx on public.inbox_conversations (workspace_id);
create index inbox_conversations_contact_idx on public.inbox_conversations (contact_id) where contact_id is not null;

do $$
declare
  t text;
begin
  foreach t in array array['inbox_labels', 'inbox_room_labels', 'inbox_conversations'] loop
    execute format('alter table public.%I owner to app_migrations', t);
    execute format('revoke all on public.%I from public, anon, authenticated', t);
    execute format('alter table public.%I enable row level security', t);
    execute format('alter table public.%I force row level security', t);
    execute format('create policy %I on public.%I for all to app_worker using (true) with check (true)', t || '_worker', t);
    execute format('grant select, insert, update, delete on public.%I to app_worker', t);
  end loop;
  foreach t in array array['inbox_labels', 'inbox_conversations'] loop
    execute format(
      'create trigger %I before update on public.%I for each row execute function private.touch_updated_at()',
      t || '_touch_updated_at', t
    );
  end loop;
end
$$;

-- A room of the context workspace (the policies below).
create function private.inbox_room_in_context(p_room_id text)
returns boolean
language sql
stable
security invoker
set search_path = ''
as $$
  select exists (
    select 1 from public.matrix_rooms room
    where room.room_id = p_room_id
      and room.workspace_id = private.context_uuid('app.workspace_id')
      and room.organization_id = private.context_uuid('app.organization_id')
  );
$$;
alter function private.inbox_room_in_context(text) owner to app_migrations;
revoke execute on function private.inbox_room_in_context(text) from public, anon, authenticated;
grant execute on function private.inbox_room_in_context(text) to app_runtime;

create policy inbox_labels_select on public.inbox_labels
  for select to app_runtime
  using (
    workspace_id = private.context_uuid('app.workspace_id')
    and organization_id = private.context_uuid('app.organization_id')
    and (select private.inbox_my_level()) is not null
  );
create policy inbox_labels_insert on public.inbox_labels
  for insert to app_runtime
  with check (
    workspace_id = private.context_uuid('app.workspace_id')
    and organization_id = private.context_uuid('app.organization_id')
    and created_by = private.context_uuid('app.user_id')
    and private.inbox_my_manages()
  );
create policy inbox_labels_update on public.inbox_labels
  for update to app_runtime
  using (
    workspace_id = private.context_uuid('app.workspace_id')
    and organization_id = private.context_uuid('app.organization_id')
    and private.inbox_my_manages()
  )
  with check (
    workspace_id = private.context_uuid('app.workspace_id')
    and organization_id = private.context_uuid('app.organization_id')
  );
create policy inbox_labels_delete on public.inbox_labels
  for delete to app_runtime
  using (
    workspace_id = private.context_uuid('app.workspace_id')
    and organization_id = private.context_uuid('app.organization_id')
    and private.inbox_my_manages()
  );
grant select, delete on public.inbox_labels to app_runtime;
grant insert (organization_id, workspace_id, name, color, created_by) on public.inbox_labels to app_runtime;
grant update (name, color, updated_at) on public.inbox_labels to app_runtime;

create policy inbox_room_labels_select on public.inbox_room_labels
  for select to app_runtime
  using (
    workspace_id = private.context_uuid('app.workspace_id')
    and organization_id = private.context_uuid('app.organization_id')
    and (select private.inbox_my_level()) is not null
  );
create policy inbox_room_labels_insert on public.inbox_room_labels
  for insert to app_runtime
  with check (
    workspace_id = private.context_uuid('app.workspace_id')
    and organization_id = private.context_uuid('app.organization_id')
    and created_by = private.context_uuid('app.user_id')
    and private.inbox_my_level() = 'reply'
    and private.inbox_room_in_context(room_id)
  );
create policy inbox_room_labels_delete on public.inbox_room_labels
  for delete to app_runtime
  using (
    workspace_id = private.context_uuid('app.workspace_id')
    and organization_id = private.context_uuid('app.organization_id')
    and private.inbox_my_level() = 'reply'
  );
grant select, delete on public.inbox_room_labels to app_runtime;
grant insert (room_id, label_id, organization_id, workspace_id, created_by) on public.inbox_room_labels to app_runtime;

-- Who has a level reads the link; who answers or manages links the
-- conversation to another contact (the job of the module runs as a
-- manager of the workspace).
create policy inbox_conversations_select on public.inbox_conversations
  for select to app_runtime
  using (
    workspace_id = private.context_uuid('app.workspace_id')
    and organization_id = private.context_uuid('app.organization_id')
    and (select private.inbox_my_level()) is not null
  );
create policy inbox_conversations_insert on public.inbox_conversations
  for insert to app_runtime
  with check (
    workspace_id = private.context_uuid('app.workspace_id')
    and organization_id = private.context_uuid('app.organization_id')
    and (private.inbox_my_level() = 'reply' or private.inbox_my_manages())
    and private.inbox_room_in_context(room_id)
    and (contact_id is null or exists (
      select 1 from public.crm_contacts contact
      where contact.id = contact_id and contact.workspace_id = inbox_conversations.workspace_id
    ))
  );
create policy inbox_conversations_update on public.inbox_conversations
  for update to app_runtime
  using (
    workspace_id = private.context_uuid('app.workspace_id')
    and organization_id = private.context_uuid('app.organization_id')
    and (private.inbox_my_level() = 'reply' or private.inbox_my_manages())
  )
  with check (
    workspace_id = private.context_uuid('app.workspace_id')
    and organization_id = private.context_uuid('app.organization_id')
    and (contact_id is null or exists (
      select 1 from public.crm_contacts contact
      where contact.id = contact_id and contact.workspace_id = inbox_conversations.workspace_id
    ))
  );
grant select on public.inbox_conversations to app_runtime;
grant insert (room_id, organization_id, workspace_id, contact_id, contact_state, updated_by)
  on public.inbox_conversations to app_runtime;
grant update (contact_id, contact_state, updated_by, updated_at) on public.inbox_conversations to app_runtime;

-- ----------------------------------------------------------------------------
-- 4. What the notices of the Inbox need of a workspace (owner app_rls_helper)
-- ----------------------------------------------------------------------------
-- The worker reads active workspaces only through this: organization,
-- status, name and slug (the link of the notice), with the lookup flag of
-- the Matrix core.
grant select (slug) on public.workspaces to app_rls_helper;

create function private.inbox_workspace_link(p_workspace_id uuid)
returns table(organization_id uuid, status text, name text, slug text)
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
    select workspace.organization_id, workspace.status, workspace.name, workspace.slug
    from public.workspaces workspace where workspace.id = p_workspace_id;
  perform set_config('app.matrix_lookup', coalesce(v_previous, ''), true);
end;
$$;

revoke execute on function private.inbox_workspace_link(uuid) from public, anon, authenticated;
grant execute on function private.inbox_workspace_link(uuid) to app_worker;
alter function private.inbox_workspace_link(uuid) owner to app_rls_helper;
