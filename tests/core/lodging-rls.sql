-- ============================================================================
-- SQL Portfolio lodging (F5c): accommodation types, rate plans and the
-- lodging variants that combine them
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
insert into public.portfolio_items (id, organization_id, workspace_id, item_type, title, handle, created_by)
values ('f5c00000-0000-4000-8000-0000000000b1', 'a0000000-0000-4000-8000-000000000020',
        'a0000000-0000-4000-8000-000000000021', 'lodging', 'Pousada de B', 'pousada-de-b',
        'a0000000-0000-4000-8000-000000000032');
insert into public.portfolio_accommodation_types (id, organization_id, workspace_id, item_id, title, created_by)
values ('f5c00000-0000-4000-8000-0000000000b2', 'a0000000-0000-4000-8000-000000000020',
        'a0000000-0000-4000-8000-000000000021', 'f5c00000-0000-4000-8000-0000000000b1',
        'Quarto de B', 'a0000000-0000-4000-8000-000000000032');
set local role app_runtime;
do $$
declare
  v_lodging uuid;
  v_other uuid;
  v_product uuid;
  v_type uuid;
  v_other_type uuid;
  v_plan uuid;
  v_variant uuid;
begin
  perform pg_temp.ctx('a0000000-0000-4000-8000-000000000031', 'a0000000-0000-4000-8000-000000000011',
                      'a0000000-0000-4000-8000-000000000010');

  insert into public.portfolio_items (organization_id, workspace_id, item_type, title, handle, created_by)
  values ('a0000000-0000-4000-8000-000000000010', 'a0000000-0000-4000-8000-000000000011',
          'lodging', 'Pousada', 'pousada', 'a0000000-0000-4000-8000-000000000031')
  returning id into v_lodging;
  insert into public.portfolio_items (organization_id, workspace_id, item_type, title, handle, created_by)
  values ('a0000000-0000-4000-8000-000000000010', 'a0000000-0000-4000-8000-000000000011',
          'lodging', 'Chalés', 'chales', 'a0000000-0000-4000-8000-000000000031')
  returning id into v_other;
  insert into public.portfolio_items (organization_id, workspace_id, item_type, title, handle, created_by)
  values ('a0000000-0000-4000-8000-000000000010', 'a0000000-0000-4000-8000-000000000011',
          'product', 'Camiseta', 'camiseta', 'a0000000-0000-4000-8000-000000000031')
  returning id into v_product;

  -- Owner registers types and plans of a lodging item, signing them.
  insert into public.portfolio_accommodation_types
    (organization_id, workspace_id, item_id, title, capacity, accommodation_kind, created_by)
  values ('a0000000-0000-4000-8000-000000000010', 'a0000000-0000-4000-8000-000000000011',
          v_lodging, 'Suíte casal', '{"adults": 2, "total": 3}', 'suite',
          'a0000000-0000-4000-8000-000000000031')
  returning id into v_type;
  insert into public.portfolio_accommodation_types
    (organization_id, workspace_id, item_id, title, created_by)
  values ('a0000000-0000-4000-8000-000000000010', 'a0000000-0000-4000-8000-000000000011',
          v_other, 'Chalé', 'a0000000-0000-4000-8000-000000000031')
  returning id into v_other_type;
  insert into public.portfolio_rate_plans
    (organization_id, workspace_id, item_id, title, refundability, free_cancellation_hours, created_by)
  values ('a0000000-0000-4000-8000-000000000010', 'a0000000-0000-4000-8000-000000000011',
          v_lodging, 'Flexível', 'refundable', 48, 'a0000000-0000-4000-8000-000000000031')
  returning id into v_plan;
  insert into public.portfolio_variants
    (organization_id, workspace_id, item_id, title, price_amount, accommodation_type_id, rate_plan_id, created_by)
  values ('a0000000-0000-4000-8000-000000000010', 'a0000000-0000-4000-8000-000000000011',
          v_lodging, 'Suíte casal — Flexível', 45000, v_type, v_plan,
          'a0000000-0000-4000-8000-000000000031')
  returning id into v_variant;

  -- Only lodging items have accommodation types and rate plans.
  begin
    insert into public.portfolio_rate_plans (organization_id, workspace_id, item_id, title, created_by)
    values ('a0000000-0000-4000-8000-000000000010', 'a0000000-0000-4000-8000-000000000011',
            v_product, 'Tarifa', 'a0000000-0000-4000-8000-000000000031');
    raise exception 'lodging: rate plan on a product accepted';
  exception when check_violation then null;
  end;
  begin
    insert into public.portfolio_rate_plans (organization_id, workspace_id, item_id, title, refundability, created_by)
    values ('a0000000-0000-4000-8000-000000000010', 'a0000000-0000-4000-8000-000000000011',
            v_lodging, 'Tarifa', 'maybe', 'a0000000-0000-4000-8000-000000000031');
    raise exception 'lodging: unknown refundability accepted';
  exception when check_violation then null;
  end;
  -- A variant only combines a type and a plan of its own item.
  begin
    update public.portfolio_variants set accommodation_type_id = v_other_type,
      updated_by = 'a0000000-0000-4000-8000-000000000031' where id = v_variant;
    raise exception 'lodging: variant linked to a type of another item';
  exception when foreign_key_violation then null;
  end;
  -- A type in use stays.
  begin
    delete from public.portfolio_accommodation_types where id = v_type;
    raise exception 'lodging: type in use deleted';
  exception when foreign_key_violation then null;
  end;
  begin
    update public.portfolio_accommodation_types set item_id = v_lodging,
      updated_by = 'a0000000-0000-4000-8000-000000000031' where id = v_other_type;
    raise exception 'lodging: type moved to another item';
  exception when check_violation then null;
  end;
  begin
    update public.portfolio_rate_plans set created_by = 'a0000000-0000-4000-8000-000000000033',
      updated_by = 'a0000000-0000-4000-8000-000000000031' where id = v_plan;
    raise exception 'lodging: author changed';
  exception when check_violation then null;
  end;
  begin
    update public.portfolio_rate_plans set title = 'x', updated_by = 'a0000000-0000-4000-8000-000000000033'
    where id = v_plan;
    raise exception 'lodging: edit signed by someone else';
  exception when insufficient_privilege then null;
  end;

  -- Nothing of workspace B is visible or reachable from A.
  if exists (select 1 from public.portfolio_accommodation_types
             where id = 'f5c00000-0000-4000-8000-0000000000b2') then
    raise exception 'lodging: type of another workspace visible';
  end if;
  begin
    insert into public.portfolio_rate_plans (organization_id, workspace_id, item_id, title, created_by)
    values ('a0000000-0000-4000-8000-000000000010', 'a0000000-0000-4000-8000-000000000011',
            'f5c00000-0000-4000-8000-0000000000b1', 'Intrusa', 'a0000000-0000-4000-8000-000000000031');
    raise exception 'lodging: plan attached to another workspace item';
  exception when check_violation or foreign_key_violation then null;
  end;

  -- An unused type can be removed.
  delete from public.portfolio_accommodation_types where id = v_other_type;
  if not found then raise exception 'lodging: owner cannot remove an unused type'; end if;

  -- The viewer reads but writes nothing.
  perform pg_temp.ctx('a0000000-0000-4000-8000-000000000033', 'a0000000-0000-4000-8000-000000000011',
                      'a0000000-0000-4000-8000-000000000010');
  if (select count(*) from public.portfolio_accommodation_types) <> 1
     or (select count(*) from public.portfolio_rate_plans) <> 1 then
    raise exception 'lodging: viewer cannot read';
  end if;
  begin
    insert into public.portfolio_rate_plans (organization_id, workspace_id, item_id, title, created_by)
    values ('a0000000-0000-4000-8000-000000000010', 'a0000000-0000-4000-8000-000000000011',
            v_lodging, 'Viewer', 'a0000000-0000-4000-8000-000000000033');
    raise exception 'lodging: viewer created a plan';
  exception when insufficient_privilege then null;
  end;
  delete from public.portfolio_rate_plans where id = v_plan;
  if found then raise exception 'lodging: viewer deleted a plan'; end if;
end
$$;
reset role;
rollback;
