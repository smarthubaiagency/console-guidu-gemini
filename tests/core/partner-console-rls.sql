-- ============================================================================
-- SQL Partner Console RLS (ADR 0012, plano P4a)
-- Tables: partner_members, partner_invitations, partners (management),
--         partner_domains (management), organizations (partner read),
--         partner_brands (partner roles)
--
-- Executed as migration administrator. Each block prepares its fixtures as
-- administrator, switches to `app_runtime` with `set local role` and rolls
-- back. Fixtures: tests/core/seed.sql, membership-seed.sql, admin-seed.sql.
--   partner B  b0000000-0000-4000-8000-000000000001 (created per block)
--   d…004 partner_owner of B           d…005 partner_admin of B
--   d…006 not a member                 d…003 platform owner
--   (none of d…004–d…006 belongs to a company, so company reads come only
--   from the partner policy)
-- ============================================================================

-- Shared fixture, recreated inside each transaction.
create or replace function pg_temp.partner_fixture() returns void
language sql as $$
  insert into public.partners (id, slug, name)
  values ('b0000000-0000-4000-8000-000000000001', 'agencia-b', 'Agência B');
  insert into public.partner_members (partner_id, user_id, email, role) values
    ('b0000000-0000-4000-8000-000000000001', 'd0000000-0000-4000-8000-000000000004', 'owner@b.test', 'partner_owner'),
    ('b0000000-0000-4000-8000-000000000001', 'd0000000-0000-4000-8000-000000000005', 'admin@b.test', 'partner_admin');
  update public.organizations
  set partner_id = 'b0000000-0000-4000-8000-000000000001'
  where id = 'a0000000-0000-4000-8000-000000000020';
$$;

-- ----------------------------------------------------------------------------
-- Test 1: current_partner_role follows context, membership and partner status
-- ----------------------------------------------------------------------------
begin;
select pg_temp.partner_fixture();
set local role app_runtime;
do $$
begin
  perform set_config('app.user_id', 'd0000000-0000-4000-8000-000000000004', true);
  if private.current_partner_role() is not null then
    raise exception 'role: resolved without partner context';
  end if;
  perform set_config('app.partner_id', '00000000-0000-4000-8000-000000000000', true);
  if private.current_partner_role() is not null then
    raise exception 'role: owner of B has a role in the house partner';
  end if;
  perform set_config('app.partner_id', 'b0000000-0000-4000-8000-000000000001', true);
  if private.current_partner_role() is distinct from 'partner_owner' then
    raise exception 'role: owner of B not recognised';
  end if;
  perform set_config('app.user_id', 'd0000000-0000-4000-8000-000000000006', true);
  if private.current_partner_role() is not null then
    raise exception 'role: non-member got a role';
  end if;
end
$$;
reset role;
update public.partners set status = 'suspended'
where id = 'b0000000-0000-4000-8000-000000000001';
set local role app_runtime;
do $$
begin
  perform set_config('app.user_id', 'd0000000-0000-4000-8000-000000000004', true);
  if private.current_partner_role() is not null then
    raise exception 'role: suspended partner still grants a role';
  end if;
end
$$;
rollback;

-- ----------------------------------------------------------------------------
-- Test 2: members and companies visible only inside the partner
-- ----------------------------------------------------------------------------
begin;
select pg_temp.partner_fixture();
select set_config('app.partner_id', 'b0000000-0000-4000-8000-000000000001', true);
set local role app_runtime;
do $$
begin
  perform set_config('app.user_id', 'd0000000-0000-4000-8000-000000000005', true);
  if (select count(*) from public.partner_members) <> 2 then
    raise exception 'members: partner admin must see both members of B';
  end if;
  if (select array_agg(id) from public.organizations)
     is distinct from array['a0000000-0000-4000-8000-000000000020'::uuid] then
    raise exception 'organizations: partner member must see exactly the companies of B';
  end if;
  if (select count(*) from public.workspaces) <> 0 then
    raise exception 'workspaces: partner role exposed workspace data';
  end if;

  perform set_config('app.user_id', 'd0000000-0000-4000-8000-000000000006', true);
  if (select count(*) from public.partner_members) <> 0 then
    raise exception 'members: non-member saw partner members';
  end if;
end
$$;
rollback;

-- ----------------------------------------------------------------------------
-- Test 3: who may invite
-- ----------------------------------------------------------------------------
begin;
select pg_temp.partner_fixture();
select set_config('app.partner_id', 'b0000000-0000-4000-8000-000000000001', true);
set local role app_runtime;
do $$
begin
  -- partner_owner of the context partner: allowed.
  perform set_config('app.user_id', 'd0000000-0000-4000-8000-000000000004', true);
  insert into public.partner_invitations (partner_id, email, role, token_hash, expires_at, invited_by)
  values ('b0000000-0000-4000-8000-000000000001', 'novo@b.test', 'partner_support',
          repeat('a', 64), now() + interval '1 day', 'd0000000-0000-4000-8000-000000000004');

  -- invited_by must be the caller.
  begin
    insert into public.partner_invitations (partner_id, email, role, token_hash, expires_at, invited_by)
    values ('b0000000-0000-4000-8000-000000000001', 'x@b.test', 'partner_support',
            repeat('b', 64), now() + interval '1 day', 'd0000000-0000-4000-8000-000000000005');
    raise exception 'invitations: invited_by impersonation accepted';
  exception when insufficient_privilege then null;
  end;

  -- partner_admin: denied.
  perform set_config('app.user_id', 'd0000000-0000-4000-8000-000000000005', true);
  begin
    insert into public.partner_invitations (partner_id, email, role, token_hash, expires_at, invited_by)
    values ('b0000000-0000-4000-8000-000000000001', 'y@b.test', 'partner_owner',
            repeat('c', 64), now() + interval '1 day', 'd0000000-0000-4000-8000-000000000005');
    raise exception 'invitations: partner_admin could invite';
  exception when insufficient_privilege then null;
  end;

  -- Platform owner, outside any partner context: allowed.
  perform set_config('app.partner_id', '', true);
  perform set_config('app.user_id', 'd0000000-0000-4000-8000-000000000003', true);
  insert into public.partner_invitations (partner_id, email, role, token_hash, expires_at, invited_by)
  values ('b0000000-0000-4000-8000-000000000001', 'dono@b.test', 'partner_owner',
          repeat('d', 64), now() + interval '1 day', 'd0000000-0000-4000-8000-000000000003');
end
$$;
rollback;

-- ----------------------------------------------------------------------------
-- Test 4: joining requires the matching invitation token, email and role
-- ----------------------------------------------------------------------------
begin;
select pg_temp.partner_fixture();
insert into public.partner_invitations (partner_id, email, role, token_hash, expires_at, invited_by) values
  ('b0000000-0000-4000-8000-000000000001', 'c@b.test', 'partner_finance',
   repeat('e', 64), now() + interval '1 day', 'd0000000-0000-4000-8000-000000000004'),
  ('b0000000-0000-4000-8000-000000000001', 'c@b.test', 'partner_finance',
   repeat('f', 64), now() - interval '1 minute', 'd0000000-0000-4000-8000-000000000004');
select set_config('app.user_id', 'd0000000-0000-4000-8000-000000000006', true);
set local role app_runtime;
do $$
begin
  -- No token in context.
  begin
    insert into public.partner_members (partner_id, user_id, email, role)
    values ('b0000000-0000-4000-8000-000000000001', 'd0000000-0000-4000-8000-000000000006', 'c@b.test', 'partner_finance');
    raise exception 'join: accepted without token';
  exception when insufficient_privilege then null;
  end;

  -- Expired token.
  perform set_config('app.partner_invitation_token_hash', repeat('f', 64), true);
  begin
    insert into public.partner_members (partner_id, user_id, email, role)
    values ('b0000000-0000-4000-8000-000000000001', 'd0000000-0000-4000-8000-000000000006', 'c@b.test', 'partner_finance');
    raise exception 'join: accepted an expired invitation';
  exception when insufficient_privilege then null;
  end;

  perform set_config('app.partner_invitation_token_hash', repeat('e', 64), true);
  -- Escalating the role.
  begin
    insert into public.partner_members (partner_id, user_id, email, role)
    values ('b0000000-0000-4000-8000-000000000001', 'd0000000-0000-4000-8000-000000000006', 'c@b.test', 'partner_owner');
    raise exception 'join: escalated the invited role';
  exception when insufficient_privilege then null;
  end;
  -- Another email.
  begin
    insert into public.partner_members (partner_id, user_id, email, role)
    values ('b0000000-0000-4000-8000-000000000001', 'd0000000-0000-4000-8000-000000000006', 'outro@b.test', 'partner_finance');
    raise exception 'join: accepted another email';
  exception when insufficient_privilege then null;
  end;

  -- Valid join, then the invitation is marked accepted by the same user.
  insert into public.partner_members (partner_id, user_id, email, role)
  values ('b0000000-0000-4000-8000-000000000001', 'd0000000-0000-4000-8000-000000000006', 'c@b.test', 'partner_finance');
  update public.partner_invitations
  set status = 'accepted', accepted_by = 'd0000000-0000-4000-8000-000000000006'
  where token_hash = repeat('e', 64);
  if not found then
    raise exception 'join: invitation could not be marked accepted';
  end if;
end
$$;
rollback;

-- ----------------------------------------------------------------------------
-- Test 5: managing members, partners, domains and brands
-- ----------------------------------------------------------------------------
begin;
select pg_temp.partner_fixture();
select set_config('app.partner_id', 'b0000000-0000-4000-8000-000000000001', true);
set local role app_runtime;
do $$
begin
  -- partner_owner changes another member, never their own row.
  perform set_config('app.user_id', 'd0000000-0000-4000-8000-000000000004', true);
  update public.partner_members set role = 'partner_support'
  where user_id = 'd0000000-0000-4000-8000-000000000005';
  if not found then raise exception 'members: owner could not change a member'; end if;
  update public.partner_members set role = 'partner_support'
  where user_id = 'd0000000-0000-4000-8000-000000000004';
  if found then raise exception 'members: owner changed their own row'; end if;

  -- partner_owner cannot manage partners or domains.
  begin
    insert into public.partner_domains (host, partner_id, kind)
    values ('app.agencia-b.com.br', 'b0000000-0000-4000-8000-000000000001', 'custom');
    raise exception 'domains: partner owner added a domain';
  exception when insufficient_privilege then null;
  end;

  -- partner_owner saves the partner brand; a support member cannot.
  insert into public.partner_brands (partner_id, version, display_name, created_by)
  values ('b0000000-0000-4000-8000-000000000001', 1, 'Agência B',
          'd0000000-0000-4000-8000-000000000004');
  perform set_config('app.user_id', 'd0000000-0000-4000-8000-000000000005', true);
  begin
    insert into public.partner_brands (partner_id, version, display_name, created_by)
    values ('b0000000-0000-4000-8000-000000000001', 2, 'X',
            'd0000000-0000-4000-8000-000000000005');
    raise exception 'brands: partner_support saved a brand';
  exception when insufficient_privilege then null;
  end;

  -- Platform owner manages partners and domains, never the house partner.
  perform set_config('app.partner_id', '', true);
  perform set_config('app.user_id', 'd0000000-0000-4000-8000-000000000003', true);
  insert into public.partners (id, slug, name)
  values ('b0000000-0000-4000-8000-000000000002', 'agencia-c', 'Agência C');
  insert into public.partner_domains (host, partner_id, kind)
  values ('app.agencia-c.com.br', 'b0000000-0000-4000-8000-000000000002', 'custom');
  update public.partners set status = 'suspended'
  where id = '00000000-0000-4000-8000-000000000000';
  if found then raise exception 'partners: house partner was updated'; end if;
  begin
    insert into public.partners (id, slug, name, is_house)
    values ('b0000000-0000-4000-8000-000000000003', 'casa-2', 'Casa 2', true);
    raise exception 'partners: created a house partner';
  exception when insufficient_privilege then null;
  end;

  -- A regular user manages nothing.
  perform set_config('app.user_id', 'd0000000-0000-4000-8000-000000000006', true);
  begin
    insert into public.partners (id, slug, name)
    values ('b0000000-0000-4000-8000-000000000004', 'agencia-d', 'Agência D');
    raise exception 'partners: regular user created a partner';
  exception when insufficient_privilege then null;
  end;
end
$$;
rollback;
