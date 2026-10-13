-- ============================================================================
-- SQL AI engine data (A2a): conversations and messages, usage, the partner
-- vault and the platform backup key.
--   workspace A a…011 (org a…010, house partner): owner a…031, viewer a…033
--   workspace B a…021 (org a…020, house partner): owner a…032
--   partner P b1…001 (created per block, with its Assistant):
--     d…004 partner_owner, d…005 partner_finance, d…006 partner_support
--   house partner 0…000 with its Assistant (A1)
--   d…003 platform owner (admin-seed.sql)
-- Each block prepares its fixtures as administrator, switches to
-- `app_runtime` with `set local role` and rolls back.
-- ============================================================================

create or replace function pg_temp.ctx(p_user uuid, p_ws uuid, p_org uuid, p_partner uuid default null)
returns void
language sql as $$
  select set_config('app.user_id', p_user::text, true),
         set_config('app.workspace_id', coalesce(p_ws::text, ''), true),
         set_config('app.organization_id', coalesce(p_org::text, ''), true),
         set_config('app.partner_id', coalesce(p_partner::text, ''), true);
$$;

-- GUIDS in A and B with one conversation each (A with a contact), the
-- Assistant conversations of a…031 and a…032, and usage rows.
create or replace function pg_temp.fixture() returns void
language sql as $$
  insert into public.partners (id, slug, name)
  values ('b1000000-0000-4000-8000-000000000001', 'agencia-p', 'Agência P');
  insert into public.partner_members (partner_id, user_id, email, role) values
    ('b1000000-0000-4000-8000-000000000001', 'd0000000-0000-4000-8000-000000000004', 'owner@p.test', 'partner_owner'),
    ('b1000000-0000-4000-8000-000000000001', 'd0000000-0000-4000-8000-000000000005', 'fin@p.test', 'partner_finance'),
    ('b1000000-0000-4000-8000-000000000001', 'd0000000-0000-4000-8000-000000000006', 'sup@p.test', 'partner_support');
  insert into public.ai_agents (id, kind, organization_id, workspace_id, created_by) values
    ('a2a00000-0000-4000-8000-0000000000a1', 'guid', 'a0000000-0000-4000-8000-000000000010',
     'a0000000-0000-4000-8000-000000000011', 'a0000000-0000-4000-8000-000000000031'),
    ('a2a00000-0000-4000-8000-0000000000b1', 'guid', 'a0000000-0000-4000-8000-000000000020',
     'a0000000-0000-4000-8000-000000000021', 'a0000000-0000-4000-8000-000000000032');
  insert into public.crm_contacts (id, organization_id, workspace_id, name, created_by) values
    ('a2a00000-0000-4000-8000-0000000000ca', 'a0000000-0000-4000-8000-000000000010',
     'a0000000-0000-4000-8000-000000000011', 'Contato A', 'a0000000-0000-4000-8000-000000000031'),
    ('a2a00000-0000-4000-8000-0000000000cb', 'a0000000-0000-4000-8000-000000000020',
     'a0000000-0000-4000-8000-000000000021', 'Contato B', 'a0000000-0000-4000-8000-000000000032');
  insert into public.ai_conversations (id, kind, agent_id, organization_id, workspace_id, contact_id, user_id, channel) values
    ('a2a00000-0000-4000-8000-0000000001a1', 'guid', 'a2a00000-0000-4000-8000-0000000000a1',
     'a0000000-0000-4000-8000-000000000010', 'a0000000-0000-4000-8000-000000000011',
     'a2a00000-0000-4000-8000-0000000000ca', 'a0000000-0000-4000-8000-000000000031', 'test'),
    ('a2a00000-0000-4000-8000-0000000001b1', 'guid', 'a2a00000-0000-4000-8000-0000000000b1',
     'a0000000-0000-4000-8000-000000000020', 'a0000000-0000-4000-8000-000000000021',
     null, null, 'test');
  -- The house Assistant answering a…031 in /admin and a…032 in workspace B.
  insert into public.ai_conversations (id, kind, agent_id, partner_id, organization_id, workspace_id, user_id, channel)
  select v.id, 'assistant', a.id, a.partner_id, v.org, v.ws, v.usr, 'panel'
  from public.ai_agents a,
       (values
         ('a2a00000-0000-4000-8000-0000000002a1'::uuid, null::uuid, null::uuid, 'a0000000-0000-4000-8000-000000000031'::uuid),
         ('a2a00000-0000-4000-8000-0000000002b1'::uuid, 'a0000000-0000-4000-8000-000000000020'::uuid,
          'a0000000-0000-4000-8000-000000000021'::uuid, 'a0000000-0000-4000-8000-000000000032'::uuid)
       ) as v(id, org, ws, usr)
  where a.kind = 'assistant' and a.partner_id = '00000000-0000-4000-8000-000000000000';
  insert into public.ai_messages (conversation_id, role, content)
  select id, 'user', 'Olá' from public.ai_conversations;
  insert into public.ai_usage_events (execution_id, organization_id, workspace_id, agent_id, key_source, provider, model) values
    (gen_random_uuid(), 'a0000000-0000-4000-8000-000000000010', 'a0000000-0000-4000-8000-000000000011',
     'a2a00000-0000-4000-8000-0000000000a1', 'customer', 'openai', 'gpt-test'),
    (gen_random_uuid(), 'a0000000-0000-4000-8000-000000000010', 'a0000000-0000-4000-8000-000000000011',
     'a2a00000-0000-4000-8000-0000000000a1', 'backup', 'openai', 'gpt-cheap'),
    (gen_random_uuid(), 'a0000000-0000-4000-8000-000000000020', 'a0000000-0000-4000-8000-000000000021',
     'a2a00000-0000-4000-8000-0000000000b1', 'customer', 'anthropic', 'claude-test');
  insert into public.ai_usage_events (execution_id, partner_id, organization_id, workspace_id, agent_id, key_source, provider, model)
  select gen_random_uuid(), a.partner_id, 'a0000000-0000-4000-8000-000000000010',
         'a0000000-0000-4000-8000-000000000011', a.id, 'admin', 'gemini', 'gemini-test'
  from public.ai_agents a where a.kind = 'assistant' and a.partner_id in
    ('00000000-0000-4000-8000-000000000000', 'b1000000-0000-4000-8000-000000000001');
$$;

-- ----------------------------------------------------------------------------
-- Test 1: conversations and messages follow the workspace and the person
-- ----------------------------------------------------------------------------
begin;
select pg_temp.fixture();
set local role app_runtime;
do $$
begin
  -- Owner of A: the GUIDS conversation of A and his own Assistant one.
  perform pg_temp.ctx('a0000000-0000-4000-8000-000000000031', 'a0000000-0000-4000-8000-000000000011',
                      'a0000000-0000-4000-8000-000000000010');
  if (select array_agg(id order by id) from public.ai_conversations)
     <> array['a2a00000-0000-4000-8000-0000000001a1', 'a2a00000-0000-4000-8000-0000000002a1']::uuid[] then
    raise exception 'ai_conversations: owner of A does not see exactly his conversations';
  end if;
  if (select count(*) from public.ai_messages) <> 2 then
    raise exception 'ai_messages: owner of A does not see exactly the messages of his conversations';
  end if;

  -- The engine writes from A2b on: no write path yet.
  begin
    insert into public.ai_conversations (kind, agent_id, organization_id, workspace_id, channel)
    values ('guid', 'a2a00000-0000-4000-8000-0000000000a1', 'a0000000-0000-4000-8000-000000000010',
            'a0000000-0000-4000-8000-000000000011', 'test');
    raise exception 'ai_conversations: inserted without a write path';
  exception when insufficient_privilege then null;
  end;
  begin
    insert into public.ai_messages (conversation_id, role, content)
    values ('a2a00000-0000-4000-8000-0000000001a1', 'user', 'x');
    raise exception 'ai_messages: inserted without a write path';
  exception when insufficient_privilege then null;
  end;
  begin
    update public.ai_messages set content = 'x';
    raise exception 'ai_messages: updated';
  exception when insufficient_privilege then null;
  end;

  -- The viewer has no conversations.read; the Assistant of the owner stays his.
  perform pg_temp.ctx('a0000000-0000-4000-8000-000000000033', 'a0000000-0000-4000-8000-000000000011',
                      'a0000000-0000-4000-8000-000000000010');
  if exists (select 1 from public.ai_conversations) or exists (select 1 from public.ai_messages) then
    raise exception 'ai_conversations: viewer sees conversations';
  end if;

  -- Owner of B: the GUIDS conversation of B and his own Assistant one.
  perform pg_temp.ctx('a0000000-0000-4000-8000-000000000032', 'a0000000-0000-4000-8000-000000000021',
                      'a0000000-0000-4000-8000-000000000020');
  if (select array_agg(id order by id) from public.ai_conversations)
     <> array['a2a00000-0000-4000-8000-0000000001b1', 'a2a00000-0000-4000-8000-0000000002b1']::uuid[] then
    raise exception 'ai_conversations: owner of B does not see exactly his conversations';
  end if;

  -- The partner never reads its customers' conversations, nor the
  -- conversations people have with its Assistant.
  perform pg_temp.ctx('d0000000-0000-4000-8000-000000000004', null, null, 'b1000000-0000-4000-8000-000000000001');
  if exists (select 1 from public.ai_conversations) or exists (select 1 from public.ai_messages) then
    raise exception 'ai_conversations: partner reads conversations';
  end if;
end
$$;
reset role;
rollback;

-- ----------------------------------------------------------------------------
-- Test 2: a conversation never links data of another owner
-- ----------------------------------------------------------------------------
begin;
select pg_temp.fixture();
do $$
declare
  v_house_assistant uuid;
  v_p_assistant uuid;
begin
  select id into v_house_assistant from public.ai_agents
  where kind = 'assistant' and partner_id = '00000000-0000-4000-8000-000000000000';
  select id into v_p_assistant from public.ai_agents
  where kind = 'assistant' and partner_id = 'b1000000-0000-4000-8000-000000000001';
  if v_p_assistant is null then raise exception 'partner P has no Assistant'; end if;

  -- GUIDS of B in a conversation of A.
  begin
    insert into public.ai_conversations (kind, agent_id, organization_id, workspace_id, channel)
    values ('guid', 'a2a00000-0000-4000-8000-0000000000b1', 'a0000000-0000-4000-8000-000000000010',
            'a0000000-0000-4000-8000-000000000011', 'test');
    raise exception 'ai_conversations: GUIDS of another workspace';
  exception when foreign_key_violation then null;
  end;
  -- Contact of B in a conversation of A.
  begin
    insert into public.ai_conversations (kind, agent_id, organization_id, workspace_id, contact_id, channel)
    values ('guid', 'a2a00000-0000-4000-8000-0000000000a1', 'a0000000-0000-4000-8000-000000000010',
            'a0000000-0000-4000-8000-000000000011', 'a2a00000-0000-4000-8000-0000000000cb', 'test');
    raise exception 'ai_conversations: contact of another workspace';
  exception when foreign_key_violation then null;
  end;
  -- An Assistant answering in a GUIDS conversation.
  begin
    insert into public.ai_conversations (kind, agent_id, organization_id, workspace_id, channel)
    values ('guid', v_house_assistant, 'a0000000-0000-4000-8000-000000000010',
            'a0000000-0000-4000-8000-000000000011', 'test');
    raise exception 'ai_conversations: Assistant in a GUIDS conversation';
  exception when foreign_key_violation then null;
  end;
  -- A GUIDS, or another partner's Assistant, in an Assistant conversation.
  begin
    insert into public.ai_conversations (kind, agent_id, partner_id, user_id, channel)
    values ('assistant', 'a2a00000-0000-4000-8000-0000000000a1', '00000000-0000-4000-8000-000000000000',
            'a0000000-0000-4000-8000-000000000031', 'panel');
    raise exception 'ai_conversations: GUIDS in an Assistant conversation';
  exception when foreign_key_violation then null;
  end;
  begin
    insert into public.ai_conversations (kind, agent_id, partner_id, user_id, channel)
    values ('assistant', v_p_assistant, '00000000-0000-4000-8000-000000000000',
            'a0000000-0000-4000-8000-000000000031', 'panel');
    raise exception 'ai_conversations: Assistant of another partner';
  exception when foreign_key_violation then null;
  end;
  -- An Assistant conversation always has its person.
  begin
    insert into public.ai_conversations (kind, agent_id, partner_id, channel)
    values ('assistant', v_house_assistant, '00000000-0000-4000-8000-000000000000', 'panel');
    raise exception 'ai_conversations: Assistant conversation without a person';
  exception when check_violation then null;
  end;
  -- A tool message answers a call.
  begin
    insert into public.ai_messages (conversation_id, role, content)
    values ('a2a00000-0000-4000-8000-0000000001a1', 'tool', '{}');
    raise exception 'ai_messages: tool message without its call';
  exception when check_violation then null;
  end;
  -- Usage of the admin key always has its partner.
  begin
    insert into public.ai_usage_events (execution_id, organization_id, workspace_id, key_source, provider, model)
    values (gen_random_uuid(), 'a0000000-0000-4000-8000-000000000010',
            'a0000000-0000-4000-8000-000000000011', 'admin', 'openai', 'gpt-test');
    raise exception 'ai_usage_events: admin usage without a partner';
  exception when check_violation then null;
  end;

  -- Deleting a GUIDS takes its conversations and messages; usage stays.
  delete from public.ai_agents where id = 'a2a00000-0000-4000-8000-0000000000a1';
  if exists (select 1 from public.ai_conversations where id = 'a2a00000-0000-4000-8000-0000000001a1')
     or exists (select 1 from public.ai_messages where conversation_id = 'a2a00000-0000-4000-8000-0000000001a1') then
    raise exception 'ai_conversations: kept after the GUIDS was deleted';
  end if;
  if (select count(*) from public.ai_usage_events
      where workspace_id = 'a0000000-0000-4000-8000-000000000011' and agent_id is null) <> 2 then
    raise exception 'ai_usage_events: usage lost with the GUIDS';
  end if;
end
$$;
rollback;

-- ----------------------------------------------------------------------------
-- Test 3: usage by owner and key
-- ----------------------------------------------------------------------------
begin;
select pg_temp.fixture();
set local role app_runtime;
do $$
begin
  -- Workspace A: its own key and the backup courtesy, never the admin key.
  perform pg_temp.ctx('a0000000-0000-4000-8000-000000000031', 'a0000000-0000-4000-8000-000000000011',
                      'a0000000-0000-4000-8000-000000000010');
  if (select array_agg(key_source || ':' || courtesy order by key_source) from public.ai_usage_events)
     <> array['backup:true', 'customer:false'] then
    raise exception 'ai_usage_events: owner of A does not see exactly his usage';
  end if;
  begin
    insert into public.ai_usage_events (execution_id, organization_id, workspace_id, key_source, provider, model)
    values (gen_random_uuid(), 'a0000000-0000-4000-8000-000000000010',
            'a0000000-0000-4000-8000-000000000011', 'customer', 'openai', 'gpt-test');
    raise exception 'ai_usage_events: inserted without a write path';
  exception when insufficient_privilege then null;
  end;

  perform pg_temp.ctx('a0000000-0000-4000-8000-000000000033', 'a0000000-0000-4000-8000-000000000011',
                      'a0000000-0000-4000-8000-000000000010');
  if exists (select 1 from public.ai_usage_events) then
    raise exception 'ai_usage_events: viewer sees usage';
  end if;

  -- Partner P: what its admin key spent, for owner and finance, not support.
  perform pg_temp.ctx('d0000000-0000-4000-8000-000000000005', null, null, 'b1000000-0000-4000-8000-000000000001');
  if (select count(*) from public.ai_usage_events) <> 1
     or exists (select 1 from public.ai_usage_events where key_source <> 'admin') then
    raise exception 'ai_usage_events: finance of P does not see exactly the admin usage of P';
  end if;
  perform pg_temp.ctx('d0000000-0000-4000-8000-000000000006', null, null, 'b1000000-0000-4000-8000-000000000001');
  if exists (select 1 from public.ai_usage_events) then
    raise exception 'ai_usage_events: support of P sees usage';
  end if;

  -- The platform sees everything.
  perform pg_temp.ctx('d0000000-0000-4000-8000-000000000003', null, null);
  if (select count(*) from public.ai_usage_events) <> 5 then
    raise exception 'ai_usage_events: platform does not see all usage';
  end if;
end
$$;
reset role;
rollback;

-- ----------------------------------------------------------------------------
-- Test 4: partner vault and platform backup key
-- ----------------------------------------------------------------------------
begin;
select pg_temp.fixture();
set local role app_runtime;
do $$
declare
  v_id uuid;
begin
  -- The owner of P keeps the admin key of P.
  perform pg_temp.ctx('d0000000-0000-4000-8000-000000000004', null, null, 'b1000000-0000-4000-8000-000000000001');
  insert into public.partner_credentials (partner_id, provider, label, masked_value, encrypted_payload, created_by)
  values ('b1000000-0000-4000-8000-000000000001', 'openrouter', 'Chave do admin', 'sk-or-…1234', 'cipher',
          'd0000000-0000-4000-8000-000000000004')
  returning id into v_id;
  -- A key is never edited, only revoked, and a revoked key stays revoked.
  begin
    update public.partner_credentials set encrypted_payload = 'other' where id = v_id;
    raise exception 'partner_credentials: key edited';
  exception when insufficient_privilege then null;
  end;
  update public.partner_credentials set status = 'revoked' where id = v_id;
  if not found then raise exception 'partner_credentials: owner could not revoke'; end if;
  begin
    update public.partner_credentials set status = 'active' where id = v_id;
    raise exception 'partner_credentials: revoked key reactivated';
  exception when insufficient_privilege then null;
  end;
  -- Never in another partner's name.
  begin
    insert into public.partner_credentials (partner_id, provider, label, masked_value, encrypted_payload, created_by)
    values ('00000000-0000-4000-8000-000000000000', 'openai', 'x', 'sk-…', 'cipher',
            'd0000000-0000-4000-8000-000000000004');
    raise exception 'partner_credentials: key saved for another partner';
  exception when insufficient_privilege then null;
  end;

  -- Support and finance do not see the vault; workspaces neither.
  perform pg_temp.ctx('d0000000-0000-4000-8000-000000000006', null, null, 'b1000000-0000-4000-8000-000000000001');
  if exists (select 1 from public.partner_credentials) then
    raise exception 'partner_credentials: support sees the vault';
  end if;
  perform pg_temp.ctx('d0000000-0000-4000-8000-000000000005', null, null, 'b1000000-0000-4000-8000-000000000001');
  if exists (select 1 from public.partner_credentials) then
    raise exception 'partner_credentials: finance sees the vault';
  end if;
  perform pg_temp.ctx('a0000000-0000-4000-8000-000000000031', 'a0000000-0000-4000-8000-000000000011',
                      'a0000000-0000-4000-8000-000000000010');
  if exists (select 1 from public.partner_credentials) or exists (select 1 from public.platform_ai_settings) then
    raise exception 'partner_credentials: workspace sees a vault';
  end if;

  -- The partner does not reach the platform backup key.
  perform pg_temp.ctx('d0000000-0000-4000-8000-000000000004', null, null, 'b1000000-0000-4000-8000-000000000001');
  begin
    insert into public.platform_ai_settings (backup_model, updated_by)
    values ('cheap', 'd0000000-0000-4000-8000-000000000004');
    raise exception 'platform_ai_settings: partner saved the backup';
  exception when insufficient_privilege then null;
  end;

  -- The platform owner saves it; a key comes with its cipher and mask.
  perform pg_temp.ctx('d0000000-0000-4000-8000-000000000003', null, null);
  insert into public.platform_ai_settings (backup_provider, backup_masked_value, backup_encrypted_payload, backup_model, updated_by)
  values ('openai', 'sk-…9999', 'cipher', 'gpt-cheap', 'd0000000-0000-4000-8000-000000000003');
  begin
    update public.platform_ai_settings set backup_encrypted_payload = null, updated_by = 'd0000000-0000-4000-8000-000000000003';
    raise exception 'platform_ai_settings: provider without a key';
  exception when check_violation then null;
  end;
  begin
    insert into public.platform_ai_settings (id, backup_model, updated_by)
    values (false, 'other', 'd0000000-0000-4000-8000-000000000003');
    raise exception 'platform_ai_settings: second row';
  exception when check_violation then null;
  end;
end
$$;
reset role;
rollback;

-- ----------------------------------------------------------------------------
-- Test 5: purge of a deleted workspace
-- ----------------------------------------------------------------------------
begin;
select pg_temp.fixture();
update public.workspaces set status = 'deletion_scheduled', deletion_requested_at = now() - interval '31 days',
  purge_after = now() - interval '1 day'
where id = 'a0000000-0000-4000-8000-000000000011';
set local role app_worker;
do $$
begin
  delete from public.ai_usage_events;
  delete from public.ai_conversations;
end
$$;
reset role;
do $$
begin
  if exists (select 1 from public.ai_usage_events where workspace_id = 'a0000000-0000-4000-8000-000000000011')
     or exists (select 1 from public.ai_conversations where workspace_id = 'a0000000-0000-4000-8000-000000000011') then
    raise exception 'purge: AI data of the deleted workspace kept';
  end if;
  if not exists (select 1 from public.ai_messages m join public.ai_conversations c on c.id = m.conversation_id
                 where c.workspace_id = 'a0000000-0000-4000-8000-000000000021') then
    raise exception 'purge: messages of another workspace removed';
  end if;
  if exists (select 1 from public.ai_messages m
             where m.conversation_id = 'a2a00000-0000-4000-8000-0000000001a1') then
    raise exception 'purge: messages of the deleted workspace kept';
  end if;
  -- The Assistant conversation in /admin has no workspace and stays.
  if not exists (select 1 from public.ai_conversations where id = 'a2a00000-0000-4000-8000-0000000002a1') then
    raise exception 'purge: Assistant conversation outside the workspace removed';
  end if;
end
$$;
rollback;

select 'ai-engine-rls: ok' as result;
