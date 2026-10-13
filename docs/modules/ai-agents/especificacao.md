# Especificação do módulo Agentes de IA — Assistente GUIDU e GUIDS

- **Versão:** 1.0
- **Data:** 12/10/2026
- **Estado:** Proposta para aprovação no PR da etapa A0. Com a aprovação, encerra o congelamento da C04 no papel ([ESTADO.md](ESTADO.md)); o código continua atrás da flag até as etapas da seção 18.
- **Substitui:** a especificação v0.3 de 09/10/2026. A parte de canais da v0.3 continua valendo para os GUIDS e foi para [canais.md](canais.md).
- **Partes:** esta especificação (produto, motor, dados e regras), [canais.md](canais.md) (canais, conversas e saídas dos GUIDS) [campos.md](campos.md) (dicionário de campos do editor) e [variaveis.md](variaveis.md) (variáveis e memória).
- **Origem:** decisões do Marcelo em 12/10/2026 nesta conversa e o handoff do agente de IA do legado CartãoPro/LinkkoPro (persona Anna, execução no n8n).
- **ADRs:** [0011](../../adr/0011-camada-de-canais-no-nucleo.md) (canais no núcleo), [0012](../../adr/0012-plataforma-de-parceiros.md) (parceiros, revisada em 12/10/2026), [0015](../../adr/0015-janela-de-edicao-gaveta-interna.md) (gaveta), [0016](../../adr/0016-smart-status-banner.md) (avisos) e [0017](../../adr/0017-sdk-dos-agentes-de-ia.md) (SDK).

Legenda: **[Decidido]** foi definido por Marcelo; **[Proposta]** é recomendação técnica a aprovar neste PR; **[Em aberto]** é regra de produto ainda não definida, que não deve ser preenchida por suposição.

## 1. Visão

O módulo tem duas verticais sobre **um motor único** **[Decidido]**:

|                  | **Assistente GUIDU**                                                                                    | **GUIDS**                                                                                                                   |
| ---------------- | ------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| O que é          | O assistente de IA que tira dúvidas de quem está logado na plataforma e executa ações (ações a definir) | Os agentes de IA dos clientes: SDR, agendador, suporte ou personalizado. O nome faz alusão aos "dots" da OpenAI             |
| Dono             | O **parceiro** (a casa é o parceiro zero)                                                               | O **workspace** do cliente                                                                                                  |
| Quantos          | **Um por parceiro**, sem limite de plano                                                                | **De 1 a 3 por workspace**, conforme o plano, mesmo com a chave do cliente                                                  |
| Ponto de partida | Um Assistente pré-configurado a partir do modelo de admin da casa, que o parceiro pode alterar          | Um modelo pronto (configuração padrão) ou personalizado; qualquer GUIDS pode ser personalizado, inclusive num plano de 1 só |
| Quem conversa    | Membro autenticado: a equipe do parceiro no `/admin` e os clientes no `/app`                            | Contatos externos do cliente, que não são usuários da plataforma                                                            |
| Onde             | Gaveta do cabeçalho do shell (ADR 0015)                                                                 | Canais de mensagem, começando pelo Chatwoot ([canais.md](canais.md)) e o chat de teste na gaveta                            |
| Marca            | Nome, avatar e base de conhecimento do parceiro                                                         | Nome e persona do agente do cliente                                                                                         |
| Chave de modelo  | Chave do admin (parceiro)                                                                               | Chave do cliente, com a chave de backup da plataforma (seção 9)                                                             |

**[Decidido]** O parceiro (e a casa) configura no `/admin` o seu Assistente GUIDU **e** os GUIDS dos clientes dele, sem entrar no `/app` do cliente (seção 6).

## 2. Conceitos

| Conceito                 | Definição                                                                                                                                                                              |
| ------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Motor**                | Núcleo comum (`src/core/ai/`): definição de agente, runtime do turno, chaves, ferramentas, base de conhecimento, consumo e auditoria                                                   |
| **Agente**               | Uma configuração executável do motor, do tipo `assistant` (Assistente GUIDU) ou `guid` (GUIDS), com um dono (parceiro ou workspace)                                                    |
| **Modelo de agente**     | O antigo _preset_ do legado: segmento, prompt template, valores padrão das 5 abas e ferramentas padrão, com versão. Existem modelos da casa e modelos do parceiro                      |
| **Modelo de admin**      | O modelo único do qual nasce o Assistente GUIDU de cada parceiro; mantido pela casa                                                                                                    |
| **Conexão de modelo**    | Qual chave e qual modelo de IA o agente usa (seção 9)                                                                                                                                  |
| **Ferramenta**           | Ação que o agente pode pedir ao servidor (criar contato, adicionar nota, transferir…). Só roda se estiver na lista de ferramentas do agente e se a identidade do turno tiver permissão |
| **Base de conhecimento** | Documentos indexados para busca (RAG), com dono, ligados a agentes                                                                                                                     |
| **Conversa e turno**     | Fio de mensagens e o processamento de um conjunto de mensagens até a resposta                                                                                                          |
| **Indicação**            | Profissional ou empresa para onde o GUIDS encaminha leads fora do escopo (o `ai_agent_partners` do legado, renomeado para não confundir com o parceiro da plataforma)                  |

## 3. O que é motor único e o que fica separado

**Motor único** (as duas verticais usam igual):

1. definição do agente, modelos de agente e versionamento da configuração;
2. runtime do turno: chamada ao modelo **fora** de transação de banco, laço de ferramentas, saída estruturada validada por Zod, limites de passos, tokens e tempo;
3. **renderizador único de prompt**, usado pelo teste e pela produção (no legado havia dois, no app e no n8n, e eles divergiam);
4. resolução da conexão de modelo e da chave, com a política de backup;
5. catálogo de ferramentas com autorização no servidor;
6. base de conhecimento (indexação, busca e citação da fonte);
7. histórico de conversas e mensagens;
8. consumo, limites e auditoria.

**Separado:**

| Tema                       | Assistente GUIDU                                                                                        | GUIDS                                                                                                                   |
| -------------------------- | ------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| Identidade das ferramentas | **Em nome do usuário logado**: só faz o que as permissões dele permitem, no workspace ou console aberto | **Identidade de serviço do agente**, com as ferramentas da lista do agente; o contato externo não tem permissão nenhuma |
| Execução                   | Síncrona, com streaming na gaveta                                                                       | Assíncrona no worker (ADR 0002), com agrupamento de mensagens e entrega idempotente ([canais.md](canais.md))            |
| Ações que alteram dados    | Sempre com confirmação da pessoa (proposta ou `confirmStatus`, ADR 0016)                                | Automáticas dentro das ferramentas permitidas; transferência para humano                                                |
| Configuração               | No `/admin`, pelo parceiro                                                                              | No `/admin`, pelo parceiro, e no `/app`, pelo cliente, com a divisão de campos da seção 5.2                             |
| Privacidade                | Conversas de usuários da plataforma                                                                     | Dados pessoais de clientes finais do workspace (a plataforma é operadora)                                               |
| Código                     | `src/core/assistant/`, porque aparece no shell de todas as áreas                                        | Módulo `ai-agents` (`src/modules/ai-agents/`), com o nome GUIDS na interface                                            |

## 4. Assistente GUIDU

- **Um por parceiro** **[Decidido]**. Nasce do modelo de admin da casa quando o parceiro é criado (e para os parceiros que já existem, na migration da etapa A1). O parceiro altera nome, avatar, instruções, base de conhecimento e conexão de modelo.
- **Onde atende:** na gaveta do cabeçalho (o botão já existe e hoje mostra "em breve"). No `/admin`, atende a equipe do parceiro; no `/app`, atende os clientes daquele parceiro com a marca do parceiro. No `/platform`, atende a equipe da casa com o Assistente do parceiro zero.
- **Chave:** a chave do admin do parceiro (seção 9).
- **Base de conhecimento** **[Proposta]**: uma base GUIDU mantida pela casa (como usar a plataforma) mais a base do parceiro, com a do parceiro tendo prioridade na busca. O parceiro não altera a base da casa.
- **Ferramentas:** de leitura no começo (as mesmas que o MCP já expõe, como resumo do workspace, módulos, consumo e contatos), sempre com as permissões de quem pergunta. **[Em aberto]** Quais ações o Assistente executa; cada uma entra por proposta com aprovação ou confirmação no banner.
- **Contexto da tela** **[Proposta]**: o Assistente recebe a área e a página abertas (por exemplo, "CRM › Contatos"), nunca dados da tela que a pessoa não poderia ler.

## 5. GUIDS

### 5.1 Quantidade, modelos e personalização

- **De 1 a 3 GUIDS por workspace, conforme o plano** **[Decidido]**. O limite vale mesmo com a chave do cliente (BYOK). É o limite `ai-agents.max` do contrato do plano (padrão 1 no manifesto do módulo), aplicado no servidor no momento da criação (mesmo padrão das quotas da F3).
- **A escolha do modelo é obrigatória** **[Decidido]**. Os modelos prontos (SDR, agendador, suporte e o que a casa e o parceiro publicarem) carregam a configuração; a opção **Personalizado** começa vazia e exige os **campos mínimos** para o agente funcionar ([campos.md](campos.md), seção 9). Qualquer GUIDS pode ser personalizado depois: num plano de 1, o cliente usa a configuração padrão ou personaliza a sua.
- **Origem e versão:** o GUIDS guarda o modelo de origem e a versão. **[Proposta]** Uma nova versão do modelo não altera GUIDS existentes; o parceiro ou o cliente aplica a atualização quando quiser, com a diferença mostrada antes.
- **Os dados iniciais** trazem os dois presets do legado (Anna, SDR, e Assistente de Onboarding) como modelos da casa.

### 5.2 Quem edita o quê

**[Decidido]** Mantém a divisão do legado, que impede o cliente de liberar ações:

| Campos (abas de [campos.md](campos.md))                                                | Parceiro no `/admin` | Cliente no `/app`                 |
| -------------------------------------------------------------------------------------- | -------------------- | --------------------------------- |
| Conexão de modelo (chave, modelo, áudio, base de conhecimento ligada), ativar e pausar | Sim                  | Sim                               |
| Visão geral, escopo, regras e score, indicações                                        | Sim                  | **Só quando personaliza** o GUIDS |
| Ferramentas e resultado esperado (`expected_output`)                                   | Sim                  | **Nunca**                         |
| Destino dos leads e integração                                                         | Sim                  | Não                               |

Quando o cliente personaliza, a configuração passa a ser do GUIDS dele; o vínculo com o modelo de origem fica só como referência.

### 5.3 Testar agente

O "Testar Integração" do legado (4 passos no n8n) vira **"Testar agente"**: um chat na gaveta interna, com o prompt renderizado pelo mesmo renderizador da produção, a conexão de modelo real e as ferramentas em **modo simulado** (mostram o que fariam, sem gravar). O teste conta no consumo. Um GUIDS só pode ser ativado num canal depois de um teste com sucesso na versão atual da configuração **[Proposta]**.

### 5.4 Pontuação de leads, avisos e indicações

Do legado, sem mudança de regra:

- **Regras de pontuação** no formato `{ rule_id, key_group, label, signal, points (−100 a 100), capture_field?, notify_immediately? }`. O `rule_id` é gerado do label só na criação e **nunca é regenerado**.
- **Log de pontuação** por contato do CRM: temperatura (`hot`, `warm`, `cold`, `suspect`) e `score_breakdown` `[{ rule_id, label, points }]`, sempre inserido, sem atualizar.
- **Avisos ao responsável** por score (limiares hot, warm e de notificação), pelo canal escolhido, usando a porta de notificação do núcleo.
- **Encaminhamento para indicações** de leads fora do escopo, com modelo de mensagem.
- No GUIDU, a avaliação das regras é código do motor (era um Lead Scoring Engine no n8n).

### 5.5 Canais

Os GUIDS atendem pela camada de canais do núcleo, com o Chatwoot via Agent Bot como primeiro canal **[Decidido]**. O GUIDU não tem o widget MobioChat do legado. Fluxo, transferência para humano e saídas em texto, áudio e JSON estão em [canais.md](canais.md).

## 6. Gestão pelo parceiro no `/admin`

**[Decidido]** O parceiro edita a **configuração** dos GUIDS dos seus clientes pelo `/admin`, sem concessão de suporte. **Conversas, leads, contatos e a base de conhecimento do cliente continuam exigindo a concessão temporária** aprovada pelo cliente (ADR 0012, revisão de 12/10/2026).

- Permissão de parceiro nova: `partner.ai_agents.manage` (editar o Assistente, os modelos do parceiro e a configuração dos GUIDS dos clientes) e `partner.ai_agents.read` (ver).
- A RLS das tabelas de configuração aceita o membro de um parceiro com essa permissão quando o workspace pertence ao parceiro (`organizations.partner_id` da empresa do workspace). Só nas tabelas de configuração; as de conversa, lead e base não mudam.
- Toda alteração pelo parceiro é auditada, com antes e depois sem segredo, e o cliente vê no GUIDS: "Alterado por <parceiro> em <data>".
- A casa, como parceiro zero, faz o mesmo para os clientes diretos.
- Na A1, as indicações (`ai_agent_referrals`) ficam só com o workspace, como os outros dados do cliente. Se o parceiro precisar editá-las pelo `/admin` (seção 5.2), a política entra na A3, junto com a tela.

## 7. Motor: execução

- **SDK:** AI SDK, conforme a [ADR 0017](../../adr/0017-sdk-dos-agentes-de-ia.md). O provedor é instanciado por chamada com a chave resolvida pela seção 9; não há gateway intermediário.
- **Sem rede dentro de transação.** O turno abre transações curtas para ler a configuração e gravar o resultado; a chamada ao modelo fica fora delas (débito 1 do protótipo).
- **Contexto vem do servidor, nunca do modelo.** Workspace, agente e identidade saem da sessão (Assistente) ou do job (GUIDS); nenhum argumento de ferramenta escolhe workspace ou agente.
- **Limites técnicos por turno** **[Proposta]**: passos de ferramenta, tokens de saída e tempo total, com valores no manifesto do módulo e ajuste em `/platform`.
- **Saída estruturada:** o plano de resposta dos GUIDS ([canais.md](canais.md), seção 6.1) e a resposta do Assistente (texto com citações e ações propostas) são validados por Zod antes de qualquer efeito.
- **Renderizador único de prompt** com as tags do legado (`{{…}}`), em código do motor. As 25 tags, os textos dos enums e as regras de renderização estão em [campos.md](campos.md), seções 7 e 8. Variáveis e memória estão em [variaveis.md](variaveis.md).

## 8. Ferramentas

| Ferramenta                                                | Origem                                      | Disponível para | Observação                                                                                                        |
| --------------------------------------------------------- | ------------------------------------------- | --------------- | ----------------------------------------------------------------------------------------------------------------- |
| `create_contact`, `add_note`                              | Legado                                      | GUIDS           | Pelo serviço público do módulo CRM (Adendo §7), validando que o contato é do workspace                            |
| `update_contact_property`                                 | Legado (proposta do handoff de variáveis)   | GUIDS           | Substitui o `edit_contact`: grava campos do contato liberados para a IA ([variaveis.md](variaveis.md), seção 2.4) |
| `set_conversation_variable`                               | Legado (`set_variable`, nunca implementado) | Ambos           | Memória da conversa ([variaveis.md](variaveis.md), seção 2.5)                                                     |
| `add_tag`                                                 | Legado                                      | GUIDS           | **[Em aberto]** o CRM do GUIDU ainda não tem etiquetas; entra junto com elas no CRM ou sai da lista               |
| `think`                                                   | Legado                                      | Ambos           | Raciocínio interno, sem efeito                                                                                    |
| `score_lead`                                              | Legado (n8n)                                | GUIDS           | Aplica as regras de pontuação e grava o log                                                                       |
| `handoff`                                                 | v0.3                                        | GUIDS           | Transferência para humano, com motivo obrigatório                                                                 |
| `search_knowledge`                                        | Novo                                        | Ambos           | Busca nas bases ligadas ao agente                                                                                 |
| Leitura do workspace (resumo, módulos, consumo, contatos) | MCP atual                                   | Assistente      | Com as permissões do usuário                                                                                      |
| `propose_operation`                                       | MCP atual                                   | Assistente      | Propõe uma alteração que a pessoa aprova                                                                          |

- A lista de ferramentas do agente é uma **allowlist** validada no servidor a cada chamada (substitui o Policy Engine do n8n). Ferramenta nova entra no catálogo do motor e no dicionário de campos, num só lugar.
- Não existe ferramenta genérica de HTTP, SQL ou arquivo (Especificação §17.3).

## 9. Chaves, consumo e limites

### 9.1 Três chaves **[Decidido]**

| Chave                            | De quem                                                                       | Usada por                                                                        |
| -------------------------------- | ----------------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| **Chave do cliente**             | Workspace (BYOK, cofre que já existe)                                         | Os GUIDS do workspace                                                            |
| **Chave do admin**               | Parceiro (a casa tem a sua), num cofre de credenciais do parceiro, novo na A2 | O Assistente GUIDU do parceiro, no `/admin` e nas dúvidas dos clientes no `/app` |
| **Chave da plataforma (backup)** | Casa, cadastrada no `/platform`                                               | Só como backup dos GUIDS (seção 9.2)                                             |

Provedores do cofre: OpenAI, Anthropic, Gemini e, novo, **OpenRouter** (o legado usava). A lista de modelos é consultada no provedor com a chave escolhida, por capacidade (chat, áudio, embeddings).

### 9.2 Backup da chave do cliente **[Decidido]**

1. Quando a chave do cliente falha (inválida, revogada, sem crédito ou limite do provedor), a chave da plataforma **só termina as conversas que já estavam abertas**. Conversa nova não é atendida pelo backup.
2. O backup usa um **modelo barato** definido em `/platform` e é **cortesia**: não conta no consumo do cliente. O uso é medido como custo da plataforma, por workspace.
3. O cliente recebe **um aviso** da falha da chave dele, no painel e pela porta de notificação, com o link para trocar a chave.
4. O backup vale por **até 24 horas** desde a primeira falha. Se a chave não for corrigida nesse prazo, o GUIDS **pausa sozinho**, e o cliente recebe **novo aviso**.
5. Uma chave corrigida (teste com sucesso) encerra o backup na hora.
6. Erros de conteúdo ou de pedido inválido não acionam o backup, só falhas da chave ou do limite do provedor **[Proposta]**.

### 9.3 Consumo e limites

- Medido por agente e por dono: tokens de entrada e saída por modelo, embeddings, segundos de áudio transcritos, caracteres sintetizados e mensagens entregues, numa tabela nova `ai_usage_events`, com a chave usada (cliente, admin ou backup). Hoje o consumo da plataforma é a contagem de registros por módulo (F3); o consumo de IA é o primeiro medido por evento.
- Limite de plano só para clientes: `ai-agents.max` (1 a 3). O parceiro tem um Assistente, sem limite de plano **[Decidido]**.
- **[Em aberto]** Limites técnicos contra abuso e laço (turnos por conversa e por contato) e o que fazer quando uma quota de consumo do cliente acabar (D-AG-10).

## 10. Base de conhecimento

- Documentos (PDF, texto, páginas) com dono (casa, parceiro ou workspace), indexados em trechos com embeddings no Postgres (pgvector) e RLS pelo dono.
- Um agente só busca nas bases ligadas a ele. A resposta cita a fonte.
- Registra o modelo e a versão da indexação; trocar o modelo de embeddings reindexa; excluir o documento propaga para os trechos (Especificação §16).
- O embedding usa a chave do dono do agente (cliente nos GUIDS, admin no Assistente).
- **[Em aberto]** Formatos aceitos, tamanho máximo e quantidade de documentos por plano.

## 11. Permissões

| Permissão                                                            | Onde       | Uso                                                                    |
| -------------------------------------------------------------------- | ---------- | ---------------------------------------------------------------------- |
| `ai_agents.use` (existe)                                             | Workspace  | Ver os GUIDS e testar                                                  |
| `ai_agents.manage` (existe)                                          | Workspace  | Criar, personalizar, pausar e excluir GUIDS dentro do limite do plano  |
| `ai_agents.conversations.read` **[Proposta]**                        | Workspace  | Ler conversas, transcrições e áudios dos GUIDS                         |
| `partner.ai_agents.read` e `partner.ai_agents.manage` **[Proposta]** | Parceiro   | Seção 6                                                                |
| `platform.ai.manage` **[Proposta]**                                  | Plataforma | Modelos da casa, modelo de admin, base GUIDU, chave e modelo de backup |
| `channels.manage` (ADR 0011)                                         | Workspace  | Conexões de canal                                                      |

O Assistente GUIDU não precisa de permissão própria para conversar: qualquer membro autenticado usa, e as ferramentas aplicam as permissões dele.

## 12. Dados

Toda tabela tem RLS forçado ([ADR 0001](../../adr/0001-prisma-como-caminho-unico.md)). O SQL nasce em migration versionada na etapa A1.

| Tabela                                                                                      | Dono                                         | Conteúdo                                                                                                                                                                                                                                                                    |
| ------------------------------------------------------------------------------------------- | -------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ai_agent_templates`                                                                        | Casa ou parceiro                             | Tipo (`guid` ou `admin`), segmento, nome, prompt template, configuração padrão por aba, ferramentas padrão, versão, publicado, aprovado por                                                                                                                                 |
| `ai_agents`                                                                                 | Parceiro (`assistant`) ou workspace (`guid`) | Tipo, dono, modelo de origem e versão, personalizado (sim ou não), **configuração por aba em JSON tipado e versionado**, conexão de modelo, status (`draft`, `active`, `paused`), estado da chave (`ok`, `backup`, `failed`) e início do backup, último teste, quem alterou |
| `ai_agent_referrals`                                                                        | Workspace                                    | Indicações: nome, tag única por workspace, especialidades, telefone, cidade, remoto                                                                                                                                                                                         |
| `ai_lead_activities`                                                                        | Workspace                                    | Contato do CRM, agente, pontuação, temperatura, `score_breakdown`, indicação                                                                                                                                                                                                |
| `ai_knowledge_bases`, `ai_knowledge_documents`, `ai_knowledge_chunks`, `ai_agent_knowledge` | Casa, parceiro ou workspace                  | Base, documentos, trechos com vetor e o vínculo agente × base                                                                                                                                                                                                               |
| `ai_usage_events`                                                                           | Parceiro ou workspace                        | Consumo por turno: agente, chave usada, modelo, tokens, áudio, embeddings                                                                                                                                                                                                   |
| `ai_conversations`, `ai_messages`                                                           | Parceiro ou workspace                        | Conversas do Assistente e dos GUIDS (evolução de `agent_sessions` e `agent_messages`)                                                                                                                                                                                       |
| `crm_contact_property_definitions`, `crm_contact_property_values`                           | Workspace (módulo CRM)                       | Campos personalizados do contato com as flags da IA e os valores ([variaveis.md](variaveis.md), seção 2.4)                                                                                                                                                                  |
| Camada de canais                                                                            | Núcleo                                       | [canais.md](canais.md) e ADR 0011                                                                                                                                                                                                                                           |

- **Configuração em JSON tipado por aba**, com um schema Zod por versão: clonar um modelo copia o documento inteiro, então um campo novo nunca fica para trás (no legado, um clone sem `tools` ou sem score ficava mudo, sem erro). Ficam como colunas só o que é filtrado ou tem restrição.
- **Unicidade:** um `assistant` por parceiro (índice único parcial).
- **Tabelas do protótipo** (`agent_configs`, `agent_sessions`, `agent_messages`): não tinham dados de produção e saíram na A2a, junto com o código do protótipo **[Decidido em 13/10/2026]**.
- **Conversas:** as do GUIDS são do workspace e exigem `ai_agents.conversations.read`; as do Assistente são de quem conversa com ele. O parceiro não lê nenhuma das duas sem concessão (A2a).

## 13. Telas

| Onde               | Tela                                                                                                                                         | Origem no legado                            |
| ------------------ | -------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------- |
| `/platform`        | Modelos da casa, modelo de admin, base GUIDU, modelo e chave de backup                                                                       | `/app/admin/presets`, `/settings/keys`      |
| `/admin`           | **Assistente GUIDU** do parceiro                                                                                                             | Novo                                        |
| `/admin`           | **Modelos do parceiro** (5 abas)                                                                                                             | Editor de presets                           |
| `/admin`           | **GUIDS dos clientes**: lista com busca, filtro por cliente e status, stats e leads do mês; editor de 5 abas na gaveta                       | `/app/admin/ai-agents` e `/[id]`            |
| `/app/[workspace]` | **GUIDS**: lista dentro do limite do plano, criar a partir de modelo ou em branco, conexão de modelo, personalizar, testar na gaveta, pausar | Configurações do Widget e Testar Integração |
| `/app/[workspace]` | Credenciais (existe) com OpenRouter e lista de modelos                                                                                       | `settings/workspace/credentials`            |
| Cabeçalho          | Chat do Assistente GUIDU na gaveta                                                                                                           | Novo                                        |

Todas seguem o shadcn (ADR 0014), a gaveta interna (ADR 0015) e o SmartStatusBanner (ADR 0016), como o legado.

## 14. Segurança

- Mensagens de usuários e de contatos, transcrições e documentos da base são **dados não confiáveis**: nunca mudam a lista de ferramentas, a identidade ou o dono.
- Nenhum segredo (chaves, tokens de canal) aparece em prompt, DTO, log, erro ou auditoria.
- O id do agente vindo do navegador é sempre revalidado contra os agentes que aquela pessoa pode ver (regra do legado).
- A ferramenta valida que o registro alvo pertence ao workspace do turno.
- Módulo indisponível, agente pausado, workspace suspenso ou limite estourado bloqueiam o turno no servidor e no worker, não só na interface.

## 15. Privacidade, retenção e exclusão

- Conversas dos GUIDS são dados pessoais de clientes finais; o acesso do parceiro exige concessão (seção 6).
- Excluir conversa, contato, agente ou workspace propaga para mensagens, transcrições, mídias, trechos da base e log de pontuação. O que ficou no provedor de canal ou de modelo segue o contrato de cada um e é documentado, não prometido como apagado.
- **[Em aberto]** Prazos de retenção por categoria (pendência "Retenção e privacidade").

## 16. Decisões

| ID                                  | Decisão                                                                                      | Estado                                  |
| ----------------------------------- | -------------------------------------------------------------------------------------------- | --------------------------------------- |
| D-AG-01                             | Camada de canais no núcleo                                                                   | **Decidido** (ADR 0011)                 |
| D-AG-02                             | SDK do agente                                                                                | **Proposta:** AI SDK (ADR 0017)         |
| D-AG-03                             | Agente × canal N:N por vínculo, um vínculo ativo por escopo                                  | Proposta ([canais.md](canais.md))       |
| D-AG-04                             | Primeiro canal                                                                               | **Decidido:** Chatwoot via Agent Bot    |
| D-AG-05 a D-AG-09, D-AG-12, D-AG-13 | Regras de canais                                                                             | Como na v0.3, em [canais.md](canais.md) |
| D-AG-10                             | Quotas de consumo do cliente e comportamento ao esgotar                                      | Em aberto (Comercial)                   |
| D-AG-11                             | Tabelas do protótipo                                                                         | **Decidido:** saem na A2                |
| D-AG-14                             | Duas verticais sobre um motor único                                                          | **Decidido**                            |
| D-AG-15                             | Um Assistente por parceiro, pré-configurado e editável                                       | **Decidido**                            |
| D-AG-16                             | De 1 a 3 GUIDS por plano, mesmo com BYOK; qualquer um pode ser personalizado                 | **Decidido**                            |
| D-AG-17                             | Parceiro edita a configuração dos GUIDS dos clientes pelo `/admin`; conteúdo exige concessão | **Decidido** (revisão da ADR 0012)      |
| D-AG-18                             | Divisão de campos parceiro × cliente do legado                                               | **Decidido**                            |
| D-AG-19                             | Três chaves e backup de 24 horas, cortesia, só conversas abertas, pausa com novo aviso       | **Decidido**                            |
| D-AG-20                             | Base de conhecimento do Assistente: base GUIDU + base do parceiro                            | Proposta                                |
| D-AG-21                             | Ações do Assistente                                                                          | Em aberto                               |
| D-AG-22                             | Etiquetas no CRM para a ferramenta `add_tag`                                                 | Em aberto                               |
| D-AG-23                             | Modelo obrigatório; "Personalizado" exige os campos mínimos                                  | **Decidido**                            |
| D-AG-24                             | Variáveis: uma sintaxe, quatro camadas, propriedades do contato no CRM com flags da IA       | Proposta ([variaveis.md](variaveis.md)) |

## 17. Critérios de aceite

1. Um workspace não vê agentes, conversas, leads nem bases de outro; um parceiro só vê a configuração dos GUIDS dos seus clientes, e não as conversas, sem concessão.
2. Criar um GUIDS além do limite do plano é recusado no servidor.
3. O cliente não consegue alterar ferramentas nem resultado esperado, nem pela interface nem chamando a action direto.
4. O teste e a produção usam o mesmo prompt renderizado.
5. Uma ferramenta fora da lista do agente é negada e auditada.
6. Uma chave do cliente com falha aciona o backup só para conversas abertas, gera o aviso, não conta no consumo do cliente e pausa o GUIDS em 24 horas sem correção.
7. O Assistente nunca executa uma ação que a pessoa logada não poderia fazer, e toda alteração pede confirmação.
8. O `rule_id` de uma regra de pontuação não muda ao editar o label.
9. Nenhum segredo aparece em log, erro, DTO, prompt ou auditoria.
10. Os critérios de canais da v0.3 ([canais.md](canais.md)) para os GUIDS.

## 18. Etapas

Uma PR por etapa, cada uma com o "pode começar" do Marcelo. A A0 corre em paralelo com S2, U3 e F6a; o código começa depois da F6a **[Decidido]**.

| Etapa     | Entrega                                                                                                                                                                                                                                                                            |
| --------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **A0**    | Esta especificação, [campos.md](campos.md), [canais.md](canais.md), ADR 0017 e revisão da ADR 0012                                                                                                                                                                                 |
| **A1**    | Migrations, RLS (com o acesso do parceiro à configuração), limite `ai-agents.max`, dados iniciais (modelo de admin, Anna e Onboarding, um Assistente por parceiro), testes de isolamento                                                                                           |
| **CRM-P** | Campos personalizados do contato no CRM, com as flags da IA e os valores ([variaveis.md](variaveis.md)). Adiada em 13/10/2026 para a etapa própria do CRM; até lá `update_contact_property` fica desligada                                                                         |
| **A2**    | Motor, em três PRs: **A2a** dados e chaves (conversas, consumo, cofre do parceiro, backup da plataforma, OpenRouter; remove o protótipo), **A2b** runtime (SDK, renderizador e variáveis, ferramentas com guarda, pontuação, turnos), **A2c** backup de 24 horas, consumo e avisos |
| **A3**    | Telas do `/platform` e do `/admin` (modelos, Assistente, GUIDS dos clientes)                                                                                                                                                                                                       |
| **A4**    | Telas do `/app` (GUIDS) e "Testar agente"                                                                                                                                                                                                                                          |
| **A5**    | Camada de canais e o adaptador Chatwoot; troca do n8n inbox por inbox                                                                                                                                                                                                              |
| **A6**    | Avisos ao responsável, indicações, regras de horário e de fora do escopo                                                                                                                                                                                                           |
| **A7**    | Base de conhecimento                                                                                                                                                                                                                                                               |
| **A8**    | Assistente GUIDU na gaveta do cabeçalho; depois, as ações por proposta                                                                                                                                                                                                             |

## 19. Do legado para o GUIDU

| Legado                                                                                                                                     | Destino                                                                                   |
| ------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------- |
| Presets, editor de 5 abas, lista de agentes, divisão de campos, tools, pontuação, log de leads, indicações                                 | Aproveitados (seções 5, 8, 12 e 13 e [campos.md](campos.md))                              |
| Clone platform → workspace por `INSERT … SELECT`                                                                                           | GUIDS criado a partir do modelo, copiando o documento de configuração inteiro             |
| `platform_ai_keys` e credencial direta do agente                                                                                           | Substituídos pelas três chaves (seção 9)                                                  |
| Colunas `n8n_*`, templates BYOK por provedor, Test Harness, view `n8n_ai_agent_config`, Redis Chat Memory, rotas `/api/internal/n8n/crm/*` | Descartados: o motor roda dentro do GUIDU                                                 |
| Policy Engine e Lead Scoring Engine (n8n)                                                                                                  | Código do motor                                                                           |
| Códigos dos selects diferentes dos mapas do prompt                                                                                         | Um enum por campo ([campos.md](campos.md))                                                |
| Dados reais: 2 presets, 2 agentes platform, 1 clone                                                                                        | Os 2 presets entram como modelos da casa; o clone não migra (o cliente cria o GUIDS dele) |
| Operação atual no n8n e Chatwoot                                                                                                           | Troca por inbox na A5, com comparação de qualidade antes de mover o restante              |
