# Instruções de trabalho

## Antes de começar

Leia `docs/context.md`, o handoff mais recente em `docs/handoff/` (estado das fases, armadilhas e como validar), a especificação, o adendo, os ADRs e `docs/pendencias.md`. ADR aceito prevalece sobre os documentos anteriores e é a referência para o trabalho do dia a dia, mas não é imutável: o projeto está em desenvolvimento e, por ajuste estratégico decidido pelo Marcelo, componentes podem entrar ou sair. Uma proposta que contraria uma ADR não é descartada por isso; ela aponta qual ADR muda e por quê, e a mudança entra revisando ou substituindo a ADR.

## Fluxo

Registre e execute: **Contexto → Objetivo → Requisitos → Lógica → Plano → Testes → Aceite**. Trabalhe no branch/worktree da issue e entregue evidência verificável.

## Comandos

- `pnpm install --frozen-lockfile`: instala versões fixadas.
- `pnpm dev`: inicia o Next.js.
- `pnpm generate`: gera o Prisma Client.
- `pnpm typecheck && pnpm lint && pnpm test && pnpm build`: aceite local.
- `pnpm test:e2e`: e2e local (requer `pnpm exec playwright install chromium`).
- Migrations nascem em `supabase/migrations/`; o CI as reaplica do zero.

## Trabalho em paralelo e testes

Combinado com o Marcelo; detalhes nos handoffs de [15/10/2026](docs/handoff/2026-10-15-handoff.md) e [16/10/2026](docs/handoff/2026-10-16-handoff.md).

- Duas etapas por vez, cada uma com subagente, worktree, branch e PR próprios.
- Cada worktree tem seu banco local (`LOCAL_DB_NAME`), suas portas (`E2E_PORT_OFFSET`) e seu índice de Redis (`REDIS_URL`). Ninguém mexe num worktree enquanto os testes dele rodam.
- Os testes rodam num subagente do modelo mais barato da família atual, definido pelo Marcelo. Ele só executa e relata; o agente principal diagnostica e corrige.
- Quando algo falha, a nova rodada repete só o que falhou: o comando, a suíte ou o arquivo de teste (por exemplo, o arquivo e2e sozinho). A rodada completa acontece uma vez, no fim, antes do push. Falha que passa sozinha é tratada como instabilidade e anotada.

## Banco e segurança

O desenvolvimento usa exclusivamente o Supabase dev `console-guidu` (`ssulunrysnvwyqjlkpry`), conforme ADR 0010 (que ajusta a ADR 0008 para este repositório). SQL e migrations só podem atingir esse projeto, sempre a partir de arquivo versionado. Migrations remotas são aplicadas com `MIGRATION_DATABASE_URL=... pnpm tsx scripts/migrate.ts` depois do PR aprovado. Nunca execute DDL ad hoc, edite migration aplicada, use produção, exponha `.env` ou segredos. Supabase local existe somente no CI. Toda consulta de domínio usa Prisma dentro de `withContext`; autorização é revalidada no servidor.

## Interface

Toda área com menu lateral usa o shell padrão com a sidebar-08 do shadcn e o cabeçalho de 60 px (`AppShell`, ADR 0014, guia em `docs/architecture/ui-shell.md`). Não crie sidebar nem cabeçalho próprios. Todo componente de interface usa o equivalente do shadcn/ui em `src/components/ui/`; não crie versão própria do que o shadcn tem. Toda tela nova segue os componentes modelo da ADR 0021 (`PageCanvas`, `PageTitle`, `Card` com variantes, `Badge` de situação, abas segmentadas, `Accordion` em cards, `Item`, `KeyValueList`, `Empty` e os raios `rounded-panel/card/inner/control`); caixa ou selo feito à mão não é aceito. Antes de criar uma tela, leia o catálogo `/platform/design/components` e a página modelo `/platform/design/example`. Edição de registro e chat abrem na gaveta interna (`WorkbenchLayout`, ADR 0015), nunca em modal ou página separada. Todo envio ou salvamento dá retorno pelo `useStatus()` (SmartStatusBanner, ADR 0016); `alert()`, `confirm()` e mensagem de resultado inline são proibidos, exceto erro de validação de um campo, que fica ao lado do campo.

## Git e evidência

Não altere a branch padrão, não force-push, não use `--no-verify`. Contagens usam `count(*)`. Produção, exclusão, infraestrutura ou migration fora do dev exigem aprovação explícita do Marcelo registrada no PR.

<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
