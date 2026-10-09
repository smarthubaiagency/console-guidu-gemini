# Estado do Módulo: Agentes de IA

- **Status:** Congelado (inativo por padrão)
- **Data do congelamento:** 09/10/2026 (Decisão do Marcelo, correção C04)
- **Feature Flag de ativação:** `GUIDU_MODULE_AI_AGENTS_ENABLED="true"` (padrão: desligado)

---

## 1. Motivação do Congelamento

O módulo de Agentes de IA foi inicialmente prototipado na Task 07 antes da existência de sua especificação formal e antes da conclusão das Fases 2, 3 e 4. Isso violou:
- **[ADR 0003](../../adr/0003-ordem-das-fases.md):** Operação antecede API e MCP. A ordem estabelecida é: F0 Decisões → F1 Fundação → F2 Dashboard e contrato de módulos → F3 Operação (quotas, consumo, jobs) → F4 API/MCP → F5 Catálogo → F6 Produção.
- **Especificação v1.0 (§1, §14 e §25):** Veda a presunção ou invenção de configurações internas e regras de negócio de módulos não especificados.
- **[Pendências Abertas](../../pendencias.md):** A pendência *"Configurações dos módulos"* define explicitamente que regras internas de Catálogo, Google Business e Agentes de IA permanecem abertas até documentos próprios de especificação.

Por decisão de Marcelo em 09/10/2026, o módulo está **congelado**: o código e as tabelas existentes são mantidos na base, mas o módulo fica tecnicamente inacessível em todas as interfaces públicas (rotas, menu, dashboard, server actions e chamadas de serviço) por padrão.

---

## 2. Artefatos Existentes no Repositório

### 2.1. Tabelas de Banco de Dados (PostgreSQL / Prisma)
As tabelas foram provisionadas via migrations versionadas (`20261008180000_sma100_ai_agents_and_sessions.sql`), possuem RLS ativado e forçado (`relrowsecurity = true`, `relforcerowsecurity = true`), e isolamento multi-tenant garantido por workspace:
- `public.agent_configs`: Configurações de perfis/personas de agentes por workspace.
- `public.agent_sessions`: Sessões de conversa associadas a um workspace e usuário.
- `public.agent_messages`: Mensagens individuais (usuário/assistente) de uma sessão com metadados de execução.

### 2.2. Arquivos de Código
- `src/core/modules/availability.ts`: Guard central server-only que governa a disponibilidade técnica (`isModuleTechnicallyAvailable("ai-agents")` e `assertModuleAvailable("ai-agents")`).
- `src/core/agents/engine.ts`: Funções de domínio para persistência de agentes, sessões e orquestração de prompts.
- `src/core/agents/actions.ts`: Server actions Next.js (`executePromptAction`, `createAgentConfigAction`, `loadSessionMessagesAction`).
- `src/app/app/[workspaceSlug]/ai-agents/`: Rota de interface do módulo com tela de bloqueio e client interativo.
- `tests/core/ai-agents.test.ts`: Testes de integração do isolamento e do engine (executados com a flag habilitada explicitamente via teste).

---

## 3. Governança e Controle de Acesso (Flag)

O módulo é controlado pela variável de ambiente:
```env
GUIDU_MODULE_AI_AGENTS_ENABLED="false" # Padrão: desligado
```

Com a flag desligada:
1. **Sidebar (`AppSidebar`):** O item de menu "Agentes de IA" não é renderizado.
2. **Dashboard do Workspace:** O módulo é apresentado com o badge de status `"Indisponível"`.
3. **Página de Módulos (`settings/modules`):** Exibe status `"Indisponível"`.
4. **Rota Direta (`/app/[workspaceSlug]/ai-agents`):** Renderiza tela informativa de módulo indisponível sem efetuar consultas às tabelas nem montar o cliente.
5. **Server Actions (`src/core/agents/actions.ts`):** Todas as actions invocam `assertModuleAvailable("ai-agents")` no início e retornam erro seguro caso acionadas diretamente.
6. **Engine de Domínio (`src/core/agents/engine.ts`):** Todas as funções exportadas que tocam tabelas ou provedores invocam `assertModuleAvailable("ai-agents")` como defesa em profundidade (Adendo §6).

---

## 4. Problemas Conhecidos a Resolver na Especificação

Quando a especificação formal do módulo for produzida e sua fase de desenvolvimento for iniciada, os seguintes débitos arquiteturais identificados na auditoria devem ser corrigidos:

1. **Chamada HTTP externa dentro da transação `withContext`:**
   Atualmente o `engine.ts` realiza a chamada ao provedor LLM externo dentro da transação do Prisma. Chamadas de rede bloqueantes prolongam o lock transacional e esgotam o pool de conexões do banco de dados em conexões lentas ou timeouts. A execução do prompt deve ocorrer fora da transação do banco, ou delegada para um worker via fila assíncrona (ADR 0002).
2. **Mecanismo de fallback sem política de produto homologada:**
   O chaveamento automático entre provedores (ex: OpenAI para Gemini) foi prototipado sem critérios formais de homologação de prompts, custos ou preferências contratuais dos workspaces.
3. **Ausência de contabilização de consumo, cotas e billing:**
   Não há integração com o modelo de planos e limites da plataforma (Fase 3), permitindo uso irrestrito de tokens.
4. **Ausência de trilha formal de auditoria:**
   As execuções e alterações de agentes não estão conectadas à tabela `audit_events` da plataforma (ADR 0009 / §20).
