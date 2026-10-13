-- ============================================================================
-- SQL AI agents (A1): workspace isolation, partner access to the GUIDS
-- configuration, one Assistant per partner, cross-workspace references and
-- templates.
--   workspace A a…011 (org a…010, house partner): owner a…031, viewer a…033
--   workspace B a…021 (org a…020, house partner): owner a…032
--   partner P b1…001 (created per block): d…004 partner_owner,
--     d…005 partner_finance, d…006 partner_support
--   customer of P: org c1…010, workspace c1…011, owner a…032
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

-- Partner P, its members and one customer with a GUIDS; GUIDS in A and B.
create or replace function pg_temp.fixture() returns void
language sql as $$
  insert into public.partners (id, slug, name)
  values ('b1000000-0000-4000-8000-000000000001', 'agencia-p', 'Agência P');
  insert into public.partner_members (partner_id, user_id, email, role) values
    ('b1000000-0000-4000-8000-000000000001', 'd0000000-0000-4000-8000-000000000004', 'owner@p.test', 'partner_owner'),
    ('b1000000-0000-4000-8000-000000000001', 'd0000000-0000-4000-8000-000000000005', 'fin@p.test', 'partner_finance'),
    ('b1000000-0000-4000-8000-000000000001', 'd0000000-0000-4000-8000-000000000006', 'sup@p.test', 'partner_support');
  insert into public.organizations (id, name, status, partner_id)
  values ('c1000000-0000-4000-8000-000000000010', 'Cliente de P', 'active', 'b1000000-0000-4000-8000-000000000001');
  insert into public.workspaces (id, organization_id, slug, name, status)
  values ('c1000000-0000-4000-8000-000000000011', 'c1000000-0000-4000-8000-000000000010', 'cliente-de-p', 'Cliente de P', 'active');
  insert into public.organization_members (organization_id, user_id, role, status)
  values ('c1000000-0000-4000-8000-000000000010', 'a0000000-0000-4000-8000-000000000032', 'owner', 'active');
  insert into public.workspace_members (workspace_id, organization_id, user_id, role, status)
  values ('c1000000-0000-4000-8000-000000000011', 'c1000000-0000-4000-8000-000000000010',
          'a0000000-0000-4000-8000-000000000032', 'owner', 'active');
  insert into public.ai_agents (id, kind, organization_id, workspace_id, config, created_by) values
    ('a1b00000-0000-4000-8000-0000000000a1', 'guid', 'a0000000-0000-4000-8000-000000000010',
     'a0000000-0000-4000-8000-000000000011', '{"overview": {"agent_name": "GUIDS A"}}', 'a0000000-0000-4000-8000-000000000031'),
    ('a1b00000-0000-4000-8000-0000000000b1', 'guid', 'a0000000-0000-4000-8000-000000000020',
     'a0000000-0000-4000-8000-000000000021', '{"overview": {"agent_name": "GUIDS B"}}', 'a0000000-0000-4000-8000-000000000032'),
    ('a1b00000-0000-4000-8000-0000000000c1', 'guid', 'c1000000-0000-4000-8000-000000000010',
     'c1000000-0000-4000-8000-000000000011', '{"overview": {"agent_name": "GUIDS C"}}', null);
  insert into public.ai_agent_referrals (id, organization_id, workspace_id, name, referral_tag, created_by)
  values ('a1c00000-0000-4000-8000-0000000000c1', 'c1000000-0000-4000-8000-000000000010',
          'c1000000-0000-4000-8000-000000000011', 'Indicação C', 'indicacao-c', 'a0000000-0000-4000-8000-000000000031');
$$;

-- ----------------------------------------------------------------------------
-- Test 1: the workspace reads and manages only its own GUIDS
-- ----------------------------------------------------------------------------
begin;
select pg_temp.fixture();
set local role app_runtime;
do $$
declare
  v_id uuid;
begin
  perform pg_temp.ctx('a0000000-0000-4000-8000-000000000031', 'a0000000-0000-4000-8000-000000000011',
                      'a0000000-0000-4000-8000-000000000010');
  if (select count(*) from public.ai_agents) <> 1
     or not exists (select 1 from public.ai_agents where id = 'a1b00000-0000-4000-8000-0000000000a1') then
    raise exception 'ai_agents: owner of A does not see exactly the GUIDS of A';
  end if;

  insert into public.ai_agents (kind, organization_id, workspace_id, config, created_by)
  values ('guid', 'a0000000-0000-4000-8000-000000000010', 'a0000000-0000-4000-8000-000000000011',
          '{}', 'a0000000-0000-4000-8000-000000000031')
  returning id into v_id;
  update public.ai_agents set status = 'paused', updated_by = 'a0000000-0000-4000-8000-000000000031'
  where id = v_id;
  if not found then raise exception 'ai_agents: owner could not edit'; end if;

  -- The workspace cannot sign as a partner, nor change the owner.
  begin
    update public.ai_agents set updated_by = 'a0000000-0000-4000-8000-000000000031',
      updated_by_partner_id = '00000000-0000-4000-8000-000000000000' where id = v_id;
    raise exception 'ai_agents: workspace signed a change as a partner';
  exception when insufficient_privilege then null;
  end;
  begin
    update public.ai_agents set workspace_id = 'a0000000-0000-4000-8000-000000000021',
      organization_id = 'a0000000-0000-4000-8000-000000000020',
      updated_by = 'a0000000-0000-4000-8000-000000000031' where id = v_id;
    raise exception 'ai_agents: GUIDS moved to another workspace';
  exception when check_violation then null;
  end;

  -- Nothing of B is visible or reachable; no GUIDS in B, no Assistant.
  update public.ai_agents set status = 'paused', updated_by = 'a0000000-0000-4000-8000-000000000031'
  where id = 'a1b00000-0000-4000-8000-0000000000b1';
  if found then raise exception 'ai_agents: GUIDS of another workspace edited'; end if;
  delete from public.ai_agents where id = 'a1b00000-0000-4000-8000-0000000000b1';
  if found then raise exception 'ai_agents: GUIDS of another workspace deleted'; end if;
  begin
    insert into public.ai_agents (kind, organization_id, workspace_id, created_by)
    values ('guid', 'a0000000-0000-4000-8000-000000000020', 'a0000000-0000-4000-8000-000000000021',
            'a0000000-0000-4000-8000-000000000031');
    raise exception 'ai_agents: GUIDS created in another workspace';
  exception when insufficient_privilege then null;
  end;
  begin
    insert into public.ai_agents (kind, partner_id, created_by)
    values ('assistant', '00000000-0000-4000-8000-000000000000', 'a0000000-0000-4000-8000-000000000031');
    raise exception 'ai_agents: workspace created an Assistant';
  exception when insufficient_privilege then null;
  end;

  delete from public.ai_agents where id = v_id;
  if not found then raise exception 'ai_agents: owner could not delete'; end if;

  -- The viewer has no ai_agents.use: sees and writes nothing.
  perform pg_temp.ctx('a0000000-0000-4000-8000-000000000033', 'a0000000-0000-4000-8000-000000000011',
                      'a0000000-0000-4000-8000-000000000010');
  if exists (select 1 from public.ai_agents) then
    raise exception 'ai_agents: viewer sees GUIDS';
  end if;
  begin
    insert into public.ai_agents (kind, organization_id, workspace_id, created_by)
    values ('guid', 'a0000000-0000-4000-8000-000000000010', 'a0000000-0000-4000-8000-000000000011',
            'a0000000-0000-4000-8000-000000000033');
    raise exception 'ai_agents: viewer created a GUIDS';
  exception when insufficient_privilege then null;
  end;

  -- The owner of B sees only B.
  perform pg_temp.ctx('a0000000-0000-4000-8000-000000000032', 'a0000000-0000-4000-8000-000000000021',
                      'a0000000-0000-4000-8000-000000000020');
  if (select count(*) from public.ai_agents) <> 1
     or not exists (select 1 from public.ai_agents where id = 'a1b00000-0000-4000-8000-0000000000b1') then
    raise exception 'ai_agents: owner of B does not see exactly the GUIDS of B';
  end if;
end
$$;
reset role;
rollback;

-- ----------------------------------------------------------------------------
-- Test 2: a partner reads and edits only the configuration of its customers'
-- GUIDS and its own Assistant; never referrals or lead activities
-- ----------------------------------------------------------------------------
begin;
select pg_temp.fixture();
set local role app_runtime;
do $$
begin
  perform pg_temp.ctx('d0000000-0000-4000-8000-000000000004', null, null, 'b1000000-0000-4000-8000-000000000001');
  if (select count(*) from public.ai_agents where kind = 'guid') <> 1
     or not exists (select 1 from public.ai_agents where id = 'a1b00000-0000-4000-8000-0000000000c1') then
    raise exception 'ai_agents: partner does not see exactly the GUIDS of its customer';
  end if;
  if (select count(*) from public.ai_agents
      where kind = 'assistant' and partner_id = 'b1000000-0000-4000-8000-000000000001') <> 1
     or (select count(*) from public.ai_agents where kind = 'assistant') <> 1 then
    raise exception 'ai_agents: partner does not see exactly its own Assistant';
  end if;

  update public.ai_agents
  set config = '{"overview": {"agent_name": "Editado pelo parceiro"}}',
      updated_by = 'd0000000-0000-4000-8000-000000000004',
      updated_by_partner_id = 'b1000000-0000-4000-8000-000000000001'
  where id = 'a1b00000-0000-4000-8000-0000000000c1';
  if not found then raise exception 'ai_agents: partner could not edit the customer GUIDS'; end if;

  -- The change must carry the partner.
  begin
    update public.ai_agents set status = 'paused', updated_by = 'd0000000-0000-4000-8000-000000000004',
      updated_by_partner_id = null where id = 'a1b00000-0000-4000-8000-0000000000c1';
    raise exception 'ai_agents: partner change without the partner signature';
  exception when insufficient_privilege then null;
  end;

  update public.ai_agents
  set status = 'active', updated_by = 'd0000000-0000-4000-8000-000000000004',
      updated_by_partner_id = 'b1000000-0000-4000-8000-000000000001'
  where kind = 'assistant';
  if not found then raise exception 'ai_agents: partner could not edit its Assistant'; end if;

  -- GUIDS of companies of another partner: invisible and untouchable.
  update public.ai_agents set status = 'paused', updated_by = 'd0000000-0000-4000-8000-000000000004',
    updated_by_partner_id = 'b1000000-0000-4000-8000-000000000001'
  where id = 'a1b00000-0000-4000-8000-0000000000a1';
  if found then raise exception 'ai_agents: partner edited a GUIDS of another partner'; end if;

  -- The partner neither creates nor deletes GUIDS.
  begin
    insert into public.ai_agents (kind, organization_id, workspace_id, created_by)
    values ('guid', 'c1000000-0000-4000-8000-000000000010', 'c1000000-0000-4000-8000-000000000011',
            'd0000000-0000-4000-8000-000000000004');
    raise exception 'ai_agents: partner created a GUIDS';
  exception when insufficient_privilege then null;
  end;
  delete from public.ai_agents where id = 'a1b00000-0000-4000-8000-0000000000c1';
  if found then raise exception 'ai_agents: partner deleted a GUIDS'; end if;
  delete from public.ai_agents where kind = 'assistant';
  if found then raise exception 'ai_agents: partner deleted its Assistant'; end if;

  -- Customer content stays with the customer (support grant, ADR 0012).
  if exists (select 1 from public.ai_agent_referrals) then
    raise exception 'ai_agent_referrals: partner reads customer referrals';
  end if;

  -- Support reads, does not edit; finance sees nothing.
  perform pg_temp.ctx('d0000000-0000-4000-8000-000000000006', null, null, 'b1000000-0000-4000-8000-000000000001');
  if (select count(*) from public.ai_agents) <> 2 then
    raise exception 'ai_agents: partner_support does not read the configuration';
  end if;
  update public.ai_agents set status = 'paused', updated_by = 'd0000000-0000-4000-8000-000000000006',
    updated_by_partner_id = 'b1000000-0000-4000-8000-000000000001';
  if found then raise exception 'ai_agents: partner_support edited an agent'; end if;

  perform pg_temp.ctx('d0000000-0000-4000-8000-000000000005', null, null, 'b1000000-0000-4000-8000-000000000001');
  if exists (select 1 from public.ai_agents) then
    raise exception 'ai_agents: partner_finance sees agents';
  end if;
end
$$;
reset role;

-- The edit is recorded as the partner's.
do $$
begin
  if (select updated_by_partner_id from public.ai_agents where id = 'a1b00000-0000-4000-8000-0000000000c1')
     is distinct from 'b1000000-0000-4000-8000-000000000001' then
    raise exception 'ai_agents: partner signature not stored';
  end if;
end
$$;
rollback;

-- ----------------------------------------------------------------------------
-- Test 3: one Assistant per partner, born with the partner; owner shapes
-- ----------------------------------------------------------------------------
begin;
select pg_temp.fixture();
do $$
begin
  if (select count(*) from public.ai_agents where kind = 'assistant') <>
     (select count(*) from public.partners) then
    raise exception 'ai_agents: a partner without its Assistant';
  end if;
  if (select config #>> '{overview,agent_name}' from public.ai_agents
      where kind = 'assistant' and partner_id = 'b1000000-0000-4000-8000-000000000001')
     <> 'Assistente Agência P' then
    raise exception 'ai_agents: Assistant not named after the partner';
  end if;
  begin
    insert into public.ai_agents (kind, partner_id)
    values ('assistant', 'b1000000-0000-4000-8000-000000000001');
    raise exception 'ai_agents: second Assistant for a partner';
  exception when unique_violation then null;
  end;
  begin
    insert into public.ai_agents (kind, organization_id, workspace_id, partner_id)
    values ('guid', 'a0000000-0000-4000-8000-000000000010', 'a0000000-0000-4000-8000-000000000011',
            'b1000000-0000-4000-8000-000000000001');
    raise exception 'ai_agents: GUIDS with a partner owner';
  exception when check_violation then null;
  end;
  begin
    insert into public.ai_agents (kind) values ('guid');
    raise exception 'ai_agents: GUIDS without a workspace';
  exception when check_violation then null;
  end;
  begin
    insert into public.ai_agents (kind, organization_id, workspace_id)
    values ('guid', 'a0000000-0000-4000-8000-000000000020', 'a0000000-0000-4000-8000-000000000011');
    raise exception 'ai_agents: workspace paired with another organization';
  exception when foreign_key_violation then null;
  end;
end
$$;

-- A partner created by the platform gets its Assistant in the same insert.
set local role app_runtime;
do $$
begin
  perform pg_temp.ctx('d0000000-0000-4000-8000-000000000003', null, null);
  insert into public.partners (id, slug, name)
  values ('b1000000-0000-4000-8000-000000000002', 'agencia-q', 'Agência Q');
end
$$;
reset role;
do $$
begin
  if not exists (
    select 1 from public.ai_agents
    where kind = 'assistant' and partner_id = 'b1000000-0000-4000-8000-000000000002'
      and created_by = 'd0000000-0000-4000-8000-000000000003'
      and template_id = 'a1a00000-0000-4000-8000-000000000001'
  ) then
    raise exception 'ai_agents: partner created without its Assistant';
  end if;
end
$$;
rollback;

-- ----------------------------------------------------------------------------
-- Test 4: lead activities and referrals never cross workspaces
-- ----------------------------------------------------------------------------
begin;
select pg_temp.fixture();
insert into public.crm_contacts (id, organization_id, workspace_id, name, created_by) values
  ('a1d00000-0000-4000-8000-0000000000a1', 'a0000000-0000-4000-8000-000000000010',
   'a0000000-0000-4000-8000-000000000011', 'Contato A', 'a0000000-0000-4000-8000-000000000031'),
  ('a1d00000-0000-4000-8000-0000000000b1', 'a0000000-0000-4000-8000-000000000020',
   'a0000000-0000-4000-8000-000000000021', 'Contato B', 'a0000000-0000-4000-8000-000000000032');
do $$
begin
  insert into public.ai_lead_activities (organization_id, workspace_id, contact_id, agent_id, points, temperature)
  values ('a0000000-0000-4000-8000-000000000010', 'a0000000-0000-4000-8000-000000000011',
          'a1d00000-0000-4000-8000-0000000000a1', 'a1b00000-0000-4000-8000-0000000000a1', 40, 'warm');
  begin
    insert into public.ai_lead_activities (organization_id, workspace_id, contact_id, agent_id, points, temperature)
    values ('a0000000-0000-4000-8000-000000000010', 'a0000000-0000-4000-8000-000000000011',
            'a1d00000-0000-4000-8000-0000000000b1', 'a1b00000-0000-4000-8000-0000000000a1', 10, 'cold');
    raise exception 'ai_lead_activities: contact of another workspace';
  exception when foreign_key_violation then null;
  end;
  begin
    insert into public.ai_lead_activities (organization_id, workspace_id, contact_id, agent_id, points, temperature)
    values ('a0000000-0000-4000-8000-000000000010', 'a0000000-0000-4000-8000-000000000011',
            'a1d00000-0000-4000-8000-0000000000a1', 'a1b00000-0000-4000-8000-0000000000b1', 10, 'cold');
    raise exception 'ai_lead_activities: agent of another workspace';
  exception when foreign_key_violation then null;
  end;
  begin
    insert into public.ai_lead_activities
      (organization_id, workspace_id, contact_id, agent_id, referral_id, points, temperature)
    values ('a0000000-0000-4000-8000-000000000010', 'a0000000-0000-4000-8000-000000000011',
            'a1d00000-0000-4000-8000-0000000000a1', 'a1b00000-0000-4000-8000-0000000000a1',
            'a1c00000-0000-4000-8000-0000000000c1', 10, 'cold');
    raise exception 'ai_lead_activities: referral of another workspace';
  exception when foreign_key_violation then null;
  end;
  begin
    insert into public.ai_agent_referrals (organization_id, workspace_id, name, referral_tag, created_by)
    values ('c1000000-0000-4000-8000-000000000010', 'c1000000-0000-4000-8000-000000000011',
            'Repetida', 'indicacao-c', 'a0000000-0000-4000-8000-000000000031');
    raise exception 'ai_agent_referrals: repeated tag in the workspace';
  exception when unique_violation then null;
  end;
end
$$;

set local role app_runtime;
do $$
begin
  -- Members of A read the log of A; B reads nothing of it.
  perform pg_temp.ctx('a0000000-0000-4000-8000-000000000031', 'a0000000-0000-4000-8000-000000000011',
                      'a0000000-0000-4000-8000-000000000010');
  if (select count(*) from public.ai_lead_activities) <> 1 then
    raise exception 'ai_lead_activities: owner of A does not read the log';
  end if;
  -- The log is insert only: the engine writes it in the name of the person
  -- of the turn (A2b), never edits or deletes it.
  begin
    update public.ai_lead_activities set points = 0;
    raise exception 'ai_lead_activities: log edited';
  exception when insufficient_privilege then null;
  end;
  begin
    delete from public.ai_lead_activities;
    raise exception 'ai_lead_activities: log deleted';
  exception when insufficient_privilege then null;
  end;
  insert into public.ai_lead_activities (organization_id, workspace_id, contact_id, agent_id, points, temperature)
  values ('a0000000-0000-4000-8000-000000000010', 'a0000000-0000-4000-8000-000000000011',
          'a1d00000-0000-4000-8000-0000000000a1', 'a1b00000-0000-4000-8000-0000000000a1', 1, 'cold');
  -- A viewer does not run the engine.
  perform pg_temp.ctx('a0000000-0000-4000-8000-000000000033', 'a0000000-0000-4000-8000-000000000011',
                      'a0000000-0000-4000-8000-000000000010');
  begin
    insert into public.ai_lead_activities (organization_id, workspace_id, contact_id, agent_id, points, temperature)
    values ('a0000000-0000-4000-8000-000000000010', 'a0000000-0000-4000-8000-000000000011',
            'a1d00000-0000-4000-8000-0000000000a1', 'a1b00000-0000-4000-8000-0000000000a1', 1, 'cold');
    raise exception 'ai_lead_activities: written by a viewer';
  exception when insufficient_privilege then null;
  end;

  perform pg_temp.ctx('a0000000-0000-4000-8000-000000000032', 'a0000000-0000-4000-8000-000000000021',
                      'a0000000-0000-4000-8000-000000000020');
  if exists (select 1 from public.ai_lead_activities) then
    raise exception 'ai_lead_activities: B reads the log of A';
  end if;
  begin
    insert into public.ai_lead_activities (organization_id, workspace_id, contact_id, agent_id, points, temperature)
    values ('a0000000-0000-4000-8000-000000000010', 'a0000000-0000-4000-8000-000000000011',
            'a1d00000-0000-4000-8000-0000000000a1', 'a1b00000-0000-4000-8000-0000000000a1', 1, 'cold');
    raise exception 'ai_lead_activities: B wrote the log of A';
  exception when insufficient_privilege then null;
  end;
  begin
    insert into public.ai_agent_referrals (organization_id, workspace_id, name, referral_tag, created_by)
    values ('a0000000-0000-4000-8000-000000000010', 'a0000000-0000-4000-8000-000000000011',
            'Intrusa', 'intrusa', 'a0000000-0000-4000-8000-000000000032');
    raise exception 'ai_agent_referrals: created in another workspace';
  exception when insufficient_privilege then null;
  end;
end
$$;
reset role;
rollback;

-- ----------------------------------------------------------------------------
-- Test 5: templates
-- ----------------------------------------------------------------------------
begin;
select pg_temp.fixture();
insert into public.ai_agent_templates (id, partner_id, kind, name, published) values
  ('a1e00000-0000-4000-8000-000000000001', null, 'guid', 'Rascunho da casa', false),
  ('a1e00000-0000-4000-8000-000000000002', 'b1000000-0000-4000-8000-000000000001', 'guid', 'Modelo de P', true);
set local role app_runtime;
do $$
begin
  -- A workspace of a house customer: the published GUIDS templates of the
  -- house only (not the admin template, drafts or another partner's).
  perform pg_temp.ctx('a0000000-0000-4000-8000-000000000031', 'a0000000-0000-4000-8000-000000000011',
                      'a0000000-0000-4000-8000-000000000010', '00000000-0000-4000-8000-000000000000');
  if (select count(*) from public.ai_agent_templates) <> 2
     or exists (select 1 from public.ai_agent_templates where kind = 'admin' or not published or partner_id is not null) then
    raise exception 'ai_agent_templates: house customer sees the wrong templates';
  end if;
  begin
    insert into public.ai_agent_templates (kind, name, created_by)
    values ('guid', 'Do cliente', 'a0000000-0000-4000-8000-000000000031');
    raise exception 'ai_agent_templates: customer created a template';
  exception when insufficient_privilege then null;
  end;

  -- A customer of P also sees P's published template; a non-member nothing.
  perform pg_temp.ctx('a0000000-0000-4000-8000-000000000032', 'c1000000-0000-4000-8000-000000000011',
                      'c1000000-0000-4000-8000-000000000010', 'b1000000-0000-4000-8000-000000000001');
  if (select count(*) from public.ai_agent_templates) <> 3
     or not exists (select 1 from public.ai_agent_templates where id = 'a1e00000-0000-4000-8000-000000000002') then
    raise exception 'ai_agent_templates: customer of P does not see the templates of P';
  end if;
  perform pg_temp.ctx('a0000000-0000-4000-8000-000000000031', 'c1000000-0000-4000-8000-000000000011',
                      'c1000000-0000-4000-8000-000000000010', 'b1000000-0000-4000-8000-000000000001');
  if exists (select 1 from public.ai_agent_templates) then
    raise exception 'ai_agent_templates: non-member reads templates';
  end if;

  -- Partner owner: its own templates and the published house ones; edits
  -- only its own.
  perform pg_temp.ctx('d0000000-0000-4000-8000-000000000004', null, null, 'b1000000-0000-4000-8000-000000000001');
  if (select count(*) from public.ai_agent_templates) <> 3 then
    raise exception 'ai_agent_templates: partner sees the wrong templates';
  end if;
  insert into public.ai_agent_templates (partner_id, kind, name, created_by)
  values ('b1000000-0000-4000-8000-000000000001', 'guid', 'Novo de P', 'd0000000-0000-4000-8000-000000000004');
  update public.ai_agent_templates set name = 'Anna alterada', updated_by = 'd0000000-0000-4000-8000-000000000004'
  where id = 'a1a00000-0000-4000-8000-000000000002';
  if found then raise exception 'ai_agent_templates: partner edited a house template'; end if;
  begin
    insert into public.ai_agent_templates (partner_id, kind, name, created_by)
    values ('00000000-0000-4000-8000-000000000000', 'guid', 'Para outro', 'd0000000-0000-4000-8000-000000000004');
    raise exception 'ai_agent_templates: partner created a template for another partner';
  exception when insufficient_privilege then null;
  end;

  -- Platform owner: edits house templates, never deletes the admin one.
  perform pg_temp.ctx('d0000000-0000-4000-8000-000000000003', null, null);
  update public.ai_agent_templates set version = version + 1, updated_by = 'd0000000-0000-4000-8000-000000000003'
  where id = 'a1a00000-0000-4000-8000-000000000002';
  if not found then raise exception 'ai_agent_templates: platform could not edit a house template'; end if;
  delete from public.ai_agent_templates where kind = 'admin';
  if found then raise exception 'ai_agent_templates: admin template deleted'; end if;
  begin
    insert into public.ai_agent_templates (kind, name, created_by)
    values ('admin', 'Segundo admin', 'd0000000-0000-4000-8000-000000000003');
    raise exception 'ai_agent_templates: second admin template';
  exception when insufficient_privilege then null;
  end;
  begin
    update public.ai_agent_templates set partner_id = 'b1000000-0000-4000-8000-000000000001',
      updated_by = 'd0000000-0000-4000-8000-000000000003'
    where id = 'a1a00000-0000-4000-8000-000000000003';
    raise exception 'ai_agent_templates: owner changed';
  exception when check_violation then null;
  end;
end
$$;
reset role;
rollback;
