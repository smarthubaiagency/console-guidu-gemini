# Prisma + RLS + Supavisor spike (SMA-92)

Status: **Spike concluído: isolamento SQL e Prisma comprovado nas conexões Supavisor Transaction (6543) e Session (5432); 11/11 testes automatizados passaram**.

## Continuous integration (SMA-113)

`.github/workflows/ci.yml` runs on every pull request and push to `main`, using fixed Node 24.10.0 and Supabase CLI 2.110.0 versions.

- `quality` generates Prisma Client, typechecks and runs Vitest without database credentials. Every database suite is reported as skipped with the missing variable names; the job cannot present those suites as passing.
- `db` starts isolated local Supabase, runs every migration from zero with `supabase db reset`, generates an ephemeral password for `app_runtime`, and obtains the direct database and Data API values from `supabase status`. It never reads a hosted secret.
- `db` sets `REQUIRE_DATABASE_TESTS=true`; missing `DIRECT_DATABASE_URL`, `SUPABASE_URL`, or `SUPABASE_ANON_KEY` fails both an explicit shell preflight and the affected Vitest suite.
- Direct-connection coverage includes the `app_runtime`/`rolbypassrls=false` preflight, AC01, AC02, AC05, connection reuse, rollback, 60 concurrent requests, Data API denial, and SQL policy tests.
- The transaction-pool test is hosted-only. CI prints `hosted-only: Supavisor local does not register custom roles` and Vitest reports that suite as skipped. No local Supavisor tenant metadata is modified.

| Evidence                                 | Local CI (`db`)                | Hosted `guidu`               |
| ---------------------------------------- | ------------------------------ | ---------------------------- |
| All migrations from zero                 | Required (`supabase db reset`) | Migration history verified   |
| RLS/AC01/AC02/AC05                       | Required, direct port          | Passed                       |
| Rollback and 60-way concurrency          | Required, direct port          | Passed                       |
| Data API closed and SQL policies         | Required                       | Passed                       |
| Supavisor transaction + `pgbouncer=true` | Explicit hosted-only skip      | SMA-92/SMA-111: 11/11 passed |

Playwright and deployment remain outside this workflow. The hosted proof is recorded below; CI never falls back to `guidu`.

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
has LOGIN but no committed password. Runtime credentials are provisioned through
Paperclip secrets and were injected only for the external validation; no value
was printed or written to the repository.

## External validation (2026-10-07 e 2026-10-08)

A primeira versão dos segredos autenticava como `postgres` e foi rejeitada como evidência. Com as credenciais de `app_runtime`, o preflight obrigatório passou nas duas URLs: `current_user = app_runtime` e `rolbypassrls = false`.

A tentativa seguinte provou o diagnóstico de configuração: sem `pgbouncer=true`, o caminho 6543 retornava SQLSTATE `26000`. A versão 3 de `DATABASE_URL`, com `pgbouncer=true&connection_limit=1`, eliminou o erro. Como uma única conexão serializa o burst de 60 transações, o helper passou a declarar `maxWait: 30_000`; isso permite aguardar a conexão sem relaxar o isolamento nem reduzir a concorrência do teste.

Resultado final da suíte externa: **3 arquivos e 11 testes passaram**. A execução cobre leitura nas duas conexões, bloqueio de leitura e escrita cruzadas (AC01), contexto ausente ou inválido e troca de workspace sem vazamento (AC02), rollback, 60 requisições simultâneas alternadas, FK composta (AC05), e negação da Data API para `anon`. O teste de overhead, repetido isoladamente por 30 amostras, mediu baseline de 40,92 ms, transação contextual de 56,93 ms e delta de 16,01 ms por transação. Esses números incluem latência de rede e não constituem benchmark de capacidade.

Por decisão de infraestrutura, a conexão chamada de “direta” neste spike é o **Supavisor Session pooler na porta 5432**. O hostname direto do Postgres exige IPv6 no projeto sem add-on IPv4, enquanto o runtime dos agentes provavelmente não dispõe de IPv6. O Session pooler autenticou como `app_runtime`, passou o preflight e é evidência aceita para este spike.

`SUPABASE_URL` e `SUPABASE_ANON_KEY` foram disponibilizadas e o teste HTTP confirmou que `anon` não lê `spike_notes` (401/403). O banco também prova que `authenticated` não possui grants nas tabelas `spike_%`; porém não foi fornecido JWT de usuário sintético para uma chamada HTTP com role `authenticated`. Portanto, essa variante específica da prova via PostgREST permanece uma limitação explícita, sem mudança para o caminho alternativo com JWT.

## Final verification

- `npm run test:spike`: 3 arquivos, 11 testes aprovados.
- `npm run typecheck`: aprovado.
- Preflight nas duas URLs: `app_runtime`, `rolbypassrls=false`.
- Supavisor 6543: `pgbouncer=true`, sem recorrência do SQLSTATE `26000`.
- Cleanup continua preparado e não aplicado.

## Cleanup

`docs/spikes/sql/remove-prisma-rls-spike.sql` permanece preparado, mas não foi aplicado. Sua remoção de `supabase/migrations` foi autorizada por Marcelo como exceção à imutabilidade: a consulta a `supabase_migrations.schema_migrations` no projeto de desenvolvimento mostrou somente as três migrations do spike RLS e as três migrations de jobs da SMA-94, sem `20261007225959`; não existe ambiente de produção. Como o timestamp do cleanup antecede as migrations da SMA-94 já aplicadas, mantê-lo no histórico faria um futuro `db push` tratá-lo como pendente fora de ordem e apagar o schema que a suíte precisa validar. O SQL permanece como artefato histórico em `docs/spikes/sql`; ele remove apenas as tabelas `spike_%` e o schema `spike_private`, enquanto os roles permanecem porque removê-los exige auditoria separada de ownership e memberships.
