-- ============================================================================
-- SQL lead notices (A6a): the partner's notice webhook and the GUIDS's
-- hot-lead notices; referral notices (A6b).
--   workspace A a…011 (org a…010, house partner): owner a…031, viewer a…033
--   workspace B a…021 (org a…020, house partner): owner a…032
--   partner P b6…001 (created per block): d…004 partner_owner,
--     d…006 partner_support; customer of P: org c6…010, workspace c6…011,
--     owner a…032
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

create or replace function pg_temp.fixture() returns void
language sql as $$
  insert into public.partners (id, slug, name)
  values ('b6000000-0000-4000-8000-000000000001', 'agencia-a6', 'Agência A6');
  insert into public.partner_members (partner_id, user_id, email, role) values
    ('b6000000-0000-4000-8000-000000000001', 'd0000000-0000-4000-8000-000000000004', 'owner@a6.test', 'partner_owner'),
    ('b6000000-0000-4000-8000-000000000001', 'd0000000-0000-4000-8000-000000000006', 'sup@a6.test', 'partner_support');
  insert into public.organizations (id, name, status, partner_id)
  values ('c6000000-0000-4000-8000-000000000010', 'Cliente A6', 'active', 'b6000000-0000-4000-8000-000000000001');
  insert into public.workspaces (id, organization_id, slug, name, status)
  values ('c6000000-0000-4000-8000-000000000011', 'c6000000-0000-4000-8000-000000000010', 'cliente-a6', 'Cliente A6', 'active');
  insert into public.organization_members (organization_id, user_id, role, status)
  values ('c6000000-0000-4000-8000-000000000010', 'a0000000-0000-4000-8000-000000000032', 'owner', 'active');
  insert into public.workspace_members (workspace_id, organization_id, user_id, role, status)
  values ('c6000000-0000-4000-8000-000000000011', 'c6000000-0000-4000-8000-000000000010',
          'a0000000-0000-4000-8000-000000000032', 'owner', 'active');
  insert into public.ai_agents (id, kind, organization_id, workspace_id, config, created_by) values
    ('a6b00000-0000-4000-8000-0000000000a1', 'guid', 'a0000000-0000-4000-8000-000000000010',
     'a0000000-0000-4000-8000-000000000011', '{}', 'a0000000-0000-4000-8000-000000000031'),
    ('a6b00000-0000-4000-8000-0000000000b1', 'guid', 'a0000000-0000-4000-8000-000000000020',
     'a0000000-0000-4000-8000-000000000021', '{}', 'a0000000-0000-4000-8000-000000000032');
  insert into public.crm_contacts (id, organization_id, workspace_id, name, created_by) values
    ('a6d00000-0000-4000-8000-0000000000a1', 'a0000000-0000-4000-8000-000000000010',
     'a0000000-0000-4000-8000-000000000011', 'Contato A', 'a0000000-0000-4000-8000-000000000031'),
    ('a6d00000-0000-4000-8000-0000000000b1', 'a0000000-0000-4000-8000-000000000020',
     'a0000000-0000-4000-8000-000000000021', 'Contato B', 'a0000000-0000-4000-8000-000000000032');
$$;

-- ----------------------------------------------------------------------------
-- Test 1: owner and admin of the partner manage its webhook; others do not
-- ----------------------------------------------------------------------------
begin;
select pg_temp.fixture();
set local role app_runtime;
do $$
begin
  perform pg_temp.ctx('d0000000-0000-4000-8000-000000000004', null, null,
                      'b6000000-0000-4000-8000-000000000001');
  insert into public.partner_notice_webhooks (partner_id, url, masked_secret, encrypted_secret, updated_by)
  values ('b6000000-0000-4000-8000-000000000001', 'https://hooks.a6.test/guidu', '****1234', 'cipher',
          'd0000000-0000-4000-8000-000000000004');
  update public.partner_notice_webhooks set enabled = false
  where partner_id = 'b6000000-0000-4000-8000-000000000001';
  if not found then raise exception 'partner_notice_webhooks: owner could not edit'; end if;

  -- Another partner's id, or someone else's signature, is refused.
  begin
    insert into public.partner_notice_webhooks (partner_id, url, masked_secret, encrypted_secret, updated_by)
    values ('00000000-0000-4000-8000-000000000000', 'https://hooks.a6.test/x', '****', 'c',
            'd0000000-0000-4000-8000-000000000004');
    raise exception 'partner_notice_webhooks: webhook of another partner written';
  exception when insufficient_privilege then null;
  end;
  begin
    update public.partner_notice_webhooks set updated_by = 'd0000000-0000-4000-8000-000000000006';
    raise exception 'partner_notice_webhooks: signed as someone else';
  exception when insufficient_privilege then null;
  end;

  -- Support reads nothing.
  perform pg_temp.ctx('d0000000-0000-4000-8000-000000000006', null, null,
                      'b6000000-0000-4000-8000-000000000001');
  if exists (select 1 from public.partner_notice_webhooks) then
    raise exception 'partner_notice_webhooks: support reads the webhook';
  end if;

  -- A customer's owner never reads the table, only the engine's function.
  perform pg_temp.ctx('a0000000-0000-4000-8000-000000000032', 'c6000000-0000-4000-8000-000000000011',
                      'c6000000-0000-4000-8000-000000000010');
  if exists (select 1 from public.partner_notice_webhooks) then
    raise exception 'partner_notice_webhooks: customer reads the table';
  end if;
end
$$;
rollback;

-- ----------------------------------------------------------------------------
-- Test 2: the engine reads the webhook of the turn's partner only, when on
-- ----------------------------------------------------------------------------
begin;
select pg_temp.fixture();
insert into public.partner_notice_webhooks (partner_id, url, masked_secret, encrypted_secret, updated_by)
values ('b6000000-0000-4000-8000-000000000001', 'https://hooks.a6.test/guidu', '****1234', 'cipher',
        'd0000000-0000-4000-8000-000000000004');
set local role app_runtime;
do $$
begin
  perform pg_temp.ctx('a0000000-0000-4000-8000-000000000032', 'c6000000-0000-4000-8000-000000000011',
                      'c6000000-0000-4000-8000-000000000010');
  if (select url from private.ai_notice_webhook()) is distinct from 'https://hooks.a6.test/guidu' then
    raise exception 'ai_notice_webhook: customer of P does not get the webhook of P';
  end if;
  -- Workspace A belongs to the house, which has no webhook.
  perform pg_temp.ctx('a0000000-0000-4000-8000-000000000031', 'a0000000-0000-4000-8000-000000000011',
                      'a0000000-0000-4000-8000-000000000010');
  if exists (select 1 from private.ai_notice_webhook()) then
    raise exception 'ai_notice_webhook: workspace of another partner gets the webhook of P';
  end if;
end
$$;
reset role;
update public.partner_notice_webhooks set enabled = false;
set local role app_runtime;
do $$
begin
  perform pg_temp.ctx('a0000000-0000-4000-8000-000000000032', 'c6000000-0000-4000-8000-000000000011',
                      'c6000000-0000-4000-8000-000000000010');
  if exists (select 1 from private.ai_notice_webhook()) then
    raise exception 'ai_notice_webhook: a disabled webhook is returned';
  end if;
end
$$;
rollback;

-- ----------------------------------------------------------------------------
-- Test 3: notices stay in their workspace, once per agent and contact
-- ----------------------------------------------------------------------------
begin;
select pg_temp.fixture();
set local role app_runtime;
do $$
begin
  perform pg_temp.ctx('a0000000-0000-4000-8000-000000000031', 'a0000000-0000-4000-8000-000000000011',
                      'a0000000-0000-4000-8000-000000000010');
  insert into public.ai_lead_notices
    (organization_id, workspace_id, agent_id, contact_id, conversation_id, points, temperature, channel)
  values ('a0000000-0000-4000-8000-000000000010', 'a0000000-0000-4000-8000-000000000011',
          'a6b00000-0000-4000-8000-0000000000a1', 'a6d00000-0000-4000-8000-0000000000a1',
          gen_random_uuid(), 60, 'hot', 'whatsapp');
  begin
    insert into public.ai_lead_notices
      (organization_id, workspace_id, agent_id, contact_id, conversation_id, points, temperature, channel)
    values ('a0000000-0000-4000-8000-000000000010', 'a0000000-0000-4000-8000-000000000011',
            'a6b00000-0000-4000-8000-0000000000a1', 'a6d00000-0000-4000-8000-0000000000a1',
            gen_random_uuid(), 70, 'hot', 'whatsapp');
    raise exception 'ai_lead_notices: second notice for the same contact';
  exception when unique_violation then null;
  end;
  begin
    insert into public.ai_lead_notices
      (organization_id, workspace_id, agent_id, contact_id, conversation_id, points, temperature, channel)
    values ('a0000000-0000-4000-8000-000000000010', 'a0000000-0000-4000-8000-000000000011',
            'a6b00000-0000-4000-8000-0000000000a1', 'a6d00000-0000-4000-8000-0000000000b1',
            gen_random_uuid(), 60, 'hot', 'whatsapp');
    raise exception 'ai_lead_notices: contact of another workspace';
  exception when foreign_key_violation then null;
  end;
  begin
    insert into public.ai_lead_notices
      (organization_id, workspace_id, agent_id, contact_id, conversation_id, points, temperature, channel, status)
    values ('a0000000-0000-4000-8000-000000000010', 'a0000000-0000-4000-8000-000000000011',
            'a6b00000-0000-4000-8000-0000000000a1', gen_random_uuid(),
            gen_random_uuid(), 60, 'hot', 'whatsapp', 'sent');
    raise exception 'ai_lead_notices: written as already sent';
  exception when insufficient_privilege then null;
  end;

  update public.ai_lead_notices set status = 'sent', sent_at = now(), attempts = 1;
  if not found then raise exception 'ai_lead_notices: delivery not recorded'; end if;
  begin
    update public.ai_lead_notices set points = 0;
    raise exception 'ai_lead_notices: score edited';
  exception when insufficient_privilege then null;
  end;
  begin
    delete from public.ai_lead_notices;
    raise exception 'ai_lead_notices: notice deleted';
  exception when insufficient_privilege then null;
  end;

  -- A viewer neither reads nor writes; B never sees A.
  perform pg_temp.ctx('a0000000-0000-4000-8000-000000000033', 'a0000000-0000-4000-8000-000000000011',
                      'a0000000-0000-4000-8000-000000000010');
  if exists (select 1 from public.ai_lead_notices) then
    raise exception 'ai_lead_notices: viewer reads the notices';
  end if;
  perform pg_temp.ctx('a0000000-0000-4000-8000-000000000032', 'a0000000-0000-4000-8000-000000000021',
                      'a0000000-0000-4000-8000-000000000020');
  if exists (select 1 from public.ai_lead_notices) then
    raise exception 'ai_lead_notices: B reads the notices of A';
  end if;
  begin
    insert into public.ai_lead_notices
      (organization_id, workspace_id, agent_id, contact_id, conversation_id, points, temperature, channel)
    values ('a0000000-0000-4000-8000-000000000010', 'a0000000-0000-4000-8000-000000000011',
            'a6b00000-0000-4000-8000-0000000000a1', 'a6d00000-0000-4000-8000-0000000000a1',
            gen_random_uuid(), 60, 'hot', 'whatsapp');
    raise exception 'ai_lead_notices: B wrote a notice of A';
  exception when insufficient_privilege then null;
  end;
end
$$;
rollback;

-- ----------------------------------------------------------------------------
-- Test 4 (A6b): referral notices, once per conversation and referral, with
-- the referral of their own workspace and no score
-- ----------------------------------------------------------------------------
begin;
select pg_temp.fixture();
insert into public.ai_agent_referrals (id, organization_id, workspace_id, name, referral_tag, created_by) values
  ('a6e00000-0000-4000-8000-0000000000a1', 'a0000000-0000-4000-8000-000000000010',
   'a0000000-0000-4000-8000-000000000011', 'Indicação A', 'dermato', 'a0000000-0000-4000-8000-000000000031'),
  ('a6e00000-0000-4000-8000-0000000000b1', 'a0000000-0000-4000-8000-000000000020',
   'a0000000-0000-4000-8000-000000000021', 'Indicação B', 'dermato', 'a0000000-0000-4000-8000-000000000032');
set local role app_runtime;
do $$
declare
  conv uuid := gen_random_uuid();
begin
  perform pg_temp.ctx('a0000000-0000-4000-8000-000000000031', 'a0000000-0000-4000-8000-000000000011',
                      'a0000000-0000-4000-8000-000000000010');
  -- The contact may not be in the CRM yet.
  insert into public.ai_lead_notices
    (organization_id, workspace_id, agent_id, kind, referral_id, reason_text, conversation_id, channel)
  values ('a0000000-0000-4000-8000-000000000010', 'a0000000-0000-4000-8000-000000000011',
          'a6b00000-0000-4000-8000-0000000000a1', 'referral', 'a6e00000-0000-4000-8000-0000000000a1',
          'Quer tratar manchas', conv, 'whatsapp');
  begin
    insert into public.ai_lead_notices
      (organization_id, workspace_id, agent_id, kind, referral_id, conversation_id, channel)
    values ('a0000000-0000-4000-8000-000000000010', 'a0000000-0000-4000-8000-000000000011',
            'a6b00000-0000-4000-8000-0000000000a1', 'referral', 'a6e00000-0000-4000-8000-0000000000a1',
            conv, 'whatsapp');
    raise exception 'ai_lead_notices: same referral twice in one conversation';
  exception when unique_violation then null;
  end;
  begin
    insert into public.ai_lead_notices
      (organization_id, workspace_id, agent_id, kind, referral_id, conversation_id, channel)
    values ('a0000000-0000-4000-8000-000000000010', 'a0000000-0000-4000-8000-000000000011',
            'a6b00000-0000-4000-8000-0000000000a1', 'referral', 'a6e00000-0000-4000-8000-0000000000b1',
            gen_random_uuid(), 'whatsapp');
    raise exception 'ai_lead_notices: referral of another workspace';
  exception when foreign_key_violation then null;
  end;
  begin
    insert into public.ai_lead_notices
      (organization_id, workspace_id, agent_id, kind, referral_id, conversation_id, points, temperature, channel)
    values ('a0000000-0000-4000-8000-000000000010', 'a0000000-0000-4000-8000-000000000011',
            'a6b00000-0000-4000-8000-0000000000a1', 'referral', 'a6e00000-0000-4000-8000-0000000000a1',
            gen_random_uuid(), 60, 'hot', 'whatsapp');
    raise exception 'ai_lead_notices: referral notice with a score';
  exception when check_violation then null;
  end;
  begin
    insert into public.ai_lead_notices
      (organization_id, workspace_id, agent_id, conversation_id, channel)
    values ('a0000000-0000-4000-8000-000000000010', 'a0000000-0000-4000-8000-000000000011',
            'a6b00000-0000-4000-8000-0000000000a1', gen_random_uuid(), 'whatsapp');
    raise exception 'ai_lead_notices: lead notice without contact and score';
  exception when check_violation then null;
  end;
  begin
    update public.ai_lead_notices set kind = 'lead';
    raise exception 'ai_lead_notices: kind edited';
  exception when insufficient_privilege then null;
  end;
end
$$;
-- Deleting the referral keeps the notice.
reset role;
delete from public.ai_agent_referrals where id = 'a6e00000-0000-4000-8000-0000000000a1';
do $$
begin
  if (select count(*) from public.ai_lead_notices where kind = 'referral' and referral_id is null) <> 1 then
    raise exception 'ai_lead_notices: notice lost with its referral';
  end if;
end
$$;
rollback;
