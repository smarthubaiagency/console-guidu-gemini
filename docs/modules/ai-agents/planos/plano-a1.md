# Plano da A1 — Dados do módulo de Agentes de IA

Proposta para aprovação do Marcelo, 13/10/2026. Nada foi codado ainda.

Base: a especificação v1.0 (`docs/modules/ai-agents/especificacao.md`) (seções 6, 9, 11, 12 e 18), `campos.md`, `variaveis.md` e a revisão da ADR 0012, todos já na `main` (A0, PR #52 a #58).

## O que entra

Só banco, tipos e testes. Nenhuma tela e nenhum motor: o módulo continua atrás da flag `GUIDU_MODULE_AI_AGENTS_ENABLED` até a A4.

### 1. Tabelas novas (uma migration)

| Tabela               | Dono                                         | Colunas principais                                                                                                                                                                                                                                                                                                      |
| -------------------- | -------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ai_agent_templates` | Casa (`partner_id` nulo) ou parceiro         | `kind` (`guid` ou `admin`), segmento, nome, prompt template, `defaults` (JSON por aba), ferramentas padrão, `version`, `published`, `approved_by`                                                                                                                                                                       |
| `ai_agents`          | Parceiro (`assistant`) ou workspace (`guid`) | `kind`, `partner_id` ou `workspace_id`, `template_id` e `template_version`, `customized`, `config` (JSON por aba, com `config_version`), `model_connection` (credencial e modelo), `status` (`draft`, `active`, `paused`), `key_state` (`ok`, `backup`, `failed`) e `backup_started_at`, `last_tested_at`, `updated_by` |
| `ai_agent_referrals` | Workspace                                    | Indicações: nome, `referral_tag` único por workspace, especialidades, telefone, cidade, remoto                                                                                                                                                                                                                          |
| `ai_lead_activities` | Workspace                                    | Contato do CRM, agente, pontos, temperatura, `score_breakdown`, indicação                                                                                                                                                                                                                                               |

- Só vira coluna o que é filtrado ou tem restrição; o resto fica no JSON tipado, validado por um schema Zod por versão (`src/core/ai/config/`), com os enums únicos do `campos.md`.
- Restrições: um `assistant` por parceiro (índice único parcial); `guid` sempre com workspace e `assistant` sempre sem; chaves estrangeiras compostas impedem ligar agente, contato e indicação de workspaces diferentes.
- Conversas, consumo e base de conhecimento **não** entram aqui: nascem com o motor (A2) e a base (A7), que são quem as usa.

### 2. Permissões e RLS

- Permissões novas no catálogo: `partner.ai_agents.read`, `partner.ai_agents.manage` e `platform.ai.manage`. `ai_agents.conversations.read` fica para a A2, junto com as conversas.
- RLS forçado em tudo, como no resto do banco:
  - membros do workspace leem os GUIDS do workspace; `ai_agents.manage` cria, edita, pausa e exclui;
  - membros do parceiro com `partner.ai_agents.*` leem e editam **só a configuração** dos GUIDS dos clientes do parceiro (`organizations.partner_id` do workspace), sem concessão (revisão da ADR 0012); indicações e lead activities continuam só do workspace;
  - o Assistente e os modelos do parceiro são do parceiro; os modelos da casa, da plataforma (`platform.ai.manage`).
- Toda alteração de agente ou modelo é auditada com o ator; quando quem altera é o parceiro, o registro mostra o parceiro (para a tela "Alterado por …" da A4).

### 3. Limites do plano

- Quotas do módulo no manifesto, pelo mecanismo que já existe (`src/core/entitlements/quotas.ts`): `ai_agents.max` (padrão 1) e `ai_agents.custom` (padrão 0, ou seja, só modelo pronto).
- Criar um GUIDS além do limite é recusado no servidor, sob lock, como as outras quotas; o Assistente do parceiro não conta.

### 4. Dados iniciais

- Modelo de admin (o Assistente padrão) e os dois modelos do legado: **Anna SDR** e **Assistente de Onboarding**, como modelos da casa publicados.
- Um Assistente para cada parceiro existente, criado a partir do modelo de admin; parceiros novos ganham o seu na criação.

### 5. Testes

- Suíte SQL `tests/core/ai-agents-rls.sql` (entra no job `db`): isolamento entre workspaces, parceiro vê só a configuração dos clientes dele, um Assistente por parceiro, chaves estrangeiras entre workspaces.
- Integração: limite do plano (criar o 2º GUIDS num plano de 1 é recusado), validação Zod da configuração, `rule_id` estável ao editar o label (critério 8).
- A suíte `security-catalog.sql` da F6a confere sozinha as tabelas e funções novas.

## Decisão que preciso de você

**Tabelas do protótipo** (`agent_configs`, `agent_sessions`, `agent_messages`, sem dados de produção):

- **A. Ficam até a A2** e saem junto com o código do protótipo. _Recomendo:_ nada quebra no meio do caminho.
- B. Saem já na A1, e o código do protótipo fica quebrado (atrás da flag) até a A2.

Sigo com a opção A se você não disser nada.

## Depois da A1

CRM-P (campos personalizados do contato com as flags da IA), depois A2 (motor).

## Como ficou (13/10/2026)

Feita com a opção A (tabelas do protótipo até a A2). Diferenças em relação ao plano acima:

- **Sem a quota `ai_agents.custom`.** A especificação decidiu que qualquer GUIDS pode ser personalizado (D-AG-16); o plano limita só a quantidade. Fica só `ai-agents.max` (com hífen, como o registro de módulos exige), padrão 1.
- **Conexão de modelo dentro da configuração** (aba `model` do `campos.md`), não numa coluna própria.
- **Cofre de chaves do parceiro** (chave do admin) passa para a A2, junto com a resolução das chaves.
- **Indicações só do workspace**, como no plano; a especificação (5.2) prevê edição pelo parceiro, que entra na A3 com a tela, se for o caso.
- **Textos dos modelos Anna e Onboarding** são de partida (não havia o texto dos presets do legado, só o prompt da CartãoPro); revisar no `/platform` na A3.
