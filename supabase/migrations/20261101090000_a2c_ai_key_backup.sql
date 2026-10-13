-- ============================================================================
-- Migration: 20261101090000_a2c_ai_key_backup.sql
-- Module: A2c — Backup of the customer's key (especificação v1.0 §9.2;
--         plano-a2.md)
--
-- Maintenance Rationale:
-- 1. When the customer's key fails (invalid, revoked, no credit or provider
--    limit), the turn of a GUIDS marks the agent `key_state = backup` and
--    finishes the conversations already open with the platform key and its
--    cheap model, for up to 24 hours. Whoever talks to the agent may be an
--    editor, who does not update agents: a security definer function makes
--    only that change, only on an agent of the context's workspace.
-- 2. The backup key reaches the engine only through a security definer
--    function, only for an agent of the context's workspace in backup and
--    inside the 24 hours. The payload stays encrypted; only the server
--    decrypts it.
-- 3. A platform job (app_worker) sends the notices and, 24 hours after the
--    first failure, pauses the agent (`status = paused`, `key_state =
--    failed`). It reads only agents with a key problem and, for their
--    workspaces, the owners and admins with the e-mail of their accepted
--    invitation (the only e-mail of a member the application keeps).
-- 4. A successful key test ends the backup: an update the workspace
--    policies of the A1 already allow (owner and admin).
-- Nothing here reads or writes without a context, except the job's narrow
-- reads as app_worker.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Start of the backup, from the turn (owned by app_rls_helper)
-- ----------------------------------------------------------------------------
-- The GUIDS of the context's workspace, for the two functions below.
create policy ai_agents_key_helper_select on public.ai_agents
  for select to app_rls_helper
  using (
    kind = 'guid'
    and workspace_id = private.context_uuid('app.workspace_id')
    and organization_id = private.context_uuid('app.organization_id')
    and private.current_workspace_role() in ('owner', 'admin', 'editor')
  );

create policy ai_agents_key_helper_update on public.ai_agents
  for update to app_rls_helper
  using (
    kind = 'guid'
    and key_state = 'ok'
    and workspace_id = private.context_uuid('app.workspace_id')
    and organization_id = private.context_uuid('app.organization_id')
    and private.current_workspace_role() in ('owner', 'admin', 'editor')
  )
  with check (
    kind = 'guid'
    and key_state = 'backup'
    and backup_started_at is not null
    and workspace_id = private.context_uuid('app.workspace_id')
    and organization_id = private.context_uuid('app.organization_id')
  );

grant update (key_state, backup_started_at) on public.ai_agents to app_rls_helper;

-- Marks the agent in backup at its first key failure. Returns when the
-- backup started and whether this call started it; nothing for an agent
-- outside the context or with its key already failed.
create function private.ai_agent_key_failed(p_agent_id uuid)
returns table(backup_started_at timestamptz, started boolean)
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_started_at timestamptz;
begin
  update public.ai_agents agent
  set key_state = 'backup', backup_started_at = now()
  where agent.id = p_agent_id and agent.key_state = 'ok'
  returning agent.backup_started_at into v_started_at;
  if v_started_at is not null then
    return query select v_started_at, true;
    return;
  end if;
  return query
    select agent.backup_started_at, false
    from public.ai_agents agent
    where agent.id = p_agent_id and agent.key_state = 'backup';
end;
$$;

revoke execute on function private.ai_agent_key_failed(uuid) from public, anon, authenticated;
grant execute on function private.ai_agent_key_failed(uuid) to app_runtime;
alter function private.ai_agent_key_failed(uuid) owner to app_rls_helper;

-- ----------------------------------------------------------------------------
-- 2. The backup key for the engine (owned by app_rls_helper)
-- ----------------------------------------------------------------------------
create policy platform_ai_settings_backup_helper_select on public.platform_ai_settings
  for select to app_rls_helper
  using (
    exists (
      select 1 from public.ai_agents agent
      where agent.kind = 'guid'
        and agent.key_state = 'backup'
        and agent.workspace_id = private.context_uuid('app.workspace_id')
    )
  );

grant select (backup_provider, backup_encrypted_payload, backup_model)
  on public.platform_ai_settings to app_rls_helper;

create function private.ai_backup_key(p_agent_id uuid)
returns table(provider text, encrypted_payload text, model text)
language sql
stable
security definer
set search_path = ''
as $$
  select settings.backup_provider, settings.backup_encrypted_payload, settings.backup_model
  from public.platform_ai_settings settings
  where settings.backup_provider is not null
    and settings.backup_encrypted_payload is not null
    and settings.backup_model is not null
    and exists (
      select 1 from public.ai_agents agent
      where agent.id = p_agent_id
        and agent.kind = 'guid'
        and agent.key_state = 'backup'
        and agent.backup_started_at > now() - interval '24 hours'
    );
$$;

revoke execute on function private.ai_backup_key(uuid) from public, anon, authenticated;
grant execute on function private.ai_backup_key(uuid) to app_runtime;
alter function private.ai_backup_key(uuid) owner to app_rls_helper;

-- A conversation finished by the backup is marked as such.
grant update (key_mode) on public.ai_conversations to app_runtime;

-- ----------------------------------------------------------------------------
-- 3. The job of the notices and of the pause (app_worker)
-- ----------------------------------------------------------------------------
create policy ai_agents_worker_key_select on public.ai_agents
  for select to app_worker
  using (kind = 'guid' and key_state <> 'ok');

-- Only the pause, 24 hours after the first failure.
create policy ai_agents_worker_key_update on public.ai_agents
  for update to app_worker
  using (
    kind = 'guid'
    and key_state = 'backup'
    and backup_started_at <= now() - interval '24 hours'
  )
  with check (kind = 'guid' and key_state = 'failed' and status = 'paused');

grant select (id, kind, organization_id, workspace_id, status, key_state, backup_started_at)
  on public.ai_agents to app_worker;
-- updated_at: the client sends it; the touch trigger sets it anyway.
grant update (status, key_state, updated_at) on public.ai_agents to app_worker;

-- Workspaces and organizations with a GUIDS whose key has a problem.
-- Security definer (app_rls_helper), so the policies below do not go
-- through the worker's own policies on agents and workspaces (the purge of
-- the F3e reads workspaces from agents: evaluated as app_worker, the check
-- would loop). The helper sees those agents only while the function runs:
-- the flag is set for the lookup and restored right after (I5 pattern).
create policy ai_agents_key_notice_helper_select on public.ai_agents
  for select to app_rls_helper
  using (
    kind = 'guid'
    and key_state <> 'ok'
    and current_setting('app.ai_key_notice', true) = 'on'
  );

create function private.ai_key_notice_workspace(p_workspace_id uuid)
returns boolean
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_previous text := current_setting('app.ai_key_notice', true);
  v_found boolean;
begin
  perform set_config('app.ai_key_notice', 'on', true);
  select exists (
    select 1 from public.ai_agents agent
    where agent.workspace_id = p_workspace_id
      and agent.kind = 'guid'
      and agent.key_state <> 'ok'
  ) into v_found;
  perform set_config('app.ai_key_notice', coalesce(v_previous, ''), true);
  return v_found;
end;
$$;

create function private.ai_key_notice_organization(p_organization_id uuid)
returns boolean
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_previous text := current_setting('app.ai_key_notice', true);
  v_found boolean;
begin
  perform set_config('app.ai_key_notice', 'on', true);
  select exists (
    select 1 from public.ai_agents agent
    where agent.organization_id = p_organization_id
      and agent.kind = 'guid'
      and agent.key_state <> 'ok'
  ) into v_found;
  perform set_config('app.ai_key_notice', coalesce(v_previous, ''), true);
  return v_found;
end;
$$;

revoke execute on function private.ai_key_notice_workspace(uuid) from public, anon, authenticated;
revoke execute on function private.ai_key_notice_organization(uuid) from public, anon, authenticated;
grant execute on function private.ai_key_notice_workspace(uuid) to app_worker;
grant execute on function private.ai_key_notice_organization(uuid) to app_worker;
alter function private.ai_key_notice_workspace(uuid) owner to app_rls_helper;
alter function private.ai_key_notice_organization(uuid) owner to app_rls_helper;

-- The workspace's name and address, for the notice and its link.
create policy workspaces_worker_ai_key_select on public.workspaces
  for select to app_worker
  using (status = 'active' and private.ai_key_notice_workspace(id));

-- Who receives the notice: active owners and admins (support memberships
-- are not the customer's).
create policy workspace_members_worker_ai_key_select on public.workspace_members
  for select to app_worker
  using (
    status = 'active'
    and role in ('owner', 'admin')
    and support_grant_id is null
    and private.ai_key_notice_workspace(workspace_id)
  );

grant select (workspace_id, organization_id, user_id, role, status, support_grant_id)
  on public.workspace_members to app_worker;

-- Their e-mail: the one of their accepted invitation.
create policy invitations_worker_ai_key_select on public.invitations
  for select to app_worker
  using (
    status = 'accepted'
    and accepted_by_user_id is not null
    and private.ai_key_notice_organization(organization_id)
  );

grant select (organization_id, workspace_id, email, status, accepted_by_user_id, accepted_at)
  on public.invitations to app_worker;
