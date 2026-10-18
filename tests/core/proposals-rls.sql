-- ============================================================================
-- SQL execution proposals (F4d): who creates, who decides, immutable content
--   workspace A a…011 (org a…010): owner a…031, viewer a…033
--   workspace B a…021 (org a…020): owner a…032
-- ============================================================================

create or replace function pg_temp.ctx(p_user uuid, p_ws uuid, p_org uuid, p_principal text, p_grant text)
returns void
language sql as $$
  select set_config('app.user_id', p_user::text, true),
         set_config('app.workspace_id', p_ws::text, true),
         set_config('app.organization_id', p_org::text, true),
         set_config('app.principal_type', p_principal, true),
         set_config('app.grant_id', p_grant, true);
$$;

begin;
insert into public.api_keys (id, organization_id, workspace_id, user_id, name, prefix, key_hash, scopes, expires_at)
values ('f4d00000-0000-4000-8000-0000000000a1', 'a0000000-0000-4000-8000-000000000010',
        'a0000000-0000-4000-8000-000000000011', 'a0000000-0000-4000-8000-000000000031',
        'proposals', 'gdu_live_f4d', 'hash-f4d-proposals', array['proposals:write'], now() + interval '1 day');
insert into public.execution_proposals
  (id, organization_id, workspace_id, requested_by, operation, payload, payload_hash, idempotency_key, expires_at)
values ('f4d00000-0000-4000-8000-0000000000b1', 'a0000000-0000-4000-8000-000000000020',
        'a0000000-0000-4000-8000-000000000021', 'a0000000-0000-4000-8000-000000000032',
        'crm.contacts.create', '{"name":"De B"}', repeat('b', 64), 'b-1', now() + interval '1 hour');
set local role app_runtime;
do $$
declare
  v_id uuid;
  v_hash text := repeat('a', 64);
begin
  -- The owner's key creates a proposal, signed by member and key.
  perform pg_temp.ctx('a0000000-0000-4000-8000-000000000031', 'a0000000-0000-4000-8000-000000000011',
                      'a0000000-0000-4000-8000-000000000010', 'api_key', 'f4d00000-0000-4000-8000-0000000000a1');
  insert into public.execution_proposals
    (organization_id, workspace_id, requested_by, api_key_id, operation, payload, payload_hash,
     idempotency_key, expires_at)
  values ('a0000000-0000-4000-8000-000000000010', 'a0000000-0000-4000-8000-000000000011',
          'a0000000-0000-4000-8000-000000000031', 'f4d00000-0000-4000-8000-0000000000a1',
          'crm.contacts.create', '{"name":"Maria"}', v_hash, 'k-1', now() + interval '1 hour')
  returning id into v_id;

  -- The same key cannot approve it: only a person decides.
  begin
    update public.execution_proposals
    set status = 'approved', decided_by = 'a0000000-0000-4000-8000-000000000031',
        decided_at = now(), approved_hash = v_hash
    where id = v_id;
    raise exception 'proposals: an API key approved';
  exception when insufficient_privilege then null;
  end;

  -- A proposal with a longer expiry, or already decided, is refused.
  begin
    insert into public.execution_proposals
      (organization_id, workspace_id, requested_by, api_key_id, operation, payload, payload_hash,
       idempotency_key, expires_at)
    values ('a0000000-0000-4000-8000-000000000010', 'a0000000-0000-4000-8000-000000000011',
            'a0000000-0000-4000-8000-000000000031', 'f4d00000-0000-4000-8000-0000000000a1',
            'crm.contacts.create', '{"name":"Longa"}', v_hash, 'k-2', now() + interval '3 days');
    raise exception 'proposals: expiry beyond 24 hours accepted';
  exception when insufficient_privilege then null;
  end;

  -- Nothing of workspace B is visible from A.
  if exists (select 1 from public.execution_proposals where id = 'f4d00000-0000-4000-8000-0000000000b1') then
    raise exception 'proposals: proposal of another workspace visible';
  end if;

  -- The session of the owner cannot create proposals.
  perform pg_temp.ctx('a0000000-0000-4000-8000-000000000031', 'a0000000-0000-4000-8000-000000000011',
                      'a0000000-0000-4000-8000-000000000010', 'user', '');
  begin
    insert into public.execution_proposals
      (organization_id, workspace_id, requested_by, operation, payload, payload_hash, idempotency_key, expires_at)
    values ('a0000000-0000-4000-8000-000000000010', 'a0000000-0000-4000-8000-000000000011',
            'a0000000-0000-4000-8000-000000000031', 'crm.contacts.create', '{"name":"Tela"}', v_hash,
            'k-3', now() + interval '1 hour');
    raise exception 'proposals: a session created a proposal';
  exception when insufficient_privilege then null;
  end;

  -- The GUIDU Assistant (A2b) proposes in the name of the session, with the
  -- execution id of its turn and no key; a key cannot claim a turn. (H4:
  -- the origin is named, `assistant`.)
  insert into public.execution_proposals
    (organization_id, workspace_id, requested_by, origin, ai_execution_id, operation, payload, payload_hash,
     idempotency_key, expires_at)
  values ('a0000000-0000-4000-8000-000000000010', 'a0000000-0000-4000-8000-000000000011',
          'a0000000-0000-4000-8000-000000000031', 'assistant', 'a2b00000-0000-4000-8000-0000000000e1',
          'crm.contacts.create', '{"name":"Do Assistente"}', v_hash, 'k-ai', now() + interval '1 hour');
  begin
    insert into public.execution_proposals
      (organization_id, workspace_id, requested_by, api_key_id, ai_execution_id, operation, payload,
       payload_hash, idempotency_key, expires_at)
    values ('a0000000-0000-4000-8000-000000000010', 'a0000000-0000-4000-8000-000000000011',
            'a0000000-0000-4000-8000-000000000031', 'f4d00000-0000-4000-8000-0000000000a1',
            'a2b00000-0000-4000-8000-0000000000e2', 'crm.contacts.create', '{"name":"Mista"}', v_hash,
            'k-ai-2', now() + interval '1 hour');
    raise exception 'proposals: a session claimed an API key';
  exception when insufficient_privilege or check_violation then null;
  end;

  -- The content never changes.
  begin
    update public.execution_proposals set payload = '{"name":"Outra"}' where id = v_id;
    raise exception 'proposals: payload changed';
  exception when check_violation then null;
  end;

  -- The approval must carry the hash of the content and its author.
  begin
    update public.execution_proposals
    set status = 'approved', decided_by = 'a0000000-0000-4000-8000-000000000031',
        decided_at = now(), approved_hash = repeat('c', 64)
    where id = v_id;
    raise exception 'proposals: approval with another hash';
  exception when check_violation then null;
  end;
  begin
    update public.execution_proposals
    set status = 'approved', decided_by = 'a0000000-0000-4000-8000-000000000033',
        decided_at = now(), approved_hash = v_hash
    where id = v_id;
    raise exception 'proposals: approval signed by someone else';
  exception when check_violation then null;
  end;
  begin
    update public.execution_proposals set status = 'executed', executed_at = now() where id = v_id;
    raise exception 'proposals: executed without approval';
  exception when check_violation then null;
  end;

  update public.execution_proposals
  set status = 'approved', decided_by = 'a0000000-0000-4000-8000-000000000031',
      decided_at = now(), approved_hash = v_hash
  where id = v_id;
  if not found then raise exception 'proposals: owner could not approve'; end if;

  begin
    update public.execution_proposals set status = 'executed' where id = v_id;
    raise exception 'proposals: executed without a record';
  exception when check_violation then null;
  end;
  update public.execution_proposals
  set status = 'executed', executed_at = now(), result = '{"resourceId":"x"}'
  where id = v_id;
  begin
    update public.execution_proposals set status = 'approved' where id = v_id;
    raise exception 'proposals: executed proposal reopened';
  exception when check_violation then null;
  end;

  -- The viewer sees no proposal of others and decides nothing.
  perform pg_temp.ctx('a0000000-0000-4000-8000-000000000033', 'a0000000-0000-4000-8000-000000000011',
                      'a0000000-0000-4000-8000-000000000010', 'user', '');
  if exists (select 1 from public.execution_proposals) then
    raise exception 'proposals: viewer sees proposals of others';
  end if;
  update public.execution_proposals set status = 'rejected', decided_by = 'a0000000-0000-4000-8000-000000000033',
    decided_at = now();
  if found then raise exception 'proposals: viewer decided'; end if;
end
$$;
reset role;
rollback;
