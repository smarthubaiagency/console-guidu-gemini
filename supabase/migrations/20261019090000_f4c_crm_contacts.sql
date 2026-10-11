-- ============================================================================
-- Migration: 20261019090000_f4c_crm_contacts.sql
-- Module: F4c — CRM module, contacts (plano F4, decisão 3)
--
-- Maintenance Rationale:
-- 1. `public.crm_contacts`: contacts of a workspace, the first object of
--    the CRM module (leads, companies, deals and tasks come later as their
--    own tables). Name is required; e-mail, phone, company (free text until
--    the company object exists), job title and notes are optional.
-- 2. Members read; owner, admin and editor create and edit, signing the
--    row (`created_by` on insert, `updated_by` on update). There is no
--    delete in this stage. A trigger keeps the workspace, the author and
--    the creation time immutable.
-- 3. The module state (enabled, contracted, suspended) is enforced by the
--    services, as for every module; RLS enforces tenant and role.
-- 4. Workspace deletion (F3e): app_worker deletes the rows of a workspace
--    past its grace period, like the other module tables.
-- 5. API keys gain the module scopes `crm:read` and `crm:write`.
-- Owner app_migrations, ENABLE + FORCE RLS, no grants to anon/authenticated.
-- ============================================================================

create table public.crm_contacts (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  workspace_id    uuid not null,
  name            text not null check (length(btrim(name)) between 1 and 160),
  email           text check (email is null or (length(email) <= 254 and email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$')),
  phone           text check (phone is null or length(phone) between 3 and 40),
  company_name    text check (company_name is null or length(company_name) <= 160),
  job_title       text check (job_title is null or length(job_title) <= 120),
  notes           text check (notes is null or length(notes) <= 5000),
  created_by      uuid not null references public.profiles(id) on delete cascade,
  updated_by      uuid references public.profiles(id) on delete set null,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  constraint fk_crm_contacts_workspace
    foreign key (workspace_id, organization_id)
    references public.workspaces(id, organization_id) on delete cascade
);

create index crm_contacts_workspace_idx
  on public.crm_contacts (workspace_id, created_at desc, id desc);
create index crm_contacts_name_idx
  on public.crm_contacts (workspace_id, lower(name));

alter table public.crm_contacts owner to app_migrations;
revoke all on public.crm_contacts from public, anon, authenticated;
alter table public.crm_contacts enable row level security;
alter table public.crm_contacts force row level security;

create trigger crm_contacts_touch_updated_at
  before update on public.crm_contacts
  for each row execute function private.touch_updated_at();

create function private.crm_contacts_guard_update()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if new.id is distinct from old.id
     or new.workspace_id is distinct from old.workspace_id
     or new.organization_id is distinct from old.organization_id
     or new.created_by is distinct from old.created_by
     or new.created_at is distinct from old.created_at then
    raise exception 'crm contacts: workspace, author and creation time are immutable'
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

alter function private.crm_contacts_guard_update() owner to app_migrations;
revoke execute on function private.crm_contacts_guard_update() from public, anon, authenticated;

create trigger crm_contacts_guard_update
  before update on public.crm_contacts
  for each row execute function private.crm_contacts_guard_update();

create policy crm_contacts_select on public.crm_contacts
  for select to app_runtime
  using (
    workspace_id = private.context_uuid('app.workspace_id')
    and organization_id = private.context_uuid('app.organization_id')
    and private.is_workspace_member(workspace_id, organization_id)
  );

create policy crm_contacts_insert on public.crm_contacts
  for insert to app_runtime
  with check (
    workspace_id = private.context_uuid('app.workspace_id')
    and organization_id = private.context_uuid('app.organization_id')
    and created_by = private.context_uuid('app.user_id')
    and updated_by is null
    and private.current_workspace_role() in ('owner', 'admin', 'editor')
  );

create policy crm_contacts_update on public.crm_contacts
  for update to app_runtime
  using (
    workspace_id = private.context_uuid('app.workspace_id')
    and organization_id = private.context_uuid('app.organization_id')
    and private.current_workspace_role() in ('owner', 'admin', 'editor')
  )
  with check (
    workspace_id = private.context_uuid('app.workspace_id')
    and organization_id = private.context_uuid('app.organization_id')
    and updated_by = private.context_uuid('app.user_id')
    and private.current_workspace_role() in ('owner', 'admin', 'editor')
  );

grant select, insert, update on public.crm_contacts to app_runtime;

-- Purge of a deleted workspace (F3e).
create policy crm_contacts_worker_purge_select on public.crm_contacts
  for select to app_worker
  using (private.workspace_purgeable(workspace_id));

create policy crm_contacts_worker_purge on public.crm_contacts
  for delete to app_worker
  using (private.workspace_purgeable(workspace_id));

grant select (workspace_id), delete on public.crm_contacts to app_worker;

-- ----------------------------------------------------------------------------
-- API key scopes of the module: crm:read (contacts) and crm:write (REST only;
-- the MCP writes contacts through proposals, F4d).
-- ----------------------------------------------------------------------------
alter table public.api_keys drop constraint api_keys_scopes_catalog_check;
alter table public.api_keys
  add constraint api_keys_scopes_catalog_check
  check (
    scopes <@ array[
      'workspace:read',
      'modules:read',
      'usage:read',
      'executions:read',
      'members:read',
      'proposals:write',
      'crm:read',
      'crm:write'
    ]::text[]
    and cardinality(scopes) > 0
  );
