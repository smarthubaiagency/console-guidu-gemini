# Agentes de IA — variáveis e memória

- **Versão:** 1.0 (parte da [especificação v1.0](especificacao.md))
- **Data:** 12/10/2026
- **Origem:** handoff das variáveis do legado e o catálogo `variable-definitions.ts` (136 variáveis do sistema), enviados por Marcelo em 12/10/2026.
- **Estado:** Proposta para aprovação no PR da etapa A0.

## 1. O que havia no legado

Três sistemas separados, **nenhum ligado ao runtime da IA**: a estrutura existia, mas a IA não lia nem gravava nenhum valor.

| Sistema                                              | Como era                                                                                                                                                                                              | Limitação                                                                                                       |
| ---------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| **Variáveis do agente** (`configAdvanced.variables`) | `{ id, key, value, description? }`, `key` em snake_case, até 50 por agente, editadas na aba avançada                                                                                                  | Constante por agente, não por conversa nem por contato. A ação `set_variable` dos fluxos nunca foi implementada |
| **Variáveis globais** (`{{contact.name}}` etc.)      | Catálogo de 136 variáveis em 14 categorias, com `key`, `label`, `description`, `example`, `valueType`, `options` e `dbField`; parser com `replaceVariables`, `extractVariables` e `validateVariables` | `replaceVariables` só era usado em testes; nada substituía em runtime                                           |
| **Propriedades** (`PropertyDefinition`)              | Chave `<entidade>.<campo>`, personalizadas como `contact.custom_xxx`, com `aiCanRead` (padrão sim) e `aiCanWrite` (padrão não), tipo e validação                                                      | Só a definição: não havia onde guardar o valor de uma propriedade personalizada                                 |

Além disso, o render do n8n tinha as 25 tags planas de configuração (`{{agent_name}}` etc.), descritas em [campos.md](campos.md), seção 8.

## 2. Como fica no GUIDU

**[Proposta]** Um único sistema, no motor (`src/core/ai/variables/`), com quatro camadas e **uma sintaxe** para tudo o que vem do contexto: `{{namespace.chave}}`. O mesmo parser serve o prompt, os modelos de aviso e os modelos de mensagem, e o renderizador é o mesmo do teste e da produção.

| Camada                    | Exemplo                                                      | Quem define                                       | Quem grava o valor                 | A IA lê      | A IA grava   |
| ------------------------- | ------------------------------------------------------------ | ------------------------------------------------- | ---------------------------------- | ------------ | ------------ |
| 1. Tags de configuração   | `{{agent_name}}`, `{{handoff_mode}}`                         | O sistema (as 25 do legado)                       | Parceiro ou cliente, no editor     | Sim          | Não          |
| 2. Variáveis do agente    | `{{agent.var.lead_score_min}}`                               | Parceiro ou cliente, no editor                    | Parceiro ou cliente                | Sim          | Não          |
| 3. Variáveis de contexto  | `{{contact.first_name}}`, `{{datetime.today}}`               | O sistema (catálogo em código)                    | O próprio sistema, no turno        | Sim          | Não          |
| 4. Propriedades e memória | `{{contact.custom.orcamento}}`, `{{conversation.var.etapa}}` | Cliente (propriedades do CRM) ou agente (memória) | A IA, por ferramenta, e as pessoas | Se permitido | Se permitido |

### 2.1 Tags de configuração

As 25 tags planas do legado continuam valendo, para que os prompts da Anna e dos modelos funcionem sem reescrita ([campos.md](campos.md), seção 8).

### 2.2 Variáveis do agente

- Constantes de configuração do agente, como no legado: `{ key, value, description? }`, `key` em snake_case sem ponto, **até 50 por agente**.
- Ficam na configuração do agente (aba Visão geral, bloco "Variáveis") e são copiadas junto quando o GUIDS nasce de um modelo.
- No prompt: `{{agent.var.<key>}}`.
- Editáveis por P e C\* (as mesmas regras de [campos.md](campos.md)).
- Não servem para guardar dado de cliente ou de conversa.

### 2.3 Variáveis de contexto (catálogo do sistema)

O catálogo do legado tem 136 variáveis, mas muitas falam de entidades que o GUIDU ainda não tem (tarefas, pedidos, tickets, carrinho, agendamentos). **[Proposta]** Entram só as que o GUIDU consegue preencher hoje; as demais entram quando o módulo dono existir, cada uma declarada pelo manifesto desse módulo.

| Namespace      | Variáveis na primeira versão                                                           | Fonte no GUIDU                                    | Disponível em |
| -------------- | -------------------------------------------------------------------------------------- | ------------------------------------------------- | ------------- |
| `contact`      | `id`, `name`, `first_name`, `last_name`, `email`, `phone`, `company_name`, `job_title` | `crm_contacts` (nome dividido no primeiro espaço) | GUIDS         |
| `company`      | `name`, `timezone`, `locale`, `currency`                                               | Workspace e empresa do cliente                    | Ambos         |
| `agent`        | `id`, `name`, `language_default`, `role`                                               | Configuração do agente                            | Ambos         |
| `user`         | `name`, `email`, `timezone`, `role`                                                    | A pessoa logada                                   | Assistente    |
| `datetime`     | `today`, `now`, `timezone`, `weekday`, `current_time`                                  | Calculadas no turno, no fuso do agente            | Ambos         |
| `conversation` | `id`, `channel`, `started_at`, `last_message_at`, `language`, `messages_count`         | Conversa do motor                                 | Ambos         |
| `channel`      | `type`                                                                                 | Camada de canais                                  | GUIDS         |
| `tools`        | `crm.enabled`, `rag.enabled`                                                           | Lista de ferramentas do agente                    | Ambos         |

Ficam para depois: `task`, `order`, `ticket`, `cart`, `appointment`, `user.calendar_*` e os campos de contato que o CRM do GUIDU não tem (`whatsapp`, `language`, `timezone`, `city`, `tags`, `source`, `lifecycleStage`, `owner_user_id`, `department`, `decision_role`, `linkedin_url`, `last_interaction_at`). `product` e `service` não viram variáveis: o agente consulta o Portfólio por ferramenta (busca do catálogo com o escopo `portfolio:agent`).

Cada variável do catálogo tem `key`, rótulo nos três idiomas, `description`, `example`, `valueType`, `source` e onde está disponível. O seletor de variáveis do editor (componente `Command` do shadcn) lista só o que vale para aquele tipo de agente.

### 2.4 Propriedades do contato (memória por contato)

É a parte mais madura do legado e a que dá memória real ao GUIDS. **[Proposta]**

- **Definições no CRM.** O CRM ganha **campos personalizados de contato**, por workspace: `key` (`contact.custom.<chave>`), rótulo, descrição (que orienta a IA), `valueType` (`string`, `number`, `boolean`, `date`, `select`), opções, validação, `ai_can_read` (padrão **sim**), `ai_can_write` (padrão **não**) e `sensitive`.
- **Os campos de sistema do contato** (nome, e-mail, telefone, empresa, cargo) têm as mesmas flags; o padrão é a IA ler e gravar todos, como no legado (`aiCanWrite` para contato e empresa).
- **Campos sensíveis** (CPF, CNPJ, senha, token, dados de saúde) ficam com `sensitive = sim`: a IA nunca grava, e a leitura também fica desligada por padrão.
- **Valores numa tabela própria**, `crm_contact_property_values` (`contact_id`, `key`, `value`, `source` = `ai`, `user` ou `api`, `updated_by`, `updated_at`), por causa da auditoria e da taxa de preenchimento. Era o que faltava no legado.
- **Ferramenta `update_contact_property({ key, value })`**: o `key` é um enum gerado a cada turno só com as propriedades que o agente pode gravar, e a descrição de cada uma vai para o modelo. No servidor, o motor valida de novo permissão, tipo e validação, e grava com `source = ai`. Substitui o `edit_contact` do legado.
- **Pontuação de leads:** o `capture_field` das regras de pontuação aponta para uma dessas propriedades.
- **Dono:** é dado do CRM, então a definição, a tabela e as telas são do módulo CRM (Adendo §7), e o motor usa o serviço público dele. Fica numa etapa própria do CRM (seção 5).

### 2.5 Memória da conversa

- Dados temporários do atendimento (etapa, intenção, "já perguntou o orçamento"): `ai_conversations.variables`, JSON com chaves em snake_case, até 30 por conversa **[Proposta]**.
- Ferramenta `set_conversation_variable({ key, value })`. No prompt: `{{conversation.var.<key>}}`.
- Vale só para aquela conversa e some com ela.

## 3. Regras do renderizador

1. **Validação ao salvar:** o editor recusa variável desconhecida ou fora do tipo de agente (o `validateVariables` do legado, agora usado de verdade).
2. Valor ausente vira `(não informado)`, no idioma do agente.
3. **Dados de contato e de conversa são dados não confiáveis.** O valor é limitado em tamanho e não pode abrir uma nova tag. **[Proposta]** Além das variáveis no texto, o motor anexa ao prompt um bloco "Dados conhecidos do contato", separado das instruções, só com as propriedades que a IA pode ler.
4. Propriedade com `ai_can_read = não` nunca entra no prompt, nem pelo bloco, nem por variável.
5. **[A2b]** Implementado em `src/core/ai/prompt/`: uma passada, valores do contato e da memória sem chaves e com até 300 caracteres no texto, bloco de dados (até 2000 caracteres por valor) depois das instruções, com o aviso de que são dados e não ordens. Os campos personalizados do contato esperam a CRM-P.

## 4. Telas

| Onde                                 | O que                                                                  | Origem no legado                   |
| ------------------------------------ | ---------------------------------------------------------------------- | ---------------------------------- |
| Editor do agente (`/admin` e `/app`) | Bloco "Variáveis" (até 50) e seletor de variáveis nos campos de texto  | `VariableDialog`, `VariablePicker` |
| CRM › Configurações (`/app`)         | Campos personalizados do contato, com as flags da IA                   | Settings › Property                |
| Contato no CRM (gaveta)              | Valores dos campos personalizados, com a origem ("preenchido pela IA") | Novo                               |

## 5. Onde entra nas etapas

| Etapa                         | O que entra                                                                                          |
| ----------------------------- | ---------------------------------------------------------------------------------------------------- |
| **A1**                        | `variables` na configuração do agente e em `ai_conversations`                                        |
| **CRM-P** (nova, antes da A2) | Campos personalizados do contato, valores, flags da IA, telas e API; mudança da especificação do CRM |
| **A2**                        | Catálogo de contexto, parser e renderizador, `update_contact_property` e `set_conversation_variable` |
| **A3 e A4**                   | Bloco "Variáveis" e seletor no editor                                                                |

As propriedades personalizadas do banco legado não migram: o GUIDU não traz dados de contatos do legado.

## 6. Fora desta versão

Os **fluxos** do legado (`AgentFlow`, com as ações `handoff`, `webhook`, `calendar_booking`, `send_file`, `tag_contact`, `end_chat` e condições) não entram na v1.0. A transferência e a etiqueta já são ferramentas do motor; os demais esperam uma especificação própria **[Em aberto]**.
