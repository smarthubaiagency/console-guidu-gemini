-- ============================================================================
-- SQL Partner RLS (ADR 0012, plano P2)
-- Tables: partners, partner_domains, organizations.partner_id
-- Helpers: current_partner_id, resolve_partner_host, resolve_workspace_slug,
--          list_user_workspaces
--
-- Executed as migration administrator. Each block prepares its own partner
-- fixtures as administrator, switches to `app_runtime` with `set local role`
-- and rolls back, so the shared seed stays untouched.
-- Fixtures: tests/core/seed.sql.
--   userA a…031 owner of org A / workspace A
--   userB a…032 owner of org B / workspace B
--   house partner 00000000-0000-4000-8000-000000000000
--   test partner  b0000000-0000-4000-8000-000000000001 (created per block)
-- ============================================================================

-- ----------------------------------------------------------------------------
-- Test 1: house partner seeded once; existing organizations belong to it
-- ----------------------------------------------------------------------------
do $$
begin
  if (select count(*) from public.partners where is_house) <> 1 then
    raise exception 'partners: expected exactly one house partner';
  end if;
  if exists (
    select 1 from public.organizations
    where partner_id <> '00000000-0000-4000-8000-000000000000'
  ) then
    raise exception 'partners: seed organization outside the house partner';
  end if;
  begin
    insert into public.partners (id, slug, name, is_house)
    values ('b0000000-0000-4000-8000-0000000000aa', 'second-house', 'Second', true);
    raise exception 'partners: a second house partner was accepted';
  exception when unique_violation then
    null;
  end;
end
$$;

-- ----------------------------------------------------------------------------
-- Test 2: app_runtime reads only the context partner and never writes
-- ----------------------------------------------------------------------------
begin;
insert into public.partners (id, slug, name)
values ('b0000000-0000-4000-8000-000000000001', 'agencia-b', 'Agência B');
insert into public.partner_domains (host, partner_id, kind, status)
values ('app.agencia-b.com.br', 'b0000000-0000-4000-8000-000000000001', 'custom', 'active');
set local role app_runtime;
do $$
begin
  if (select count(*) from public.partners) <> 0 then
    raise exception 'partners: rows visible without partner context';
  end if;
  if (select count(*) from public.partner_domains) <> 0 then
    raise exception 'partner_domains: rows visible without partner context';
  end if;

  perform set_config('app.partner_id', '00000000-0000-4000-8000-000000000000', true);
  if (select count(*) from public.partners) <> 1
     or (select id from public.partners) <> '00000000-0000-4000-8000-000000000000' then
    raise exception 'partners: house context must see only the house partner';
  end if;
  if (select count(*) from public.partner_domains) <> 0 then
    raise exception 'partner_domains: house context saw another partner domain';
  end if;

  perform set_config('app.partner_id', 'b0000000-0000-4000-8000-000000000001', true);
  if (select count(*) from public.partner_domains) <> 1 then
    raise exception 'partner_domains: partner could not read its own domain';
  end if;

  begin
    update public.partners set name = 'x';
    raise exception 'partners: app_runtime could update';
  exception when insufficient_privilege then
    null;
  end;
  begin
    insert into public.partner_domains (host, partner_id, kind)
    values ('evil.example.com', 'b0000000-0000-4000-8000-000000000001', 'custom');
    raise exception 'partner_domains: app_runtime could insert';
  exception when insufficient_privilege then
    null;
  end;
end
$$;
rollback;

-- ----------------------------------------------------------------------------
-- Test 3: the application cannot move an organization to another partner
-- ----------------------------------------------------------------------------
begin;
insert into public.partners (id, slug, name)
values ('b0000000-0000-4000-8000-000000000001', 'agencia-b', 'Agência B');
select set_config('app.user_id', 'a0000000-0000-4000-8000-000000000031', true),
       set_config('app.workspace_id', 'a0000000-0000-4000-8000-000000000011', true),
       set_config('app.organization_id', 'a0000000-0000-4000-8000-000000000010', true),
       set_config('app.partner_id', '00000000-0000-4000-8000-000000000000', true);
set local role app_runtime;
do $$
begin
  -- The owner may still update other columns.
  update public.organizations set name = 'Organization A'
  where id = 'a0000000-0000-4000-8000-000000000010';

  begin
    update public.organizations
    set partner_id = 'b0000000-0000-4000-8000-000000000001'
    where id = 'a0000000-0000-4000-8000-000000000010';
    raise exception 'organizations: app_runtime changed partner_id';
  exception when insufficient_privilege then
    -- 42501 is also the RLS error code; insist on the trigger's message.
    if sqlerrm not like '%partner_id cannot be changed%' then
      raise;
    end if;
  end;
end
$$;
rollback;

-- ----------------------------------------------------------------------------
-- Test 4: host resolver returns only active domains of active partners
-- ----------------------------------------------------------------------------
begin;
insert into public.partners (id, slug, name, status) values
  ('b0000000-0000-4000-8000-000000000001', 'agencia-b', 'Agência B', 'active'),
  ('b0000000-0000-4000-8000-000000000002', 'agencia-c', 'Agência C', 'suspended');
insert into public.partner_domains (host, partner_id, kind, status) values
  ('app.agencia-b.com.br', 'b0000000-0000-4000-8000-000000000001', 'custom', 'active'),
  ('novo.agencia-b.com.br', 'b0000000-0000-4000-8000-000000000001', 'custom', 'pending'),
  ('app.agencia-c.com.br', 'b0000000-0000-4000-8000-000000000002', 'custom', 'active');
set local role app_runtime;
do $$
begin
  if (select partner_id from private.resolve_partner_host('APP.Agencia-B.com.br'))
     is distinct from 'b0000000-0000-4000-8000-000000000001'::uuid then
    raise exception 'resolver: active domain did not resolve';
  end if;
  if (select count(*) from private.resolve_partner_host('novo.agencia-b.com.br')) <> 0 then
    raise exception 'resolver: pending domain resolved';
  end if;
  if (select count(*) from private.resolve_partner_host('app.agencia-c.com.br')) <> 0 then
    raise exception 'resolver: domain of a suspended partner resolved';
  end if;
  if (select count(*) from private.resolve_partner_host('unknown.example.com')) <> 0 then
    raise exception 'resolver: unknown host resolved';
  end if;
end
$$;
rollback;

-- ----------------------------------------------------------------------------
-- Test 5: workspace resolution and listing are partner-bound
-- ----------------------------------------------------------------------------
begin;
insert into public.partners (id, slug, name)
values ('b0000000-0000-4000-8000-000000000001', 'agencia-b', 'Agência B');
-- Administrator moves org B to the test partner (the trigger only blocks
-- app_runtime).
update public.organizations
set partner_id = 'b0000000-0000-4000-8000-000000000001'
where id = 'a0000000-0000-4000-8000-000000000020';
select set_config('app.user_id', 'a0000000-0000-4000-8000-000000000032', true);
set local role app_runtime;
do $$
begin
  if (select count(*) from private.resolve_workspace_slug('workspace-b')) <> 0 then
    raise exception 'slug: resolved without partner context';
  end if;
  if (select count(*) from private.list_user_workspaces()) <> 0 then
    raise exception 'list: listed without partner context';
  end if;

  perform set_config('app.partner_id', '00000000-0000-4000-8000-000000000000', true);
  if (select count(*) from private.resolve_workspace_slug('workspace-b')) <> 0 then
    raise exception 'slug: house host resolved a workspace of another partner';
  end if;
  if (select count(*) from private.list_user_workspaces()) <> 0 then
    raise exception 'list: house host listed a workspace of another partner';
  end if;

  perform set_config('app.partner_id', 'b0000000-0000-4000-8000-000000000001', true);
  if (select workspace_id from private.resolve_workspace_slug('workspace-b'))
     is distinct from 'a0000000-0000-4000-8000-000000000021'::uuid then
    raise exception 'slug: partner host could not resolve its own workspace';
  end if;
  if (select array_agg(workspace_slug) from private.list_user_workspaces())
     is distinct from array['workspace-b'] then
    raise exception 'list: partner host did not list its own workspace';
  end if;
end
$$;
rollback;

-- ----------------------------------------------------------------------------
-- Test 6: no execution or table access for anon and authenticated
-- ----------------------------------------------------------------------------
begin;
set local role authenticated;
do $$
begin
  begin
    perform private.resolve_partner_host('app.agencia-b.com.br');
    raise exception 'authenticated can execute private.resolve_partner_host';
  exception when insufficient_privilege then
    null;
  end;
  begin
    perform 1 from public.partners;
    raise exception 'authenticated can read public.partners';
  exception when insufficient_privilege then
    null;
  end;
end
$$;
rollback;
