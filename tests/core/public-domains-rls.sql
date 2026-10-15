-- ============================================================================
-- SQL default public domains (CF2c): `public.partner_public_domains`,
-- `public.workspace_public_routes`, the host guard and the resolvers.
--   partner P b8c00000…001 (per block): d…006 partner_admin, d…004
--     partner_support; org B a…020 and workspace B a…021 move to partner P
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
  values ('b8c00000-0000-4000-8000-000000000001', 'agencia-cf2c', 'Agência CF2c');
  insert into public.partner_members (partner_id, user_id, email, role) values
    ('b8c00000-0000-4000-8000-000000000001', 'd0000000-0000-4000-8000-000000000006', 'admin@cf2c.test', 'partner_admin'),
    ('b8c00000-0000-4000-8000-000000000001', 'd0000000-0000-4000-8000-000000000004', 'sup@cf2c.test', 'partner_support');
  update public.organizations set partner_id = 'b8c00000-0000-4000-8000-000000000001'
  where id = 'a0000000-0000-4000-8000-000000000020';
$$;

-- ----------------------------------------------------------------------------
-- Test 1: partner owners and admins manage their own default domains
-- ----------------------------------------------------------------------------
begin;
select pg_temp.fixture();
set local role app_runtime;
do $$
declare
  p constant uuid := 'b8c00000-0000-4000-8000-000000000001';
  admin_user constant uuid := 'd0000000-0000-4000-8000-000000000006';
  support_user constant uuid := 'd0000000-0000-4000-8000-000000000004';
begin
  perform pg_temp.ctx(admin_user, null, null, p);
  insert into public.partner_public_domains (partner_id, route_type, host, created_by)
  values (p, 'profile', 'cartao.cf2c.test', admin_user);
  update public.partner_public_domains set last_error = 'dns_pending', checked_at = now()
  where host = 'cartao.cf2c.test';
  if not found then raise exception 'public domains: partner admin could not record a check'; end if;

  -- Only pending rows, for its own partner, one per type.
  begin
    insert into public.partner_public_domains (partner_id, route_type, host, status, created_by)
    values (p, 'quiz', 'quiz.cf2c.test', 'active', admin_user);
    raise exception 'public domains: partner added an active default domain';
  exception when insufficient_privilege then null;
  end;
  begin
    insert into public.partner_public_domains (partner_id, route_type, host, created_by)
    values ('00000000-0000-4000-8000-000000000000', 'quiz', 'quiz.cf2c.test', admin_user);
    raise exception 'public domains: partner added a default domain to another partner';
  exception when insufficient_privilege then null;
  end;
  begin
    insert into public.partner_public_domains (partner_id, route_type, host, created_by)
    values (p, 'profile', 'outro.cf2c.test', admin_user);
    raise exception 'public domains: two default domains for one type';
  exception when unique_violation then null;
  end;
  -- The host and the type never change.
  begin
    update public.partner_public_domains set host = 'mudou.cf2c.test' where host = 'cartao.cf2c.test';
    raise exception 'public domains: host changed';
  exception when insufficient_privilege then null;
  end;

  -- partner_support reads but does not manage.
  perform pg_temp.ctx(support_user, null, null, p);
  if (select count(*) from public.partner_public_domains) <> 1 then
    raise exception 'public domains: partner support does not read';
  end if;
  begin
    insert into public.partner_public_domains (partner_id, route_type, host, created_by)
    values (p, 'page', 'site.cf2c.test', support_user);
    raise exception 'public domains: partner support added a default domain';
  exception when insufficient_privilege then null;
  end;
  delete from public.partner_public_domains;
  if found then raise exception 'public domains: partner support removed a default domain'; end if;

  -- A workspace member reads none of the partner's rows directly.
  perform pg_temp.ctx('a0000000-0000-4000-8000-000000000032',
                      'a0000000-0000-4000-8000-000000000021',
                      'a0000000-0000-4000-8000-000000000020');
  if exists (select 1 from public.partner_public_domains) then
    raise exception 'public domains: workspace member reads the partner table';
  end if;

  perform pg_temp.ctx(admin_user, null, null, p);
  delete from public.partner_public_domains where host = 'cartao.cf2c.test';
  if not found then raise exception 'public domains: partner admin could not remove'; end if;
end $$;
rollback;

-- The house partner never has a row (its default is the platform's).
begin;
do $$
begin
  insert into public.partner_public_domains (partner_id, route_type, host)
  values ('00000000-0000-4000-8000-000000000000', 'profile', 'casa.cf2c.test');
  raise exception 'public domains: house partner got a default domain';
exception when check_violation then null;
end $$;
rollback;

-- ----------------------------------------------------------------------------
-- Test 2: no host under a partner's default domain, in any table
-- ----------------------------------------------------------------------------
begin;
select pg_temp.fixture();
insert into public.workspace_domains (host, organization_id, workspace_id)
values ('perfil.loja.cf2c.test', 'a0000000-0000-4000-8000-000000000020',
        'a0000000-0000-4000-8000-000000000021');
do $$
declare
  p constant uuid := 'b8c00000-0000-4000-8000-000000000001';
begin
  -- A default domain over an existing own domain, or equal to it.
  begin
    insert into public.partner_public_domains (partner_id, route_type, host)
    values (p, 'profile', 'loja.cf2c.test');
    raise exception 'public domains: default domain over an own domain';
  exception when unique_violation then null;
  end;
  begin
    insert into public.partner_public_domains (partner_id, route_type, host)
    values (p, 'profile', 'perfil.loja.cf2c.test');
    raise exception 'public domains: default domain equal to an own domain';
  exception when unique_violation then null;
  end;

  insert into public.partner_public_domains (partner_id, route_type, host)
  values (p, 'quiz', 'quiz.cf2c.test');
  -- Own domains, dashboard domains and other default domains under it.
  begin
    insert into public.workspace_domains (host, organization_id, workspace_id)
    values ('rodobens.quiz.cf2c.test', 'a0000000-0000-4000-8000-000000000020',
            'a0000000-0000-4000-8000-000000000021');
    raise exception 'public domains: own domain under a default domain';
  exception when unique_violation then null;
  end;
  begin
    insert into public.partner_domains (host, partner_id, kind, status)
    values ('painel.quiz.cf2c.test', p, 'custom', 'pending');
    raise exception 'public domains: dashboard domain under a default domain';
  exception when unique_violation then null;
  end;
  begin
    insert into public.partner_public_domains (partner_id, route_type, host)
    values (p, 'page', 'a.quiz.cf2c.test');
    raise exception 'public domains: default domain under another';
  exception when unique_violation then null;
  end;
  begin
    insert into public.partner_public_domains (partner_id, route_type, host)
    values (p, 'page', 'cf2c.test');
    raise exception 'public domains: default domain over another';
  exception when unique_violation then null;
  end;
  -- A sibling name is fine.
  insert into public.workspace_domains (host, organization_id, workspace_id)
  values ('quizz.cf2c.test', 'a0000000-0000-4000-8000-000000000020',
          'a0000000-0000-4000-8000-000000000021');
end $$;
rollback;

-- ----------------------------------------------------------------------------
-- Test 3: resolvers see only active rows and restore the lookup slug
-- ----------------------------------------------------------------------------
begin;
select pg_temp.fixture();
insert into public.partner_public_domains (partner_id, route_type, host, status) values
  ('b8c00000-0000-4000-8000-000000000001', 'profile', 'cartao.cf2c.test', 'active'),
  ('b8c00000-0000-4000-8000-000000000001', 'quiz', 'quiz.cf2c.test', 'pending');
set local role app_runtime;
do $$
declare
  ws_b_slug text;
  r record;
begin
  perform pg_temp.ctx('00000000-0000-4000-8000-000000000000', null, null);
  if (select count(*) from private.resolve_public_bases(
        array['x.cartao.cf2c.test', 'cartao.cf2c.test', 'quiz.cf2c.test', 'cf2c.test'])) <> 1 then
    raise exception 'public domains: resolve_public_bases must return only the active domain';
  end if;
  if (select route_type from private.resolve_public_bases(array['cartao.cf2c.test'])) <> 'profile' then
    raise exception 'public domains: wrong route type';
  end if;

  -- The workspace of a slug comes with its partner and replaced types,
  -- and the lookup slug does not outlive the call.
  reset role;
  select slug into ws_b_slug from public.workspaces where id = 'a0000000-0000-4000-8000-000000000021';
  set local role app_runtime;
  select * into r from private.resolve_public_workspace(upper(ws_b_slug));
  if r.workspace_id is distinct from 'a0000000-0000-4000-8000-000000000021'::uuid
     or r.partner_id is distinct from 'b8c00000-0000-4000-8000-000000000001'::uuid
     or r.replaced_types is distinct from array['profile'] then
    raise exception 'public domains: resolve_public_workspace returned %', row_to_json(r);
  end if;
  if coalesce(current_setting('app.public_workspace_slug', true), '') <> '' then
    raise exception 'public domains: lookup slug outlived the call';
  end if;
  if exists (select 1 from private.resolve_public_workspace('nao-existe-cf2c'))
     or exists (select 1 from private.resolve_public_workspace('')) then
    raise exception 'public domains: unknown slug resolved';
  end if;
end $$;
-- A suspended workspace or partner domain stops resolving.
reset role;
update public.workspaces set status = 'suspended' where id = 'a0000000-0000-4000-8000-000000000021';
update public.partners set status = 'suspended' where id = 'b8c00000-0000-4000-8000-000000000001';
set local role app_runtime;
do $$
begin
  if exists (select 1 from private.resolve_public_bases(array['cartao.cf2c.test'])) then
    raise exception 'public domains: suspended partner domain resolves';
  end if;
end $$;
reset role;
do $$
declare
  ws_b_slug text;
begin
  select slug into ws_b_slug from public.workspaces where id = 'a0000000-0000-4000-8000-000000000021';
  if exists (select 1 from private.resolve_public_workspace(ws_b_slug)) then
    raise exception 'public domains: suspended workspace resolves';
  end if;
end $$;
rollback;

-- ----------------------------------------------------------------------------
-- Test 4: the domain of each tool, its reach and the context default domains
-- ----------------------------------------------------------------------------
begin;
select pg_temp.fixture();
insert into public.workspace_domains (id, host, organization_id, workspace_id, status) values
  ('c2c00000-0000-4000-8000-0000000000a1', 'cards.loja-a.cf2c.test',
   'a0000000-0000-4000-8000-000000000010', 'a0000000-0000-4000-8000-000000000011', 'active'),
  ('c2c00000-0000-4000-8000-0000000000b1', 'cards.loja-b.cf2c.test',
   'a0000000-0000-4000-8000-000000000020', 'a0000000-0000-4000-8000-000000000021', 'active');
insert into public.partner_public_domains (partner_id, route_type, host, status)
values ('b8c00000-0000-4000-8000-000000000001', 'profile', 'cartao.cf2c.test', 'active');
set local role app_runtime;
do $$
declare
  ws_a constant uuid := 'a0000000-0000-4000-8000-000000000011';
  org_a constant uuid := 'a0000000-0000-4000-8000-000000000010';
  ws_b constant uuid := 'a0000000-0000-4000-8000-000000000021';
  org_b constant uuid := 'a0000000-0000-4000-8000-000000000020';
  owner_a constant uuid := 'a0000000-0000-4000-8000-000000000031';
  viewer_a constant uuid := 'a0000000-0000-4000-8000-000000000033';
  owner_b constant uuid := 'a0000000-0000-4000-8000-000000000032';
begin
  perform pg_temp.ctx(owner_a, ws_a, org_a);
  insert into public.workspace_public_routes (workspace_id, organization_id, tool_key, route_type, domain_id, updated_by)
  values (ws_a, org_a, 'digital-profile', 'profile', 'c2c00000-0000-4000-8000-0000000000a1', owner_a);
  -- Another workspace's domain is refused by the key.
  begin
    insert into public.workspace_public_routes (workspace_id, organization_id, tool_key, route_type, domain_id, updated_by)
    values (ws_a, org_a, 'quiz', 'quiz', 'c2c00000-0000-4000-8000-0000000000b1', owner_a);
    raise exception 'public domains: tool took another workspace''s domain';
  exception when foreign_key_violation then null;
  end;
  begin
    insert into public.workspace_public_routes (workspace_id, organization_id, tool_key, route_type, domain_id, updated_by)
    values (ws_a, org_a, 'Ferramenta Inválida', 'quiz', 'c2c00000-0000-4000-8000-0000000000a1', owner_a);
    raise exception 'public domains: invalid tool key accepted';
  exception when check_violation then null;
  end;
  -- The house workspace sees no partner default domain.
  if exists (select 1 from private.context_public_bases()) then
    raise exception 'public domains: house workspace sees a partner default domain';
  end if;

  -- The viewer reads, does not choose.
  perform pg_temp.ctx(viewer_a, ws_a, org_a);
  if (select count(*) from public.workspace_public_routes) <> 1 then
    raise exception 'public domains: viewer does not read the choices';
  end if;
  begin
    insert into public.workspace_public_routes (workspace_id, organization_id, tool_key, route_type, domain_id, updated_by)
    values (ws_a, org_a, 'site', 'page', 'c2c00000-0000-4000-8000-0000000000a1', viewer_a);
    raise exception 'public domains: viewer chose a domain';
  exception when insufficient_privilege then null;
  end;

  -- Workspace B sees nothing of A, and its partner's active default domain.
  perform pg_temp.ctx(owner_b, ws_b, org_b);
  if exists (select 1 from public.workspace_public_routes) then
    raise exception 'public domains: workspace B reads workspace A choices';
  end if;
  if (select array_agg(host) from private.context_public_bases()) is distinct from array['cartao.cf2c.test'] then
    raise exception 'public domains: context default domains wrong for workspace B';
  end if;

  -- The resolver lists the tools of an active own domain.
  if (select array_agg(tool_key) from private.public_domain_routes('CARDS.loja-a.cf2c.test'))
     is distinct from array['digital-profile'] then
    raise exception 'public domains: public_domain_routes wrong';
  end if;
end $$;
-- Removing the domain removes the choice (back to the default).
reset role;
delete from public.workspace_domains where id = 'c2c00000-0000-4000-8000-0000000000a1';
do $$
begin
  if exists (select 1 from public.workspace_public_routes) then
    raise exception 'public domains: choice outlived its domain';
  end if;
end $$;
rollback;

-- ----------------------------------------------------------------------------
-- Test 5: no access for anon and authenticated
-- ----------------------------------------------------------------------------
begin;
set local role authenticated;
do $$
begin
  perform 1 from public.partner_public_domains;
  raise exception 'authenticated can read public.partner_public_domains';
exception when insufficient_privilege then
  null;
end
$$;
rollback;

begin;
set local role anon;
do $$
begin
  perform 1 from public.workspace_public_routes;
  raise exception 'anon can read public.workspace_public_routes';
exception when insufficient_privilege then
  null;
end
$$;
rollback;
