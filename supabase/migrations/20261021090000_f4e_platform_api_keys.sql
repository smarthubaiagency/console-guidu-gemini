-- ============================================================================
-- Migration: 20261021090000_f4e_platform_api_keys.sql
-- Module: F4e — Platform API and MCP keys (Especificação §15, §17.3, AC09)
--
-- Maintenance Rationale:
-- 1. `public.platform_api_keys`: administrative keys (`gdu_admin_…`) of an
--    internal role member, stored only as a SHA-256 hash. They live apart
--    from the workspace keys (`public.api_keys`), so a platform key is
--    never found by the workspace lookup and never reaches a workspace
--    route (AC09).
-- 2. Scopes: `admin:customers:read` (minimal commercial data) and
--    `admin:operations:read` (health and failed jobs, no customer content).
--    No administrative writes in this phase.
-- 3. The member creates their own keys with an active internal role (MFA
--    is checked by the service); expiry is mandatory, up to 90 days. The
--    member revokes their own; the platform owner revokes any. A trigger
--    keeps everything immutable except revocation and the last use.
-- 4. `private.resolve_platform_api_key(hash)`: lookup by hash without a
--    prior context, security definer owned by app_rls_helper, for
--    app_runtime only.
-- Owner app_migrations, ENABLE + FORCE RLS, no grants to anon/authenticated.
-- ============================================================================

create table public.platform_api_keys (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references public.profiles(id) on delete cascade,
  name         text not null check (length(btrim(name)) between 1 and 80),
  prefix       text not null check (length(prefix) between 8 and 32),
  key_hash     text not null unique check (key_hash ~ '^[0-9a-f]{64}$'),
  scopes       text[] not null
    check (
      scopes <@ array['admin:customers:read', 'admin:operations:read']::text[]
      and cardinality(scopes) > 0
    ),
  status       text not null default 'active' check (status in ('active', 'revoked')),
  expires_at   timestamptz not null,
  last_used_at timestamptz,
  revoked_at   timestamptz,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  check (expires_at > created_at and expires_at <= created_at + interval '90 days 5 minutes'),
  check ((status = 'revoked') = (revoked_at is not null))
);

create index platform_api_keys_user_idx on public.platform_api_keys (user_id, created_at desc);

alter table public.platform_api_keys owner to app_migrations;
revoke all on public.platform_api_keys from public, anon, authenticated;
alter table public.platform_api_keys enable row level security;
alter table public.platform_api_keys force row level security;

create trigger platform_api_keys_touch_updated_at
  before update on public.platform_api_keys
  for each row execute function private.touch_updated_at();

create function private.platform_api_keys_guard_update()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if new.id is distinct from old.id
     or new.user_id is distinct from old.user_id
     or new.name is distinct from old.name
     or new.prefix is distinct from old.prefix
     or new.key_hash is distinct from old.key_hash
     or new.scopes is distinct from old.scopes
     or new.expires_at is distinct from old.expires_at
     or new.created_at is distinct from old.created_at then
    raise exception 'platform api keys: only revocation and last use may change'
      using errcode = 'check_violation';
  end if;
  if old.status = 'revoked' and new.status <> 'revoked' then
    raise exception 'platform api keys: a revoked key stays revoked'
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

alter function private.platform_api_keys_guard_update() owner to app_migrations;
revoke execute on function private.platform_api_keys_guard_update() from public, anon, authenticated;

create trigger platform_api_keys_guard_update
  before update on public.platform_api_keys
  for each row execute function private.platform_api_keys_guard_update();

-- The member sees their own keys; the platform owner sees all of them.
create policy platform_api_keys_select on public.platform_api_keys
  for select to app_runtime
  using (
    private.current_platform_admin_role() is not null
    and (
      user_id = private.context_uuid('app.user_id')
      or private.current_platform_admin_role() = 'owner'
    )
  );

create policy platform_api_keys_insert on public.platform_api_keys
  for insert to app_runtime
  with check (
    user_id = private.context_uuid('app.user_id')
    and private.current_platform_admin_role() is not null
    and status = 'active' and revoked_at is null and last_used_at is null
    and expires_at > now() and expires_at <= now() + interval '90 days 5 minutes'
  );

-- Revocation (own key, or any key by the platform owner) and the last use
-- recorded by the request authenticated with the key.
create policy platform_api_keys_update on public.platform_api_keys
  for update to app_runtime
  using (
    private.current_platform_admin_role() is not null
    and (
      user_id = private.context_uuid('app.user_id')
      or private.current_platform_admin_role() = 'owner'
    )
  )
  with check (
    private.current_platform_admin_role() is not null
    and (
      user_id = private.context_uuid('app.user_id')
      or private.current_platform_admin_role() = 'owner'
    )
  );

grant select, insert, update on public.platform_api_keys to app_runtime;

-- Lookup by hash for the definer function only.
grant select on public.platform_api_keys to app_rls_helper;

create policy platform_api_keys_helper_select on public.platform_api_keys
  for select to app_rls_helper
  using (key_hash = current_setting('app.platform_api_key_hash', true));

set local role app_rls_helper;

create function private.resolve_platform_api_key(p_key_hash text)
returns table (
  id uuid,
  user_id uuid,
  scopes text[],
  status text,
  expires_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_key_hash is null or p_key_hash !~ '^[0-9a-f]{64}$' then
    return;
  end if;
  perform set_config('app.platform_api_key_hash', p_key_hash, true);
  return query
  select k.id, k.user_id, k.scopes, k.status, k.expires_at
  from public.platform_api_keys k
  where k.key_hash = p_key_hash;
end;
$$;

revoke all on function private.resolve_platform_api_key(text) from public, anon, authenticated;
grant execute on function private.resolve_platform_api_key(text) to app_runtime;

reset role;
