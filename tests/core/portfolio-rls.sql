-- ============================================================================
-- SQL Portfolio (F5a): workspace locations, items and variants
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
values ('f5a00000-0000-4000-8000-0000000000b1', 'a0000000-0000-4000-8000-000000000020',
        'a0000000-0000-4000-8000-000000000021', 'product', 'Item de B', 'item-de-b',
        'a0000000-0000-4000-8000-000000000032');
set local role app_runtime;
do $$
declare
  v_location uuid;
  v_item uuid;
  v_variant uuid;
begin
  perform pg_temp.ctx('a0000000-0000-4000-8000-000000000031', 'a0000000-0000-4000-8000-000000000011',
                      'a0000000-0000-4000-8000-000000000010');

  -- Owner manages locations.
  insert into public.workspace_locations (organization_id, workspace_id, name, created_by)
  values ('a0000000-0000-4000-8000-000000000010', 'a0000000-0000-4000-8000-000000000011',
          'Loja Centro', 'a0000000-0000-4000-8000-000000000031')
  returning id into v_location;
  begin
    insert into public.workspace_locations (organization_id, workspace_id, name, latitude, created_by)
    values ('a0000000-0000-4000-8000-000000000010', 'a0000000-0000-4000-8000-000000000011',
            'Sem longitude', -23.5, 'a0000000-0000-4000-8000-000000000031');
    raise exception 'portfolio: latitude without longitude accepted';
  exception when check_violation then null;
  end;

  -- Owner creates an item and its variants, signing them.
  insert into public.portfolio_items (organization_id, workspace_id, item_type, title, handle, created_by)
  values ('a0000000-0000-4000-8000-000000000010', 'a0000000-0000-4000-8000-000000000011',
          'product', 'Camiseta', 'camiseta', 'a0000000-0000-4000-8000-000000000031')
  returning id into v_item;
  insert into public.portfolio_variants
    (organization_id, workspace_id, item_id, title, sku, price_amount, created_by)
  values ('a0000000-0000-4000-8000-000000000010', 'a0000000-0000-4000-8000-000000000011',
          v_item, 'Azul', 'CAM-AZ', 4990, 'a0000000-0000-4000-8000-000000000031')
  returning id into v_variant;

  begin
    insert into public.portfolio_items (organization_id, workspace_id, item_type, title, handle, created_by)
    values ('a0000000-0000-4000-8000-000000000010', 'a0000000-0000-4000-8000-000000000011',
            'product', 'Outra', 'camiseta', 'a0000000-0000-4000-8000-000000000031');
    raise exception 'portfolio: duplicated handle accepted';
  exception when unique_violation then null;
  end;
  begin
    insert into public.portfolio_variants
      (organization_id, workspace_id, item_id, title, sku, created_by)
    values ('a0000000-0000-4000-8000-000000000010', 'a0000000-0000-4000-8000-000000000011',
            v_item, 'Repetida', 'CAM-AZ', 'a0000000-0000-4000-8000-000000000031');
    raise exception 'portfolio: duplicated SKU accepted';
  exception when unique_violation then null;
  end;
  begin
    update public.portfolio_variants set price_amount = 6000, list_price_amount = 5000,
      updated_by = 'a0000000-0000-4000-8000-000000000031' where id = v_variant;
    raise exception 'portfolio: list price below price accepted';
  exception when check_violation then null;
  end;
  begin
    insert into public.portfolio_items (organization_id, workspace_id, item_type, title, handle, created_by)
    values ('a0000000-0000-4000-8000-000000000010', 'a0000000-0000-4000-8000-000000000011',
            'vehicle', 'Carro', 'carro', 'a0000000-0000-4000-8000-000000000031');
    raise exception 'portfolio: unknown item type accepted';
  exception when check_violation then null;
  end;
  begin
    update public.portfolio_items set created_by = 'a0000000-0000-4000-8000-000000000033',
      updated_by = 'a0000000-0000-4000-8000-000000000031' where id = v_item;
    raise exception 'portfolio: author changed';
  exception when check_violation then null;
  end;
  begin
    update public.portfolio_variants set item_id = 'f5a00000-0000-4000-8000-0000000000b1',
      updated_by = 'a0000000-0000-4000-8000-000000000031' where id = v_variant;
    raise exception 'portfolio: variant moved to another item';
  exception when check_violation or foreign_key_violation then null;
  end;
  begin
    update public.portfolio_items set title = 'x', updated_by = 'a0000000-0000-4000-8000-000000000033'
    where id = v_item;
    raise exception 'portfolio: edit signed by someone else';
  exception when insufficient_privilege then null;
  end;
  begin
    delete from public.portfolio_items where id = v_item;
    raise exception 'portfolio: item deleted';
  exception when insufficient_privilege then null;
  end;

  -- Nothing of workspace B is visible or reachable from A.
  if exists (select 1 from public.portfolio_items where id = 'f5a00000-0000-4000-8000-0000000000b1') then
    raise exception 'portfolio: item of another workspace visible';
  end if;
  begin
    insert into public.portfolio_variants (organization_id, workspace_id, item_id, title, created_by)
    values ('a0000000-0000-4000-8000-000000000010', 'a0000000-0000-4000-8000-000000000011',
            'f5a00000-0000-4000-8000-0000000000b1', 'Intrusa', 'a0000000-0000-4000-8000-000000000031');
    raise exception 'portfolio: variant attached to another workspace item';
  exception when foreign_key_violation then null;
  end;

  -- The viewer reads but writes nothing.
  perform pg_temp.ctx('a0000000-0000-4000-8000-000000000033', 'a0000000-0000-4000-8000-000000000011',
                      'a0000000-0000-4000-8000-000000000010');
  if (select count(*) from public.portfolio_items) <> 1
     or (select count(*) from public.portfolio_variants) <> 1
     or (select count(*) from public.workspace_locations) <> 1 then
    raise exception 'portfolio: viewer cannot read';
  end if;
  begin
    insert into public.portfolio_items (organization_id, workspace_id, item_type, title, handle, created_by)
    values ('a0000000-0000-4000-8000-000000000010', 'a0000000-0000-4000-8000-000000000011',
            'product', 'Viewer', 'viewer', 'a0000000-0000-4000-8000-000000000033');
    raise exception 'portfolio: viewer created an item';
  exception when insufficient_privilege then null;
  end;
  begin
    insert into public.workspace_locations (organization_id, workspace_id, name, created_by)
    values ('a0000000-0000-4000-8000-000000000010', 'a0000000-0000-4000-8000-000000000011',
            'Viewer', 'a0000000-0000-4000-8000-000000000033');
    raise exception 'portfolio: viewer created a location';
  exception when insufficient_privilege then null;
  end;
  delete from public.portfolio_variants where id = v_variant;
  if found then raise exception 'portfolio: viewer deleted a variant'; end if;
  update public.workspace_locations set name = 'x', updated_by = 'a0000000-0000-4000-8000-000000000033'
  where id = v_location;
  if found then raise exception 'portfolio: viewer edited a location'; end if;
end
$$;
reset role;
rollback;
