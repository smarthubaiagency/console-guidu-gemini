# Plano da A2 — Motor do agente

Proposta para aprovação do Marcelo, 13/10/2026. Nada foi codado ainda.

Base: especificação (`docs/modules/ai-agents/especificacao.md`, seções 7, 8, 9, 12, 14 e 17), `campos.md` (seções 7 e 8), `variaveis.md`, `canais.md` (seções 4 a 6), ADR 0017 e o que a A1 deixou na `main` (PR #61).

## Decisão de 13/10/2026

A CRM-P (campos personalizados do contato) fica para a etapa própria do CRM. Na A2, então:

- `update_contact_property` fica no catálogo, mas **desligada**: o motor recusa a chamada com "ainda não disponível" e audita, até a CRM-P;
- o renderizador usa só os campos de sistema do contato (nome, telefone, e-mail, empresa, origem); a camada `contact.*` personalizada entra junto com a CRM-P;
- `add_tag` continua desligada pelo mesmo motivo (D-AG-22, o CRM ainda não tem etiquetas).

## Como dividir

O motor é grande. Proponho **três PRs**, cada uma com o seu "pode começar":

| Parte   | Entrega                                                                                                                                                       |
| ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **A2a** | Dados e chaves: tabelas de conversa, mensagem e consumo; cofre do parceiro; chave e modelo de backup da plataforma; OpenRouter no cofre; remoção do protótipo |
| **A2b** | Runtime: SDK, renderizador e variáveis, ferramentas com allowlist, pontuação, turno do Assistente (na requisição, com streaming) e turno do GUIDS (no worker) |
| **A2c** | Backup de 24 horas, consumo medido, avisos ao cliente e pausa automática                                                                                      |

Sem telas: o motor é exercitado por testes com um modelo simulado do próprio SDK (`MockLanguageModel` de `ai/test`), sem rede. As telas chegam na A3 e na A4; o módulo continua atrás da flag `GUIDU_MODULE_AI_AGENTS_ENABLED`.

## A2a — Dados e chaves

### Tabelas novas (uma migration)

| Tabela                 | Dono                                       | Colunas principais                                                                                                                                                                                                                                  |
| ---------------------- | ------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ai_conversations`     | Parceiro (Assistente) ou workspace (GUIDS) | agente, canal (`test`, `panel` e, na A5, os canais reais), contato do CRM (GUIDS), usuário (Assistente), `status` (`active`, `handoff`, `closed`), `variables` (memória, até 30 chaves), `summary`, `key_mode` (`own`, `backup`), `last_message_at` |
| `ai_messages`          | Igual à conversa                           | papel (`user`, `assistant`, `tool`), conteúdo, chamadas de ferramenta, plano de resposta validado, modelo, tokens, erro                                                                                                                             |
| `ai_usage_events`      | Parceiro ou workspace                      | agente, conversa, chave usada (`customer`, `admin`, `backup`), provedor, modelo, tokens de entrada e saída, `courtesy` (backup não conta para o cliente)                                                                                            |
| `partner_credentials`  | Parceiro                                   | Cofre do parceiro (chave do admin), com a mesma cifra do cofre do workspace; a casa usa o do parceiro zero                                                                                                                                          |
| `platform_ai_settings` | Plataforma                                 | Credencial de backup (cifrada) e o modelo barato do backup                                                                                                                                                                                          |

- RLS forçado em tudo. Conversas e mensagens dos GUIDS: leitura com a permissão nova `ai_agents.conversations.read`; o parceiro **não** lê sem concessão (critério 1). Conversas do Assistente: só o próprio usuário e o parceiro dono.
- Consumo e conversas entram na exportação e no expurgo do workspace (`data.ts`), como a A1 fez.
- Chaves estrangeiras compostas impedem ligar conversa, agente e contato de workspaces diferentes.

### Cofre

- OpenRouter entra em `SUPPORTED_PROVIDERS`.
- Serviços de cofre do parceiro (`partner.ai_agents.manage`) e da chave de backup (`platform.ai.manage`), auditados, sem nunca devolver o segredo.

### Remoção do protótipo (D-AG-11)

- Saem `src/core/agents/`, a rota `/app/[workspace]/ai-agents` do protótipo, os testes dele (`tests/core/ai-agents.test.ts`, `tests/unit/executor.test.ts`, `actions.test.ts`, `notify.test.ts`), a exceção do ESLint e as tabelas `agent_configs`, `agent_sessions` e `agent_messages`.
- O que for aproveitável (`notify`, `templates`, `language`) é avaliado e, se servir, migra para `src/core/ai/`; o resto sai.
- A rota do módulo some até a A4. Como a flag está desligada, ninguém perde tela.

## A2b — Runtime

### SDK (ADR 0017)

Versões exatas, com pelo menos duas semanas de publicação (conferido hoje no npm):

| Pacote                        | Versão  | Publicado em |
| ----------------------------- | ------- | ------------ |
| `ai`                          | 7.0.122 | 28/09/2026   |
| `@ai-sdk/openai`              | 4.0.81  | 29/09/2026   |
| `@ai-sdk/anthropic`           | 4.0.68  | 28/09/2026   |
| `@ai-sdk/google`              | 4.0.85  | 28/09/2026   |
| `@openrouter/ai-sdk-provider` | 3.1.0   | 19/09/2026   |

- Só `src/core/ai/` importa o SDK (regra de lint). O provedor é criado por chamada com a chave decifrada no servidor.
- Nenhuma chamada ao modelo dentro de transação: lê a configuração, fecha, chama o modelo, abre outra transação curta para gravar.
- Limites por turno no manifesto: passos de ferramenta, tokens de saída e tempo total.

### Renderizador e variáveis

- Um renderizador único em `src/core/ai/prompt/`, com as 25 tags do legado e a sintaxe `{{namespace.key}}` do `variaveis.md`.
- Camadas: variáveis do agente (até 50), contexto (`company`, `agent`, `user`, `datetime`, `conversation`, `channel`, `tools`, campos de sistema do `contact`) e memória da conversa.
- Valor ausente vira "(não informado)"; dados do contato vão num bloco separado, marcado como não confiável.
- Teste e produção usam a mesma função (critério 4).

### Ferramentas

- Allowlist validada no servidor a cada chamada (critério 5): ferramenta fora da lista é negada e auditada.
- Contexto (workspace, agente, contato) vem do turno, nunca do argumento da ferramenta.
- Entram: `create_contact`, `add_note` (pelo serviço público do CRM), `set_conversation_variable`, `think`, `score_lead`, `handoff`, e no Assistente `workspace_read` e `propose_operation` (só propõe; a pessoa confirma, critério 7).
- Ficam desligadas: `update_contact_property` e `add_tag` (CRM), `search_knowledge` (A7).
- **Guarda de ferramentas** (do MCP Go, aprovado em 13/10/2026; ver [avaliacao-mcp-go.md](avaliacao-mcp-go.md)):
  - toda chamada passa por uma decisão de política antes de executar, com default deny: `allow`, `deny` (permanente) ou `restrict` (falta permissão ou o recurso está desligado), sempre com o nome da regra e o motivo, gravados na auditoria;
  - um `execution_id` por turno, levado a ferramentas, mensagens, consumo e auditoria, para reconstruir o turno inteiro;
  - a auditoria guarda o hash SHA-256 de entrada e saída de cada ferramenta e o payload com dados pessoais mascarados; o texto da conversa fica só em `ai_messages`, sob RLS;
  - falha de ferramenta devolve ao modelo e à tela só uma mensagem segura com `error_id`, nunca o erro interno;
  - o `propose_operation` reaproveita as propostas da F4d (`src/core/proposals/`), que já conferem o hash na aprovação.

### Pontuação

- `score_lead` aplica as regras por `rule_id`, soma, calcula a temperatura pelos limiares e grava em `ai_lead_activities` com o `score_breakdown`.

### Turnos

- **Assistente:** na requisição, com streaming, com as permissões de quem está logado; chave do admin do parceiro.
- **GUIDS:** job do pg-boss; produz o plano de resposta do `canais.md` §6.1, validado por Zod antes de qualquer efeito; chave do cliente. Sem canal real até a A5: o job grava a resposta na conversa.
- Módulo indisponível, agente pausado, workspace suspenso ou limite estourado bloqueiam o turno no servidor e no worker.

## A2c — Backup, consumo e avisos

- Classifica o erro do provedor: chave inválida, revogada, sem crédito ou limite aciona o backup; erro de conteúdo ou de pedido não aciona.
- No backup: só conversas já abertas, com o modelo barato da plataforma, consumo marcado como cortesia; `key_state = backup` e `backup_started_at`.
- Aviso ao cliente pela porta de notificação, com o link para trocar a chave.
- Job periódico: 24 horas sem correção pausa o GUIDS (`status = paused`, `key_state = failed`) e manda o segundo aviso.
- Teste da chave com sucesso encerra o backup na hora.
- Tudo auditado, sem segredo em log, erro, DTO, prompt ou auditoria (critério 9).

## Testes

- SQL de RLS das tabelas novas (no job `db` do CI), como na A1.
- Unitários do renderizador, da guarda de ferramentas (allow, deny e restrict, hash e máscara), da pontuação e da classificação de erros.
- Integração com `MockLanguageModel`: turno do Assistente, turno do GUIDS no worker, ferramenta negada, backup acionado e pausa após 24 horas (com relógio simulado).
- Aceite local completo em cada parte: SQL, typecheck, lint, testes, build e e2e.

## Decisão que preciso

1. **Dividir em A2a, A2b e A2c (recomendado)**, uma PR por parte, ou uma PR só para a A2 inteira.

## Como ficou a A2a (13/10/2026)

- Migration `20261030090000_a2a_ai_engine_data.sql`: `ai_conversations`, `ai_messages`, `ai_usage_events`, `partner_credentials` e `platform_ai_settings`, com RLS forçado e só leitura nesta etapa. As políticas de escrita entram na A2b, junto com o código que escreve.
- As conversas do GUIDS são do workspace (owner, admin e editor, com a permissão nova `ai_agents.conversations.read`). As do Assistente são só de quem conversa com ele. O parceiro não lê nenhuma das duas. Chaves estrangeiras compostas impedem misturar GUIDS, Assistente, contato e workspace.
- O consumo fica guardado mesmo quando o agente é excluído. O workspace vê o próprio consumo e o do backup (cortesia); o parceiro vê o da chave do admin (owner, admin e finance); a plataforma vê tudo.
- `src/core/ai/keys.ts`: cofre do parceiro (cadastrar, listar mascarado, revogar), backup da plataforma (modelo e chave, trocar ou remover) e a resolução interna das duas chaves para o motor.
- OpenRouter entrou no cofre do workspace, no banco e na tela de credenciais.
- O protótipo saiu, com o código, os testes e as três tabelas. A rota mostra "Em construção" com a flag ligada.
- Pasta `docs/mcp`: saíram os binários, o `start-dev.ps1` com segredos, o `package.json` e o `Dockerfile`; entrou `docs/mcp/README.md` e a avaliação (`docs/mcp/AVALIACAO.md`).
- Testes: `tests/core/ai-engine-rls.sql` (5 blocos) e `tests/core/ai-keys.test.ts` (3).

## Como ficou a A2b (13/10/2026)

- Migration `20261031090000_a2b_ai_engine_runtime.sql`: políticas de escrita (conversas de teste do GUIDS e do Assistente, mensagens, consumo, `ai_lead_activities`), funções `private.ai_assistant_runtime()` e `private.ai_admin_key()` (security definer, só no servidor) e a coluna `execution_proposals.ai_execution_id`.
- SDK fixado (ai 7, OpenAI, Anthropic, Google, OpenRouter); só `src/core/ai` importa o SDK (ESLint).
- Renderizador em uma passada, com bloco de dados não confiáveis; variáveis do agente (até 50) na configuração.
- Guarda das ferramentas com as ideias do MCP Go: decisão allow, deny ou restrict com regra e motivo, execution id, SHA-256 de entrada e saída, payload mascarado e `error_id`. A guarda nunca lança: o SDK repassaria a mensagem do erro ao modelo.
- GUIDS: "Testar agente" grava a mensagem e enfileira o turno; o worker roda como job desanexado (modelo fora de transação, uma tentativa, idempotente pelo id da mensagem). Assistente: streaming na requisição, chave do admin, `/admin` sem leitura de workspace e `/app` com leitura e propostas.
- Propostas do Assistente: em nome da pessoa, sem chave de API, marcadas com `ai_execution_id`; aparecem na tela de propostas para revisão.
- Pontuação: cada regra conta uma vez; total negativo é suspeito, depois quente, morno e frio pelos limiares.
- Testes: `tests/core/ai-turns.test.ts` (6, com modelo simulado), `src/core/ai/tools/guard.test.ts` (8), `src/core/ai/prompt/render.test.ts` (62) e as suítes SQL.

## Como ficou a A2c (13/10/2026)

- Migration `20261101090000_a2c_ai_key_backup.sql`: funções `private.ai_agent_key_failed()` e `private.ai_backup_key()` (security definer, só no contexto do workspace do agente), leituras estreitas do worker para os avisos e a pausa, e `key_mode` gravável na conversa.
- Gatilho: 401, 403, 402 e 429 do provedor. Erro de conteúdo, de pedido, de saída inválida ou tempo esgotado não aciona.
- O backup só termina conversas abertas antes da primeira falha, por 24 horas, com o modelo barato da plataforma; consumo `backup` (cortesia). Sem chave de backup configurada, a conversa fica com o erro e o agente segue em backup até a pausa.
- Job `ai-agents.key-watch` a cada 15 minutos: primeiro aviso uma vez por backup; pausa e segundo aviso depois de 24 horas.
- Destinatários: owners e admins do workspace, no e-mail do convite aceito. Decisão padrão tomada por mim: a aplicação não lê o e-mail de login (`auth.users`); quem entrou sem convite só vê o aviso no painel (A3/A4) até existir outra fonte de e-mail.
- Teste da chave com sucesso encerra o backup na hora; um agente já pausado continua pausado até ser reativado.
- Testes: `tests/core/ai-backup.test.ts` (5), `src/core/ai/backup.test.ts` (3), avisos em `notify.test.ts` (2), blocos 7 e 8 da suíte SQL do motor.
