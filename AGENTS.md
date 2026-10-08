# Instruções de trabalho

## Antes de começar

Leia `docs/context.md`, a especificação, o adendo, os ADRs e `docs/pendencias.md`. ADR aceito prevalece.

## Fluxo

Registre e execute: **Contexto → Objetivo → Requisitos → Lógica → Plano → Testes → Aceite**. Trabalhe no branch/worktree da issue e entregue evidência verificável.

## Comandos

- `pnpm install --frozen-lockfile`: instala versões fixadas.
- `pnpm dev`: inicia o Next.js.
- `pnpm generate`: gera o Prisma Client.
- `pnpm typecheck && pnpm lint && pnpm test && pnpm build`: aceite local.
- `pnpm test:e2e`: e2e local (requer `pnpm exec playwright install chromium`).
- Migrations nascem em `supabase/migrations/`; o CI as reaplica do zero.

## Banco e segurança

O desenvolvimento usa exclusivamente o Supabase dev `guidu` (`mmwmhlafzewdyqsgfkzk`), conforme ADR 0008. SQL e migrations só podem atingir esse projeto, sempre a partir de arquivo versionado. Nunca execute DDL ad hoc, edite migration aplicada, use produção, exponha `.env` ou segredos. Supabase local existe somente no CI. Toda consulta de domínio usa Prisma dentro de `withContext`; autorização é revalidada no servidor.

## Git e evidência

Não altere a branch padrão, não force-push, não use `--no-verify`. Contagens usam `count(*)`. Produção, exclusão, infraestrutura ou migration fora do dev exigem aprovação explícita do Marcelo no Paperclip.

<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
