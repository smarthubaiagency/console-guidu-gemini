# C03 — Remover código de spike descartado

> Copie todo o conteúdo abaixo da linha para o Antigravity.

---

Você vai trabalhar no repositório **console-guidu-gemini** (Next.js 16, Prisma 6, Supabase, pnpm).

**Antes de qualquer alteração, leia:** `AGENTS.md`, `docs/context.md`, `docs/adr/` (principalmente 0002 e 0009), `docs/spikes/` e `docs/correcoes/README.md` (regras comuns, que valem integralmente).

**Branch:** `fix/C03-remover-codigo-spike`, a partir da `main` atualizada (com C01 e C02 integradas). Entregue via PR.

## Contexto

O repositório herdou código dos spikes da F0:
- `src/mcp/resource-server.ts` e `src/mcp/jwt.ts`, mais `tests/mcp-oauth/`: resource server MCP com tokens do Supabase OAuth Server (SMA-93). A **ADR 0009 descartou** o Supabase OAuth Server como emissor de tokens do MCP.
- `scripts/jobs/` (`preflight`, `apply-migration`, `generate-migration`, `run-spike`, `run-pgmq-probe`, `db.ts`, `sql/cleanup.sql`) e os scripts `spike:*` do `package.json`: prova do pg-boss/pgmq (SMA-94). A C02 removeu do banco o schema e a extensão correspondentes.

Os documentos em `docs/spikes/` são a memória dessas provas e **devem permanecer**.

## Objetivo

Remover o código executável dos spikes que não faz parte do produto, sem perder a documentação e sem quebrar o CI.

## Requisitos

1. Remover `src/mcp/`, `tests/mcp-oauth/`, `scripts/jobs/` e os scripts `spike:preflight`, `spike:migrate` e `spike:test` do `package.json`.
2. **Manter** `tests/prisma-rls/` (`describe-database.ts`, `database-suite.ts`, `describe-database.test.ts`) e o script `test:spike`: o CI usa esses arquivos no passo "Prove database suite fails without required variables". Se quiser renomear o script para algo como `test:db-guard`, atualize o `ci.yml` no mesmo PR.
3. Procurar referências restantes (`git grep -n "src/mcp\|mcp-oauth\|scripts/jobs\|spike:"`) em código, configs (`vitest.config.ts`, `tsconfig.json`, `eslint.config.mjs`) e workflow, e ajustar.
4. Em `docs/spikes/mcp-oauth.md` e `docs/spikes/jobs.md`, **não reescreva o conteúdo**. Acrescente só uma nota no topo: "O código executável deste spike foi removido em <data> (C03); o registro histórico está no commit `<sha da main antes da remoção>`."
5. Dependências que ficarem sem uso (por exemplo `jose`, se só o spike usava): confirme com `git grep` e remova com `pnpm remove`, atualizando o `pnpm-lock.yaml`. **Não remova `pg-boss`**: ele é o motor escolhido na ADR 0002 e será usado na F3.

## Plano

1. Inventariar os arquivos e as referências.
2. Remover.
3. Ajustar configs e o CI.
4. Acrescentar as notas nos spikes.
5. Rodar o aceite.

## Testes

- `pnpm test` continua passando, com número de testes menor só pelos arquivos removidos. Informe o antes e o depois no PR.
- O CI job `db` continua provando que a suíte de banco falha sem variáveis.

## Aceite

- `pnpm install --frozen-lockfile && pnpm generate && pnpm typecheck && pnpm lint && pnpm test && pnpm build` sem erros, e CI verde.
- `git grep` sem referências aos caminhos removidos fora de `docs/`.
