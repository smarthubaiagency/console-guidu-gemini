# Sala de operação

- **Status:** Proposta para discussão. Nada aqui foi implementado. Prioridade **P2**; a fundação (tipos de sala, regra do @, threads) chega antes, na SB1 do P1 ([prioridades](prioridades-agentes-e-inbox.md)).
- **Data:** 19/10/2026
- **Origem:** conversa de Marcelo com o Claude em 19/10/2026. Detalha a seção 4.3 de [agentes-na-matrix-e-compra-agentica.md](agentes-na-matrix-e-compra-agentica.md).
- **Decisões do Marcelo (19/10/2026):**
  - **agentes e humanos juntos na mesma sala**, com os GUIDS incluídos;
  - todo agente **só age quando é mencionado com @**, como no Buzz;
  - a sala é a "sala de reuniões" da empresa, e o agente principal é o **@ops**, um GUIDS de fábrica com a chave do cliente;
  - o **@guidu** e o **@gmn** ficam com plataforma e conta, com a nossa chave.
- **Relaciona-se com:** [ADR 0019](../adr/0019-subagente-especialista.md), [ADR 0022](../adr/0022-central-de-eventos.md), [ADR 0023](../adr/0023-chat-interno-como-cliente-matrix.md), [núcleo Matrix](../modules/inbox/nucleo-matrix.md), [GUIDS na sala](../modules/inbox/guids-na-sala.md).

## 1. O que é

Uma sala Matrix interna por workspace: a sala de reuniões da empresa. A equipe conversa e pede trabalho aos agentes com @, e cada tarefa vive numa thread. Tudo ali é sobre o que acontece na empresa: contatos, mensagens, e-mails, cotações, pedidos, relatórios. Ninguém fala com o consumidor dali.

A conversa interna sobre um lead específico fica na **sala de bastidor** daquela conversa (seção 4.4 do documento principal), e não aqui. Cada thread de bastidor aparece aqui como tarefa, com a origem.

## 2. Quem está na sala

| Membro                                                    | Poder | Chave                | Para quê                                                    |
| --------------------------------------------------------- | ----- | -------------------- | ----------------------------------------------------------- |
| Núcleo (remetente do AS)                                  | 100   | —                    | Estado, propostas, decisões, convites, redação              |
| Dono, admin e atendentes                                  | 10    | —                    | Conversar, pedir com @, aprovar pela interface              |
| Editor e leitor (a decidir)                               | 0     | —                    | Só ler                                                      |
| **@ops** (GUIDS de fábrica)                               | 10    | Do cliente           | Agente principal: coordena a empresa e delega aos GUIDS     |
| **Orquestrador, atendente e vendedor** (GUIDS de fábrica) | 10    | Do cliente           | Respondem sobre o próprio trabalho quando mencionados       |
| **@guidu** (Assistente GUIDU)                             | 10    | Nossa ou do parceiro | Plataforma e conta: faturamento, limites, consumo           |
| **@gmn**                                                  | 10    | Nossa ou do parceiro | Fichas do Google                                            |
| Equipe do parceiro, só no gerenciado                      | 10    | —                    | Como a equipe; sai na hora em que o cliente volta ao padrão |
| Suporte temporário                                        | —     | —                    | Não entra, como no Inbox                                    |

- **GUIDS com a mesma identidade.** Cada GUIDS entra com o mesmo usuário virtual que usa nas salas de atendimento (`@_guidu_a_…`, IN6). A equipe fala com a mesma persona que atende os clientes. Entram os GUIDS ligados, e os pausados aparecem como tal.
- **Eventos `chat.guidu.proposal` e `chat.guidu.decision` em nível 100:** só o núcleo posta, então nenhum membro ou agente forja uma proposta ou uma aprovação.
- **Histórico visível a partir da entrada** (`joined`): quem entra na equipe não lê automaticamente as tarefas antigas. A confirmar.
- **Tipo** `chat.guidu.ops` no `m.room.create`, registrado no Supabase (`ops_rooms`) e fora das visões e dos avisos do Inbox.

## 3. O que a Matrix oferece

### 3.1 Já usado no núcleo

O núcleo está em `src/core/matrix/` e usa o `matrix-js-sdk` 43.

| Recurso                                                      | Uso hoje                                                  |
| ------------------------------------------------------------ | --------------------------------------------------------- |
| Application Service com usuários virtuais (`@_guidu_.*`)     | O GUIDS entra na sala de atendimento com o nome do agente |
| Níveis de poder por tipo de evento                           | Leitor 0, quem responde 10, estado só pelo núcleo (100)   |
| State event próprio (`chat.guidu.conversation`)              | Status e responsável da conversa                          |
| `m.notice`                                                   | Avisos do sistema                                         |
| Transações deduplicadas pelo `event_id`, processadas num job | Turno do agente no worker                                 |
| Login JWT, contas provisionadas, purge de sala               | Ciclo de vida                                             |

### 3.2 No protocolo, ainda não usado

| Recurso                                                                | Uso na sala                                                               |
| ---------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| **Threads** (`m.thread`)                                               | Cada tarefa é uma thread. A linha principal fica limpa                    |
| **Lista de threads da sala** (API `/threads`)                          | Painel de tarefas sem varrer a timeline                                   |
| **Recibos de leitura por thread**                                      | Não lidas e notificações por tarefa                                       |
| **Resumo da thread** (quantas respostas, a última, se você participou) | Cartão recolhível na gaveta                                               |
| **Edições** (`m.replace`)                                              | O agente atualiza a mesma mensagem enquanto trabalha. É o nosso streaming |
| **Respostas** (`m.in_reply_to`)                                        | Responder um ponto específico dentro da thread                            |
| **Referências** (`m.reference`)                                        | Ligar a decisão à proposta e o resultado ao pedido                        |
| **Menções** (`m.mentions`)                                             | **O gatilho dos agentes** (seção 4) e das notificações                    |
| **Reações** (`m.annotation`)                                           | 👍 / 👀 como confirmação informal. Nunca como aprovação                   |
| **Eventos próprios** (`chat.guidu.*`)                                  | Tarefa, proposta, decisão e relatório, com texto de reserva               |
| **Tipo de sala** e **Spaces**                                          | Distinguir as salas. Um Space por workspace no futuro                     |
| **Mídia** (`m.file`, `m.image`)                                        | Relatórios em PDF e gráficos na thread                                    |
| **Eventos fixados** (`m.room.pinned_events`)                           | Resumo semanal, entrevista de onboarding                                  |
| **Digitando**                                                          | "@ops está trabalhando…"                                                  |
| **Regras de push**                                                     | Notificar menção e thread em que você participa                           |
| **Retenção e redação**                                                 | Prazo de guarda e remoção de conteúdo sensível pelo núcleo                |
| **Busca no servidor** (`/search`)                                      | Basta para uma sala. O Inbox continua buscando no Supabase                |

Enquetes (`m.poll`) e widgets ainda não são estáveis ou são específicos do Element: não usar.

## 4. Quando um agente age: só com @

**Regra única:** um agente age somente quando o seu usuário está em `m.mentions.user_ids` de uma mensagem nova. Sem menção, nenhum agente responde, nem na linha principal nem dentro de uma thread que ele abriu. A regra vale igual na sala de bastidor.

- **Quem pode acionar:**
  - pessoas com poder 10 ou mais;
  - o @ops, quando delega a um GUIDS;
  - o @guidu, quando delega ao @gmn.

  Os demais agentes não acionam ninguém: a menção feita por eles a outro agente é ignorada pelo núcleo. Isso dá um nível só de delegação.

- **Nunca a si mesmo.** Uma menção do próprio agente não dispara turno.
- **Edições não acionam.** Só eventos novos com menção contam.
- **Contexto do turno:** a thread em que foi mencionado (ou, na linha principal, a mensagem e as respostas a ela), a memória do workspace e o registro de origem da tarefa. Nunca a sala inteira.
- **Permissão de quem pediu.** A ação do agente respeita a permissão de quem o mencionou: um atendente não consegue, pelo @ops, fazer o que não pode fazer no painel.
- **Interface:** autocompletar de @ com os agentes e a descrição de uma linha de cada um ("ops — coordena a empresa", "Sofia — atendimento", "guidu — sua conta na plataforma").

## 5. Anatomia da sala

**Linha principal:** conversa da equipe, pedidos com @, resumos de uma linha das tarefas concluídas e avisos da Central de Eventos (`m.notice`, sem push).

**Thread = unidade de trabalho.** Uma menção na linha principal que pede trabalho faz o núcleo criar a raiz da tarefa, e o agente responde dentro da thread:

```json
{
  "msgtype": "m.text",
  "body": "Tarefa: enviar e-mail para os leads de ontem",
  "chat.guidu.task": {
    "task_id": "…",
    "kind": "request",
    "origin": { "type": "ops" },
    "status": "in_progress"
  }
}
```

- O `body` é a reserva para clientes sem o nosso renderizador (Element, ponte de WhatsApp).
- **Status:** aberta, em andamento, aguardando aprovação, concluída, falhou ou cancelada. O núcleo atualiza a raiz por edição. A fonte da verdade é a tabela `ops_tasks` no Supabase, com tarefa, sala, raiz da thread, origem, quem pediu, agentes envolvidos, status e custo.
- **Origem:** pedido direto, registro (contato, item, ficha), rotina ou thread de bastidor (`origin.type = "backstage"`, com a sala de atendimento). As threads de bastidor aparecem aqui como tarefas, com link para a conversa.
- **Continuar a tarefa:** dentro da thread, a pessoa menciona o agente de novo ("@ops usa um tom mais formal").

## 6. O que o @ops faz

Exemplos de pedidos, crescendo por etapas:

- **Consultar:** "@ops pega o contato da Maria", "@ops como está a cotação 123?", "@ops quantos leads entraram hoje?".
- **Agir por proposta:** "@ops manda um e-mail para os leads de ontem", "@ops envia para a Maria que o pedido saiu". A mensagem ou o e-mail chega como proposta e só sai depois da aprovação.
- **Delegar:** "@ops pede ao @vendedor uma cotação de 30 peças para a Maria". O @ops menciona o vendedor na thread, o pedido estruturado vai pelo job e o resultado volta como proposta.
- **Relatar:** "@ops como foi o atendimento da semana?". Ele lê os resumos e eventos dos GUIDS.

Assuntos de plataforma e conta (fatura, limite, consumo da chave) vão para o @guidu. Se alguém perguntar isso ao @ops, ele indica o @guidu.

## 7. Delegação

1. Uma pessoa pede na linha principal: "@ops prepara uma cotação de 30 peças para a Maria".
2. O núcleo cria a raiz da tarefa e o @ops responde na thread, mencionando o GUIDS: "@vendedor monta a cotação de 30 peças do item X para a Maria".
3. A menção feita pelo @ops aciona o vendedor. O pedido estruturado vai pelo job, e a menção é só a parte visível.
4. O vendedor posta uma mensagem de progresso e a edita conforme avança.
5. O resultado chega como `chat.guidu.proposal`, postado pelo núcleo, com o id da proposta no Supabase.
6. "Aprovar" no nosso cliente chama a API (`/proposals/:id/approve`), que confere a permissão. O núcleo posta `chat.guidu.decision` com `m.reference` para a proposta, edita a raiz para "concluída" e executa a ação.
7. A linha principal recebe uma linha só: "✓ Cotação enviada para a Maria (aprovada por Ana)".

O mesmo vale para o @guidu delegando ao @gmn em assuntos da plataforma. Uma pessoa também pode mencionar um GUIDS ou o @gmn diretamente.

## 8. GUIDS na sala

### 8.1 O que a equipe faz com um GUIDS

- **Perguntar sobre o atendimento:** "@Sofia por que transferiu o João?". Ela responde com base nas conversas dela e nos resumos de transferência.
- **Dar feedback e instruções:** "@Sofia a partir de hoje oferece frete grátis acima de R$ 200". Isso vira uma **proposta de ajuste de configuração** do GUIDS, com uma nova versão da configuração e o aviso de "não testada" (A4b), aprovada por quem tem `ai_agents.manage`. O prompt nunca é alterado direto pelo chat.
- **Pedir uma mensagem para um cliente:** ela prepara a mensagem como proposta. O envio na sala de atendimento só acontece depois da aprovação de um atendente.

### 8.2 O que os GUIDS postam sem ser mencionados

Só **avisos do próprio trabalho** que hoje são eventos do núcleo, postados em nome do GUIDS e mencionando quem deve agir:

- transferência: "@Ana transferi o João: quer orçamento para 30 peças";
- lead quente: "@Ana lead quente: Maria, score 85".

São mensagens geradas pelo núcleo a partir do evento, com texto fixo e o resumo já gravado. Não são turno do modelo, então não ferem a regra do @.

### 8.3 Guardrails

1. **Dois modos, um agente.** Nas salas internas, o GUIDS recebe uma seção de prompt própria ("você está falando com a sua equipe, não com um cliente") e um conjunto de ferramentas próprio. No atendimento, continua como hoje.
2. **Nada da sala vaza para o cliente.** O que a equipe diz nas salas internas não entra no contexto dos turnos de atendimento. Uma informação só chega ao cliente pela configuração aprovada ou por uma mensagem aprovada.
3. **Ferramentas nas salas internas:** ler as próprias conversas e os resumos, consultar o Portfólio e o CRM, e propor configuração, mensagem ou cotação. Nada é enviado ao cliente nem gravado no CRM sem proposta.
4. **Chave e consumo:** @ops e os GUIDS usam a chave do cliente e contam no plano. O @guidu e o @gmn usam a nossa chave ou a do parceiro.
5. **Quem instrui:** só membros com poder 10 ou mais, e a ação respeita a permissão de quem mencionou. O texto de clientes citado na thread continua sendo dado.
6. **Limites:** orçamento de tokens por thread e por dia, separado por chave.

## 9. Notificações e leitura

- **Push:** menção a você e resposta numa thread em que você participa. Os avisos da Central de Eventos só geram push quando são graves, e aí o aviso menciona o responsável.
- **Não lidas por thread,** como contador no cartão da gaveta.
- **Fixados:** resumo semanal e entrevista de onboarding.

## 10. Dados, retenção e segurança

- **Na sala:** conversa, resumos e ids. **No Supabase:** tarefas, propostas, decisões, custo e auditoria.
- **Conversa do agente:** reaproveitar `ai_conversations`, que já tem `matrix_room_id`, com o canal `matrix_ops` e o id da raiz da thread. É uma conversa por agente e thread.
- **Retenção:** por exemplo, 12 meses, com redação pelo núcleo quando houver pedido de exclusão e purge quando o workspace é apagado (já existe).
- **Injeção de prompt:** texto de cliente, de documento e de outro agente é dado. Instrução só vem de membro autorizado que mencionou o agente.
- **Desligar sem deploy:** pausar um agente na sala, ou todos os agentes do workspace, pelo painel.

## 11. Limitações a provar antes de construir

1. **Threads no Sliding Sync:** o suporte a threads ainda está amadurecendo. Pode ser preciso usar a API `/threads` e a de relações.
2. **Interface:** o `chatbot-template` não tem threads. É preciso um componente de thread que sirva na gaveta, no painel do Inbox (bastidor) e no guidu.chat.
3. **Edições em rajada:** limitar a cerca de uma edição por segundo e confirmar que os usuários do AS estão fora do rate limit (`rate_limited: false`).
4. **Thread não aninha:** a delegação fica na mesma thread, o que combina com o nível único de delegação.
5. **Menções:** confirmar que o `matrix-js-sdk` 43 e o nosso compositor preenchem `m.mentions`, e que o núcleo não depende do texto `@nome` no `body`.

**AM0, prova contra o Synapse de teste:**

- salas com os tipos `chat.guidu.ops` e `chat.guidu.backstage`;
- thread com raiz própria;
- edições no ritmo do streaming;
- menção que aciona e menção ignorada (de agente sem permissão de delegar, de si mesmo, por edição);
- recibo por thread;
- lista de threads pelo SDK;
- evento em nível 100 recusado para poder 10;
- o mesmo usuário virtual do GUIDS na sala de atendimento e nas internas.

## 12. Primeiro recorte

- **AM1:** a sala por workspace, com o @ops, os GUIDS, o @guidu e o @gmn como membros, a regra do @, uma thread por pedido, o streaming por edição e os avisos de transferência e lead quente.
- **AM2:** a gaveta do cabeçalho como cliente da sala.
- **AM3:** delegação (@ops aos GUIDS, @guidu ao @gmn) com proposta e aprovação.
- **AM4:** sala de bastidor no Inbox, com as threads aparecendo aqui como tarefas.

## 13. Perguntas

1. Editor e leitor entram na sala só para ler, ou ficam de fora?
2. Histórico a partir da entrada (`joined`) ou desde a criação?
3. GUIDS pausado continua na sala, só sem responder, ou sai?
4. A resposta de um GUIDS ou do @ops nas salas internas conta no consumo do plano ou numa cota separada?
