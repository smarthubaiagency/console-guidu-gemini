-- ============================================================================
-- Migration: 20261031090000_a2b_ai_engine_runtime.sql
-- Module: A2b — Runtime of the AI engine (especificação v1.0 §7, §8 e §9;
--         plano-a2.md)
--
-- Maintenance Rationale:
-- 1. Write policies of the engine, together with the code that writes:
--    conversations, messages and usage of the GUIDS (workspace, as the
--    person who tests the agent) and of the Assistant (as the person who
--    talks to it); the scoring log of `score_lead`.
-- 2. The Assistant is the partner's and any member uses it (§10): in the
--    /admin as a member of the partner, in the /app as a member of a
--    customer workspace of that partner. Two security definer functions
--    give the engine, and only on the server, the Assistant's
--    configuration and the admin key of that partner, without opening
--    those rows to the member's own reads.
-- 3. Proposals of the Assistant (propose_operation): created in the name of
--    the person, without an API key and with the turn's execution id, and
--    reviewed on the proposals page. A session alone still cannot propose.
-- Nothing here reads or writes without a context: the turn of a GUIDS in
-- the worker runs as app_runtime with the requester's context, like every
-- workspace job.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Partner of a turn (owned by app_rls_helper)
-- ----------------------------------------------------------------------------
-- The partner whose Assistant serves the context: the partner of the
-- workspace's company for a member of the workspace, or the context
-- partner for a member of that partner. Null for anyone else.
create function private.ai_turn_partner_id()
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when private.current_workspace_role() is not null then (
      select organization.partner_id
      from public.organizations organization
      where organization.id = private.context_uuid('app.organization_id')
    )
    when private.current_partner_role() is not null then private.current_partner_id()
  end;
$$;

revoke execute on function private.ai_turn_partner_id() from public, anon, authenticated;
grant execute on function private.ai_turn_partner_id() to app_runtime, app_rls_helper;
alter function private.ai_turn_partner_id() owner to app_rls_helper;

-- Reads of the two functions below, as their owner.
create policy ai_agents_assistant_helper_select on public.ai_agents
  for select to app_rls_helper
  using (kind = 'assistant' and partner_id = private.ai_turn_partner_id());

create policy partner_credentials_helper_select on public.partner_credentials
  for select to app_rls_helper
  using (status = 'active' and partner_id = private.ai_turn_partner_id());

grant select on public.ai_agents, public.partner_credentials to app_rls_helper;

-- ----------------------------------------------------------------------------
-- 2. The Assistant and its key for the engine
-- ----------------------------------------------------------------------------
create function private.ai_assistant_runtime()
returns table(
  agent_id uuid,
  partner_id uuid,
  status text,
  config jsonb,
  config_version integer
)
language sql
stable
security definer
set search_path = ''
as $$
  select agent.id, agent.partner_id, agent.status, agent.config, agent.config_version
  from public.ai_agents agent
  where agent.kind = 'assistant'
    and agent.partner_id = private.ai_turn_partner_id();
$$;

-- The chosen admin key, or the newest active one of the provider. The
-- payload stays encrypted; only the server decrypts it.
create function private.ai_admin_key(p_credential_id uuid, p_provider text)
returns table(provider text, encrypted_payload text)
language sql
stable
security definer
set search_path = ''
as $$
  select credential.provider, credential.encrypted_payload
  from public.partner_credentials credential
  where credential.partner_id = private.ai_turn_partner_id()
    and credential.status = 'active'
    and credential.purpose in ('chat', 'all')
    and (p_credential_id is null or credential.id = p_credential_id)
    and (p_provider is null or credential.provider = p_provider)
  order by credential.created_at desc
  limit 1;
$$;

revoke execute on function private.ai_assistant_runtime() from public, anon, authenticated;
grant execute on function private.ai_assistant_runtime() to app_runtime;
alter function private.ai_assistant_runtime() owner to app_rls_helper;

revoke execute on function private.ai_admin_key(uuid, text) from public, anon, authenticated;
grant execute on function private.ai_admin_key(uuid, text) to app_runtime;
alter function private.ai_admin_key(uuid, text) owner to app_rls_helper;

-- ----------------------------------------------------------------------------
-- 3. Conversations
-- ----------------------------------------------------------------------------
-- GUIDS: the test conversation of a person of the workspace (channels of
-- the A5 bring their own policies). Assistant: the person who talks, with
-- the Assistant of the partner that serves the context.
create policy ai_conversations_insert on public.ai_conversations
  for insert to app_runtime
  with check (
    (
      kind = 'guid'
      and channel = 'test'
      and user_id = private.context_uuid('app.user_id')
      and workspace_id = private.context_uuid('app.workspace_id')
      and organization_id = private.context_uuid('app.organization_id')
      and private.current_workspace_role() in ('owner', 'admin', 'editor')
    )
    or (
      kind = 'assistant'
      and channel = 'panel'
      and user_id = private.context_uuid('app.user_id')
      and partner_id = private.ai_turn_partner_id()
      and (
        (workspace_id is null and private.current_partner_role() is not null)
        or (
          workspace_id = private.context_uuid('app.workspace_id')
          and organization_id = private.context_uuid('app.organization_id')
          and private.current_workspace_role() is not null
        )
      )
    )
  );

create policy ai_conversations_update on public.ai_conversations
  for update to app_runtime
  using (
    (
      kind = 'guid'
      and workspace_id = private.context_uuid('app.workspace_id')
      and organization_id = private.context_uuid('app.organization_id')
      and private.current_workspace_role() in ('owner', 'admin', 'editor')
    )
    or (kind = 'assistant' and user_id = private.context_uuid('app.user_id'))
  )
  with check (
    (
      kind = 'guid'
      and workspace_id = private.context_uuid('app.workspace_id')
      and organization_id = private.context_uuid('app.organization_id')
      and private.current_workspace_role() in ('owner', 'admin', 'editor')
    )
    or (kind = 'assistant' and user_id = private.context_uuid('app.user_id'))
  );

grant insert on public.ai_conversations to app_runtime;
grant update (contact_id, status, variables, summary, last_message_at, closed_at)
  on public.ai_conversations to app_runtime;

-- A message is written into a conversation the person can see.
create policy ai_messages_insert on public.ai_messages
  for insert to app_runtime
  with check (
    exists (select 1 from public.ai_conversations c where c.id = conversation_id)
  );

grant insert on public.ai_messages to app_runtime;

-- ----------------------------------------------------------------------------
-- 4. Usage
-- ----------------------------------------------------------------------------
create policy ai_usage_events_insert on public.ai_usage_events
  for insert to app_runtime
  with check (
    (
      key_source in ('customer', 'backup')
      and partner_id is null
      and workspace_id = private.context_uuid('app.workspace_id')
      and organization_id = private.context_uuid('app.organization_id')
      and private.current_workspace_role() is not null
    )
    or (
      key_source = 'admin'
      and partner_id = private.ai_turn_partner_id()
      and (
        (workspace_id is null and private.current_partner_role() is not null)
        or (
          workspace_id = private.context_uuid('app.workspace_id')
          and organization_id = private.context_uuid('app.organization_id')
          and private.current_workspace_role() is not null
        )
      )
    )
  );

grant insert on public.ai_usage_events to app_runtime;

-- ----------------------------------------------------------------------------
-- 5. Scoring log (score_lead), always inserted, never updated
-- ----------------------------------------------------------------------------
create policy ai_lead_activities_insert on public.ai_lead_activities
  for insert to app_runtime
  with check (
    workspace_id = private.context_uuid('app.workspace_id')
    and organization_id = private.context_uuid('app.organization_id')
    and private.current_workspace_role() in ('owner', 'admin', 'editor')
  );

grant insert on public.ai_lead_activities to app_runtime;

-- ----------------------------------------------------------------------------
-- 6. Proposals of the Assistant
-- ----------------------------------------------------------------------------
-- An API key proposes with its own id. The Assistant proposes in the name
-- of the person, with no key and with the execution id of its turn; a
-- session alone still cannot propose (F4d). Everything else stays.
alter table public.execution_proposals
  add column ai_execution_id uuid,
  add constraint execution_proposals_source_check
    check (api_key_id is null or ai_execution_id is null);

create index execution_proposals_ai_execution_idx
  on public.execution_proposals (ai_execution_id) where ai_execution_id is not null;

alter policy execution_proposals_insert on public.execution_proposals
  with check (
    workspace_id = private.context_uuid('app.workspace_id')
    and organization_id = private.context_uuid('app.organization_id')
    and requested_by = private.context_uuid('app.user_id')
    and (
      (
        current_setting('app.principal_type', true) = 'api_key'
        and api_key_id = nullif(current_setting('app.grant_id', true), '')::uuid
        and ai_execution_id is null
      )
      or (
        current_setting('app.principal_type', true) = 'user'
        and api_key_id is null
        and ai_execution_id is not null
      )
    )
    and private.current_workspace_role() in ('owner', 'admin', 'editor')
    and status = 'pending'
    and decided_by is null and decided_at is null and approved_hash is null
    and executed_at is null and result is null and error_code is null
    and expires_at > now() and expires_at <= now() + interval '24 hours 5 minutes'
  );
