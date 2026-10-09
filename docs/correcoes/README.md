# Plano de correções — adequação do console-guidu-gemini às decisões D1–D9 e ADRs

- **Origem:** [relatório de verificação de 08/10/2026](../auditoria/2026-10-08-verificacao-execucao-gemini.md)
- **Execução:** Antigravity local, uma correção por vez, na ordem abaixo. Os prompts estão em [`prompts/`](prompts/).
- **Coordenação:** sem Paperclip. Aprovação do Marcelo fica registrada no PR do GitHub (comentário ou aprovação de review).

## Decisões já tomadas por Marcelo (09/10/2026)

| Tema | Decisão |
| --- | --- |
| Banco de desenvolvimento deste repositório | **Manter `console-guidu` (`ssulunrysnvwyqjlkpry`)**. Registrar em ADR 0010 como exceção à ADR 0008 só para este repositório. O projeto `guidu` (`mmwmhlafzewdyqsgfkzk`) continua reservado ao `console-guidu` original e fica **proibido** aqui. |
| Módulo Agentes de IA implementado sem especificação | **Congelar atrás de feature flag desligada por padrão**: código e tabelas permanecem, rota/menu/ações ficam bloqueados até existir a especificação do módulo. |

## Ações manuais do Marcelo (não delegar a agentes)

| # | Quando | Ação |
| --- | --- | --- |
| M1 | **Imediatamente** | Trocar a senha do papel `app_migrations` no `console-guidu`. A senha atual está no histórico do Git (`scripts/migrate.ts:22`, `scripts/seed-admin.ts:7`) e deve ser considerada vazada. Exemplo: `alter role app_migrations password '<nova>'` no SQL Editor. Atualizar o `.env.local` de quem usa. |
| M2 | Junto com a C02 | No painel do Supabase `console-guidu` → Authentication → *Leaked password protection*: ligar. |
| M3 | Junto com a C02 | Conferir se o Dynamic Client Registration / OAuth Server está ligado no `console-guidu` e desligar (ADR 0009). |
| M4 | Antes de cada merge com migration | Aprovar o PR. A migration é aplicada no `console-guidu` só depois da aprovação. |

## Lista de correções

| ID | Correção | Origem | Gravidade | Tipo | Depende de |
| --- | --- | --- | --- | --- | --- |
| [C01](prompts/C01-governanca-ambiente.md) | Governança do ambiente: ADR 0010, segredos fora do código, `.env.example`, lockfile, `supabase/.temp` | ADR 0008, 0001, §19, AGENTS.md | 🔴 Crítica | docs + código | M1 |
| [C02](prompts/C02-limpeza-banco.md) | Migration de limpeza: `test_migration_probe`, `sma94_jobs`, `pgmq`, mais invariantes SQL | ADR 0001, 0002, 0008 | 🔴 Crítica | migration | C01 |
| [C03](prompts/C03-remover-codigo-spike.md) | Remover código de spike descartado (OAuth MCP, scripts pg-boss/pgmq) | ADR 0009, 0002 | 🟡 Baixa | código | C01 |
| [C04](prompts/C04-congelar-agentes-ia.md) | Congelar o módulo Agentes de IA atrás de flag | ADR 0003, §1, §14, §25, pendências | 🔴 Alta | código | C01 |
| [C05](prompts/C05-branding-configuravel.md) | Nome e domínio só por configuração | ADR 0004 | 🟡 Baixa | código | — |
| [C06](prompts/C06-matriz-permissoes.md) | Matriz papel → permissão e guard de servidor | §7, §4, Adendo §6 | 🔴 Alta | código + docs | C01 |
| [C07](prompts/C07-aplicar-permissoes.md) | Aplicar permissões em credenciais BYOK, chaves de API e equipe | §7, §16, ADR 0009 | 🔴 Alta | código | C06 |
| [C08](prompts/C08-rls-membership.md) | Endurecer o RLS de vínculos e proteger o último owner do workspace | §7, §9, AC04, ADR 0001 | 🟠 Média | migration | C02, C07 |
| [C09](prompts/C09-convite-destinatario.md) | Convite vinculado ao destinatário e rota `/invite/[token]` | §8, §10, AC06 | 🟠 Média | código | C05, C08 |
| [C10](prompts/C10-chave-mestra-erros-seguros.md) | Chave mestra obrigatória e erros seguros | §16, §15, AC07 | 🔴 Alta | código | C01 |
| [C11](prompts/C11-auditoria.md) | `audit_events` append-only e registro das ações críticas existentes | §20, AC14, ADR 0009 | 🔴 Alta | migration + código | C02, C07, C10 |
| [C12](prompts/C12-chaves-api-adr0009.md) | Chaves de API conforme a ADR 0009 (escopos §17.3, `/settings/mcp`, lookup seguro) | ADR 0009, §17.3 | 🟠 Média | migration + código | C07, C08, C10, C11 |
| [C13](prompts/C13-homologacao.md) | Homologação: E2E de bloqueio, suíte completa, advisors, relatório atualizado | §24, AGENTS.md | 🟠 Média | testes + docs | todas |

**Ordem recomendada:** C01 → C02 → C04 → C10 → C05 → C06 → C07 → C08 → C09 → C11 → C12 → C03 → C13.
C03 é independente e pode ser feita em qualquer folga, depois da C02.

## Regras comuns (valem para todos os prompts)

1. **Leitura obrigatória antes de começar:** `AGENTS.md`, `docs/context.md`, `docs/adr/` (inclusive a 0010 após a C01), `docs/pendencias.md`, este README e o relatório em `docs/auditoria/`. ADR aceito prevalece sobre a spec. Em dúvida sobre texto da spec, vale o original em `smarthub-docs/projetos/guidu/documentos/originais/`, corrigido pelas decisões D1–D9.
2. **Next.js 16:** antes de escrever código de rotas, server actions ou proxy, leia o guia relevante em `node_modules/next/dist/docs/`.
3. **Fluxo:** registre no PR Contexto → Objetivo → Requisitos → Lógica → Plano → Testes → Aceite.
4. **Git:** um branch por correção (`fix/Cxx-slug`) a partir da `main` atualizada; PR para `main`. Nunca commit direto na `main`, nunca `--force`, nunca `--no-verify`, nunca reescrever histórico.
5. **Ferramentas:** só `pnpm` (`pnpm install --frozen-lockfile`). Não gerar `package-lock.json`.
6. **Banco:** só o `console-guidu` (`ssulunrysnvwyqjlkpry`). Toda mudança nasce de **arquivo novo** em `supabase/migrations/`, com timestamp maior que o último existente. Nunca editar migration já aplicada. Nunca `supabase db push`, `db reset`, `db pull`, `link` ou `login`. Nunca DDL pelo painel ou SQL solto. Antes de aplicar, confira `select version from supabase_migrations.schema_migrations order by version`. Aplique só depois do PR aprovado, com `MIGRATION_DATABASE_URL=... pnpm tsx scripts/migrate.ts`. Use apenas dados sintéticos.
7. **Domínio:** toda consulta de domínio usa Prisma dentro de `withContext`. Autorização é revalidada no servidor (serviço), nunca só no layout/menu. Nada de `user_id`, `role` ou `workspace_id` vindo do formulário como prova de acesso.
8. **Segredos:** nada de senha, chave ou token no código, em teste com valor real, em log, em DTO ou em mensagem de erro.
9. **Escopo:** faça só o que o prompt pede. Não preencha regras internas de módulos (Catálogo, Google Business, Agentes de IA) por suposição. Se faltar decisão, pare e pergunte.
10. **Aceite local obrigatório:** `pnpm generate && pnpm typecheck && pnpm lint && pnpm test && pnpm build`. Para mudanças de banco, rodar também os testes SQL e de integração (ver C02) contra o Supabase local do CI ou o `console-guidu`. Cole a saída resumida no PR. Não marque como aprovado o que não foi executado.

## Fora do escopo das correções (próximas fases, conforme a ADR 0003)

Ficam para depois das correções, com prompts próprios quando chegar a vez:
- **F2:** contrato de módulos (manifesto Zod, `registry.ts`, navegação e Settings gerados), `module-templates/standard` e módulo de referência (ADRs 0005 e 0006, Adendo §4–9 e §17).
- **F3:** planos, versões e assinaturas, quotas/entitlements, jobs pg-boss com worker `app_worker`, `usage_events`, observabilidade e privacidade.
- **F4:** REST do núcleo com OpenAPI, servidores `/mcp/workspace` e `/mcp/admin` com chaves, rate limit e propostas.
- Rotas ainda ausentes da §10–§12: `/onboarding`, `/privacy`, `/terms`, `settings/integrations`, `settings/audit`, `/app/organizations/[id]/settings`, `/app/account` e as páginas do admin.
