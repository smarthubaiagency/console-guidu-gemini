# Agentes de IA: o que já existe e o que falta

Levantamento de 12/10/2026 no código da branch `claude/loving-davinci-f0g1ux` e nas docs do repositório.

## Resumo

O módulo está **congelado** desde 09/10/2026 (correção C04, `GUIDU_MODULE_AI_AGENTS_ENABLED` desligada). Existe um protótipo antigo, uma especificação v0.3 ainda em rascunho e muita infraestrutura da plataforma que o agente vai usar. A camada de canais (ADR 0011, aceita) ainda não tem nenhuma linha de código.

## 1. O que já existe

### Protótipo congelado (vai ser reaproveitado só em parte)

| Peça                                                        | Onde                                                                                               | Situação                                                                                                       |
| ----------------------------------------------------------- | -------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| Tabelas `agent_configs`, `agent_sessions`, `agent_messages` | `supabase/migrations/20261008180000_sma100_ai_agents_and_sessions.sql`, `prisma/schema.prisma:721` | Com RLS forçado por workspace. A spec manda evoluir por migrations (D-AG-11)                                   |
| Engine e server actions                                     | `src/core/agents/engine.ts`, `actions.ts`                                                          | Protegidos por `assertModuleAvailable("ai-agents")`. Chama o modelo **dentro** da transação (débito conhecido) |
| Executor de provedores                                      | `src/core/agents/providers/executor.ts`                                                            | HTTP direto para OpenAI, Gemini e Anthropic, sem SDK, com fallback entre provedores sem política aprovada      |
| Manifesto e tela                                            | `src/modules/ai-agents/manifest.ts`, `src/app/app/[workspaceSlug]/ai-agents/`                      | `beta`, atrás da flag; a tela mostra "indisponível"                                                            |
| Testes                                                      | `tests/core/ai-agents.test.ts`, `src/core/agents/actions.test.ts`                                  | Isolamento e engine, com a flag ligada no teste                                                                |

### Infraestrutura da plataforma que o agente vai usar (pronta)

| Peça                                                                                                                                                                                                 | Onde                                                                                             |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| **BYOK**: cofre de credenciais cifrado por workspace, catálogo de provedores (OpenAI, Anthropic, Gemini)                                                                                             | `src/core/credentials/vault.ts`, `crypto.ts`, `providers/index.ts`; tela `/settings/credentials` |
| **SDK da Anthropic** (`@anthropic-ai/sdk` 0.128.0), hoje usado só na tradução automática                                                                                                             | `src/core/i18n/machine/anthropic.ts`                                                             |
| **Servidor MCP** (`@modelcontextprotocol/sdk` 1.30.1) com chaves, escopos e ferramentas: workspace, módulos, consumo, execuções, membros, contatos do CRM, catálogo e portfólio, `propose_operation` | `src/core/mcp/` (`tools.ts`, `scopes.ts`, `server.ts`); tela `/settings/mcp`                     |
| **Propostas com aprovação humana**: o agente propõe, o dono aprova (já testado no e2e com contato do CRM)                                                                                            | `src/core/proposals/`, `src/modules/crm/proposals.ts`, `src/modules/portfolio/proposals.ts`      |
| **Busca do catálogo para "o nosso agente"** (escopo `portfolio:agent`, com governança de IA e itens de orçamento)                                                                                    | `src/modules/portfolio/server/services/catalog.ts:585`                                           |
| **Jobs e worker** (pg-boss), execuções e erros seguros                                                                                                                                               | `src/core/jobs/`                                                                                 |
| **Consumo e quotas** (`usage`, `quotas`, regras de entitlement)                                                                                                                                      | `src/core/entitlements/`                                                                         |
| **Auditoria** (`audit_events`), **permissões** `ai_agents.use` e `ai_agents.manage`                                                                                                                  | `src/core/audit/`, `src/core/permissions/catalog.ts:44`                                          |
| **Contrato e runtime de módulos** (manifesto, disponibilidade por workspace)                                                                                                                         | `src/core/module-contracts/`, `src/core/module-runtime/`                                         |
| **Interface**: gaveta interna para o chat (ADR 0015) e o botão do assistente no cabeçalho, hoje "em breve"                                                                                           | `src/components/layout/workbench/`, `shell-main.tsx`                                             |

## 2. O que está previsto (documentado, não construído)

Especificação v0.3 em `docs/modules/ai-agents/especificacao.md` (rascunho, **aguarda sua aprovação**):

- **Escopo da v1:** agente conversacional por canais de mensagem, texto e áudio, resposta dividida em mensagens curtas, saída em texto, áudio ou JSON. RAG, agendamentos e ferramentas MCP do módulo ficam fora.
- **Camada de canais no núcleo** (`src/core/channels/`, ADR 0011 aceita): adaptadores, webhooks, rotas (um dono por escopo), conversas e entregas idempotentes, compartilhada com o futuro chat interno.
- **Canais e ordem sugerida:** Chatwoot via Agent Bot (substitui o n8n), Matrix, Meta Cloud API, chat interno, Evolution API (só com aceite de risco).
- **Modelo:** agente, vínculo agente × canal (N:N, um vínculo ativo por escopo), conversa com estados `bot_ativo`, `transferida`, `pausada`, plano de resposta validado por Zod, transferência para humano como ferramenta.
- **Fluxo:** webhook só grava; agrupamento, transcrição, chamada ao modelo **fora** da transação e entrega rodam em jobs no worker.
- **SDK proposto:** AI SDK (`ai` 7.x) com `ToolLoopAgent`, `transcribe()` e `generateSpeech()`, provedor instanciado com a chave BYOK (D-AG-02, ainda sem ADR).
- **Tabelas novas:** `channel_connections`, `channel_inbound_events`, `channel_routes`, `channel_conversations`, `channel_deliveries` (núcleo); `agent_channel_bindings`, `agent_conversations` (módulo); evolução de `agent_configs` e `agent_messages`.
- **Permissões novas:** `ai_agents.conversations.read` (proposta) e `channels.manage` (decidida).

## 3. O que falta construir

1. **Fechar a especificação:** sua aprovação da v0.3 e as decisões em aberto: SDK (D-AG-02), ordem dos canais (D-AG-04), Matrix (D-AG-06), schema JSON (D-AG-07), nova mensagem durante a entrega (D-AG-08), volta ao bot (D-AG-09), **quotas e o que fazer ao esgotar** (D-AG-10, sem isso não vai para produção), limites de texto, ritmo e janela de agrupamento, retenção de conversas e áudios.
2. **Núcleo de canais** inteiro: tabelas, contrato do adaptador, suíte de conformidade, webhooks verificados, roteamento, entregas com retry e ordem, download de mídia seguro, bucket privado.
3. **Adaptadores**, um por vez, começando pelo Chatwoot.
4. **Motor do agente refeito**: SDK escolhido no lugar do executor HTTP, chamada fora da transação, plano de resposta, ferramentas autorizadas no servidor, transcrição e voz, consumo em tokens e segundos de áudio, auditoria.
5. **Migrations** para evoluir as tabelas do protótipo e criar as novas.
6. **Telas**: agentes (instruções, modelo, ferramentas), conexões de canal, vínculos e política de saída, conversas (lista, estado, leitura com permissão), teste do agente na gaveta, e o assistente do cabeçalho.
7. **Catálogo de modelos homologados** e padrões por provedor (hoje são `TODO(spec-ai-agents)` em `src/core/credentials/providers/index.ts`).
8. **Testes**: os 11 critérios de aceite da seção 15 da spec (isolamento, idempotência, retomada após queda, agrupamento, transferência, bloqueio por quota etc.).

## 4. Ponto de atenção

O assistente do cabeçalho (o "chat com o GUIDU" dentro do painel) **não está na spec v0.3**: ela trata do agente que atende clientes finais por canais. Se você quer também o assistente interno, ele precisa entrar na especificação, provavelmente usando o servidor MCP e as propostas que já existem.
