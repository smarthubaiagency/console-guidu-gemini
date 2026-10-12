# Agentes de IA — dicionário de campos do editor

- **Versão:** 1.0 (parte da [especificação v1.0](especificacao.md))
- **Data:** 12/10/2026
- **Origem:** campos e abas aprovados no legado CartãoPro/LinkkoPro (`ai_agent_settings`, editor em 5 abas e editor de presets), sem as colunas que só existiam por causa do n8n.
- **Estado:** Proposta para aprovação no PR da etapa A0.

## Como ler

- Os campos ficam em `ai_agents.config` (e em `ai_agent_templates.defaults`, com os mesmos nomes) como **um documento JSON por aba**, validado por um schema Zod com versão (`configVersion`). Criar um GUIDS a partir de um modelo copia o documento inteiro.
- Os nomes seguem o legado em `snake_case`, para facilitar a conferência. No código TypeScript viram `camelCase`.
- **Editável por:** **P** = parceiro no `/admin` (e a casa no `/platform`, nos modelos da casa); **C** = cliente no `/app`; **C\*** = cliente só quando personaliza o GUIDS (especificação, seção 5.2).
- **Enums:** um único conjunto de valores por campo, usado pela tela, pelo banco e pelo renderizador de prompt. No legado a tela gravava um código e o prompt esperava outro (veja a seção 7).
- Nos modelos de agente, todos os campos são editáveis só por quem é dono do modelo (casa ou parceiro).

## 1. Visão geral (`overview`)

| Campo               | Tipo                                                   | Editável por | Observação                                                                                                                 |
| ------------------- | ------------------------------------------------------ | ------------ | -------------------------------------------------------------------------------------------------------------------------- |
| `agent_name`        | texto (1–80)                                           | P, C\*       | Nome que o agente usa na conversa (ex.: "Anna")                                                                            |
| `agent_tone`        | enum `professional`, `friendly`, `technical`, `casual` | P, C\*       | Profissional, amigável, técnico, descontraído                                                                              |
| `language`          | enum `pt-BR`, `en-US`, `es`                            | P, C\*       | Idioma das respostas                                                                                                       |
| `segment`           | texto                                                  | P, C\*       | Segmento do negócio, vindo do modelo                                                                                       |
| `business_summary`  | texto longo                                            | P, C\*       | Resumo do negócio                                                                                                          |
| `products_services` | texto longo                                            | P, C\*       | Produtos e serviços. **[Proposta]** Quando o workspace tem o Portfólio, o agente também consulta o catálogo por ferramenta |
| `persona_context`   | texto longo                                            | P, C\*       | Contexto da persona                                                                                                        |
| `expected_output`   | texto longo                                            | **P**        | Resultado esperado. O cliente nunca edita (legado)                                                                         |
| `system_prompt`     | texto longo com tags `{{…}}`                           | P, C\*       | Prompt do sistema; se vazio, usa o prompt template do modelo                                                               |
| `prompt_version`    | inteiro                                                | Sistema      | Sobe a cada alteração do prompt                                                                                            |

O status (`draft`, `active`, `paused`), o tipo de dono e o modelo de origem não ficam nesta aba: são colunas de `ai_agents` (especificação, seção 12).

## 2. Escopo (`scope`)

| Campo                     | Tipo                            | Editável por | Observação                                                                             |
| ------------------------- | ------------------------------- | ------------ | -------------------------------------------------------------------------------------- |
| `base_city`, `base_state` | texto                           | P, C\*       | Cidade e estado base                                                                   |
| `remote_allowed`          | sim/não                         | P, C\*       | Atende remoto                                                                          |
| `travel_allowed`          | sim/não                         | P, C\*       | Aceita deslocamento                                                                    |
| `coverage_areas`          | lista de texto                  | P, C\*       | Áreas de atuação                                                                       |
| `coverage_cities`         | lista de texto                  | P, C\*       | Cidades de cobertura                                                                   |
| `coverage_radius_km`      | inteiro ≥ 0                     | P, C\*       | Raio de atendimento                                                                    |
| `timezone`                | fuso IANA                       | P, C\*       | Ex.: `America/Sao_Paulo`                                                               |
| `availability_slots`      | lista `{ weekday, start, end }` | P, C\*       | Horário de atendimento. **[Proposta]** Formato fechado aqui; no legado era jsonb livre |

## 3. Regras (`rules`)

| Campo                                         | Tipo                            | Editável por | Observação                                                                                 |
| --------------------------------------------- | ------------------------------- | ------------ | ------------------------------------------------------------------------------------------ |
| `hot_score_threshold`, `warm_score_threshold` | inteiro                         | P, C\*       | Limiares de temperatura; `hot` > `warm`                                                    |
| `notify_on_score`                             | inteiro                         | P, C\*       | Score a partir do qual o responsável é avisado                                             |
| `lead_scoring_rules`                          | lista de regras (abaixo)        | P, C\*       | Repetidor de regras de pontuação                                                           |
| `scoring_rules_version`                       | inteiro                         | Sistema      | Sobe a cada alteração das regras                                                           |
| `owner_phone`                                 | telefone E.164                  | P, C\*       | Responsável que recebe os avisos                                                           |
| `notify_channel`                              | enum `whatsapp`, `email`, `sms` | P, C\*       | **[Em aberto]** SMS depende de provedor; e-mail depende do provedor transacional (D-PA-08) |
| `notify_template`                             | texto com tags                  | P, C\*       | Modelo do aviso                                                                            |
| `handoff_mode`                                | enum (seção 7)                  | P, C\*       | Quando transferir para humano                                                              |
| `after_hours_behavior`                        | enum (seção 7)                  | P, C\*       | Fora do horário                                                                            |
| `out_of_scope_action`                         | enum (seção 7)                  | P, C\*       | Pedido fora do escopo                                                                      |
| `refuses_pricing`                             | sim/não                         | P, C\*       | Não informa preços                                                                         |
| `refuses_competitor_comparison`               | sim/não                         | P, C\*       | Não compara com concorrentes                                                               |
| `refuses_delivery_commitment`                 | sim/não                         | P, C\*       | Não promete prazo                                                                          |
| `partner_referral_notify`                     | sim/não                         | P, C\*       | Avisa a indicação ao encaminhar                                                            |
| `partner_message_template`                    | texto com tags                  | P, C\*       | Mensagem de encaminhamento                                                                 |

**Regra de pontuação** (igual ao legado):

| Campo                | Tipo                  | Observação                                            |
| -------------------- | --------------------- | ----------------------------------------------------- |
| `rule_id`            | texto                 | Gerado do label **só na criação**; nunca é regenerado |
| `key_group`          | texto                 | Grupo da regra                                        |
| `label`              | texto                 | Nome da regra                                         |
| `signal`             | texto                 | Sinal que o agente procura na conversa                |
| `points`             | inteiro de −100 a 100 | Pontos                                                |
| `capture_field`      | texto, opcional       | Campo do contato a preencher                          |
| `notify_immediately` | sim/não, opcional     | Avisa o responsável na hora                           |

## 4. Indicações

Tabela própria `ai_agent_referrals` (era a aba "Parceiros" do legado), editável por P e C\*:

| Campo          | Tipo           | Observação                      |
| -------------- | -------------- | ------------------------------- |
| `name`         | texto          | Nome do profissional ou empresa |
| `referral_tag` | texto          | Única por workspace             |
| `specialties`  | lista de texto | Especialidades                  |
| `phone`        | telefone E.164 | Contato                         |
| `city`         | texto          | Cidade                          |
| `remote`       | sim/não        | Atende remoto                   |

## 5. Integração (`integration`)

| Campo                  | Tipo                             | Editável por | Observação                                                               |
| ---------------------- | -------------------------------- | ------------ | ------------------------------------------------------------------------ |
| `tools`                | lista de ferramentas do catálogo | **P**        | Allowlist (especificação, seção 8). O cliente nunca edita                |
| `lead_destination`     | enum `crm`, `webhook`, `both`    | **P**        | **[Proposta]** `crm` é o CRM do GUIDU; no legado o padrão era o Chatwoot |
| `crm_webhook_url`      | URL https                        | **P**        | Obrigatória com `webhook` ou `both`; validada contra SSRF                |
| `onboarding_completed` | sim/não                          | P            | Marca de onboarding do legado                                            |

## 6. Conexão de modelo (`model`)

| Campo                        | Tipo                                                                                  | Editável por | Observação                                                                                      |
| ---------------------------- | ------------------------------------------------------------------------------------- | ------------ | ----------------------------------------------------------------------------------------------- |
| `credential_id`              | referência a uma credencial do cofre do workspace (GUIDS) ou do parceiro (Assistente) | P, C         | Chave do cliente (GUIDS) ou do admin (Assistente). Nunca a chave de backup, que é da plataforma |
| `model_provider`             | enum `openai`, `anthropic`, `gemini`, `openrouter`                                    | Sistema      | Vem da credencial escolhida                                                                     |
| `model_name`                 | texto                                                                                 | P, C         | Escolhido da lista consultada no provedor (capacidade `chat`)                                   |
| `audio_enabled`              | sim/não                                                                               | P, C         | Só aparece se o provedor tem áudio                                                              |
| `audio_model`, `audio_voice` | texto                                                                                 | P, C         | Capacidade `audio`                                                                              |
| `rag_enabled`                | sim/não                                                                               | P, C         | Liga a busca nas bases ligadas                                                                  |
| `embedding_model`            | texto                                                                                 | P, C         | Capacidade `embedding`                                                                          |

Ficam de fora: `platform_ai_key_id`, `credential_vault_secret_id` e `credential_configured_at` (viraram as três chaves) e todas as colunas `n8n_*`.

## 7. Enums de comportamento

No legado, a tela gravava `manual/automatic`, `collect_and_notify/auto_respond/ignore` e `notify_owner/ignore/escalate`, mas o render do prompt esperava `high_intent/always_ask/never`, `offer_callback/inform_hours/auto_reply_only` e `escalate_team/say_dont_know`. O código cru da tela ia para o prompt.

**[Decidido]** Os valores do render do legado (`render-system-prompt.ts`, cópia do Code node do n8n) são os únicos valores; rótulos confirmados por Marcelo em 12/10/2026. A última coluna é o texto que o renderizador põe no prompt, igual ao legado:

| Campo                  | Valor             | Rótulo na tela (pt-BR)                               | Texto no prompt                                                                                       |
| ---------------------- | ----------------- | ---------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| `handoff_mode`         | `high_intent`     | Transferir quando o lead mostrar alta intenção       | Transfira para um atendente humano assim que perceber alta intenção de compra ou pedido explícito.    |
|                        | `always_ask`      | Sempre perguntar se o lead quer falar com uma pessoa | Sempre pergunte se o contato prefere continuar com um humano antes de avançar.                        |
|                        | `never`           | Nunca transferir                                     | Não transfira automaticamente; continue o atendimento você mesmo.                                     |
| `after_hours_behavior` | `offer_callback`  | Oferecer retorno no horário de atendimento           | Fora do horário de atendimento, informe isso com transparência e ofereça retornar assim que possível. |
|                        | `inform_hours`    | Informar o horário de atendimento                    | Fora do horário de atendimento, apenas informe o horário de funcionamento.                            |
|                        | `auto_reply_only` | Só a resposta automática                             | Fora do horário, responda apenas com uma mensagem automática padrão.                                  |
| `out_of_scope_action`  | `escalate_team`   | Encaminhar para a equipe (ou para uma indicação)     | Se a pergunta fugir do que você pode responder, explique que vai encaminhar para o time responsável.  |
|                        | `say_dont_know`   | Dizer que não sabe e seguir                          | Se não souber responder, diga isso com honestidade, sem inventar informação.                          |

Os textos do prompt são traduzidos para `en-US` e `es` conforme o `language` do agente, pelo mesmo catálogo de idiomas do painel (ADR 0013).

## 8. Tags do prompt

O prompt template do modelo e o `system_prompt` do agente aceitam as **25 tags** do legado, no formato `{{tag}}`. A lista e as regras vêm do `render-system-prompt.ts` do legado (enviado por Marcelo em 12/10/2026).

| Tag                                                                                                     | Campo       | Como vira texto                                                                    |
| ------------------------------------------------------------------------------------------------------- | ----------- | ---------------------------------------------------------------------------------- |
| `{{agent_name}}`, `{{business_summary}}`, `{{segment}}`, `{{products_services}}`, `{{persona_context}}` | Visão geral | Texto como está                                                                    |
| `{{language}}`, `{{agent_tone}}`                                                                        | Visão geral | O valor do enum                                                                    |
| `{{base_city}}`, `{{base_state}}`, `{{timezone}}`, `{{coverage_radius_km}}`                             | Escopo      | Texto ou número como está                                                          |
| `{{coverage_cities}}`, `{{coverage_areas}}`                                                             | Escopo      | Lista separada por vírgula                                                         |
| `{{remote_allowed}}`, `{{travel_allowed}}`                                                              | Escopo      | Sim/não (veja a regra 3)                                                           |
| `{{availability_slots}}`                                                                                | Escopo      | "dias: início às fim", separados por ponto e vírgula; sem horário, "não informado" |
| `{{refuses_pricing}}`, `{{refuses_competitor_comparison}}`, `{{refuses_delivery_commitment}}`           | Regras      | Sim/não                                                                            |
| `{{partner_referral_notify}}`                                                                           | Regras      | Sim/não                                                                            |
| `{{partner_message_template}}`                                                                          | Regras      | Texto como está                                                                    |
| `{{handoff_mode}}`, `{{after_hours_behavior}}`, `{{out_of_scope_action}}`                               | Regras      | O texto do prompt da seção 7                                                       |
| `{{lead_destination}}`                                                                                  | Integração  | O valor do enum                                                                    |

**Regras do renderizador** (iguais ao legado, salvo onde indicado):

1. Substituição literal de cada `{{tag}}` por todas as ocorrências; tag desconhecida fica como está no texto.
2. Campo vazio vira `(nao configurado)`; código de enum desconhecido vai como está.
3. **[Proposta]** Sim/não: o legado escrevia `true` e `false` no prompt; o GUIDU escreve "sim" e "não" no idioma do agente.
4. **[Proposta]** `availability_slots`: o legado guardava um objeto `{ "seg-sex": "09:00-18:00" }`; o GUIDU guarda a lista `{ weekday, start, end }` (seção 2) e o renderizador agrupa os dias com o mesmo horário para produzir o mesmo texto.
5. **Sem prompt de reserva.** No legado, um agente inativo ou sem template caía num prompt fixo da CartãoPro (`DEFAULT_SYSTEM_MESSAGE`). No GUIDU, um agente sem prompt **não pode ser ativado** nem testado, e a tela diz o que falta. O texto da CartãoPro serve de referência para o modelo SDR da casa (Anna), não de reserva.
6. O renderizador é um só, no motor, e é usado pelo "Testar agente" e pela produção. Cada tag tem um teste.
