# Estado do Módulo: Agentes de IA

- **Status:** Em construção atrás da flag (inativo por padrão até a A4)
- **Data do congelamento:** 09/10/2026 (Decisão do Marcelo, correção C04)
- **Feature Flag de ativação:** `GUIDU_MODULE_AI_AGENTS_ENABLED="true"` (padrão: desligado)
- **Registro de módulos (F2):** manifesto em `src/modules/ai-agents/manifest.ts`, `beta` atrás da mesma flag. Com a flag ligada, o item de menu só aparece depois de habilitado no workspace; a página congelada continua usando só `isModuleTechnicallyAvailable`.
- **Especificação:** v1.0 em [especificacao.md](especificacao.md), com [canais.md](canais.md) e [campos.md](campos.md), proposta no PR da etapa A0 (12/10/2026). Duas verticais sobre um motor único: o **Assistente GUIDU** (um por parceiro) e os **GUIDS** (de 1 a 3 agentes por workspace, conforme o plano).
- **Descongelamento:** a aprovação do PR da A0 encerra o congelamento da C04 no papel. O código continua atrás da flag até a etapa A4. O protótipo e as tabelas dele saíram na A2a (D-AG-11).
- **A1 (dados), 13/10/2026:** migration `20261029090000_a1_ai_agents.sql` com `ai_agent_templates`, `ai_agents`, `ai_agent_referrals` e `ai_lead_activities`, RLS com o acesso do parceiro só à configuração dos GUIDS dos clientes, limite `ai-agents.max` (padrão 1), os modelos da casa (modelo de admin, Anna e Assistente de Onboarding) e um Assistente por parceiro, criado também quando nasce um parceiro novo. Configuração em JSON validado por Zod em `src/core/ai/config/`; criação de GUIDS em `src/modules/ai-agents/server/services/agents.ts`. Testes: `tests/core/ai-agents-rls.sql` e `tests/core/ai-agents-guids.test.ts`.
- **A2a (dados e chaves do motor), 13/10/2026:** migration `20261030090000_a2a_ai_engine_data.sql` com `ai_conversations` e `ai_messages` (conversas dos GUIDS, do workspace, e do Assistente, de quem conversa com ele), `ai_usage_events` (consumo por chave: cliente, admin ou backup, este como cortesia), o cofre do parceiro `partner_credentials` (chave do admin) e `platform_ai_settings` (chave e modelo de backup). Nesta etapa as tabelas só são lidas: as políticas de escrita entram na A2b com o motor. OpenRouter entra no cofre do workspace. Permissão nova `ai_agents.conversations.read` (owner, admin e editor); o parceiro não lê conversas sem concessão. Serviços das chaves em `src/core/ai/keys.ts`. Saíram o protótipo (`src/core/agents/`, o cliente da rota, os testes dele) e as tabelas `agent_configs`, `agent_sessions` e `agent_messages`; a rota `/app/[workspace]/ai-agents` mostra "Em construção" com a flag ligada até a A4. Testes: `tests/core/ai-engine-rls.sql` e `tests/core/ai-keys.test.ts`. O plano das próximas partes (A2b runtime, A2c backup) está em `/mnt/project-files/ia/plano-a2.md`.
- **A2b (runtime do motor), 13/10/2026:** migration `20261031090000_a2b_ai_engine_runtime.sql` com as políticas de escrita do motor (conversas de teste dos GUIDS e do Assistente, mensagens, consumo, pontuação) e duas funções `security definer` que entregam ao servidor a configuração do Assistente e a chave do admin do parceiro que atende o contexto (membro do workspace: parceiro da empresa; membro do parceiro: o próprio parceiro). Código em `src/core/ai/`: provedores pelo AI SDK (`providers.ts`; só `src/core/ai` importa o SDK, travado no ESLint), renderizador de prompt e variáveis em uma passada (`prompt/`), catálogo de ferramentas com guarda (`tools/`: decisão allow, deny ou restrict, SHA-256 da entrada e da saída, payload mascarado na auditoria, erro seguro com `error_id`) e turnos (`turn/`). O turno do GUIDS roda no worker como job desanexado (`defineDetachedJob`): a chamada ao modelo fica fora de transação, cada ferramenta abre a sua com as permissões de quem conversa e o fim do turno grava mensagens, consumo e auditoria numa transação curta. O turno do Assistente responde em streaming na requisição, com a chave do admin. O Assistente propõe mudanças pelo `propose_operation` em nome da pessoa, marcado com `ai_execution_id`; a sessão sozinha continua sem poder propor (F4d). Pontuação de lead com temperatura (negativo é suspeito). Testes: `tests/core/ai-turns.test.ts` (modelo simulado), `src/core/ai/tools/guard.test.ts`, `src/core/ai/prompt/render.test.ts` e as suítes SQL.

---

## 1. Motivação do Congelamento

O módulo de Agentes de IA foi inicialmente prototipado na Task 07 antes da existência de sua especificação formal e antes da conclusão das Fases 2, 3 e 4. Isso violou:

- **[ADR 0003](../../adr/0003-ordem-das-fases.md):** Operação antecede API e MCP. A ordem estabelecida é: F0 Decisões → F1 Fundação → F2 Dashboard e contrato de módulos → F3 Operação (quotas, consumo, jobs) → F4 API/MCP → F5 Catálogo → F6 Produção.
- **Especificação v1.0 (§1, §14 e §25):** Veda a presunção ou invenção de configurações internas e regras de negócio de módulos não especificados.
- **[Pendências Abertas](../../pendencias.md):** A pendência _"Configurações dos módulos"_ define explicitamente que regras internas de Catálogo, Google Business e Agentes de IA permanecem abertas até documentos próprios de especificação.

Por decisão de Marcelo em 09/10/2026, o módulo está **congelado**: o código e as tabelas existentes são mantidos na base, mas o módulo fica tecnicamente inacessível em todas as interfaces públicas (rotas, menu, dashboard, server actions e chamadas de serviço) por padrão.

---

## 2. Artefatos no Repositório

O protótipo da Task 07 (`agent_configs`, `agent_sessions`, `agent_messages`, `src/core/agents/` e o cliente da rota) saiu na A2a. O que existe hoje:

- **Tabelas:** as da A1 e da A2a, listadas acima, todas com RLS forçado.
- **Código:** `src/core/ai/config/` (configuração, ferramentas e pontuação), `src/core/ai/keys.ts` (chave do admin e de backup), `src/core/ai/errors.ts` (`ProviderError`), `src/core/ai/providers.ts`, `src/core/ai/prompt/`, `src/core/ai/tools/` e `src/core/ai/turn/` (motor, A2b), `src/modules/ai-agents/` (manifesto, quotas, dados e serviços dos GUIDS, mensagem de teste).
- **Rota:** `src/app/app/[workspaceSlug]/ai-agents/page.tsx`, que mostra "Módulo Indisponível" com a flag desligada e "Em construção" com ela ligada.
- **Guard:** `src/core/modules/availability.ts` (`isModuleTechnicallyAvailable("ai-agents")` e `assertModuleAvailable("ai-agents")`).

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
4. **Rota Direta (`/app/[workspaceSlug]/ai-agents`):** Renderiza tela informativa de módulo indisponível sem consultar as tabelas do módulo.
5. **Serviços (`src/modules/ai-agents/server/`):** chamam `assertModuleOperational` no início, como defesa em profundidade (Adendo §6).

---

## 4. Débitos do protótipo

Os quatro débitos apontados na auditoria do protótipo (chamada de rede dentro da transação, fallback entre provedores sem política, consumo sem conta e execução sem auditoria) saíram com ele. O motor novo os trata na A2b e na A2c: chamada ao modelo fora da transação, consumo em `ai_usage_events` e auditoria de cada ferramenta (A2b), chaves com backup definido (§9.2, A2c).
