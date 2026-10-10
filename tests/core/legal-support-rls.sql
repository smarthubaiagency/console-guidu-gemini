-- ============================================================================
-- SQL Legal documents and temporary support access RLS (ADR 0012, P4b2)
-- Tables: partner_legal_documents, legal_acceptances, partner_support_grants,
--         workspace_members.support_grant_id (validity in membership helpers)
--
-- Executed as migration administrator. Each block prepares its fixtures as
-- administrator, switches to `app_runtime` with `set local role` and rolls
-- back. Fixtures: tests/core/seed.sql, membership-seed.sql, admin-seed.sql.
--   partner B b0000000-0000-4000-8000-000000000001 (per block); org B a…020
--   and workspace B a…021 (slug workspace-b) are moved to partner B
--   userB a…032 owner of workspace B     d…004 partner_support of B
--   d…005 partner_finance of B           d…003 platform owner
-- ============================================================================

create or replace function pg_temp.support_fixture() returns void
language sql as $$
  insert into public.partners (id, slug, name)
  values ('b0000000-0000-4000-8000-000000000001', 'agencia-b', 'Agência B');
  insert into public.partner_members (partner_id, user_id, email, role) values
    ('b0000000-0000-4000-8000-000000000001', 'd0000000-0000-4000-8000-000000000004', 'suporte@b.test', 'partner_support'),
    ('b0000000-0000-4000-8000-000000000001', 'd0000000-0000-4000-8000-000000000005', 'fin@b.test', 'partner_finance');
  update public.organizations
  set partner_id = 'b0000000-0000-4000-8000-000000000001'
  where id = 'a0000000-0000-4000-8000-000000000020';
$$;

-- ----------------------------------------------------------------------------
-- Test 1: legal documents and acceptances
-- ----------------------------------------------------------------------------
begin;
select set_config('app.partner_id', '00000000-0000-4000-8000-000000000000', true);
set local role app_runtime;
do $$
declare
  v_doc uuid;
begin
  -- Platform owner publishes for the house partner.
  perform set_config('app.user_id', 'd0000000-0000-4000-8000-000000000003', true);
  insert into public.partner_legal_documents (partner_id, kind, version, title, body, published_by)
  values ('00000000-0000-4000-8000-000000000000', 'terms', 1, 'Termos', 'Texto', 'd0000000-0000-4000-8000-000000000003');
  -- The first version always requires acceptance.
  begin
    insert into public.partner_legal_documents (partner_id, kind, version, title, body, requires_acceptance, published_by)
    values ('00000000-0000-4000-8000-000000000000', 'privacy', 1, 'Privacidade', 'Texto', false, 'd0000000-0000-4000-8000-000000000003');
    raise exception 'legal: first version without acceptance';
  exception when check_violation then null;
  end;

  -- A regular user cannot publish, but reads and accepts for themselves.
  perform set_config('app.user_id', 'a0000000-0000-4000-8000-000000000031', true);
  begin
    insert into public.partner_legal_documents (partner_id, kind, version, title, body, published_by)
    values ('00000000-0000-4000-8000-000000000000', 'terms', 2, 'X', 'X', 'a0000000-0000-4000-8000-000000000031');
    raise exception 'legal: regular user published';
  exception when insufficient_privilege then null;
  end;
  select id into v_doc from public.partner_legal_documents where kind = 'terms';
  if v_doc is null then raise exception 'legal: document not readable in its partner'; end if;
  insert into public.legal_acceptances (user_id, document_id)
  values ('a0000000-0000-4000-8000-000000000031', v_doc);
  begin
    insert into public.legal_acceptances (user_id, document_id)
    values ('a0000000-0000-4000-8000-000000000032', v_doc);
    raise exception 'legal: accepted on behalf of another user';
  exception when insufficient_privilege then null;
  end;

  -- Another user sees no acceptance of others; another partner sees no document.
  perform set_config('app.user_id', 'a0000000-0000-4000-8000-000000000032', true);
  if (select count(*) from public.legal_acceptances) <> 0 then
    raise exception 'legal: acceptances of another user visible';
  end if;
  perform set_config('app.partner_id', 'b0000000-0000-4000-8000-0000000000ff', true);
  if (select count(*) from public.partner_legal_documents) <> 0 then
    raise exception 'legal: documents visible to another partner';
  end if;
end
$$;
rollback;

-- ----------------------------------------------------------------------------
-- Test 2: who may ask for support access
-- ----------------------------------------------------------------------------
begin;
select pg_temp.support_fixture();
select set_config('app.partner_id', 'b0000000-0000-4000-8000-000000000001', true);
set local role app_runtime;
do $$
begin
  perform set_config('app.user_id', 'd0000000-0000-4000-8000-000000000004', true);
  insert into public.partner_support_grants
    (partner_id, organization_id, grantee_user_id, grantee_email, requested_by, reason, duration_hours)
  values ('b0000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000020',
          'd0000000-0000-4000-8000-000000000004', 'suporte@b.test', 'd0000000-0000-4000-8000-000000000004',
          'Investigar erro de configuração', 4);
  begin
    insert into public.partner_support_grants
      (partner_id, organization_id, grantee_user_id, grantee_email, requested_by, reason, duration_hours)
    values ('b0000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000010',
            'd0000000-0000-4000-8000-000000000004', 'suporte@b.test', 'd0000000-0000-4000-8000-000000000004',
            'Empresa de outro parceiro', 4);
    raise exception 'support: asked access to another partner''s company';
  exception when insufficient_privilege then null;
  end;
  begin
    insert into public.partner_support_grants
      (partner_id, organization_id, grantee_user_id, grantee_email, requested_by, reason, duration_hours)
    values ('b0000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000020',
            'd0000000-0000-4000-8000-000000000005', 'fin@b.test', 'd0000000-0000-4000-8000-000000000004',
            'Pedido em nome de outra pessoa', 4);
    raise exception 'support: asked access for someone else';
  exception when insufficient_privilege then null;
  end;
  begin
    insert into public.partner_support_grants
      (partner_id, organization_id, grantee_user_id, grantee_email, requested_by, reason, duration_hours, status)
    values ('b0000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000020',
            'd0000000-0000-4000-8000-000000000004', 'suporte@b.test', 'd0000000-0000-4000-8000-000000000004',
            'Já nasce aprovado', 4, 'approved');
    raise exception 'support: created an approved grant';
  exception when check_violation or insufficient_privilege then null;
  end;

  perform set_config('app.user_id', 'd0000000-0000-4000-8000-000000000005', true);
  begin
    insert into public.partner_support_grants
      (partner_id, organization_id, grantee_user_id, grantee_email, requested_by, reason, duration_hours)
    values ('b0000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000020',
            'd0000000-0000-4000-8000-000000000005', 'fin@b.test', 'd0000000-0000-4000-8000-000000000005',
            'Financeiro não pede suporte', 4);
    raise exception 'support: partner_finance asked access';
  exception when insufficient_privilege then null;
  end;
end
$$;
rollback;

-- ----------------------------------------------------------------------------
-- Test 3: approval gives viewer access only while the grant is valid
-- ----------------------------------------------------------------------------
begin;
select pg_temp.support_fixture();
insert into public.partner_support_grants
  (id, partner_id, organization_id, grantee_user_id, grantee_email, requested_by, reason, duration_hours)
values ('e0000000-0000-4000-8000-000000000001', 'b0000000-0000-4000-8000-000000000001',
        'a0000000-0000-4000-8000-000000000020', 'd0000000-0000-4000-8000-000000000004',
        'suporte@b.test', 'd0000000-0000-4000-8000-000000000004', 'Investigar erro de configuração', 4);
select set_config('app.partner_id', 'b0000000-0000-4000-8000-000000000001', true),
       set_config('app.workspace_id', 'a0000000-0000-4000-8000-000000000021', true),
       set_config('app.organization_id', 'a0000000-0000-4000-8000-000000000020', true);
set local role app_runtime;
do $$
begin
  -- The grantee cannot approve their own request (permissive policies
  -- combine: the requester's revoke USING must not meet the approval CHECK).
  perform set_config('app.user_id', 'd0000000-0000-4000-8000-000000000004', true);
  begin
    update public.partner_support_grants
    set status = 'approved', workspace_id = 'a0000000-0000-4000-8000-000000000021',
        expires_at = now() + interval '4 hours', decided_by = 'd0000000-0000-4000-8000-000000000004'
    where id = 'e0000000-0000-4000-8000-000000000001';
    if found then raise exception 'support: grantee approved their own request'; end if;
  exception when insufficient_privilege then null;
  end;

  -- The workspace owner cannot exceed the requested duration...
  perform set_config('app.user_id', 'a0000000-0000-4000-8000-000000000032', true);
  begin
    update public.partner_support_grants
    set status = 'approved', workspace_id = 'a0000000-0000-4000-8000-000000000021',
        expires_at = now() + interval '5 hours', decided_by = 'a0000000-0000-4000-8000-000000000032'
    where id = 'e0000000-0000-4000-8000-000000000001';
    raise exception 'support: approval longer than requested';
  exception when insufficient_privilege then null;
  end;
  -- ...and approves within it, adding the support membership.
  update public.partner_support_grants
  set status = 'approved', workspace_id = 'a0000000-0000-4000-8000-000000000021',
      workspace_slug = 'workspace-b', expires_at = now() + interval '4 hours',
      decided_by = 'a0000000-0000-4000-8000-000000000032', decided_at = now()
  where id = 'e0000000-0000-4000-8000-000000000001';
  if not found then raise exception 'support: owner could not approve'; end if;
  insert into public.workspace_members (workspace_id, organization_id, user_id, role, status, support_grant_id)
  values ('a0000000-0000-4000-8000-000000000021', 'a0000000-0000-4000-8000-000000000020',
          'd0000000-0000-4000-8000-000000000004', 'viewer', 'active', 'e0000000-0000-4000-8000-000000000001');

  -- The grantee now resolves the workspace as viewer.
  perform set_config('app.user_id', 'd0000000-0000-4000-8000-000000000004', true);
  if not private.is_workspace_member('a0000000-0000-4000-8000-000000000021', 'a0000000-0000-4000-8000-000000000020') then
    raise exception 'support: approved grant gives no membership';
  end if;
  if private.current_workspace_role() is distinct from 'viewer' then
    raise exception 'support: approved grant must give the viewer role';
  end if;
  if (select count(*) from private.resolve_workspace_slug('workspace-b')) <> 1 then
    raise exception 'support: grantee cannot resolve the workspace';
  end if;
end
$$;

-- Expiry: no job, the next query denies.
reset role;
update public.partner_support_grants set expires_at = now() - interval '1 minute'
where id = 'e0000000-0000-4000-8000-000000000001';
set local role app_runtime;
do $$
begin
  perform set_config('app.user_id', 'd0000000-0000-4000-8000-000000000004', true);
  if private.is_workspace_member('a0000000-0000-4000-8000-000000000021', 'a0000000-0000-4000-8000-000000000020') then
    raise exception 'support: expired grant still gives membership';
  end if;
  if private.current_workspace_role() is not null then
    raise exception 'support: expired grant still gives a role';
  end if;
  if (select count(*) from private.resolve_workspace_slug('workspace-b')) <> 0
     or (select count(*) from private.list_user_workspaces()) <> 0 then
    raise exception 'support: expired grant still resolves the workspace';
  end if;
  if (select count(*) from public.workspaces) <> 0 then
    raise exception 'support: expired grant still reads workspace data';
  end if;
end
$$;

-- Revocation: an unexpired but revoked grant denies as well.
reset role;
update public.partner_support_grants
set expires_at = now() + interval '1 hour', status = 'revoked'
where id = 'e0000000-0000-4000-8000-000000000001';
set local role app_runtime;
do $$
begin
  perform set_config('app.user_id', 'd0000000-0000-4000-8000-000000000004', true);
  if private.is_workspace_member('a0000000-0000-4000-8000-000000000021', 'a0000000-0000-4000-8000-000000000020') then
    raise exception 'support: revoked grant still gives membership';
  end if;

  -- Regular members are unaffected.
  perform set_config('app.user_id', 'a0000000-0000-4000-8000-000000000032', true);
  if private.current_workspace_role() is distinct from 'owner' then
    raise exception 'support: regular owner lost the role';
  end if;
end
$$;
rollback;
