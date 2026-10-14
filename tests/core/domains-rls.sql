-- ============================================================================
-- SQL custom domains (CF2b): `public.partner_domains` (partner side),
-- `public.workspace_domains` and the resolvers.
--   partner P b8…001 (per block): d…006 partner_admin, d…004 partner_support;
--     org B a…020 and workspace B a…021 move to partner P
--   workspace A a…011 (org a…010, house partner): owner a…031, viewer a…033
--   workspace B a…021 (org a…020): owner a…032
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
  values ('b8000000-0000-4000-8000-000000000001', 'agencia-cf2b', 'Agência CF2b');
  insert into public.partner_members (partner_id, user_id, email, role) values
    ('b8000000-0000-4000-8000-000000000001', 'd0000000-0000-4000-8000-000000000006', 'admin@cf2b.test', 'partner_admin'),
    ('b8000000-0000-4000-8000-000000000001', 'd0000000-0000-4000-8000-000000000004', 'sup@cf2b.test', 'partner_support');
  insert into public.partner_domains (host, partner_id, kind, status)
  values ('agencia-cf2b.guidu.test', 'b8000000-0000-4000-8000-000000000001', 'subdomain', 'active');
  update public.organizations set partner_id = 'b8000000-0000-4000-8000-000000000001'
  where id = 'a0000000-0000-4000-8000-000000000020';
$$;

-- ----------------------------------------------------------------------------
-- Test 1: the partner manages its own custom dashboard domains only
-- ----------------------------------------------------------------------------
begin;
select pg_temp.fixture();
set local role app_runtime;
do $$
declare
  p constant uuid := 'b8000000-0000-4000-8000-000000000001';
begin
  perform pg_temp.ctx('d0000000-0000-4000-8000-000000000006', null, null, p);
  insert into public.partner_domains (host, partner_id, kind, status)
  values ('console.cf2b.test', p, 'custom', 'pending');
  update public.partner_domains set ssl_status = 'pending', cloudflare_hostname_id = 'cf-1'
  where host = 'console.cf2b.test';
  if not found then raise exception 'domains: partner admin could not record a check'; end if;

  -- Only pending custom domains are added; subdomains stay with the platform.
  begin
    insert into public.partner_domains (host, partner_id, kind, status)
    values ('outro.cf2b.test', p, 'custom', 'active');
    raise exception 'domains: partner added an active domain';
  exception when insufficient_privilege then null;
  end;
  begin
    insert into public.partner_domains (host, partner_id, kind, status)
    values ('sub.guidu.test', p, 'subdomain', 'pending');
    raise exception 'domains: partner added a subdomain';
  exception when insufficient_privilege then null;
  end;
  delete from public.partner_domains where host = 'agencia-cf2b.guidu.test';
  if found then raise exception 'domains: partner removed its platform subdomain'; end if;

  -- Another partner's context sees and changes nothing.
  begin
    insert into public.partner_domains (host, partner_id, kind, status)
    values ('casa.cf2b.test', '00000000-0000-4000-8000-000000000000', 'custom', 'pending');
    raise exception 'domains: partner added a domain to another partner';
  exception when insufficient_privilege then null;
  end;

  -- partner_support reads but does not manage.
  perform pg_temp.ctx('d0000000-0000-4000-8000-000000000004', null, null, p);
  begin
    insert into public.partner_domains (host, partner_id, kind, status)
    values ('suporte.cf2b.test', p, 'custom', 'pending');
    raise exception 'domains: partner support added a domain';
  exception when insufficient_privilege then null;
  end;
  delete from public.partner_domains where host = 'console.cf2b.test';
  if found then raise exception 'domains: partner support removed a domain'; end if;

  perform pg_temp.ctx('d0000000-0000-4000-8000-000000000006', null, null, p);
  delete from public.partner_domains where host = 'console.cf2b.test';
  if not found then raise exception 'domains: partner admin could not remove'; end if;
end $$;
rollback;

-- ----------------------------------------------------------------------------
-- Test 2: workspace managers and the company's partner manage public domains
-- ----------------------------------------------------------------------------
begin;
select pg_temp.fixture();
set local role app_runtime;
do $$
declare
  p constant uuid := 'b8000000-0000-4000-8000-000000000001';
  ws_a constant uuid := 'a0000000-0000-4000-8000-000000000011';
  org_a constant uuid := 'a0000000-0000-4000-8000-000000000010';
  ws_b constant uuid := 'a0000000-0000-4000-8000-000000000021';
  org_b constant uuid := 'a0000000-0000-4000-8000-000000000020';
begin
  -- Owner of workspace A adds; the viewer reads but does not add.
  perform pg_temp.ctx('a0000000-0000-4000-8000-000000000031', ws_a, org_a);
  insert into public.workspace_domains (host, organization_id, workspace_id, created_by)
  values ('perfil.loja-a.test', org_a, ws_a, 'a0000000-0000-4000-8000-000000000031');
  begin
    insert into public.workspace_domains (host, organization_id, workspace_id, status, created_by)
    values ('ativo.loja-a.test', org_a, ws_a, 'active', 'a0000000-0000-4000-8000-000000000031');
    raise exception 'domains: workspace added an active domain';
  exception when insufficient_privilege then null;
  end;
  perform pg_temp.ctx('a0000000-0000-4000-8000-000000000033', ws_a, org_a);
  if (select count(*) from public.workspace_domains) <> 1 then
    raise exception 'domains: viewer does not read the workspace domains';
  end if;
  begin
    insert into public.workspace_domains (host, organization_id, workspace_id, created_by)
    values ('viewer.loja-a.test', org_a, ws_a, 'a0000000-0000-4000-8000-000000000033');
    raise exception 'domains: viewer added a domain';
  exception when insufficient_privilege then null;
  end;
  delete from public.workspace_domains;
  if found then raise exception 'domains: viewer removed a domain'; end if;

  -- Workspace B sees nothing of workspace A.
  perform pg_temp.ctx('a0000000-0000-4000-8000-000000000032', ws_b, org_b);
  if exists (select 1 from public.workspace_domains) then
    raise exception 'domains: workspace B reads workspace A';
  end if;

  -- The partner of company B manages its domains, never the house's company A.
  perform pg_temp.ctx('d0000000-0000-4000-8000-000000000006', null, null, p);
  insert into public.workspace_domains (host, organization_id, workspace_id, created_by)
  values ('perfil.loja-b.test', org_b, ws_b, 'd0000000-0000-4000-8000-000000000006');
  begin
    insert into public.workspace_domains (host, organization_id, workspace_id, created_by)
    values ('intruso.loja-a.test', org_a, ws_a, 'd0000000-0000-4000-8000-000000000006');
    raise exception 'domains: partner added a domain to another partner''s customer';
  exception when insufficient_privilege then null;
  end;
  if (select array_agg(host) from public.workspace_domains) is distinct from array['perfil.loja-b.test'] then
    raise exception 'domains: partner must read only its customers'' domains';
  end if;
  if exists (select 1 from private.partner_customer_workspaces() where workspace_id = ws_a)
     or not exists (select 1 from private.partner_customer_workspaces() where workspace_id = ws_b) then
    raise exception 'domains: partner must list only its customers'' workspaces';
  end if;

  -- partner_support reads, does not add.
  perform pg_temp.ctx('d0000000-0000-4000-8000-000000000004', null, null, p);
  if (select count(*) from public.workspace_domains) <> 1 then
    raise exception 'domains: partner support does not read customer domains';
  end if;
  begin
    insert into public.workspace_domains (host, organization_id, workspace_id, created_by)
    values ('sup.loja-b.test', org_b, ws_b, 'd0000000-0000-4000-8000-000000000004');
    raise exception 'domains: partner support added a domain';
  exception when insufficient_privilege then null;
  end;

  -- Without a partner context, the list of customer workspaces is empty.
  perform pg_temp.ctx('d0000000-0000-4000-8000-000000000006', null, null);
  if exists (select 1 from private.partner_customer_workspaces()) then
    raise exception 'domains: customer workspaces listed without partner context';
  end if;
end $$;
rollback;

-- ----------------------------------------------------------------------------
-- Test 3: one host across both tables; resolvers only see active hosts
-- ----------------------------------------------------------------------------
begin;
select pg_temp.fixture();
insert into public.workspace_domains (host, organization_id, workspace_id, status)
values ('perfil.loja-b.test', 'a0000000-0000-4000-8000-000000000020',
        'a0000000-0000-4000-8000-000000000021', 'pending');
do $$
begin
  begin
    insert into public.partner_domains (host, partner_id, kind, status)
    values ('perfil.loja-b.test', 'b8000000-0000-4000-8000-000000000001', 'custom', 'pending');
    raise exception 'domains: the same host in both tables';
  exception when unique_violation then null;
  end;
  begin
    insert into public.workspace_domains (host, organization_id, workspace_id)
    values ('agencia-cf2b.guidu.test', 'a0000000-0000-4000-8000-000000000020',
            'a0000000-0000-4000-8000-000000000021');
    raise exception 'domains: a workspace took a partner host';
  exception when unique_violation then null;
  end;
end $$;
set local role app_runtime;
do $$
begin
  perform pg_temp.ctx('00000000-0000-4000-8000-000000000000', null, null);
  if private.domain_host_active('perfil.loja-b.test') then
    raise exception 'domains: a pending host is served';
  end if;
  if not private.domain_host_active('AGENCIA-CF2B.guidu.test') then
    raise exception 'domains: an active partner host is not served';
  end if;
  if exists (select 1 from private.resolve_public_domain('perfil.loja-b.test')) then
    raise exception 'domains: a pending public domain resolves';
  end if;
end $$;
reset role;
update public.workspace_domains set status = 'active' where host = 'perfil.loja-b.test';
set local role app_runtime;
do $$
begin
  if not private.domain_host_active('perfil.loja-b.test') then
    raise exception 'domains: an active public domain is not served';
  end if;
  if (select workspace_id from private.resolve_public_domain('perfil.loja-b.test'))
     <> 'a0000000-0000-4000-8000-000000000021' then
    raise exception 'domains: public domain resolves to the wrong workspace';
  end if;
end $$;
reset role;
update public.workspaces set status = 'suspended' where id = 'a0000000-0000-4000-8000-000000000021';
set local role app_runtime;
do $$
begin
  if private.domain_host_active('perfil.loja-b.test') then
    raise exception 'domains: a suspended workspace is served';
  end if;
end $$;
rollback;

-- ----------------------------------------------------------------------------
-- Test 4: no access for anon and authenticated
-- ----------------------------------------------------------------------------
begin;
set local role authenticated;
do $$
begin
  perform 1 from public.workspace_domains;
  raise exception 'authenticated can read public.workspace_domains';
exception when insufficient_privilege then
  null;
end
$$;
rollback;
