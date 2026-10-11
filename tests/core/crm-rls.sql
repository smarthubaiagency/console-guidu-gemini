-- ============================================================================
-- SQL CRM contacts (F4c): tenant, role, author and immutable columns
--   workspace A a…011 (org a…010): owner a…031, viewer a…033
--   workspace B a…021 (org a…020): owner a…032
-- ============================================================================

create or replace function pg_temp.ctx(p_user uuid, p_ws uuid, p_org uuid) returns void
language sql as $$
  select set_config('app.user_id', p_user::text, true),
         set_config('app.workspace_id', p_ws::text, true),
         set_config('app.organization_id', p_org::text, true);
$$;

begin;
insert into public.crm_contacts (id, organization_id, workspace_id, name, created_by) values
  ('f4c00000-0000-4000-8000-0000000000b1', 'a0000000-0000-4000-8000-000000000020',
   'a0000000-0000-4000-8000-000000000021', 'Contato de B', 'a0000000-0000-4000-8000-000000000032');
set local role app_runtime;
do $$
declare
  v_id uuid;
begin
  -- The owner of A creates and edits, signing the rows.
  perform pg_temp.ctx('a0000000-0000-4000-8000-000000000031', 'a0000000-0000-4000-8000-000000000011',
                      'a0000000-0000-4000-8000-000000000010');
  insert into public.crm_contacts (organization_id, workspace_id, name, email, created_by)
  values ('a0000000-0000-4000-8000-000000000010', 'a0000000-0000-4000-8000-000000000011',
          'Maria', 'maria@cliente.test', 'a0000000-0000-4000-8000-000000000031')
  returning id into v_id;
  update public.crm_contacts set phone = '11999990000', updated_by = 'a0000000-0000-4000-8000-000000000031'
  where id = v_id;
  if not found then raise exception 'crm: owner could not edit'; end if;
  begin
    update public.crm_contacts set phone = '1', updated_by = 'a0000000-0000-4000-8000-000000000033'
    where id = v_id;
    raise exception 'crm: edit signed by someone else';
  exception when insufficient_privilege then null;
  end;
  begin
    update public.crm_contacts set created_by = 'a0000000-0000-4000-8000-000000000033',
      updated_by = 'a0000000-0000-4000-8000-000000000031' where id = v_id;
    raise exception 'crm: author changed';
  exception when check_violation then null;
  end;
  begin
    delete from public.crm_contacts where id = v_id;
    raise exception 'crm: contact deleted';
  exception when insufficient_privilege then null;
  end;

  -- Nothing of workspace B is visible or reachable from A.
  if exists (select 1 from public.crm_contacts where id = 'f4c00000-0000-4000-8000-0000000000b1') then
    raise exception 'crm: contact of another workspace visible';
  end if;
  update public.crm_contacts set name = 'x', updated_by = 'a0000000-0000-4000-8000-000000000031'
  where id = 'f4c00000-0000-4000-8000-0000000000b1';
  if found then raise exception 'crm: contact of another workspace edited'; end if;
  begin
    insert into public.crm_contacts (organization_id, workspace_id, name, created_by)
    values ('a0000000-0000-4000-8000-000000000020', 'a0000000-0000-4000-8000-000000000021',
            'Intruso', 'a0000000-0000-4000-8000-000000000031');
    raise exception 'crm: contact created in another workspace';
  exception when insufficient_privilege then null;
  end;

  -- The viewer reads but does not write.
  perform pg_temp.ctx('a0000000-0000-4000-8000-000000000033', 'a0000000-0000-4000-8000-000000000011',
                      'a0000000-0000-4000-8000-000000000010');
  if (select count(*) from public.crm_contacts) <> 1 then
    raise exception 'crm: viewer cannot read the contacts';
  end if;
  begin
    insert into public.crm_contacts (organization_id, workspace_id, name, created_by)
    values ('a0000000-0000-4000-8000-000000000010', 'a0000000-0000-4000-8000-000000000011',
            'Viewer', 'a0000000-0000-4000-8000-000000000033');
    raise exception 'crm: viewer created a contact';
  exception when insufficient_privilege then null;
  end;
  update public.crm_contacts set notes = 'x', updated_by = 'a0000000-0000-4000-8000-000000000033';
  if found then raise exception 'crm: viewer edited a contact'; end if;
end
$$;
reset role;

-- API keys accept the module scopes.
do $$
begin
  insert into public.api_keys (organization_id, workspace_id, user_id, name, prefix, key_hash, scopes, expires_at)
  values ('a0000000-0000-4000-8000-000000000010', 'a0000000-0000-4000-8000-000000000011',
          'a0000000-0000-4000-8000-000000000031', 'crm', 'gdu_live_crm', 'hash-crm-f4c',
          array['crm:read', 'crm:write'], now() + interval '1 day');
  begin
    insert into public.api_keys (organization_id, workspace_id, user_id, name, prefix, key_hash, scopes, expires_at)
    values ('a0000000-0000-4000-8000-000000000010', 'a0000000-0000-4000-8000-000000000011',
            'a0000000-0000-4000-8000-000000000031', 'x', 'gdu_live_x', 'hash-x-f4c',
            array['crm:delete'], now() + interval '1 day');
    raise exception 'crm: unknown scope accepted';
  exception when check_violation then null;
  end;
end
$$;
rollback;
