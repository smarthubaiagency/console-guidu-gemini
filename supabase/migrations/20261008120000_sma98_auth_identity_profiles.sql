-- SMA-98 (F1.3): the Auth slice of `profiles`.
--
-- Contract with F1.2 (SMA-97, migration 20261008000001_core_identity_schema.sql,
-- PR #10 / SMA-137): F1.2 owns `public.profiles` and the shared `private`
-- helper schema. This migration only adds the auth-slice columns (the row
-- created on first sign-in and the status that stops an identity from
-- operating even while its JWT is still valid — specification section 8,
-- AC03) and finalises the RLS policies that gate writes on `status`.
--
-- It must never create a second, parallel helper schema (there was an
-- `app_private` here before this fix — removed, see SMA-139/SMA-131): every
-- object below lives in F1.2's `private` schema, under the same function
-- names and bodies, so the two chains converge instead of diverging.
--
-- Every statement is idempotent (`if not exists` / `create or replace` /
-- `drop ... if exists` then create) for two reasons:
--   * In the combined chain this migration always replays after F1.2's
--     (20261008000001 < 20261008120000), so `private` and `public.profiles`
--     already exist with F1.2's shape; everything here except the auth-slice
--     `alter table ... add column` statements and the policy
--     drop+recreate is then a no-op.
--   * Until SMA-97 merges, this branch's own CI applies this file alone, so
--     the `create schema if not exists` / `create table if not exists`
--     bootstrap keeps this migration self-sufficient, mirroring F1.2's base
--     shape exactly so there is nothing to reconcile once both chains land
--     together.
--
-- The profiles_*_self policy names match F1.2's exactly on purpose: dropping
-- and recreating them here, instead of adding differently-named policies,
-- keeps a single policy per action instead of two permissive policies that
-- would combine with OR and undo the status gate (SMA-135 finding 1).

create schema if not exists private authorization app_migrations;
revoke all on schema private from public, anon, authenticated;
grant usage on schema private to app_runtime;

-- Reads a uuid from the transaction-local context set by the server. Returns
-- null for an absent, empty or malformed value, so "no context" denies.
-- Body matches F1.2's definition exactly: whichever migration creates it
-- first, the other's `create or replace` changes nothing.
create or replace function private.context_uuid(setting_name text)
returns uuid
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  value text;
begin
  value := current_setting(setting_name, true);
  if value is null or value = '' then
    return null;
  end if;
  return value::uuid;
exception
  when invalid_text_representation then return null;
end
$$;

alter function private.context_uuid(text) owner to app_migrations;
revoke execute on function private.context_uuid(text) from public, anon, authenticated;
grant execute on function private.context_uuid(text) to app_runtime;

-- Keeps updated_at authoritative in the database, not in the caller. Body
-- matches F1.2's definition exactly.
create or replace function private.touch_updated_at()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end
$$;

alter function private.touch_updated_at() owner to app_migrations;
revoke execute on function private.touch_updated_at() from public, anon, authenticated;

-- Bootstrap only: F1.2 owns this table and creates it with this exact shape
-- (specification section 8 / F1.2 migration). When F1.2's migration is
-- present this is a no-op and only the auth-slice column adds below apply.
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text,
  status text not null default 'active'
    check (status in ('active', 'suspended', 'blocked')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.profiles owner to app_migrations;

-- Auth-slice columns: this migration's actual scope.
alter table public.profiles add column if not exists preferences jsonb not null default '{}'::jsonb;
alter table public.profiles add column if not exists status_reason text;
alter table public.profiles add column if not exists status_changed_at timestamptz not null default now();
alter table public.profiles add column if not exists last_sign_in_at timestamptz;

drop trigger if exists profiles_touch_updated_at on public.profiles;
create trigger profiles_touch_updated_at
  before update on public.profiles
  for each row execute function private.touch_updated_at();

alter table public.profiles enable row level security;
alter table public.profiles force row level security;

-- D1: the Data API stays closed for domain tables; only the Prisma runtime
-- role reaches `profiles`, and only through the transaction-local context.
revoke all on public.profiles from public, anon, authenticated;
grant select, insert, update on public.profiles to app_runtime;

-- SELECT is not gated on status so the server can read the row that tells it
-- the identity is blocked.
drop policy if exists profiles_select_self on public.profiles;
create policy profiles_select_self on public.profiles
  for select to app_runtime
  using (id = private.context_uuid('app.user_id'));

-- The row is created active; a non-active status is an administrative act.
drop policy if exists profiles_insert_self on public.profiles;
create policy profiles_insert_self on public.profiles
  for insert to app_runtime
  with check (
    id = private.context_uuid('app.user_id')
    and status = 'active'
  );

-- A suspended or blocked identity cannot touch its own row, so revocation
-- holds even if an application path forgets to check the status first.
-- Lifting a block is an administrative operation and will not come through
-- this policy.
drop policy if exists profiles_update_self on public.profiles;
create policy profiles_update_self on public.profiles
  for update to app_runtime
  using (
    id = private.context_uuid('app.user_id')
    and status = 'active'
  )
  with check (
    id = private.context_uuid('app.user_id')
    and status = 'active'
  );
