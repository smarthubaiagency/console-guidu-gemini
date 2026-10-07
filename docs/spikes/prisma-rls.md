# Prisma + RLS + Supavisor spike (SMA-92)

Status: **partially proven; Prisma connection validation is blocked on a missing
`app_runtime` password/connection secrets**.

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
Vitest discovers 10 integration checks, but correctly skips them without the
three connection/API environment variables.

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

## Remaining validation / explicit blocker

The following claims are **not yet proven** and must not be inferred from the
passing SQL checks:

1. Prisma connects as `app_runtime` through direct Postgres and through
   Supavisor transaction mode.
2. Sixty alternating parallel Prisma transactions do not leak context.
3. A forced rollback and subsequent pooled request do not retain context.
4. PostgREST HTTP calls for both `anon` and an authenticated user are denied.
5. Transaction overhead (baseline transaction versus five `set_config` calls)
   has not been measured.

Required unblock: provision an `app_runtime` password without committing it,
then register `DATABASE_URL`, `DIRECT_DATABASE_URL`, `SUPABASE_URL`, and
`SUPABASE_ANON_KEY` for the assigned agent/CI. An authenticated test token or a
safe test-user sign-in flow is also required for the authenticated PostgREST
request. Run `npm run test:spike` afterward and record latency samples here.

## Cleanup

`20261007225959_remove_prisma_rls_spike.sql` is ready but deliberately not
applied. It removes only the `spike_%` tables and `spike_private` schema; roles
remain because role removal needs a separate ownership/membership audit.

