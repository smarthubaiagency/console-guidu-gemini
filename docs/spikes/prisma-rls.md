# Prisma + RLS + Supavisor spike (SMA-92)

Status: **Spike concluído: isolamento SQL e Prisma comprovado nas conexões Supavisor Transaction (6543) e Session (5432); 11/11 testes automatizados passaram**.

## Continuous integration (SMA-113)

`.github/workflows/ci.yml` runs on every pull request and push to `main`, using fixed Node 24.10.0 and Supabase CLI 2.110.0 versions.

- `quality` restores the npm cache, generates Prisma Client, typechecks, and runs tests that do not require database URLs. There is no lint step because this repository has no lint script or configuration yet.
- `db` starts Supabase locally with its transaction-mode pooler, runs `supabase db reset`, creates an ephemeral password for `app_runtime`, and derives local API and database values from `supabase status`. It never reads a hosted Supabase secret.
- The database job loads two-workspace synthetic fixtures, executes `tests/prisma-rls/rls.sql`, then runs the Prisma and Data API suite. Its preflight requires `current_user = app_runtime` and `rolbypassrls = false`; coverage includes cross-workspace access, invalid context, pool reuse, rollback, concurrency, composite FK, and closed Data API access.
- The pool URL carries `pgbouncer=true`, matching the prepared-statement constraint of hosted Supavisor.

Playwright and deployment remain outside this workflow. Hosted Supavisor validation remains documented below and manual; the CI gate uses only runner-local Supabase and never falls back to `guidu`.

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

`docs/spikes/sql/remove-prisma-rls-spike.sql` permanece preparado, mas não foi aplicado. Ele foi retirado de `supabase/migrations` antes do primeiro CI porque era um cleanup marcado `DO NOT APPLY`; no histórico, um banco reconstruído apagaria o schema que a própria suíte precisa validar. Ele remove apenas as tabelas `spike_%` e o schema `spike_private`; os roles permanecem porque removê-los exige auditoria separada de ownership e memberships.

