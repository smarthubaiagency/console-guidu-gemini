-- ============================================================================
-- SQL platform API keys (F4e): internal role only, own keys, immutable,
-- lookup by hash only through the definer function
--   platform owner d…003 (admin-seed), support d…002, customer a…031
-- ============================================================================

begin;
insert into public.platform_admin_members (user_id, role, status)
values ('d0000000-0000-4000-8000-000000000002', 'support', 'active')
on conflict (user_id) do update set role = 'support', status = 'active';
set local role app_runtime;
do $$
declare
  v_support uuid;
  v_owner uuid;
begin
  -- Support creates their own key.
  perform set_config('app.user_id', 'd0000000-0000-4000-8000-000000000002', true);
  insert into public.platform_api_keys (user_id, name, prefix, key_hash, scopes, expires_at)
  values ('d0000000-0000-4000-8000-000000000002', 'suporte', 'gdu_admin_aaa...', repeat('a', 64),
          array['admin:operations:read'], now() + interval '30 days')
  returning id into v_support;

  begin
    insert into public.platform_api_keys (user_id, name, prefix, key_hash, scopes, expires_at)
    values ('d0000000-0000-4000-8000-000000000003', 'alheia', 'gdu_admin_bbb...', repeat('b', 64),
            array['admin:operations:read'], now() + interval '30 days');
    raise exception 'platform keys: key created for someone else';
  exception when insufficient_privilege then null;
  end;
  begin
    insert into public.platform_api_keys (user_id, name, prefix, key_hash, scopes, expires_at)
    values ('d0000000-0000-4000-8000-000000000002', 'longa', 'gdu_admin_ccc...', repeat('c', 64),
            array['admin:operations:read'], now() + interval '120 days');
    raise exception 'platform keys: expiry beyond 90 days accepted';
  exception when insufficient_privilege or check_violation then null;
  end;
  begin
    insert into public.platform_api_keys (user_id, name, prefix, key_hash, scopes, expires_at)
    values ('d0000000-0000-4000-8000-000000000002', 'escrita', 'gdu_admin_ddd...', repeat('d', 64),
            array['admin:customers:write'], now() + interval '30 days');
    raise exception 'platform keys: unknown scope accepted';
  exception when check_violation then null;
  end;
  begin
    update public.platform_api_keys set scopes = array['admin:customers:read', 'admin:operations:read']
    where id = v_support;
    raise exception 'platform keys: scopes changed';
  exception when check_violation then null;
  end;

  -- The table is never read by hash from outside the definer function,
  -- and the function finds only platform keys.
  if (select count(*) from private.resolve_platform_api_key(repeat('a', 64))) <> 1 then
    raise exception 'platform keys: lookup by hash failed';
  end if;

  -- The platform owner sees and revokes it; a revoked key stays revoked.
  perform set_config('app.user_id', 'd0000000-0000-4000-8000-000000000003', true);
  insert into public.platform_api_keys (user_id, name, prefix, key_hash, scopes, expires_at)
  values ('d0000000-0000-4000-8000-000000000003', 'dono', 'gdu_admin_eee...', repeat('e', 64),
          array['admin:customers:read'], now() + interval '7 days')
  returning id into v_owner;
  update public.platform_api_keys set status = 'revoked', revoked_at = now() where id = v_support;
  if not found then raise exception 'platform keys: owner could not revoke'; end if;
  begin
    update public.platform_api_keys set status = 'active', revoked_at = null where id = v_support;
    raise exception 'platform keys: revoked key reactivated';
  exception when check_violation then null;
  end;

  -- Support does not see the owner's key.
  perform set_config('app.user_id', 'd0000000-0000-4000-8000-000000000002', true);
  if exists (select 1 from public.platform_api_keys where id = v_owner) then
    raise exception 'platform keys: support sees the key of another member';
  end if;

  -- A customer without an internal role sees and creates nothing.
  perform set_config('app.user_id', 'a0000000-0000-4000-8000-000000000031', true);
  if exists (select 1 from public.platform_api_keys) then
    raise exception 'platform keys: customer sees platform keys';
  end if;
  begin
    insert into public.platform_api_keys (user_id, name, prefix, key_hash, scopes, expires_at)
    values ('a0000000-0000-4000-8000-000000000031', 'cliente', 'gdu_admin_fff...', repeat('f', 64),
            array['admin:customers:read'], now() + interval '7 days');
    raise exception 'platform keys: customer created a platform key';
  exception when insufficient_privilege then null;
  end;
end
$$;
reset role;
rollback;
