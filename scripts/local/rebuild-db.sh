#!/bin/bash
# Banco Postgres 16 LOCAL e descartável para validar migrations, suítes SQL e
# testes de integração (porta 54333, banco `guidu`). Nunca aponta para o
# Supabase: o único banco remoto é o dev, e só via scripts/migrate.ts depois
# do PR aprovado (ADR 0010).
#
# Uso: AS_MIGRATIONS=1 bash scripts/local/rebuild-db.sh
#   AS_MIGRATIONS=1          aplica a ÚLTIMA migration como app_migrations
#   AS_MIGRATIONS=<arquivo>  aplica essa migration como app_migrations
#   (as demais são aplicadas como postgres, como no histórico do dev)
set -u
cd "$(dirname "$0")/../.."
if ! psql -h 127.0.0.1 -p 54333 -U postgres -Atc "select 1" >/dev/null 2>&1; then
  if [ ! -d /var/tmp/pgt/data ]; then mkdir -p /var/tmp/pgt && chown postgres /var/tmp/pgt && su postgres -c "/usr/lib/postgresql/16/bin/initdb -D /var/tmp/pgt/data -U postgres --auth=trust >/dev/null"; fi
  su postgres -c "/usr/lib/postgresql/16/bin/pg_ctl -D /var/tmp/pgt/data -o '-p 54333 -k /var/tmp/pgt' -l /var/tmp/pgt/log start" >/dev/null
fi
A="psql -h 127.0.0.1 -p 54333 -U postgres -v ON_ERROR_STOP=1 -q"
$A -c "drop database if exists guidu" -c "create database guidu" >/dev/null
P="$A -d guidu"
$P <<'SQL'
do $$ begin
  if not exists (select 1 from pg_roles where rolname='anon') then create role anon nologin noinherit; end if;
  if not exists (select 1 from pg_roles where rolname='authenticated') then create role authenticated nologin noinherit; end if;
  if not exists (select 1 from pg_roles where rolname='service_role') then create role service_role nologin noinherit bypassrls; end if;
  if not exists (select 1 from pg_roles where rolname='app_migrations') then create role app_migrations nologin noinherit; end if;
  if not exists (select 1 from pg_roles where rolname='app_runtime') then create role app_runtime login nosuperuser nocreatedb nocreaterole noinherit nobypassrls password 'runtime'; end if;
end $$;
grant app_migrations to postgres;
grant app_runtime to postgres;
grant usage, create on schema public to app_migrations;
grant usage on schema public to app_runtime, anon, authenticated;
alter default privileges for role postgres in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges for role app_migrations in schema public grant all on tables to anon, authenticated, service_role;
create schema if not exists auth;
create table auth.users (instance_id uuid, id uuid primary key, aud text, role text, email text, encrypted_password text, email_confirmed_at timestamptz, raw_app_meta_data jsonb, raw_user_meta_data jsonb, created_at timestamptz default now(), updated_at timestamptz default now());
create type auth.factor_type as enum ('totp', 'webauthn', 'phone');
create type auth.factor_status as enum ('unverified', 'verified');
create table auth.mfa_factors (id uuid primary key, user_id uuid not null, friendly_name text, factor_type auth.factor_type not null, status auth.factor_status not null, created_at timestamptz not null, updated_at timestamptz not null, secret text);
create or replace function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
SQL
LAST=$(ls supabase/migrations/*.sql | sort | tail -1)
for f in $(ls supabase/migrations/*.sql | sort); do b=$(basename $f); [[ "$b" < "20261008" ]] && continue;
  if [[ -n "$AS_MIGRATIONS" && ( "$b" == "$AS_MIGRATIONS" || ( "$AS_MIGRATIONS" == "1" && "$f" == "$LAST" ) ) ]]; then
    (echo "begin; set role app_migrations;"; cat $f; echo "reset role; commit;") | $P >/dev/null || echo "FAIL(as app_migrations) $b"
  else $P -1 -f $f >/dev/null || echo "FAIL $b"; fi; done
psql -h 127.0.0.1 -p 54333 -U postgres -d guidu -q -c "alter role app_worker login password 'worker'" >/dev/null 2>&1
for f in tests/core/seed.sql tests/core/membership-seed.sql tests/core/admin-seed.sql tests/auth/seed.sql tests/core/audit-seed.sql; do $P -f $f >/dev/null || echo "SEED FAIL $f"; done
# Mesmas suítes SQL do job `db` do CI, na mesma ordem.
for f in $(grep -oE -- '--file tests/[^ ]+\.sql' .github/workflows/ci.yml | awk '{print $2}' | grep -v seed); do
  [ -f "$f" ] || continue
  $P -f "$f" >/dev/null 2>/tmp/guidu-sql.err && echo "PASS $f" || { echo "FAIL $f"; grep -m3 -E "ERROR|CONTEXT" /tmp/guidu-sql.err; }
done
