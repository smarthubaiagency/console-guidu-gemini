# C01 — Governança do ambiente: ADR 0010, segredos fora do código, `.env.example`, lockfile

> Copie todo o conteúdo abaixo da linha para o Antigravity.

---

Você vai trabalhar no repositório **console-guidu-gemini** (Next.js 16, React 19, Prisma 6, Supabase, pnpm).

**Antes de qualquer alteração, leia:** `AGENTS.md`, `CLAUDE.md`, `docs/context.md`, todos os arquivos de `docs/adr/`, `docs/pendencias.md`, `docs/correcoes/README.md` (regras comuns, que valem integralmente) e `docs/auditoria/2026-10-08-verificacao-execucao-gemini.md`.

**Branch:** `fix/C01-governanca-ambiente`, criado a partir da `main` atualizada. Entregue via PR para `main`. Não faça commit direto na `main`, não use `--force` nem `--no-verify` e **não reescreva o histórico do Git**.

## Contexto

A ADR 0008 define o projeto Supabase `guidu` (`mmwmhlafzewdyqsgfkzk`) como banco de desenvolvimento. Este repositório usou outro projeto, o `console-guidu` (`ssulunrysnvwyqjlkpry`), sem registrar a decisão. Marcelo decidiu em 09/10/2026 **manter o `console-guidu`** neste repositório e registrar isso como ADR.

A verificação encontrou também:
- **a senha do papel `app_migrations` fixa no código**, em `scripts/migrate.ts` e `scripts/seed-admin.ts`;
- `supabase/.temp/` commitado (indica `supabase link`, proibido sem aprovação);
- `package-lock.json` commitado junto com o `pnpm-lock.yaml`;
- `.env.example` com `connection_limit=10` (a ADR 0001 exige `connection_limit=1`), sem `ENCRYPTION_KEY` e sem `MIGRATION_DATABASE_URL`;
- `AGENTS.md` dizendo que o banco é o `guidu` e mencionando o Paperclip, que não será usado nesta etapa.

## Objetivo

Deixar documentação, configuração e scripts coerentes com a decisão de banco e sem nenhum segredo no repositório.

## Requisitos

1. **Criar `docs/adr/0010-banco-dev-console-guidu.md`**, no mesmo formato das ADRs existentes:
   - Status: Aceito. Data: 09/10/2026. Aprovador: Marcelo. Altera: ADR 0008, só para este repositório.
   - Contexto: o repositório `console-guidu-gemini` é uma execução paralela e experimental do GUIDU. Ele não pode disputar o banco `guidu` com o repositório `console-guidu` original.
   - Decisão: o banco de desenvolvimento deste repositório é o projeto Supabase `console-guidu` (ref `ssulunrysnvwyqjlkpry`, org `rminuvcdsdwmdqkpsujk`, `sa-east-1`, Postgres 17). O `guidu` (`mmwmhlafzewdyqsgfkzk`) fica proibido para agentes deste repositório. **Todas as demais regras da ADR 0008 continuam valendo**: só esse projeto, só migrations versionadas, só dados sintéticos, um agente por vez aplicando migrations depois de conferir o histórico, sem editar migration aplicada, reset só com confirmação do Marcelo, CI reaplicando o histórico do zero.
   - Consequências: `AGENTS.md`, `CLAUDE.md` e `.env.example` passam a citar o `console-guidu`. A aprovação do Marcelo, nesta etapa, fica registrada no PR do GitHub (sem Paperclip).
2. **`AGENTS.md` e `CLAUDE.md`:** trocar as referências ao `guidu`/`mmwmhlafzewdyqsgfkzk` pelo `console-guidu`/`ssulunrysnvwyqjlkpry`, citando a ADR 0010. Trocar "aprovação explícita do Marcelo no Paperclip" por "aprovação explícita do Marcelo registrada no PR". Acrescentar que migrations remotas são aplicadas com `MIGRATION_DATABASE_URL=... pnpm tsx scripts/migrate.ts` **depois** do PR aprovado. Preserve o bloco `nextjs-agent-rules` intacto. **Não altere** as ADRs 0001–0009 nem `docs/spec/`.
3. **`docs/context.md`:** na lista "Fontes de verdade", citar que a ADR 0010 ajusta a 0008 para este repositório. Mudança mínima.
4. **Remover segredos do código:**
   - `scripts/migrate.ts` e `scripts/seed-admin.ts` devem ler **somente** `process.env.MIGRATION_DATABASE_URL`. Se ela faltar, falhar com mensagem clara, sem fallback.
   - Os dois scripts devem recusar qualquer host que não seja o projeto `ssulunrysnvwyqjlkpry` ou `localhost`/`127.0.0.1`. Sugestão: uma função compartilhada `assertDevDatabase(url)` em `scripts/lib/dev-database.ts`.
   - Nunca imprimir a URL completa no console (no máximo host e usuário).
   - Rode `git grep -nE "postgres(ql)?://[^<\"$]*:[^<@\"$]{6,}@"` e garanta que só sobram URLs locais de teste (`postgres:postgres@127.0.0.1`).
5. **`.env.example`:**
   - comentário de cabeçalho citando o `console-guidu` e a ADR 0010;
   - `APP_NAME="GUIDU"` e `APP_URL="http://localhost:3000"`;
   - `DATABASE_URL` com `pgbouncer=true&connection_limit=1`, conforme a ADR 0001;
   - `DIRECT_DATABASE_URL` via Session pooler (5432);
   - `MIGRATION_DATABASE_URL="postgresql://app_migrations.<ref>:<password>@...:5432/postgres?sslmode=require"`, com comentário: "somente para scripts/migrate.ts; nunca no runtime";
   - `ENCRYPTION_KEY="<64 caracteres hex — gere com: openssl rand -hex 32>"`;
   - `SUPABASE_URL` e `SUPABASE_ANON_KEY` com **placeholders** (`<anon-key>`), sem a chave real.
   - Nenhum valor real em lugar nenhum.
6. **Higiene do repositório:**
   - `git rm -r --cached supabase/.temp` e adicionar `supabase/.temp/` ao `.gitignore`;
   - `git rm package-lock.json` e adicionar `package-lock.json` e `yarn.lock` ao `.gitignore`;
   - garantir que `.env`, `.env.local` e `.env*.local` estejam no `.gitignore`.
7. **Não reescreva o histórico.** A senha antiga continua no histórico do Git. Marcelo vai trocá-la manualmente (ação M1 do README). Registre isso na descrição do PR.

## Lógica

São mudanças de documentação e configuração, sem alteração de schema ou de comportamento de runtime. A validação de host nos scripts protege contra rodar migrations em outro projeto (ADR 0008/0010).

## Plano

1. Ler as fontes obrigatórias.
2. Escrever a ADR 0010.
3. Ajustar `AGENTS.md`, `CLAUDE.md` e `docs/context.md`.
4. Refatorar os scripts e criar `assertDevDatabase`, com teste unitário em `tests/unit/` cobrindo host permitido, host proibido (por exemplo `mmwmhlafzewdyqsgfkzk`) e variável ausente.
5. Reescrever o `.env.example` e ajustar o `.gitignore`.
6. Remover os arquivos versionados indevidos.
7. Rodar o aceite.

## Testes

- Unitário de `assertDevDatabase` (3 casos acima).
- `git grep` de segredos sem resultados de credenciais remotas.
- `git ls-files supabase/.temp package-lock.json` sem nenhuma saída.

## Aceite

- `pnpm install --frozen-lockfile && pnpm generate && pnpm typecheck && pnpm lint && pnpm test && pnpm build` sem erros.
- ADR 0010 criada. `AGENTS.md`, `CLAUDE.md` e `.env.example` coerentes entre si.
- Nenhuma credencial real no tree.
- A descrição do PR lista os arquivos alterados, as evidências dos comandos e o lembrete: "Marcelo: trocar a senha de `app_migrations` antes do merge (M1)".
