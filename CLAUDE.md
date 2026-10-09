# Instruções para Claude Code

Siga integralmente `AGENTS.md` e as fontes obrigatórias ali listadas.

Use pnpm e o lockfile: `pnpm install --frozen-lockfile`, `pnpm dev`, `pnpm generate` e, para aceite, `pnpm typecheck && pnpm lint && pnpm test && pnpm build`. E2E: `pnpm test:e2e` após instalar Chromium.

O único banco remoto gravável por agentes é o projeto Supabase dev `console-guidu` (`ssulunrysnvwyqjlkpry`), conforme ADR 0010 (que ajusta a ADR 0008 para este repositório). SQL e migrations partem sempre de arquivos versionados em `supabase/migrations`; migrations remotas são aplicadas com `MIGRATION_DATABASE_URL=... pnpm tsx scripts/migrate.ts` depois do PR aprovado por Marcelo. Nunca use DDL ad hoc, produção, `db push`, `db reset`, `db pull`, `login` ou `link` sem aprovação explícita do Marcelo registrada no PR. Supabase local é exclusivo do CI.
