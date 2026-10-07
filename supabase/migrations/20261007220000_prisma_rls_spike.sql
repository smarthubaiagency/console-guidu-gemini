-- SMA-92: disposable proof of Prisma + transaction-local context + RLS.
-- Passwords are deliberately not part of migrations. Provision app_runtime's
-- password out-of-band and keep both connection URLs in Paperclip secrets.

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'app_migrations') then
    create role app_migrations nologin nosuperuser nocreatedb nocreaterole noinherit nobypassrls;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'app_runtime') then
    create role app_runtime login nosuperuser nocreatedb nocreaterole noinherit nobypassrls;
  end if;
end
$$;

grant app_migrations to postgres;
grant create on schema public to postgres;
grant usage on schema public to app_migrations, app_runtime;
grant create on schema public to app_migrations;


create schema if not exists spike_private authorization app_migrations;
revoke all on schema spike_private from public, anon, authenticated;
grant usage on schema spike_private to app_runtime;

create table public.spike_organizations (
  id uuid primary key,
  name text not null check (length(name) > 0)
);

create table public.spike_workspaces (
  id uuid primary key,
  organization_id uuid not null references public.spike_organizations(id) on delete cascade,
  name text not null check (length(name) > 0),
  unique (id, organization_id)
);
create index spike_workspaces_organization_id_idx
  on public.spike_workspaces (organization_id);

create table public.spike_workspace_members (
  workspace_id uuid not null,
  organization_id uuid not null,
  user_id uuid not null,
  primary key (workspace_id, user_id),
  foreign key (workspace_id, organization_id)
    references public.spike_workspaces(id, organization_id) on delete cascade
);
create index spike_workspace_members_user_workspace_idx
  on public.spike_workspace_members (user_id, workspace_id, organization_id);

create table public.spike_notes (
  id uuid primary key,
  workspace_id uuid not null,
  organization_id uuid not null,
  body text not null,
  foreign key (workspace_id, organization_id)
    references public.spike_workspaces(id, organization_id) on delete cascade
);

create index spike_notes_workspace_organization_idx
  on public.spike_notes (workspace_id, organization_id);

alter table public.spike_organizations owner to app_migrations;
alter table public.spike_workspaces owner to app_migrations;
alter table public.spike_workspace_members owner to app_migrations;
alter table public.spike_notes owner to app_migrations;

create function spike_private.context_uuid(setting_name text)
returns uuid
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  value text;
begin
  value := current_setting(setting_name, true);
  if value is null or value = '' then
    return null;
  end if;
  return value::uuid;
exception
  when invalid_text_representation then return null;
end
$$;

create function spike_private.is_current_member(candidate_workspace_id uuid, candidate_organization_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select candidate_workspace_id = spike_private.context_uuid('app.workspace_id')
    and candidate_organization_id = spike_private.context_uuid('app.organization_id')
    and exists (
      select 1
      from public.spike_workspace_members member
      where member.workspace_id = candidate_workspace_id
        and member.organization_id = candidate_organization_id
        and member.user_id = spike_private.context_uuid('app.user_id')
    );
$$;

alter function spike_private.context_uuid(text) owner to app_migrations;
alter function spike_private.is_current_member(uuid, uuid) owner to app_migrations;

revoke execute on function spike_private.context_uuid(text) from public, anon, authenticated;
revoke execute on function spike_private.is_current_member(uuid, uuid) from public, anon, authenticated;
grant execute on function spike_private.context_uuid(text) to app_runtime;
grant execute on function spike_private.is_current_member(uuid, uuid) to app_runtime;

alter table public.spike_organizations enable row level security;
alter table public.spike_organizations force row level security;
alter table public.spike_workspaces enable row level security;
alter table public.spike_workspaces force row level security;
alter table public.spike_workspace_members enable row level security;
alter table public.spike_notes enable row level security;
alter table public.spike_notes force row level security;

create policy spike_organizations_select on public.spike_organizations
  for select to app_runtime
  using (
    id = spike_private.context_uuid('app.organization_id')
    and spike_private.is_current_member(
      spike_private.context_uuid('app.workspace_id'),
      id
    )
  );

create policy spike_workspaces_select on public.spike_workspaces
  for select to app_runtime
  using (spike_private.is_current_member(id, organization_id));

create policy spike_notes_select on public.spike_notes
  for select to app_runtime
  using (spike_private.is_current_member(workspace_id, organization_id));
create policy spike_notes_insert on public.spike_notes
  for insert to app_runtime
  with check (spike_private.is_current_member(workspace_id, organization_id));
create policy spike_notes_update on public.spike_notes
  for update to app_runtime
  using (spike_private.is_current_member(workspace_id, organization_id))
  with check (spike_private.is_current_member(workspace_id, organization_id));
create policy spike_notes_delete on public.spike_notes
  for delete to app_runtime
  using (spike_private.is_current_member(workspace_id, organization_id));

revoke all on public.spike_organizations from public, anon, authenticated;
revoke all on public.spike_workspaces from public, anon, authenticated;
revoke all on public.spike_workspace_members from public, anon, authenticated;
revoke all on public.spike_notes from public, anon, authenticated;

grant select on public.spike_organizations, public.spike_workspaces to app_runtime;
grant select, insert, update, delete on public.spike_notes to app_runtime;


