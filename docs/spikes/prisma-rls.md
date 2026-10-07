# Prisma + RLS + Supavisor spike (SMA-92)

Status: **SQL-level isolation and Prisma runtime identity proven; external
Supavisor validation remains blocked because the port 6543 secret omits
`pgbouncer=true` and Prisma receives SQLSTATE `26000`**.

## Environment and versions

- Supabase dev project: `guidu` (`mmwmhlafzewdyqsgfkzk`, sa-east-1).
- Hosted PostgreSQL: 17.6 (queried from the dev project).
- Prisma Client/CLI: 6.12.0.
- Vitest: 5.0.3; TypeScript: 5.9.3; Node used during authoring: 24.21.0.
- Supavisor transaction URL must use port 6543, username
  `app_runtime.mmwmhlafzewdyqsgfkzk`, and `pgbouncer=true` so Prisma disables
  prepared statements.

## Result so far

The migrations were applied to the empty dev project and the fixtures contain
two synthetic organizations, workspaces, users, and notes. SQL checks executed
as `set local role app_runtime` proved:

- workspace A sees only note A and workspace B sees only note B;
- an allowed same-workspace insert succeeds inside a rolled-back transaction;
- a cross-workspace insert fails with SQLSTATE `42501` (RLS);
- missing and malformed context both return zero rows without a UUID cast error;
- a mismatched `(workspace_id, organization_id)` fails with SQLSTATE `23503`
  (the composite FK), proving AC05 independently of RLS;
- `anon` and `authenticated` have no table grants on any `spike_%` table;
- all domain tables have RLS enabled and FORCE RLS; the membership lookup table
  intentionally omits FORCE so the fixed-search-path security-definer helper can
  perform its non-recursive lookup;
- all tables are owned by `app_migrations`, while `app_runtime` is LOGIN,
  NOSUPERUSER, NOCREATEDB, NOCREATEROLE, NOBYPASSRLS, and owns no table.

The TypeScript helper uses an interactive Prisma transaction and parameterized
`set_config(..., true)` calls. Static generation and strict typecheck pass.
Vitest discovers 11 integration checks. The suite now asserts both `current_user =
'app_runtime'` and `rolbypassrls = false` on the pool and port 5432 connection
before exercising RLS, so an administrative connection cannot produce misleading
isolation results.

## Hosted Supabase differences discovered

The hosted `postgres` role is not a superuser, but reports CREATEROLE and
BYPASSRLS and can create the two custom roles. A role cannot receive ownership
of an object in `public` unless it has CREATE on that schema. Therefore the base
migration grants `app_migrations` CREATE in `public`, creates the objects as the
hosted migration administrator, and transfers ownership. `app_runtime` receives
only schema usage, helper execution, read access to the two lookup tables, and
CRUD on the test domain table. A follow-up immutable migration grants
`app_runtime` membership to `postgres` solely so migration/QA sessions can use
`SET ROLE` for RLS tests; it grants no privilege to runtime.

Passwords cannot safely live in a migration. The `app_runtime` role therefore
has LOGIN but no committed password. A strong password must be provisioned and
stored as Paperclip secrets for `DATABASE_URL` and `DIRECT_DATABASE_URL` before
the remaining suite can run.

## External validation attempts (2026-10-07)

The first registered secret version authenticated as the hosted `postgres` role
and was rejected as invalid evidence. After credentials v2 were registered, the
mandatory preflight passed on both URLs: `current_user = app_runtime` and
`rolbypassrls = false`. Basic pooled and port 5432 reads, cross-workspace denial,
missing/malformed context, and the composite FK checks passed.

The resumed run found 6 passing, 4 failing, and 1 skipped test. The failures were
all on the port 6543 Supavisor path: pool reuse, rollback cleanup, 60 concurrent
alternating requests, and overhead measurement reached SQLSTATE `26000`
(`prepared statement ... does not exist`). Sanitized URL inspection confirmed
that `DATABASE_URL` uses port 6543 but has no `pgbouncer=true`; per operator
direction, the run stopped without modifying or overriding the secret. The
provided `DIRECT_DATABASE_URL` uses the Supavisor host on port 5432 rather than
the direct database hostname, although its runtime identity preflight and direct
test cases passed.

`SUPABASE_URL` and `SUPABASE_ANON_KEY` remain absent, so the PostgREST test is
explicitly skipped. Those are the exact names expected by
`tests/prisma-rls/data-api.test.ts`; the second may contain a compatible anon
or publishable key used as the `apikey` header. No JWT alternative was
implemented.

## Remaining validation / explicit blocker

Marcelo must update `GUIDU_DEV_DATABASE_URL` so the injected `DATABASE_URL` on
port 6543 includes `pgbouncer=true`. Then rerun the four currently failing pool
checks and capture the overhead measurement. For a literal direct-Postgres proof,
`GUIDU_DEV_DIRECT_DATABASE_URL` must use the project direct database endpoint
rather than the Supavisor host on port 5432.

The Data API check remains pending until `SUPABASE_URL` and
`SUPABASE_ANON_KEY` are registered. The current HTTP test proves anonymous
access is denied; an authenticated-user HTTP scenario still requires an
authorized synthetic auth flow or token and remains outside this run.

## Cleanup

`20261007225959_remove_prisma_rls_spike.sql` is ready but deliberately not
applied. It removes only the `spike_%` tables and `spike_private` schema; roles
remain because role removal needs a separate ownership/membership audit.

