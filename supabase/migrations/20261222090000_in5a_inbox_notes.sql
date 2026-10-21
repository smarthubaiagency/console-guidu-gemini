-- ============================================================================
-- Migration: 20261222090000_in5a_inbox_notes.sql
-- Module: IN5a — private notes of the Inbox
--         (docs/modules/inbox/plano-tr2-in5a.md, section IN5a)
--
-- Maintenance Rationale:
-- 1. A note is internal: it lives here, by room, never in the Matrix room,
--    where the consumer is a member and would see any event (ADR 0023,
--    rule 6).
-- 2. Everyone with a level in the Inbox of the workspace reads the notes
--    (the attendant and the owner or admin who only reads); only who
--    answers (level `reply`) writes; only the author edits and deletes the
--    own note. Deleting is soft: the row stays, without its text, and the
--    conversation shows "Nota apagada".
-- 3. Deleting the room or the workspace deletes its notes (cascade, and
--    the purge of WS1 in src/core/privacy/maintenance.ts).
-- 4. The authors' names come from `private.inbox_note_authors()`: the
--    profiles are not readable by other members.
-- ============================================================================

create table public.inbox_notes (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  workspace_id    uuid not null,
  room_id         text not null references public.matrix_rooms(room_id) on delete cascade,
  user_id         uuid references public.profiles(id) on delete set null,
  body            text not null,
  created_at      timestamptz not null default now(),
  edited_at       timestamptz,
  deleted_at      timestamptz,
  -- A live note has 1 to 4000 characters; a deleted one keeps no text.
  constraint inbox_notes_body check (
    (deleted_at is null and length(btrim(body)) between 1 and 4000 and length(body) <= 4000)
    or (deleted_at is not null and body = '')
  ),
  constraint fk_inbox_notes_workspace
    foreign key (workspace_id, organization_id)
    references public.workspaces(id, organization_id) on delete cascade
);

create index inbox_notes_room_created_idx on public.inbox_notes (room_id, created_at);
create index inbox_notes_workspace_idx on public.inbox_notes (workspace_id);

alter table public.inbox_notes owner to app_migrations;
revoke all on public.inbox_notes from public, anon, authenticated;
alter table public.inbox_notes enable row level security;
alter table public.inbox_notes force row level security;

-- The worker purges the notes of a deleted workspace (WS1).
create policy inbox_notes_worker on public.inbox_notes
  for all to app_worker using (true) with check (true);
grant select, insert, update, delete on public.inbox_notes to app_worker;

-- Who has a level in the Inbox of the context workspace reads.
create policy inbox_notes_select on public.inbox_notes
  for select to app_runtime
  using (
    workspace_id = private.context_uuid('app.workspace_id')
    and organization_id = private.context_uuid('app.organization_id')
    and (select private.inbox_my_level()) is not null
  );
-- Who answers writes, as themselves, in a room of the context workspace.
create policy inbox_notes_insert on public.inbox_notes
  for insert to app_runtime
  with check (
    workspace_id = private.context_uuid('app.workspace_id')
    and organization_id = private.context_uuid('app.organization_id')
    and user_id = private.context_uuid('app.user_id')
    and private.inbox_my_level() = 'reply'
    and private.inbox_room_in_context(room_id)
    and edited_at is null
    and deleted_at is null
  );
-- The author (still answering) edits or deletes a live note of their own.
create policy inbox_notes_update on public.inbox_notes
  for update to app_runtime
  using (
    workspace_id = private.context_uuid('app.workspace_id')
    and organization_id = private.context_uuid('app.organization_id')
    and user_id = private.context_uuid('app.user_id')
    and deleted_at is null
    and private.inbox_my_level() = 'reply'
  )
  with check (
    workspace_id = private.context_uuid('app.workspace_id')
    and organization_id = private.context_uuid('app.organization_id')
    and user_id = private.context_uuid('app.user_id')
  );
grant select on public.inbox_notes to app_runtime;
grant insert (organization_id, workspace_id, room_id, user_id, body) on public.inbox_notes to app_runtime;
grant update (body, edited_at, deleted_at) on public.inbox_notes to app_runtime;
-- No delete for the web: deleting a note is soft.

-- ----------------------------------------------------------------------------
-- The names of the authors of the notes of the context workspace
-- ----------------------------------------------------------------------------
-- Only for who has a level in its Inbox, and only of people who wrote a
-- note there and are still in the workspace (the IN3 list of people).
create policy inbox_notes_rls_helper on public.inbox_notes
  for select to app_rls_helper
  using (current_setting('app.matrix_lookup', true) = 'on');
grant select (workspace_id, user_id) on public.inbox_notes to app_rls_helper;

create function private.inbox_note_authors()
returns table(user_id uuid, full_name text)
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_workspace uuid := private.context_uuid('app.workspace_id');
  v_previous text := current_setting('app.matrix_lookup', true);
begin
  if v_workspace is null or private.inbox_my_level() is null then
    return;
  end if;
  perform set_config('app.matrix_lookup', 'on', true);
  return query
    select people.user_id, people.full_name
    from private.matrix_workspace_people(v_workspace) people
    where exists (
      select 1 from public.inbox_notes note
      where note.workspace_id = v_workspace and note.user_id = people.user_id
    );
  perform set_config('app.matrix_lookup', coalesce(v_previous, ''), true);
end;
$$;

revoke execute on function private.inbox_note_authors() from public, anon, authenticated;
grant execute on function private.inbox_note_authors() to app_runtime;
alter function private.inbox_note_authors() owner to app_rls_helper;
