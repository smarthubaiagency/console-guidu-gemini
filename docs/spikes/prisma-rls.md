# Prisma + RLS + Supavisor spike (SMA-92)

Status: **SQL-level isolation proven; local CI now reconstructs the database and
validates Prisma/RLS without credentials from the hosted `guidu` project**.

## Continuous integration (SMA-113)

`.github/workflows/ci.yml` runs on every pull request and push to `main`, using
fixed Node 24.10.0 and Supabase CLI 2.110.0 versions.

- `quality` restores the npm cache, generates Prisma Client, typechecks, and
  runs tests that do not require database URLs. There is no lint step because
  this repository has no lint script or configuration yet.
- `db` starts Supabase locally with its transaction-mode pooler, runs
  `supabase db reset`, creates an ephemeral password for `app_runtime`, and
  derives the API URL, anonymous key, and administrator database URL from
  `supabase status`. It never reads a hosted Supabase secret.
- The database job loads the two-workspace synthetic fixtures, executes
  `tests/prisma-rls/rls.sql`, then runs the Prisma suite through both the local
  transaction pool and a direct connection. Its preflight requires
  `current_user = 'app_runtime'` and `rolbypassrls = false`; the remaining tests
  cover cross-workspace access, missing/malformed context, pool reuse,
  rollback, concurrency, the composite foreign key, and closed Data API access.
- The pool URL carries `pgbouncer=true`, so Prisma disables prepared statements
  for the local transaction pool just as it must for hosted Supavisor.

Playwright and deployment remain outside this workflow. Hosted-only Supavisor
validation also remains manual: use port 6543, the project-qualified
`app_runtime.<project-ref>` username, and `pgbouncer=true`. The local CI is the
required gate and does not fall back to `guidu`.

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
Vitest discovers 10 integration checks. The suite now asserts `current_user =
'app_runtime'` before exercising RLS so an administrative connection cannot
produce misleading isolation results.

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

## External validation attempt (2026-10-07)

The registered secrets were injected and the suite ran against the dev project.
Sanitized inspection showed that both URLs authenticate as
`postgres.mmwmhlafzewdyqsgfkzk` through the pooler. `DATABASE_URL` uses port
6543 without `pgbouncer=true`; `DIRECT_DATABASE_URL` uses the pooler host on
port 5432. Both returned both tenants because the hosted `postgres` role has
`BYPASSRLS`, and the concurrency run also reached SQLSTATE `26000` from prepared
statements in transaction pooling. `SUPABASE_URL` and `SUPABASE_ANON_KEY` were
not present, so Data API stayed skipped. This is a credential/configuration
failure, not proof of an `app_runtime` policy leak. No JWT alternative was
implemented.

## Hosted validation still pending

The following claims are **not yet proven** and must not be inferred from the
passing SQL checks:

1. Prisma connects as `app_runtime` through direct Postgres and through
   Supavisor transaction mode.
2. Sixty alternating parallel Prisma transactions do not leak context.
3. A forced rollback and subsequent pooled request do not retain context.
4. PostgREST HTTP calls for both `anon` and an authenticated user are denied.
5. Transaction overhead (baseline transaction versus five `set_config` calls)
   has not been measured.

To rerun against hosted Supavisor, replace both URLs with `app_runtime`
credentials. The pool URL
must use `app_runtime.mmwmhlafzewdyqsgfkzk`, port 6543, and `pgbouncer=true`;
the direct URL must authenticate as `app_runtime` against the direct database
endpoint. Also register `SUPABASE_URL`, `SUPABASE_ANON_KEY`, and an authenticated
test flow. Then rerun the suite and measure transaction overhead.

## Cleanup

`20261007225959_remove_prisma_rls_spike.sql` is ready but deliberately not
applied. It removes only the `spike_%` tables and `spike_private` schema; roles
remain because role removal needs a separate ownership/membership audit.

