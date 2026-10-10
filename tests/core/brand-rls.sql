-- ============================================================================
-- SQL Partner Brand RLS (ADR 0012, plano P3)
-- Table: partner_brands
--
-- Executed as migration administrator. Each block prepares its fixtures as
-- administrator, switches to `app_runtime` with `set local role` and rolls
-- back. Fixtures: tests/core/seed.sql, membership-seed.sql, admin-seed.sql.
--   house partner 00000000-0000-4000-8000-000000000000
--   test partner  b0000000-0000-4000-8000-000000000001 (created per block)
--   platform owner d…003 (active, role owner)
--   userA a…031 (no platform role)
-- ============================================================================

-- ----------------------------------------------------------------------------
-- Test 1: brands are readable only for the context partner, even signed out
-- ----------------------------------------------------------------------------
begin;
insert into public.partners (id, slug, name)
values ('b0000000-0000-4000-8000-000000000001', 'agencia-b', 'Agência B');
insert into public.partner_brands (partner_id, version, display_name) values
  ('00000000-0000-4000-8000-000000000000', 1, 'GUIDU'),
  ('b0000000-0000-4000-8000-000000000001', 1, 'Agência B');
set local role app_runtime;
do $$
begin
  if (select count(*) from public.partner_brands) <> 0 then
    raise exception 'brands: visible without partner context';
  end if;
  perform set_config('app.partner_id', '00000000-0000-4000-8000-000000000000', true);
  if (select array_agg(display_name) from public.partner_brands)
     is distinct from array['GUIDU'] then
    raise exception 'brands: house context must see only the house brand';
  end if;
end
$$;
rollback;

-- ----------------------------------------------------------------------------
-- Test 2: only platform owner/operations insert, for the context partner
-- ----------------------------------------------------------------------------
begin;
insert into public.partners (id, slug, name)
values ('b0000000-0000-4000-8000-000000000001', 'agencia-b', 'Agência B');
select set_config('app.partner_id', '00000000-0000-4000-8000-000000000000', true);
set local role app_runtime;
do $$
begin
  -- Regular user: denied.
  perform set_config('app.user_id', 'a0000000-0000-4000-8000-000000000031', true);
  begin
    insert into public.partner_brands (partner_id, version, display_name, created_by)
    values ('00000000-0000-4000-8000-000000000000', 1, 'X',
            'a0000000-0000-4000-8000-000000000031');
    raise exception 'brands: regular user inserted a brand';
  exception when insufficient_privilege then
    null;
  end;

  -- Platform owner: allowed for the context partner.
  perform set_config('app.user_id', 'd0000000-0000-4000-8000-000000000003', true);
  insert into public.partner_brands (partner_id, version, display_name, primary_color, created_by)
  values ('00000000-0000-4000-8000-000000000000', 1, 'GUIDU', '#1976d2',
          'd0000000-0000-4000-8000-000000000003');

  -- Platform owner: denied for a partner other than the context one.
  begin
    insert into public.partner_brands (partner_id, version, display_name, created_by)
    values ('b0000000-0000-4000-8000-000000000001', 1, 'Agência B',
            'd0000000-0000-4000-8000-000000000003');
    raise exception 'brands: inserted for a partner outside the context';
  exception when insufficient_privilege then
    null;
  end;

  -- Platform owner: denied when created_by impersonates someone else.
  begin
    insert into public.partner_brands (partner_id, version, display_name, created_by)
    values ('00000000-0000-4000-8000-000000000000', 2, 'GUIDU',
            'a0000000-0000-4000-8000-000000000031');
    raise exception 'brands: created_by did not match app.user_id';
  exception when insufficient_privilege then
    null;
  end;

  -- History is append-only.
  begin
    update public.partner_brands set display_name = 'Y';
    raise exception 'brands: app_runtime could update';
  exception when insufficient_privilege then
    null;
  end;
  begin
    delete from public.partner_brands;
    raise exception 'brands: app_runtime could delete';
  exception when insufficient_privilege then
    null;
  end;
end
$$;
rollback;

-- ----------------------------------------------------------------------------
-- Test 3: column checks reject unsafe values
-- ----------------------------------------------------------------------------
do $$
begin
  begin
    insert into public.partner_brands (partner_id, version, display_name, primary_color)
    values ('00000000-0000-4000-8000-000000000000', 90, 'X', 'red;}body{');
    raise exception 'brands: accepted an invalid color';
  exception when check_violation then
    null;
  end;
  begin
    insert into public.partner_brands (partner_id, version, display_name, logo, logo_mime)
    values ('00000000-0000-4000-8000-000000000000', 91, 'X', '\x3c737667'::bytea, 'image/svg+xml');
    raise exception 'brands: accepted an SVG logo';
  exception when check_violation then
    null;
  end;
  begin
    insert into public.partner_brands (partner_id, version, display_name, logo, logo_mime)
    values ('00000000-0000-4000-8000-000000000000', 92, 'X',
            decode(repeat('00', 262145), 'hex'), 'image/png');
    raise exception 'brands: accepted a logo over 256 KiB';
  exception when check_violation then
    null;
  end;
  begin
    insert into public.partner_brands (partner_id, version, display_name, support_url)
    values ('00000000-0000-4000-8000-000000000000', 93, 'X', 'javascript:alert(1)');
    raise exception 'brands: accepted a non-https support URL';
  exception when check_violation then
    null;
  end;
end
$$;

-- ----------------------------------------------------------------------------
-- Test 4: no access for anon and authenticated
-- ----------------------------------------------------------------------------
begin;
set local role authenticated;
do $$
begin
  perform 1 from public.partner_brands;
  raise exception 'authenticated can read public.partner_brands';
exception when insufficient_privilege then
  null;
end
$$;
rollback;
