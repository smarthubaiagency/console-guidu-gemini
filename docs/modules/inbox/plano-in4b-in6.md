# Plano do par IN4b + IN6: contexto, etiquetas e avisos; GUIDS na sala

- **Data:** 17/10/2026. Base: `main` com IN3, WS1, IN4a ([janela-inbox.md](janela-inbox.md)), H1 e H2 (Central de Eventos, regras de aviso).
- **Estado:** aprovado em 17/10/2026 com todas as sugestões da seção 5. IN4b na `main` (#120, [contexto-inbox.md](contexto-inbox.md)); IN6 em PR a partir de `claude/in6-guids-sala` ([guids-na-sala.md](guids-na-sala.md)).
- **Migrations reservadas:** IN4b `20261214090000_in4b_inbox_context`, IN6 `20261215090000_in6_guids_in_room`, depois da `20261213090000` da AJ1 (que tomou o número antes reservado à IN6). A `20261211090000` é da GB1c.

## 1. O que você vai ver no fim

**IN4b (contexto, etiquetas e avisos)**

- Na lista: a etiqueta de cada conversa, o número de mensagens não lidas e o filtro por etiqueta. Na aba do navegador: "(3) Inbox".
- No painel de contexto: o **contato do CRM** da conversa (nome, telefone e e-mail), criado com o nome do perfil quando a conversa nasce. O atendente pode ligar a conversa a outro contato que já existe (busca) quando descobre quem é. E as **etiquetas** da conversa, com o catálogo do workspace.
- No sino (e no e-mail, se a pessoa ligar): **conversa nova** (para os atendentes), **conversa atribuída a você** e **conversa sem resposta há 15 minutos** (para o responsável; sem responsável, para os atendentes).

**IN6 (GUIDS na sala)**

- Em Inbox › Configurações, o dono ou admin escolhe **qual GUIDS atende** as conversas do Inbox (ou nenhum).
- Conversa **pendente** (sem atendente): o GUIDS responde sozinho, com as regras da A5b: agrupa as mensagens seguidas, respeita o máximo de mensagens e de caracteres e o intervalo entre elas, mostra "digitando". Na sala, ele aparece com o nome do agente.
- **Transferência:** quando o GUIDS decide transferir, a conversa vira **aberta e sem responsável** ("Não atribuídas") e o resumo do GUIDS aparece no painel de contexto, só para a equipe. Um atendente assume, ou quem gerencia atribui.
- **Volta ao bot:** botão "Devolver ao GUIDS" no painel (a conversa volta para pendente). Uma conversa resolvida em que o cliente volta a escrever reabre como pendente, com o GUIDS.
- O cliente nunca vê nada interno: o resumo e as etiquetas ficam no Supabase.

## 2. Como funciona por dentro

**Peça comum: marcas de mensagem (vai na IN4b).** Hoje o núcleo não registra nada das mensagens. A IN4b passa a registrar só **quando** chegou mensagem e **de quem** (consumidor, atendente ou agente), sem o texto: `matrix_rooms.last_consumer_message_at`, `last_team_message_at` e `last_agent_message_at`. O texto continua só no Synapse (ADR 0023, regra 6). A IN4b usa isso para o aviso "sem resposta"; a IN6, para disparar o turno do GUIDS. Por isso a **IN4b entra primeiro** na `main`, e a IN6 traz a `main` antes do PR. As duas são feitas em paralelo, cada uma no seu worktree, como manda o `AGENTS.md`.

**IN4b**

- **Etiquetas:** `inbox_labels` (catálogo por workspace: nome e cor) e `inbox_room_labels` (sala × etiqueta). Quem gerencia cria, renomeia e apaga; quem responde põe e tira etiquetas.
- **Contato do CRM:** `inbox_conversations` (sala → contato do CRM), tabela do módulo Inbox. Quando o núcleo abre uma sala, chama um gancho que os módulos registram (como os ganchos do ciclo de vida da WS1); o do Inbox cria o contato pelo serviço público do CRM (`createContact`), respeitando a cota de contatos. Ligar a outro contato usa `listContacts`. O Inbox não lê tabela do CRM direto (ADR 0014, revisão de 16/10, item 5).
- **Não lidas:** dos recibos de leitura do Matrix, que cada atendente tem por ser dono da conta (a IN4a já envia o recibo ao abrir a conversa). O Sliding Sync traz a contagem por sala. Nada vai para o banco.
- **Avisos:** três tipos novos no catálogo da Central de Eventos (`inbox.conversation.new`, `inbox.conversation.assigned`, `inbox.conversation.unanswered`), com sino por padrão e e-mail desligado (cada um liga nas preferências; a H2 deixa ajustar a regra por workspace). A rota "atendentes do Inbox" é nova na lista de destinatários; "atribuída a você" usa a rota da pessoa. O "sem resposta" é um job a cada 5 minutos que olha as marcas de mensagem, com chave por conversa e período (não repete).

**IN6**

- **Serviço público do módulo Agentes de IA para hubs** (`canais.md` §3.5): `runTurn` responde um turno sem enviar nada, reaproveitando o turno do GUIDS da A5b (o mesmo usado pelo Chatwoot). O Inbox, dono da rota, envia.
- **Usuário virtual do GUIDS na sala:** `@_guidu_a_<opaco>:<server>`, com o nome do agente, poder 10 (só manda mensagem). Status e transferência continuam com o núcleo, que grava o estado.
- **Turno:** a marca de mensagem do consumidor numa sala pendente agenda o job `inbox.guids-turn` com o atraso do agrupamento (um turno por sala de cada vez). O job lê as mensagens novas e o histórico no Synapse (como núcleo), chama o `runTurn`, envia as respostas como o usuário do agente, com "digitando" e o intervalo, e executa a transferência.
- **Ligação com a conversa do agente:** `ai_conversations` ganha a sala (`matrix_room_id`), como já tem a conversa do Chatwoot. O consumo e as conversas do GUIDS continuam no módulo Agentes de IA.
- **Configurações do Inbox:** entrada do manifesto em Configurações › Módulos › Inbox: o GUIDS que atende e as regras de atendimento (agrupamento, máximo de mensagens e de caracteres, intervalo), com os padrões da A5b.

## 3. Testes

- **IN4b:** suíte SQL das etiquetas e das ligações; integração do gancho que cria o contato e das marcas de mensagem (Synapse local); unidade dos avisos e da regra "sem resposta"; e2e no `e2e-inbox`: etiquetar, filtrar, ver o contato, não lidas e o aviso no sino.
- **IN6:** unidade do serviço `runTurn` com o modelo falso dos testes (o mesmo da A5b); integração do turno com o Synapse local (cliente escreve, GUIDS responde, transfere, volta ao bot); e2e no `e2e-inbox`: o cliente fala com o GUIDS, o GUIDS transfere, o atendente assume.

## 4. Fora deste par

Ferramentas do painel (IN5: portfólio, notas internas, respostas rápidas, Assistente), WhatsApp da Meta (IN7), áudio na sala (o GUIDS ouvir e responder em áudio fica para depois; na IN6 é só texto), visão Pedidos e reservas e o Inbox do parceiro no modo gerenciado.

## 5. Perguntas (minha sugestão entre parênteses)

1. **Ordem de merge:** IN4b primeiro, IN6 traz a `main` depois. (Sim.)
2. **Contato criado sozinho:** toda conversa nova cria um contato no CRM com o nome do perfil, mesmo que o cliente nunca diga mais nada? Se a cota de contatos do plano acabar, a conversa segue sem contato e o painel avisa. (Sim, como na especificação §2.)
3. **Etiquetas:** quem cria o catálogo? (Dono e Admin, como pede a especificação §3; quem responde só aplica.)
4. **Aviso "sem resposta":** conta a partir da última mensagem do cliente sem resposta de um atendente, só em conversas abertas (com humano) e pendentes sem GUIDS ligado. Avisa uma vez por mensagem sem resposta. (Sim.)
5. **Conversa nova:** avisa os atendentes também quando o GUIDS está atendendo? (Não: só quando a conversa chega sem GUIDS ou quando o GUIDS transfere, para não encher o sino.)
6. **GUIDS do Inbox:** um GUIDS por workspace para todas as conversas do Inbox. (Sim, na v1; por canal fica para a IN7.)
7. **Transferência:** conversa transferida fica aberta e sem responsável, em "Não atribuídas", com o resumo no painel. (Sim.)
8. **Volta ao bot:** "Devolver ao GUIDS" para quem responde; e conversa resolvida que recebe mensagem nova volta pendente, com o GUIDS. (Sim.)
9. **Nome do GUIDS na sala:** o cliente vê o nome do agente (ex.: "Lia"), sem dizer que é robô além do que o próprio agente diz. (Sim; a regra de se apresentar como IA é do prompt do agente.)
