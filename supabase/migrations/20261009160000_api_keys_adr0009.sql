-- ============================================================================
-- Migration: 20261009160000_api_keys_adr0009.sql
-- Module: Platform API Keys & MCP Token Authentication (ADR 0009, Spec §15, §17.3)
--
-- Maintenance Rationale:
-- 1. Adds `revoked_at timestamptz null` column to record the exact moment of revocation.
-- 2. Converts legacy synthetic API keys from `read` to `['workspace:read', 'modules:read']`.
-- 3. Sets column default to `array['workspace:read', 'modules:read']::text[]`.
-- 4. Enforces check constraint `api_keys_scopes_catalog_check` validating scopes belong
--    to the §17.3 catalog (workspace:read, modules:read, usage:read, executions:read,
--    members:read, proposals:write) and cardinality > 0.
-- 5. Enforces check constraint `api_keys_expires_at_check` (expires_at > created_at and
--    expires_at <= created_at + interval '365 days').
-- 6. Grants SELECT to `app_rls_helper` and creates minimal helper policy `api_keys_helper_select`.
-- 7. Creates `private.resolve_api_key(p_key_hash text)` (SECURITY DEFINER, owned by
--    `app_rls_helper`, search_path = '', EXECUTE granted strictly to `app_runtime`)
--    for secure single-key lookup by SHA-256 hash without prior workspace context.
-- 8. Ensures table ownership is `app_migrations` with ENABLE and FORCE ROW LEVEL SECURITY.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Column: revoked_at
-- ----------------------------------------------------------------------------
alter table public.api_keys
  add column if not exists revoked_at timestamptz null;

-- ----------------------------------------------------------------------------
-- 2. Convert Synthetic / Legacy Data
-- ----------------------------------------------------------------------------
-- Temporarily lift FORCE RLS so table owner app_migrations can convert synthetic rows
alter table public.api_keys no force row level security;
alter table public.api_keys disable row level security;

update public.api_keys
set scopes = array['workspace:read', 'modules:read']::text[]
where scopes = array['read']::text[] or 'read' = any(scopes);

alter table public.api_keys enable row level security;
alter table public.api_keys force row level security;

-- ----------------------------------------------------------------------------
-- 3. Update Column Default Scopes
-- ----------------------------------------------------------------------------
alter table public.api_keys
  alter column scopes set default array['workspace:read', 'modules:read']::text[];

-- ----------------------------------------------------------------------------
-- 4. Check Constraints
-- ----------------------------------------------------------------------------
alter table public.api_keys
  drop constraint if exists api_keys_scopes_catalog_check;

alter table public.api_keys
  add constraint api_keys_scopes_catalog_check
  check (
    scopes <@ array[
      'workspace:read',
      'modules:read',
      'usage:read',
      'executions:read',
      'members:read',
      'proposals:write'
    ]::text[]
    and cardinality(scopes) > 0
  );

alter table public.api_keys
  drop constraint if exists api_keys_expires_at_check;

alter table public.api_keys
  add constraint api_keys_expires_at_check
  check (
    expires_at > created_at
    and expires_at <= created_at + interval '365 days'
  );

-- ----------------------------------------------------------------------------
-- 5. Permissions and Helper Policy for app_rls_helper
-- ----------------------------------------------------------------------------
grant select on public.api_keys to app_rls_helper;

drop policy if exists api_keys_helper_select on public.api_keys;

create policy api_keys_helper_select on public.api_keys
  for select to app_rls_helper
  using (
    key_hash = current_setting('app.api_key_hash', true)
  );

-- ----------------------------------------------------------------------------
-- 6. Secure Lookup Function: private.resolve_api_key
-- ----------------------------------------------------------------------------
create or replace function private.resolve_api_key(p_key_hash text)
returns table (
  id uuid,
  user_id uuid,
  workspace_id uuid,
  organization_id uuid,
  scopes text[],
  status text,
  expires_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_key_hash is null or p_key_hash = '' then
    return;
  end if;

  perform set_config('app.api_key_hash', p_key_hash, true);
  return query
  select
    k.id,
    k.user_id,
    k.workspace_id,
    k.organization_id,
    k.scopes,
    k.status,
    k.expires_at
  from public.api_keys k
  where k.key_hash = p_key_hash;
end;
$$;

revoke all on function private.resolve_api_key(text) from public, anon, authenticated;
grant execute on function private.resolve_api_key(text) to app_runtime;

alter function private.resolve_api_key(text) owner to app_rls_helper;

-- ----------------------------------------------------------------------------
-- 7. Table Ownership and RLS Enforcement
-- ----------------------------------------------------------------------------
alter table public.api_keys owner to app_migrations;
alter table public.api_keys enable row level security;
alter table public.api_keys force row level security;
