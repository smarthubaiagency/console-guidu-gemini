-- ============================================================================
-- SQL GF2: the orchestrator hands the conversation to a specialist.
--   workspace A a…011 (org a…010): owner a…031, viewer a…033
--   workspace B a…021 (org a…020): owner a…032
-- The new columns: `ai_messages.author_agent_id` / `via_delegation` and
-- `ai_conversations.delegated_agent_id` / `delegated_until`, and the tools of
-- the factory templates. Each block prepares as administrator, switches to
-- `app_runtime` with `set local role` and rolls back.
-- ============================================================================

create or replace function pg_temp.ctx(p_user uuid, p_ws uuid, p_org uuid)
returns void
language sql as $$
  select set_config('app.user_id', coalesce(p_user::text, ''), true),
         set_config('app.workspace_id', coalesce(p_ws::text, ''), true),
         set_config('app.organization_id', coalesce(p_org::text, ''), true),
         set_config('app.partner_id', '', true);
$$;

-- An orchestrator and a seller in A, a seller in B, and a test conversation
-- of A's owner with the orchestrator.
create or replace function pg_temp.fixture() returns void
language sql as $$
  insert into public.ai_agents (id, kind, organization_id, workspace_id, factory_role, config, created_by) values
    ('9f200000-0000-4000-8000-0000000000a1', 'guid', 'a0000000-0000-4000-8000-000000000010',
     'a0000000-0000-4000-8000-000000000011', 'orchestrator', '{"overview": {"agent_name": "Recepção"}}',
     'a0000000-0000-4000-8000-000000000031'),
    ('9f200000-0000-4000-8000-0000000000a3', 'guid', 'a0000000-0000-4000-8000-000000000010',
     'a0000000-0000-4000-8000-000000000011', 'seller', '{"overview": {"agent_name": "Vendedor"}}',
     'a0000000-0000-4000-8000-000000000031'),
    ('9f200000-0000-4000-8000-0000000000b3', 'guid', 'a0000000-0000-4000-8000-000000000020',
     'a0000000-0000-4000-8000-000000000021', 'seller', '{"overview": {"agent_name": "Vendedor B"}}',
     'a0000000-0000-4000-8000-000000000032');
  insert into public.ai_conversations (id, kind, agent_id, organization_id, workspace_id, user_id, channel) values
    ('9f200000-0000-4000-8000-0000000001a1', 'guid', '9f200000-0000-4000-8000-0000000000a1',
     'a0000000-0000-4000-8000-000000000010', 'a0000000-0000-4000-8000-000000000011',
     'a0000000-0000-4000-8000-000000000031', 'test');
$$;

-- ----------------------------------------------------------------------------
-- Test 1: the author of a message is a GUIDS of the conversation's workspace
-- ----------------------------------------------------------------------------
begin;
select pg_temp.fixture();
set local role app_runtime;
do $$
declare
  v_state text;
begin
  perform pg_temp.ctx('a0000000-0000-4000-8000-000000000031', 'a0000000-0000-4000-8000-000000000011',
                      'a0000000-0000-4000-8000-000000000010');
  insert into public.ai_messages (conversation_id, role, content, author_agent_id, via_delegation)
  values ('9f200000-0000-4000-8000-0000000001a1', 'assistant', 'Temos três pacotes.',
          '9f200000-0000-4000-8000-0000000000a3', true);
  insert into public.ai_messages (conversation_id, role, content, author_agent_id)
  values ('9f200000-0000-4000-8000-0000000001a1', 'assistant', 'Olá!',
          '9f200000-0000-4000-8000-0000000000a1');
  -- Rows written before the GF2 keep both empty.
  insert into public.ai_messages (conversation_id, role, content)
  values ('9f200000-0000-4000-8000-0000000001a1', 'user', 'Oi');
  if (select count(*) from public.ai_messages where via_delegation) <> 1 then
    raise exception 'ai_messages: via_delegation not kept';
  end if;
  if exists (select 1 from public.ai_messages where role = 'user' and (author_agent_id is not null or via_delegation)) then
    raise exception 'ai_messages: default author is not empty';
  end if;

  -- The seller of workspace B is not a valid author in A.
  begin
    insert into public.ai_messages (conversation_id, role, content, author_agent_id)
    values ('9f200000-0000-4000-8000-0000000001a1', 'assistant', 'x', '9f200000-0000-4000-8000-0000000000b3');
    raise exception 'ai_messages: author of another workspace';
  exception when foreign_key_violation then null;
  end;
  -- Nor an agent that does not exist.
  begin
    insert into public.ai_messages (conversation_id, role, content, author_agent_id)
    values ('9f200000-0000-4000-8000-0000000001a1', 'assistant', 'x', gen_random_uuid());
    raise exception 'ai_messages: author does not exist';
  exception when foreign_key_violation then null;
  end;
  -- A message stays as written: no update, whatever the column.
  begin
    update public.ai_messages set author_agent_id = null;
    raise exception 'ai_messages: author updated';
  exception when insufficient_privilege then null;
  end;
end $$;
rollback;

-- ----------------------------------------------------------------------------
-- Test 2: who holds the conversation, only inside the workspace
-- ----------------------------------------------------------------------------
begin;
select pg_temp.fixture();
set local role app_runtime;
do $$
begin
  perform pg_temp.ctx('a0000000-0000-4000-8000-000000000031', 'a0000000-0000-4000-8000-000000000011',
                      'a0000000-0000-4000-8000-000000000010');
  update public.ai_conversations
  set delegated_agent_id = '9f200000-0000-4000-8000-0000000000a3',
      delegated_until = now() + interval '24 hours'
  where id = '9f200000-0000-4000-8000-0000000001a1';
  if not found then raise exception 'ai_conversations: owner could not delegate'; end if;
  if (select delegated_agent_id from public.ai_conversations) is distinct from '9f200000-0000-4000-8000-0000000000a3' then
    raise exception 'ai_conversations: delegated agent not kept';
  end if;
  -- The deadline moves with each message of the contact.
  update public.ai_conversations set delegated_until = now() + interval '25 hours';
  -- Back to the orchestrator.
  update public.ai_conversations set delegated_agent_id = null, delegated_until = null;
  if (select delegated_agent_id from public.ai_conversations) is not null then
    raise exception 'ai_conversations: delegation not cleared';
  end if;

  -- A specialist of another workspace cannot be named (composite reference).
  begin
    update public.ai_conversations
    set delegated_agent_id = '9f200000-0000-4000-8000-0000000000b3',
        delegated_until = now() + interval '1 hour';
    raise exception 'ai_conversations: delegated to another workspace';
  exception when foreign_key_violation then null;
  end;
  -- A delegation always has its deadline.
  begin
    update public.ai_conversations
    set delegated_agent_id = '9f200000-0000-4000-8000-0000000000a3', delegated_until = null;
    raise exception 'ai_conversations: delegation without a deadline';
  exception when check_violation then null;
  end;
  -- The engine still cannot change who the conversation belongs to.
  begin
    update public.ai_conversations set agent_id = '9f200000-0000-4000-8000-0000000000a3';
    raise exception 'ai_conversations: agent changed';
  exception when insufficient_privilege then null;
  end;
end $$;
rollback;

-- ----------------------------------------------------------------------------
-- Test 3: other people of the workspace and of other workspaces
-- ----------------------------------------------------------------------------
begin;
select pg_temp.fixture();
set local role app_runtime;
do $$
declare
  v_rows integer;
begin
  -- The viewer of A reads no conversation and changes none.
  perform pg_temp.ctx('a0000000-0000-4000-8000-000000000033', 'a0000000-0000-4000-8000-000000000011',
                      'a0000000-0000-4000-8000-000000000010');
  update public.ai_conversations
  set delegated_agent_id = '9f200000-0000-4000-8000-0000000000a3',
      delegated_until = now() + interval '1 hour';
  get diagnostics v_rows = row_count;
  if v_rows <> 0 then raise exception 'ai_conversations: viewer delegated'; end if;

  -- The owner of B does not reach A's conversation, with B's own seller.
  perform pg_temp.ctx('a0000000-0000-4000-8000-000000000032', 'a0000000-0000-4000-8000-000000000021',
                      'a0000000-0000-4000-8000-000000000020');
  update public.ai_conversations
  set delegated_agent_id = '9f200000-0000-4000-8000-0000000000b3',
      delegated_until = now() + interval '1 hour'
  where id = '9f200000-0000-4000-8000-0000000001a1';
  get diagnostics v_rows = row_count;
  if v_rows <> 0 then raise exception 'ai_conversations: owner of B delegated in A'; end if;
  if exists (select 1 from public.ai_conversations) then
    raise exception 'ai_conversations: owner of B reads A';
  end if;
  begin
    insert into public.ai_messages (conversation_id, role, content, author_agent_id)
    values ('9f200000-0000-4000-8000-0000000001a1', 'assistant', 'x', '9f200000-0000-4000-8000-0000000000b3');
    raise exception 'ai_messages: owner of B wrote in A';
  exception when others then
    if sqlstate = 'P0001' then raise; end if;
  end;

  -- Without context nothing is seen or changed.
  perform pg_temp.ctx(null, null, null);
  if exists (select 1 from public.ai_conversations) or exists (select 1 from public.ai_messages) then
    raise exception 'ai_conversations: without context';
  end if;
end $$;
rollback;

-- ----------------------------------------------------------------------------
-- Test 4: grants of the new columns
-- ----------------------------------------------------------------------------
do $$
declare
  i integer;
begin
  if not has_column_privilege('app_runtime', 'public.ai_conversations', 'delegated_agent_id', 'update')
     or not has_column_privilege('app_runtime', 'public.ai_conversations', 'delegated_until', 'update') then
    raise exception 'grants: app_runtime cannot update the delegation';
  end if;
  if has_table_privilege('app_runtime', 'public.ai_messages', 'update')
     or has_column_privilege('app_runtime', 'public.ai_messages', 'author_agent_id', 'update') then
    raise exception 'grants: app_runtime can update messages';
  end if;
  for i in 1..2 loop
    if has_column_privilege(case i when 1 then 'anon' else 'authenticated' end,
                            'public.ai_conversations', 'delegated_agent_id', 'select')
       or has_column_privilege(case i when 1 then 'anon' else 'authenticated' end,
                               'public.ai_messages', 'author_agent_id', 'select')
       or has_column_privilege(case i when 1 then 'anon' else 'authenticated' end,
                               'public.ai_conversations', 'delegated_until', 'update') then
      raise exception 'grants: anon or authenticated reach the new columns';
    end if;
  end loop;
  if not (select relforcerowsecurity from pg_class where oid = 'public.ai_conversations'::regclass)
     or not (select relforcerowsecurity from pg_class where oid = 'public.ai_messages'::regclass)
     or not (select relforcerowsecurity from pg_class where oid = 'public.ai_agents'::regclass)
     or not (select relforcerowsecurity from pg_class where oid = 'public.ai_agent_templates'::regclass) then
    raise exception 'rls: FORCE lost on a table the migration touched';
  end if;
  -- The check of the author is not callable from outside.
  if has_function_privilege('anon', 'private.ai_messages_check_author()', 'execute')
     or has_function_privilege('authenticated', 'private.ai_messages_check_author()', 'execute') then
    raise exception 'grants: the author check is callable';
  end if;
end $$;

-- ----------------------------------------------------------------------------
-- Test 5: the factory templates carry the new tools and the new prompt
-- ----------------------------------------------------------------------------
do $$
declare
  v_tools jsonb;
begin
  select defaults #> '{integration,tools}' into v_tools
  from public.ai_agent_templates where factory_role = 'orchestrator';
  if not (v_tools @> '["delegate"]'::jsonb) or v_tools @> '["return_to_reception"]'::jsonb then
    raise exception 'templates: orchestrator tools are %', v_tools;
  end if;
  if not exists (
    select 1 from public.ai_agent_templates
    where factory_role = 'orchestrator'
      and prompt_template like '%QUANDO ENCAMINHAR%'
      and defaults #>> '{overview,system_prompt}' = prompt_template
  ) then
    raise exception 'templates: the orchestrator prompt was not updated';
  end if;
  for v_tools in
    select defaults #> '{integration,tools}'
    from public.ai_agent_templates where factory_role in ('attendant', 'seller')
  loop
    if not (v_tools @> '["return_to_reception"]'::jsonb) or v_tools @> '["delegate"]'::jsonb then
      raise exception 'templates: specialist tools are %', v_tools;
    end if;
  end loop;
  -- Ops has neither.
  select defaults #> '{integration,tools}' into v_tools
  from public.ai_agent_templates where factory_role = 'ops';
  if v_tools @> '["delegate"]'::jsonb or v_tools @> '["return_to_reception"]'::jsonb then
    raise exception 'templates: ops has an engine tool';
  end if;
end $$;
