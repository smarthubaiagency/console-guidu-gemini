-- ============================================================================
-- SQL security settings (CF5a): `public.ip_allowlists`, `private.ip_allowed`
-- and `private.security_events`.
--   platform: d…003 owner, d…002 billing, d…005 support (per block)
--   partner B b7…005 (per block): d…006 partner_admin, d…004 partner_support;
--     org B a…020 moves to partner B
--   another partner b7…006 without members
-- Each block prepares its fixtures as administrator, switches to
-- `app_runtime` with `set local role` and rolls back.
-- ============================================================================

create or replace function pg_temp.ctx(p_user uuid, p_partner uuid default null)
returns void
language sql as $$
  select set_config('app.user_id', p_user::text, true),
         set_config('app.principal_type', 'user', true),
         set_config('app.workspace_id', '', true),
         set_config('app.organization_id', '', true),
         set_config('app.partner_id', coalesce(p_partner::text, ''), true);
$$;

create or replace function pg_temp.fixture() returns void
language sql as $$
  insert into public.partners (id, slug, name) values
    ('b7000000-0000-4000-8000-000000000005', 'agencia-cf5', 'Agência CF5'),
    ('b7000000-0000-4000-8000-000000000006', 'outra-cf5', 'Outra CF5');
  insert into public.partner_members (partner_id, user_id, email, role) values
    ('b7000000-0000-4000-8000-000000000005', 'd0000000-0000-4000-8000-000000000006', 'admin@cf5.test', 'partner_admin'),
    ('b7000000-0000-4000-8000-000000000005', 'd0000000-0000-4000-8000-000000000004', 'sup@cf5.test', 'partner_support');
  insert into public.platform_admin_members (user_id, role, status) values
    ('d0000000-0000-4000-8000-000000000002', 'billing', 'active'),
    ('d0000000-0000-4000-8000-000000000005', 'support', 'active')
  on conflict (user_id) do update set role = excluded.role, status = 'active';
  update public.organizations set partner_id = 'b7000000-0000-4000-8000-000000000005'
  where id = 'a0000000-0000-4000-8000-000000000020';
$$;

-- ----------------------------------------------------------------------------
-- Test 1: the /platform list belongs to platform owner and operations
-- ----------------------------------------------------------------------------
begin;
select pg_temp.fixture();
set local role app_runtime;
do $$
begin
  perform pg_temp.ctx('d0000000-0000-4000-8000-000000000003');
  insert into public.ip_allowlists (area, entries, updated_by)
  values ('platform', array['203.0.113.0/24', '2001:db8::/32']::cidr[],
          'd0000000-0000-4000-8000-000000000003');
  update public.ip_allowlists set entries = array['203.0.113.7/32']::cidr[]
  where area = 'platform';
  if not found then raise exception 'ip_allowlists: platform owner could not edit'; end if;

  -- Area and partner never change.
  begin
    update public.ip_allowlists set area = 'admin';
    raise exception 'ip_allowlists: area changed';
  exception when insufficient_privilege then null;
  end;

  -- Bad addresses and empty lists never reach the table.
  begin
    insert into public.ip_allowlists (area, entries, updated_by)
    values ('platform', array['999.1.1.1']::cidr[], 'd0000000-0000-4000-8000-000000000003');
    raise exception 'ip_allowlists: invalid address accepted';
  exception when invalid_text_representation then null;
  end;
  begin
    update public.ip_allowlists set entries = array[]::cidr[] where area = 'platform';
    raise exception 'ip_allowlists: empty list accepted';
  exception when check_violation then null;
  end;

  -- Billing and support neither read nor write it.
  perform pg_temp.ctx('d0000000-0000-4000-8000-000000000002');
  if exists (select 1 from public.ip_allowlists) then
    raise exception 'ip_allowlists: platform billing reads the list';
  end if;
  delete from public.ip_allowlists;
  if found then raise exception 'ip_allowlists: platform billing deleted the list'; end if;
  perform pg_temp.ctx('d0000000-0000-4000-8000-000000000005');
  begin
    insert into public.ip_allowlists (area, entries, updated_by)
    values ('platform', array['10.0.0.0/8']::cidr[], 'd0000000-0000-4000-8000-000000000005');
    raise exception 'ip_allowlists: platform support wrote a list';
  exception when insufficient_privilege or unique_violation then null;
  end;

  -- A partner manager never touches the /platform list.
  perform pg_temp.ctx('d0000000-0000-4000-8000-000000000006', 'b7000000-0000-4000-8000-000000000005');
  if exists (select 1 from public.ip_allowlists where area = 'platform') then
    raise exception 'ip_allowlists: partner reads the platform list';
  end if;
end $$;
rollback;

-- ----------------------------------------------------------------------------
-- Test 2: the /admin list of a partner belongs to its owner and admin
-- ----------------------------------------------------------------------------
begin;
select pg_temp.fixture();
set local role app_runtime;
do $$
begin
  perform pg_temp.ctx('d0000000-0000-4000-8000-000000000006', 'b7000000-0000-4000-8000-000000000005');
  insert into public.ip_allowlists (area, partner_id, entries, updated_by)
  values ('admin', 'b7000000-0000-4000-8000-000000000005', array['198.51.100.0/24']::cidr[],
          'd0000000-0000-4000-8000-000000000006');

  -- Another partner's list, a list without partner or signed as someone
  -- else is refused.
  begin
    insert into public.ip_allowlists (area, partner_id, entries, updated_by)
    values ('admin', 'b7000000-0000-4000-8000-000000000006', array['10.0.0.0/8']::cidr[],
            'd0000000-0000-4000-8000-000000000006');
    raise exception 'ip_allowlists: list of another partner written';
  exception when insufficient_privilege then null;
  end;
  begin
    insert into public.ip_allowlists (area, entries, updated_by)
    values ('admin', array['10.0.0.0/8']::cidr[], 'd0000000-0000-4000-8000-000000000006');
    raise exception 'ip_allowlists: admin list without partner';
  exception when insufficient_privilege or check_violation then null;
  end;
  begin
    update public.ip_allowlists set updated_by = 'd0000000-0000-4000-8000-000000000004';
    raise exception 'ip_allowlists: signed as someone else';
  exception when insufficient_privilege then null;
  end;

  -- Support neither reads nor changes it.
  perform pg_temp.ctx('d0000000-0000-4000-8000-000000000004', 'b7000000-0000-4000-8000-000000000005');
  if exists (select 1 from public.ip_allowlists) then
    raise exception 'ip_allowlists: partner support reads the list';
  end if;
  delete from public.ip_allowlists;
  if found then raise exception 'ip_allowlists: partner support deleted the list'; end if;

  -- The platform does not manage partner lists.
  perform pg_temp.ctx('d0000000-0000-4000-8000-000000000003');
  if exists (select 1 from public.ip_allowlists where area = 'admin') then
    raise exception 'ip_allowlists: platform reads a partner list';
  end if;
end $$;
rollback;

-- ----------------------------------------------------------------------------
-- Test 3: the guard answers per area, never with the list
-- ----------------------------------------------------------------------------
begin;
select pg_temp.fixture();
insert into public.ip_allowlists (area, partner_id, entries, updated_by) values
  ('platform', null, array['203.0.113.0/24', '2001:db8::/32']::cidr[], 'd0000000-0000-4000-8000-000000000003'),
  ('admin', 'b7000000-0000-4000-8000-000000000005', array['198.51.100.7/32']::cidr[], 'd0000000-0000-4000-8000-000000000006');
set local role app_runtime;
do $$
begin
  perform pg_temp.ctx('a0000000-0000-4000-8000-000000000033');
  if not private.ip_allowed('platform', null, '203.0.113.9') then
    raise exception 'ip_allowed: address of the platform list refused';
  end if;
  if not private.ip_allowed('platform', null, '2001:db8::1') then
    raise exception 'ip_allowed: IPv6 address of the platform list refused';
  end if;
  if private.ip_allowed('platform', null, '192.0.2.1') then
    raise exception 'ip_allowed: address outside the platform list allowed';
  end if;
  if private.ip_allowed('platform', null, null) then
    raise exception 'ip_allowed: unknown address allowed under a list';
  end if;
  if not private.ip_allowed('admin', 'b7000000-0000-4000-8000-000000000005', '198.51.100.7') then
    raise exception 'ip_allowed: address of the partner list refused';
  end if;
  if private.ip_allowed('admin', 'b7000000-0000-4000-8000-000000000005', '203.0.113.9') then
    raise exception 'ip_allowed: platform list leaked into the partner area';
  end if;
  -- No list: no restriction, even without an address.
  if not private.ip_allowed('admin', 'b7000000-0000-4000-8000-000000000006', null) then
    raise exception 'ip_allowed: partner without list refused';
  end if;
  if exists (select 1 from public.ip_allowlists) then
    raise exception 'ip_allowlists: a customer reads the lists';
  end if;
end $$;
rollback;

-- ----------------------------------------------------------------------------
-- Test 4: security events, all for the platform, theirs for the partner
-- ----------------------------------------------------------------------------
begin;
select pg_temp.fixture();
insert into public.audit_events
  (id, actor_user_id, actor_principal_type, origin, action, resource_type, result, metadata, organization_id)
values
  ('c5000000-0000-4000-8000-000000000001', 'd0000000-0000-4000-8000-000000000006', 'user', 'app',
   'auth.sign_in', 'session', 'success', '{"partnerId": "b7000000-0000-4000-8000-000000000005"}', null),
  ('c5000000-0000-4000-8000-000000000002', 'a0000000-0000-4000-8000-000000000032', 'user', 'app',
   'workspace_members.role_changed', 'workspace_member', 'success', '{}',
   'a0000000-0000-4000-8000-000000000020'),
  ('c5000000-0000-4000-8000-000000000003', 'a0000000-0000-4000-8000-000000000031', 'user', 'app',
   'auth.sign_in', 'session', 'success', '{"partnerId": "b7000000-0000-4000-8000-000000000006"}', null),
  ('c5000000-0000-4000-8000-000000000004', 'a0000000-0000-4000-8000-000000000032', 'user', 'app',
   'crm.contact.create', 'crm_contact', 'success', '{}', 'a0000000-0000-4000-8000-000000000020'),
  ('c5000000-0000-4000-8000-000000000005', 'd0000000-0000-4000-8000-000000000006', 'user', 'admin',
   'partner.settings.save', 'settings', 'success',
   '{"partnerId": "b7000000-0000-4000-8000-000000000005", "fields": ["security.mfa.app"]}', null),
  ('c5000000-0000-4000-8000-000000000006', 'd0000000-0000-4000-8000-000000000006', 'user', 'admin',
   'partner.settings.save', 'settings', 'success',
   '{"partnerId": "b7000000-0000-4000-8000-000000000005", "fields": ["region.currency"]}', null);
set local role app_runtime;
do $$
declare
  v_ids text;
begin
  -- Platform owner and support read every security event, nothing else.
  perform pg_temp.ctx('d0000000-0000-4000-8000-000000000003');
  select string_agg(right(id::text, 1), ',' order by id) into v_ids
  from private.security_events(null, null, 200) where id::text like 'c5000000%';
  if v_ids is distinct from '1,2,3,5' then
    raise exception 'security_events: platform owner got %', v_ids;
  end if;
  perform pg_temp.ctx('d0000000-0000-4000-8000-000000000005');
  if (select count(*) from private.security_events(null, null, 200) where id::text like 'c5000000%') <> 4 then
    raise exception 'security_events: platform support misses events';
  end if;

  -- The page cursor and the limit.
  if (select count(*) from private.security_events(now() - interval '1 hour', null, 200)
      where id::text like 'c5000000%') <> 0 then
    raise exception 'security_events: cursor ignored';
  end if;
  if (select count(*) from private.security_events(null, null, 1)) <> 1 then
    raise exception 'security_events: limit ignored';
  end if;

  -- Platform billing reads none.
  perform pg_temp.ctx('d0000000-0000-4000-8000-000000000002');
  if exists (select 1 from private.security_events(null, null, 200)) then
    raise exception 'security_events: platform billing reads events';
  end if;

  -- The partner admin reads its own and its customers' events.
  perform pg_temp.ctx('d0000000-0000-4000-8000-000000000006', 'b7000000-0000-4000-8000-000000000005');
  select string_agg(right(id::text, 1), ',' order by id) into v_ids
  from private.security_events(null, null, 200);
  if v_ids is distinct from '1,2,5' then
    raise exception 'security_events: partner admin got %', v_ids;
  end if;

  -- Partner support and a partner it does not belong to read none.
  perform pg_temp.ctx('d0000000-0000-4000-8000-000000000004', 'b7000000-0000-4000-8000-000000000005');
  if exists (select 1 from private.security_events(null, null, 200)) then
    raise exception 'security_events: partner support reads events';
  end if;
  perform pg_temp.ctx('d0000000-0000-4000-8000-000000000006', 'b7000000-0000-4000-8000-000000000006');
  if exists (select 1 from private.security_events(null, null, 200)) then
    raise exception 'security_events: events of a partner without membership';
  end if;

  -- The table itself stays without reads.
  begin
    perform 1 from public.audit_events;
    raise exception 'audit_events: app_runtime reads the table';
  exception when insufficient_privilege then null;
  end;
end $$;
rollback;

-- ----------------------------------------------------------------------------
-- Test (AJ1): the page cursor is (occurred_at, id); events of the same
-- instant are never skipped
-- ----------------------------------------------------------------------------
begin;
select pg_temp.fixture();
insert into public.audit_events
  (id, actor_user_id, actor_principal_type, origin, action, resource_type, result, metadata, occurred_at)
values
  ('c5a00000-0000-4000-8000-000000000001', 'd0000000-0000-4000-8000-000000000006', 'user', 'app',
   'auth.sign_in', 'session', 'success', '{}', '2026-10-01 12:00:00.123456+00'),
  ('c5a00000-0000-4000-8000-000000000002', 'd0000000-0000-4000-8000-000000000006', 'user', 'app',
   'auth.sign_in', 'session', 'success', '{}', '2026-10-01 12:00:00.123456+00'),
  ('c5a00000-0000-4000-8000-000000000003', 'd0000000-0000-4000-8000-000000000006', 'user', 'app',
   'auth.sign_in', 'session', 'success', '{}', '2026-10-01 12:00:00.123789+00');
set local role app_runtime;
do $$
declare
  v_ids text;
begin
  perform pg_temp.ctx('d0000000-0000-4000-8000-000000000003');
  -- Newest first, the id breaks the tie.
  select string_agg(right(id::text, 1), ',') into v_ids
  from private.security_events('2026-10-01 12:00:01+00', null, 200) where id::text like 'c5a00000%';
  if v_ids is distinct from '3,2,1' then
    raise exception 'security_events: order %', v_ids;
  end if;
  -- After the row 3 (same millisecond, other microseconds): 2 and 1.
  select string_agg(right(id::text, 1), ',') into v_ids
  from private.security_events('2026-10-01 12:00:00.123789+00', 'c5a00000-0000-4000-8000-000000000003', 200)
  where id::text like 'c5a00000%';
  if v_ids is distinct from '2,1' then
    raise exception 'security_events: microseconds cursor got %', v_ids;
  end if;
  -- After the row 2 (same instant): only 1.
  select string_agg(right(id::text, 1), ',') into v_ids
  from private.security_events('2026-10-01 12:00:00.123456+00', 'c5a00000-0000-4000-8000-000000000002', 200)
  where id::text like 'c5a00000%';
  if v_ids is distinct from '1' then
    raise exception 'security_events: tie cursor got %', v_ids;
  end if;
  -- The two-argument version is gone.
  begin
    perform 1 from private.security_events(null::timestamptz, 10);
    raise exception 'security_events: the two-argument version still exists';
  exception when undefined_function then null;
  end;
end $$;
rollback;
