# C04 — Congelar o módulo Agentes de IA atrás de feature flag

> Copie todo o conteúdo abaixo da linha para o Antigravity.

---

Você vai trabalhar no repositório **console-guidu-gemini** (Next.js 16, React 19, Prisma 6, Supabase, pnpm).

**Antes de qualquer alteração, leia:** `AGENTS.md`, `docs/context.md`, `docs/adr/` (principalmente 0003 e 0006), `docs/pendencias.md` (linha "Configurações dos módulos"), a Especificação §1, §11, §14 e §25, o Adendo §3, §8 e §12, e `docs/correcoes/README.md` (regras comuns, que valem integralmente). Antes de mexer em páginas ou server actions, leia o guia do App Router em `node_modules/next/dist/docs/`.

**Branch:** `fix/C04-congelar-agentes-ia`, a partir da `main` atualizada. Entregue via PR.

## Contexto

A Task 07 implementou o módulo Agentes de IA (`src/core/agents/`, `src/app/app/[workspaceSlug]/ai-agents/`, tabelas `agent_configs`, `agent_sessions` e `agent_messages`) **sem especificação do módulo** e **antes** das fases F2–F4. Isso viola a ADR 0003 (ordem das fases), a Especificação §1, §14 e §25 ("não preencher configuração interna dos módulos por suposição") e a pendência aberta "Configurações dos módulos". Itens inventados:
- catálogo de provedores e modelos (`gpt-4o-mini`, `claude-3-5-sonnet-latest`, `gemini-2.5-flash`…) em `src/core/credentials/providers/index.ts`;
- **criação automática de um agente padrão** com prompt e fallback fixos (`src/core/agents/engine.ts`, cerca da linha 340);
- prompt padrão no cliente (`agents-client.tsx`, cerca da linha 81).

**Decisão do Marcelo (09/10/2026):** congelar. Código e tabelas permanecem, mas o módulo fica **inacessível** por padrão até existir a especificação. Não remover tabelas nem migrations.

## Objetivo

Com a flag desligada (o padrão), o módulo fica bloqueado em **todas** as entradas: menu, dashboard, página, server actions e qualquer chamada de serviço. Isso já antecipa o AC08 ("módulo indisponível bloqueia UI, API, MCP e workers") para este caso.

## Requisitos

1. **Flag central de servidor:** `src/core/modules/availability.ts` (`server-only`) exporta `isModuleTechnicallyAvailable(moduleKey: "catalog" | "google-business" | "ai-agents"): boolean` e `assertModuleAvailable(moduleKey)`, que lança `ModuleUnavailableError`.
   - Para `ai-agents`, a fonte é `process.env.GUIDU_MODULE_AI_AGENTS_ENABLED === "true"`; o padrão é **desligado**.
   - `catalog` e `google-business` retornam `false`.
   - Documente no arquivo que isto é provisório e será substituído pelo registro de módulos da F2 (ADR 0006). **Não** crie manifesto nem registry agora.
2. **Bloqueios com a flag desligada:**
   - `src/app/app/[workspaceSlug]/ai-agents/page.tsx`: depois de resolver contexto e membership, renderizar o estado "Indisponível". Não consultar as tabelas de agentes nem montar o `AgentsClient`.
   - `src/core/agents/actions.ts`: as três server actions (`executePromptAction`, `createAgentConfigAction`, `loadSessionMessagesAction`) chamam `assertModuleAvailable("ai-agents")` **antes** de qualquer acesso ao banco ou ao provedor, e devolvem um erro seguro.
   - `src/core/agents/engine.ts`: as funções exportadas que tocam o banco ou o provedor também chamam `assertModuleAvailable`, como defesa em profundidade, porque o serviço é protegido mesmo quando chamado direto (Adendo §6).
   - `src/components/layout/app-sidebar.tsx`: não exibir o item "Agentes de IA" quando indisponível.
   - Dashboard `src/app/app/[workspaceSlug]/page.tsx` e `settings/modules/page.tsx`: mostrar o status real ("Indisponível"/"Em breve") a partir da mesma função, e não de texto fixo.
3. **Remover suposições**, mesmo com a flag ligada:
   - remover a criação automática do agente padrão em `executeAgentPrompt`. Sem agente configurado, devolver o erro acionável "nenhum agente configurado";
   - remover o prompt de sistema padrão do `agents-client.tsx` (campo vazio com placeholder neutro);
   - em `providers/index.ts`, manter só o necessário para validar o formato da chave BYOK (prefixos). Mover a lista de modelos para um comentário `TODO(spec-ai-agents)` ou deixá-la vazia, sem valores padrão.
4. **Registrar o estado:** criar `docs/modules/ai-agents/ESTADO.md` com:
   - o que existe (arquivos e tabelas);
   - que o módulo está congelado e por quê (ADR 0003 e pendência);
   - a flag;
   - problemas conhecidos, a resolver quando houver especificação: chamada HTTP ao provedor dentro da transação `withContext`; fallback entre provedores sem regra de produto; ausência de consumo e quotas; ausência de auditoria.
   - Atualizar `docs/pendencias.md`, linha "Configurações dos módulos", com um link para esse arquivo.
5. **Não** apagar tabelas, migrations nem os testes de isolamento RLS das tabelas `agent_*`. Esses testes continuam valendo.

## Lógica

Uma única função decide a disponibilidade técnica, e todas as entradas a consultam: ocultar o menu não é autorização (Especificação §14). A flag via env é a ponte mínima até o registro de módulos da F2.

## Plano

1. Criar o módulo de disponibilidade com testes unitários.
2. Aplicar os bloqueios na página, nas actions, no engine, na sidebar, no dashboard e em settings/modules.
3. Remover as suposições.
4. Ajustar os testes existentes de `tests/core/ai-agents.test.ts`: os testes de engine ligam a flag explicitamente (`vi.stubEnv`), e um teste novo prova que, desligada, as funções lançam `ModuleUnavailableError` **sem** tocar o banco nem o executor (use um `executorFn` espião).
5. E2E `e2e/ai-agents.spec.ts`: com a flag desligada, a rota mostra "Indisponível" e o menu não tem o item. O fluxo atual pode ficar num `describe` que liga a flag no rig.
6. Escrever a documentação.

## Testes

- Unitários da disponibilidade (padrão desligado, `true` liga, qualquer outro valor desliga).
- Integração: actions e engine bloqueados com a flag desligada; nenhum `INSERT` em `agent_*` e o executor não é chamado.
- E2E de rota e menu.

## Aceite

- `pnpm generate && pnpm typecheck && pnpm lint && pnpm test && pnpm build` sem erros, e CI verde.
- Com o `.env` padrão, o módulo fica inacessível por URL direta, por menu e por server action.
- Não sobra nenhum valor de produto inventado: agente padrão, prompt padrão e modelos padrão.
