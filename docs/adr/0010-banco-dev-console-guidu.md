# ADR 0010 — Banco de desenvolvimento dedicado console-guidu para o repositório experimental

- **Status:** Aceito
- **Data:** 09/10/2026
- **Aprovador:** Marcelo
- **Altera:** ADR 0008, só para este repositório (`console-guidu-gemini`).

## Contexto

O repositório `console-guidu-gemini` é uma execução paralela e experimental do GUIDU. Ele não pode disputar o banco de desenvolvimento `guidu` (`mmwmhlafzewdyqsgfkzk`) com o repositório `console-guidu` original, sob pena de colisões de schema, conflitos em migrations e corrupção de estado durante execuções simultâneas.

## Decisão

O banco de desenvolvimento deste repositório é o projeto Supabase `console-guidu`, ref `ssulunrysnvwyqjlkpry`, organização `rminuvcdsdwmdqkpsujk`, região `sa-east-1`, Postgres 17.

O projeto `guidu` (`mmwmhlafzewdyqsgfkzk`) fica expressamente **proibido** para agentes e processos deste repositório.

Todas as demais regras de governança e segurança da [ADR 0008](0008-ambiente-de-desenvolvimento.md) continuam vigentes:
- Somente esse projeto Supabase de desenvolvimento pode ser acessado remotamente por agentes;
- SQL e migrations partem sempre e exclusivamente de arquivos versionados em `supabase/migrations`;
- Somente dados sintéticos podem ser utilizados;
- Banco compartilhado: apenas um agente aplica migrations por vez, após conferir `supabase_migrations.schema_migrations`;
- Migrations já aplicadas nunca são editadas;
- Reset exige confirmação explícita de Marcelo;
- O CI continua utilizando Supabase local temporário reaplicando o histórico do zero.

## Consequências

`AGENTS.md`, `CLAUDE.md` e `.env.example` passam a citar exclusivamente o projeto `console-guidu` (`ssulunrysnvwyqjlkpry`).

A aprovação do Marcelo, nesta etapa, fica registrada formalmente no Pull Request do GitHub (sem uso do Paperclip).
Migrations remotas autorizadas são aplicadas somente após o PR aprovado via `MIGRATION_DATABASE_URL=... pnpm tsx scripts/migrate.ts`.
