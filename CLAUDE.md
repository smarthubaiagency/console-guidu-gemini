# Instruções para Claude Code

Siga integralmente `AGENTS.md` e as fontes obrigatórias ali listadas.

Use pnpm e o lockfile: `pnpm install --frozen-lockfile`, `pnpm dev`, `pnpm generate` e, para aceite, `pnpm typecheck && pnpm lint && pnpm test && pnpm build`. E2E: `pnpm test:e2e` após instalar Chromium.

O único banco remoto gravável por agentes é o projeto Supabase dev `guidu` (`mmwmhlafzewdyqsgfkzk`). SQL e migrations partem sempre de arquivos versionados em `supabase/migrations`; nunca use DDL ad hoc, produção, `db push`, `db reset`, `db pull`, `login` ou `link` sem a aprovação exigida pela ADR 0008. Supabase local é exclusivo do CI.
