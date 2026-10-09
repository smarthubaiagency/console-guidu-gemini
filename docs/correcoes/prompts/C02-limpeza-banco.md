# C02 — Migration de limpeza do banco e invariantes SQL

> Copie todo o conteúdo abaixo da linha para o Antigravity.

---

Você vai trabalhar no repositório **console-guidu-gemini** (Next.js 16, Prisma 6, Supabase, pnpm).

**Antes de qualquer alteração, leia:** `AGENTS.md`, `docs/context.md`, `docs/adr/` (principalmente 0001, 0002, 0008 e 0010), `docs/correcoes/README.md` (regras comuns, que valem integralmente) e `docs/auditoria/2026-10-08-verificacao-execucao-gemini.md`, seção 4.

**Branch:** `fix/C02-limpeza-banco`, criado a partir da `main` com a C01 já integrada. Entregue via PR.

## Contexto

O banco `console-guidu` (`ssulunrysnvwyqjlkpry`) tem problemas fora do que as ADRs permitem:

1. `public.test_migration_probe`: tabela criada **sem migration**, com **RLS desligada** e com todos os privilégios para `anon` e `authenticated`. É o alerta crítico do Supabase.
2. O schema `sma94_jobs` (pg-boss do spike SMA-94, criado em `20261007230000_sma94_jobs_spike.sql`) continua no banco. O `app_runtime` tem CRUD nas tabelas, uso das sequences e execução das funções desse schema. A ADR 0002 exige que o runtime web **não acesse o schema da fila**.
3. A extensão `pgmq` e a fila `sma94_probe` (migrations `20261007230001` e `20261007230002`) continuam instaladas, também com CRUD para o `app_runtime`. A ADR 0002 escolheu pg-boss, e nada no produto usa o pgmq.
4. Os advisors acusam 6 funções `sma94_jobs.*` com `search_path` mutável. Elas somem junto com o schema.

O papel `app_runtime` concedido a `postgres` (`20261007221000_allow_postgres_to_test_app_runtime.sql`) **deve continuar**: os testes SQL usam `set local role`.

## Objetivo

Uma migration nova e idempotente que remove os restos do spike e a tabela ad hoc, mais testes SQL que impedem a regressão.

## Requisitos

1. **Nova migration** `supabase/migrations/<timestamp>_cleanup_spike_leftovers.sql`. O timestamp deve ser maior que o último arquivo existente; use o formato `YYYYMMDDHHMMSS`. Ela precisa funcionar **tanto** no banco remoto (onde `test_migration_probe` existe) **quanto** no CI, que reaplica tudo do zero e onde essa tabela nunca existiu:
   - `drop table if exists public.test_migration_probe;`
   - `drop schema if exists sma94_jobs cascade;`
   - remover a fila `sma94_probe` com segurança, só se a extensão e a fila existirem. Por exemplo, um bloco `do $$ ... $$` que consulta `pgmq.meta` antes de chamar `pgmq.drop_queue('sma94_probe')`. Depois, `drop extension if exists pgmq cascade;`
   - `revoke all on schema pgmq from app_runtime` não é necessário se a extensão for removida. Confirme no teste que nenhum privilégio sobra.
   - cabeçalho com comentário explicando o motivo: ADR 0002, ADR 0008/0010 e o relatório de auditoria.
   - **não** editar nenhuma migration antiga.
2. **Testes SQL de invariantes.** Acrescentar em `tests/core/rls.sql`, ou criar `tests/core/invariants.sql` e incluí-lo no passo "SQL policy tests" do `.github/workflows/ci.yml`, asserções que falhem com `raise exception`:
   - toda tabela do schema `public` tem `relrowsecurity = true` **e** `relforcerowsecurity = true`;
   - `anon` e `authenticated` não têm nenhum privilégio em tabelas do `public` (consultar `information_schema.role_table_grants`);
   - `app_runtime` não tem privilégio em nenhum schema fora de `public` e `private` (tabelas, sequences e funções; consultar `information_schema.role_table_grants`, `role_usage_grants` e `role_routine_grants`, ignorando objetos de sistema do Supabase);
   - o schema `sma94_jobs` e a extensão `pgmq` não existem;
   - `app_runtime` continua `NOSUPERUSER`, `NOBYPASSRLS` e sem propriedade de tabelas.
   - Use `count(*)` nas contagens (AGENTS.md).
3. **Aplicação no remoto:** só depois do PR aprovado por Marcelo.
   - Antes: `select version, name from supabase_migrations.schema_migrations order by version` e confirmar que a última aplicada é `20261008180000`, ou a última do repo se outra correção já tiver aplicado alguma.
   - Aplicar: `MIGRATION_DATABASE_URL=... pnpm tsx scripts/migrate.ts`.
   - Depois: repetir a consulta. Rodar o arquivo de invariantes contra o remoto como `app_migrations`, só leitura. Se a ferramenta de advisors do Supabase estiver disponível, rodar os advisors de segurança e anexar o resultado (esperado: **0 ERROR**).
   - Ações manuais M2 e M3 (Marcelo): proteção contra senha vazada no Auth e desligar o DCR/OAuth Server.

## Lógica

`drop ... if exists` mantém a migration idempotente entre o ambiente remoto e o CI. Os testes de invariantes transformam regras das ADRs 0001 e 0002 em verificação executável, impedindo que uma tabela nova entre sem `FORCE RLS` ou que o runtime volte a ganhar acesso a outro schema.

## Plano

1. Ler os arquivos `supabase/migrations/2026100723000*.sql` para saber exatamente o que foi criado.
2. Escrever a migration.
3. Escrever os testes de invariantes e ligá-los ao CI.
4. Validar localmente. Sem Docker, o CI é a prova; com Docker: `supabase start` e `supabase db reset` **somente no Supabase local**, mais `psql` dos seeds e dos testes, como no `ci.yml`.
5. Abrir o PR e aguardar aprovação.
6. Aplicar no remoto e anexar as evidências ao PR.

## Testes

- CI job `db` verde: migrations do zero, seeds, `rls.sql`, `profiles-rls.sql`, invariantes e suíte de integração com contagem maior que zero.
- No remoto, após aplicar: invariantes passam, e `select count(*) from pg_namespace where nspname = 'sma94_jobs'` retorna 0.

## Aceite

- `pnpm typecheck && pnpm lint && pnpm test && pnpm build` sem erros, e CI verde.
- Migration aplicada no `console-guidu`, com o antes e o depois do `schema_migrations` no PR.
- Advisors de segurança sem ERROR. Os WARN restantes ficam listados no PR.
