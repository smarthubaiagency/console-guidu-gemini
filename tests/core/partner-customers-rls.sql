-- ============================================================================
-- SQL Partner Customers RLS (ADR 0012, plano P4b)
-- Tables: organizations, workspaces, invitations, workspace_modules (insert
--         by partner), partner_offered_modules, partner_workspace_templates
--
-- Executed as migration administrator. Each block prepares its fixtures as
-- administrator, switches to `app_runtime` with `set local role` and rolls
-- back. Fixtures: tests/core/seed.sql, membership-seed.sql.
--   partner B b0000000-0000-4000-8000-000000000001 (created per block)
--   d…004 partner_owner of B     d…005 partner_finance of B
--   d…006 not a member           org A a…010 belongs to the house partner
-- ============================================================================

create or replace function pg_temp.customer_fixture() returns void
language sql as $$
  insert into public.partners (id, slug, name)
  values ('b0000000-0000-4000-8000-000000000001', 'agencia-b', 'Agência B');
  insert into public.partner_members (partner_id, user_id, email, role) values
    ('b0000000-0000-4000-8000-000000000001', 'd0000000-0000-4000-8000-000000000004', 'owner@b.test', 'partner_owner'),
    ('b0000000-0000-4000-8000-000000000001', 'd0000000-0000-4000-8000-000000000005', 'fin@b.test', 'partner_finance');
$$;

-- ----------------------------------------------------------------------------
-- Test 1: owner/admin register a customer of the context partner only
-- ----------------------------------------------------------------------------
begin;
select pg_temp.customer_fixture();
select set_config('app.partner_id', 'b0000000-0000-4000-8000-000000000001', true);
set local role app_runtime;
do $$
begin
  perform set_config('app.user_id', 'd0000000-0000-4000-8000-000000000004', true);

  insert into public.organizations (id, name, status, partner_id)
  values ('c0000000-0000-4000-8000-000000000001', 'Cliente 1', 'active', 'b0000000-0000-4000-8000-000000000001');
  insert into public.workspaces (id, organization_id, slug, name, status)
  values ('c0000000-0000-4000-8000-000000000002', 'c0000000-0000-4000-8000-000000000001', 'cliente-1', 'Cliente 1', 'active');
  insert into public.workspace_modules (organization_id, workspace_id, module_key, status, updated_by)
  values ('c0000000-0000-4000-8000-000000000001', 'c0000000-0000-4000-8000-000000000002', 'catalog', 'enabled',
          'd0000000-0000-4000-8000-000000000004');
  insert into public.invitations (organization_id, workspace_id, email, role, token_hash, invited_by_user_id, status, expires_at)
  values ('c0000000-0000-4000-8000-000000000001', 'c0000000-0000-4000-8000-000000000002', 'dono@cliente.test', 'owner',
          repeat('a', 64), 'd0000000-0000-4000-8000-000000000004', 'pending', now() + interval '7 days');

  -- Writing does not grant reading the workspace or its modules.
  if (select count(*) from public.workspaces) <> 0 then
    raise exception 'workspaces: partner can read the customer workspace';
  end if;
  if (select count(*) from public.workspace_modules) <> 0 then
    raise exception 'workspace_modules: partner can read customer modules';
  end if;

  -- Another partner's organization: denied everywhere.
  begin
    insert into public.organizations (id, name, status, partner_id)
    values ('c0000000-0000-4000-8000-000000000003', 'X', 'active', '00000000-0000-4000-8000-000000000000');
    raise exception 'organizations: created a company for another partner';
  exception when insufficient_privilege then null;
  end;
  begin
    insert into public.workspaces (id, organization_id, slug, name, status)
    values ('c0000000-0000-4000-8000-000000000004', 'a0000000-0000-4000-8000-000000000010', 'intruso', 'X', 'active');
    raise exception 'workspaces: created a workspace in another partner''s company';
  exception when insufficient_privilege then null;
  end;
  begin
    insert into public.invitations (organization_id, workspace_id, email, role, token_hash, invited_by_user_id, status, expires_at)
    values ('a0000000-0000-4000-8000-000000000010', 'a0000000-0000-4000-8000-000000000011', 'x@x.test', 'owner',
            repeat('b', 64), 'd0000000-0000-4000-8000-000000000004', 'pending', now() + interval '1 day');
    raise exception 'invitations: invited into another partner''s company';
  exception when insufficient_privilege then null;
  end;
  begin
    insert into public.workspace_modules (organization_id, workspace_id, module_key, status, updated_by)
    values ('a0000000-0000-4000-8000-000000000010', 'a0000000-0000-4000-8000-000000000011', 'catalog', 'enabled',
            'd0000000-0000-4000-8000-000000000004');
    raise exception 'workspace_modules: enabled a module for another partner''s workspace';
  exception when insufficient_privilege then null;
  end;
  -- A suspended company cannot be created.
  begin
    insert into public.organizations (id, name, status, partner_id)
    values ('c0000000-0000-4000-8000-000000000005', 'X', 'suspended', 'b0000000-0000-4000-8000-000000000001');
    raise exception 'organizations: created a suspended company';
  exception when insufficient_privilege then null;
  end;

  -- partner_finance and non-members register nothing.
  perform set_config('app.user_id', 'd0000000-0000-4000-8000-000000000005', true);
  begin
    insert into public.organizations (id, name, status, partner_id)
    values ('c0000000-0000-4000-8000-000000000006', 'X', 'active', 'b0000000-0000-4000-8000-000000000001');
    raise exception 'organizations: partner_finance created a company';
  exception when insufficient_privilege then null;
  end;
  perform set_config('app.user_id', 'd0000000-0000-4000-8000-000000000006', true);
  begin
    insert into public.organizations (id, name, status, partner_id)
    values ('c0000000-0000-4000-8000-000000000007', 'X', 'active', 'b0000000-0000-4000-8000-000000000001');
    raise exception 'organizations: non-member created a company';
  exception when insufficient_privilege then null;
  end;
end
$$;
rollback;

-- ----------------------------------------------------------------------------
-- Test 2: module catalog and templates
-- ----------------------------------------------------------------------------
begin;
select pg_temp.customer_fixture();
select set_config('app.partner_id', 'b0000000-0000-4000-8000-000000000001', true);
set local role app_runtime;
do $$
begin
  perform set_config('app.user_id', 'd0000000-0000-4000-8000-000000000004', true);
  insert into public.partner_offered_modules (partner_id, module_key, created_by)
  values ('b0000000-0000-4000-8000-000000000001', 'catalog', 'd0000000-0000-4000-8000-000000000004');
  insert into public.partner_workspace_templates (partner_id, name, module_keys, created_by)
  values ('b0000000-0000-4000-8000-000000000001', 'Padrão', array['catalog'], 'd0000000-0000-4000-8000-000000000004');

  perform set_config('app.user_id', 'd0000000-0000-4000-8000-000000000005', true);
  if (select count(*) from public.partner_offered_modules) <> 1
     or (select count(*) from public.partner_workspace_templates) <> 1 then
    raise exception 'catalog: partner member cannot read the catalog';
  end if;
  begin
    insert into public.partner_workspace_templates (partner_id, name, created_by)
    values ('b0000000-0000-4000-8000-000000000001', 'Outro', 'd0000000-0000-4000-8000-000000000005');
    raise exception 'templates: partner_finance created a template';
  exception when insufficient_privilege then null;
  end;
  delete from public.partner_offered_modules;
  if found then raise exception 'catalog: partner_finance withdrew a module'; end if;

  perform set_config('app.user_id', 'd0000000-0000-4000-8000-000000000006', true);
  if (select count(*) from public.partner_workspace_templates) <> 0 then
    raise exception 'templates: non-member read templates';
  end if;

  -- Another partner context sees nothing.
  perform set_config('app.user_id', 'd0000000-0000-4000-8000-000000000004', true);
  perform set_config('app.partner_id', '00000000-0000-4000-8000-000000000000', true);
  if (select count(*) from public.partner_offered_modules) <> 0 then
    raise exception 'catalog: visible outside the partner context';
  end if;
end
$$;
rollback;
