# Agentes na Matrix e compra agêntica

- **Status:** Proposta para discussão. Nada aqui foi implementado.
- **Data:** 19/10/2026
- **Origem:** conversa de Marcelo com o Claude em 18 e 19/10/2026, a partir do padrão "chief of staff" do Grok Bot (xAI) e do desenho atual do Inbox na Matrix.
- **Decisões do Marcelo em 19/10/2026:**
  - agentes e humanos juntos nas salas internas, e todo agente só age quando é mencionado com @;
  - o GUIDU e o GUIDU GMN são agentes de plataforma, com a nossa chave, para dúvidas da plataforma e da conta do cliente;
  - todo cliente novo nasce com **quatro GUIDS de fábrica**, com a chave do cliente: @ops, orquestrador, atendente e vendedor;
  - conversas internas sobre um lead ficam numa **sala de bastidor**, nunca na sala do lead, e as notas ficam no Supabase;
  - tradução do chat em tempo real com a chave do cliente, por modelo de IA ou Google Translate, com fallback entre os dois ([traducao.md](../modules/inbox/traducao.md)).
- **Relaciona-se com:** [ADR 0011](../adr/0011-camada-de-canais-no-nucleo.md) (canais), [ADR 0015](../adr/0015-janela-de-edicao-gaveta-interna.md) (gaveta), [ADR 0017](../adr/0017-sdk-dos-agentes-de-ia.md) (motor), [ADR 0019](../adr/0019-subagente-especialista.md) (especialista), [ADR 0020](../adr/0020-modo-de-servico-gerenciado.md) (gerenciado), [ADR 0022](../adr/0022-central-de-eventos.md) (eventos), [ADR 0023](../adr/0023-chat-interno-como-cliente-matrix.md) (Inbox na Matrix), [plano da F5](../operacao/plano-f5.md) (Portfólio e UCP), [GUIDS na sala](../modules/inbox/guids-na-sala.md), [sala de operação](sala-de-operacao.md).

Estamos em desenvolvimento: as ADRs são referência, não decisão final. Onde a proposta contraria uma ADR, a seção 9 diz o que muda.

## 1. Resumo

1. **Compra agêntica (prioridade).** O consumidor pede pelo WhatsApp ao nosso agente de compras (o orquestrador guidu.bot, chamado aqui de **botmercado**). Ele pesquisa no Portfólio das lojas, o consumidor escolhe, e o botmercado fecha com o **GUIDS vendedor** da loja numa sala de negócio. O carrinho é montado por código e o consumidor paga no checkout do guidu.chat. Nenhum agente paga nem inventa preço.
2. **Quatro GUIDS de fábrica por cliente:** @ops (coordena a empresa), orquestrador (porta de entrada do atendimento), atendente e vendedor.
3. **Sala de operação.** A "sala de reuniões" de cada empresa, onde a equipe e os agentes trabalham juntos em threads, chamando os agentes com @ ([sala-de-operacao.md](sala-de-operacao.md)).
4. **Sala de bastidor.** Para cada conversa com um lead, uma sala interna só da equipe e dos agentes, mostrada no Inbox como "threads desta conversa". O lead nunca é membro.
5. **Mesma sala, várias janelas.** A gaveta do cabeçalho, a gaveta de registro, o painel do Inbox e o guidu.chat mostram recortes das mesmas salas.
6. **guidu.chat com modo loja.** O comerciante acompanha as conversas e responde as transferências pelo celular.

## 2. Papéis e princípios

### 2.1 Quem é quem

| Agente                              | Onde atua                                 | Chave                | Papel                                                                                      |
| ----------------------------------- | ----------------------------------------- | -------------------- | ------------------------------------------------------------------------------------------ |
| **@guidu** (Assistente GUIDU)       | Gaveta do cabeçalho e sala de operação    | Nossa ou do parceiro | Dúvidas da plataforma e da conta: faturamento, limites, consumo, relatórios da conta       |
| **@gmn** (GUIDU GMN)                | Gaveta da automação e sala de operação    | Nossa ou do parceiro | Especialista da plataforma em fichas do Google                                             |
| **@ops** (GUIDS de fábrica)         | Sala de operação e salas de bastidor      | Do cliente           | Coordena a empresa: contatos, mensagens, e-mails, cotações, pedidos, relatórios do negócio |
| **Orquestrador** (GUIDS de fábrica) | Salas de atendimento (canais)             | Do cliente           | Porta de entrada. Responde o simples e encaminha ao atendente ou ao vendedor               |
| **Atendente** (GUIDS de fábrica)    | Por trás do orquestrador; bastidor        | Do cliente           | SDR, agendador ou suporte. Prompt editável                                                 |
| **Vendedor** (GUIDS de fábrica)     | Por trás do orquestrador; sala de negócio | Do cliente           | Compra agêntica: produtos, cotação e carrinho                                              |
| **botmercado** (guidu.bot)          | WhatsApp do consumidor; sala de negócio   | Nossa                | Agente do comprador: pesquisa preço, escolhe a loja e fecha com o vendedor                 |

### 2.2 Princípios

1. **Cada orquestrador no seu lado.** Empresa: @ops. Plataforma e conta: @guidu. Consumidor: o orquestrador da loja (e o botmercado, do lado do comprador). Dois orquestradores nunca disputam a mesma pessoa nem o mesmo assunto.
2. **O que vale é o banco.** Preço, estoque, frete, carrinho, pedido, proposta, aprovação, nota e tradução ficam no Supabase. A sala Matrix mostra a conversa e leva só o id do registro.
3. **Texto de agente e de cliente é dado, nunca instrução.** Instrução só vem de membro autorizado que mencionou o agente.
4. **Nada interno na sala do consumidor** (ADR 0023, regra 6). Não existe nota privada dentro de uma sala Matrix: todo membro recebe todos os eventos. O interno vai para o Supabase (notas) ou para a sala de bastidor (conversa).
5. **Ação externa só por proposta** (ADR 0019, regra 7). Pagamento é sempre feito pela pessoa.
6. **Uma persona por lado.** O consumidor vê um nome, o da loja ou o do botmercado, mesmo quando há vários agentes por trás.
7. **Só com @.** Nas salas internas, nenhum agente age sem ser mencionado.

## 3. Compra agêntica de ponta a ponta (prioridade)

### 3.1 O que já existe

- O Portfólio guarda itens e variantes no formato do UCP, com preço em centavos, estoque e lojas (`workspace_locations`), e é "a fonte do commerce agentic" ([especificação do Portfólio](../../src/modules/portfolio/MODULE_SPEC.md)).
- Decisão de 11/10/2026: "a conversa é sempre com o orquestrador guidu.bot, e o checkout é sempre o nosso, no guidu.chat (fase 2)". A saída UCP já traz `url` e `continue_url` para o nosso fluxo.
- Carrinho, checkout e pedido ficaram fora da F5. O Stripe Connect está configurado na aba Gateway, com a cobrança real desligada ([pendências](../pendencias.md)). A P6 trata da cobrança das assinaturas; o pagamento das vendas ao consumidor é outro fluxo, com repasse à loja.

### 3.2 Fluxo

1. **Pedido.** O consumidor escreve ao botmercado no WhatsApp. O botmercado pergunta o que falta (local, orçamento, entrega ou retirada, prazo) e pede o consentimento para compartilhar dados com a loja escolhida.
2. **Busca, por código.** Um serviço interno consulta o Portfólio das lojas participantes: preço, disponibilidade, distância, horário e avaliação. O ranking é código, com critério explicável ("mais barato", "mais perto", "entrega hoje"). O modelo só resume.
3. **Escolha.** O consumidor recebe 2 ou 3 opções e escolhe, ou diz "escolha o melhor", e o botmercado aplica o critério que mostrou.
4. **Fechamento com o vendedor.** O botmercado pede cotação estruturada (SKUs, quantidades, entrega, CEP). O vendedor confirma estoque, frete e prazo e pode dar desconto só dentro dos limites que o comerciante configurou. Item sob consulta ou pedido fora da regra vira transferência para a equipe.
5. **Carrinho, por código.** O serviço cria o carrinho a partir das variantes do Portfólio, com reserva de estoque por tempo curto. O texto dos agentes nunca define preço.
6. **Aceite e pagamento.** O botmercado manda o resumo e o link do checkout no guidu.chat (`continue_url`). O consumidor confirma e paga (Pix ou cartão).
7. **Pedido.** O pagamento confirmado vira pedido. A loja é avisada na sala de operação e o @ops resume. Abre-se uma sala de atendimento no Inbox entre consumidor e loja para o pós-venda.
8. **Pós-venda.** O botmercado acompanha a entrega e pede avaliação. Devolução, estorno e disputa seguem por regra, com humano.

### 3.3 Sala de negócio

- Uma sala Matrix por negociação, com o botmercado e o vendedor da loja como usuários virtuais e a equipe da loja podendo assistir e entrar. O consumidor não é membro.
- As mensagens levam eventos próprios, por exemplo `chat.guidu.quote_request`, `chat.guidu.quote`, `chat.guidu.cart`, com o id do registro no Supabase e um esquema validado (Zod). Linguagem natural fica para o que não cabe na estrutura.
- Limite de rodadas e de tempo por negociação. Estourou, vai para a equipe da loja.
- Histórico auditável do que cada agente disse, ligado à Central de Eventos.
- No primeiro recorte (3.6), a confirmação de estoque pode ser um pedido estruturado respondido por botão, sem sala. A sala se paga quando houver orçamento sob consulta ou desconto negociado.

### 3.4 Estados

| Registro | Estados                                                                                                          |
| -------- | ---------------------------------------------------------------------------------------------------------------- |
| Cotação  | pedida → respondida → expirada ou recusada                                                                       |
| Carrinho | rascunho → proposto → aceito → pago → cancelado ou expirado                                                      |
| Pedido   | criado → confirmado pela loja → em preparo → entregue ou retirado → concluído; cancelado e estornado em paralelo |

Cada transição é feita por código, emite evento (ADR 0022) e fica auditada.

### 3.5 Decisões em aberto

1. **botmercado = guidu.bot?** Este documento assume que sim.
2. **Modelo de pagamento.** Ao cobrar do consumidor e repassar à loja, a plataforma vira intermediária de pagamento e marketplace (Código de Defesa do Consumidor, estorno, nota fiscal, regras do Stripe Connect). Precisa de decisão jurídica e comercial antes da CA1.
3. **Neutralidade.** Somos a plataforma do comprador e da loja. Regras de ranking públicas, patrocínio sempre identificado, e o critério mostrado em toda recomendação.
4. **Quem paga os tokens do vendedor** na negociação: plano do cliente, comissão ou nossa chave.
5. **Carrinho com várias lojas.** Um pedido por loja; checkout único ou um por loja.
6. **Lojas participantes.** Opt-in do comerciante, com limites de desconto e itens que o botmercado pode oferecer.
7. **Número do botmercado.** Meta Cloud API (oficial, com janela de 24 h e templates) ou número não oficial. Para compra, a recomendação é o oficial.

### 3.6 Primeiro recorte

Uma loja, um item com preço fixo, retirada na loja, sem desconto. O vendedor só confirma estoque e o consumidor paga no guidu.chat. Depois entram entrega e frete, descontos em faixas, várias lojas e carrinho com várias lojas.

## 4. Agentes na Matrix

### 4.1 Tipos de sala

| Tipo                                                                               | Membros                                                                     | Para quê                                       |
| ---------------------------------------------------------------------------------- | --------------------------------------------------------------------------- | ---------------------------------------------- |
| **Atendimento** (já existe, IN4 a IN7)                                             | Consumidor, atendentes, o orquestrador                                      | Conversa da loja com o consumidor              |
| **Operação** (nova, uma por workspace)                                             | Equipe, @ops, @guidu, @gmn, os GUIDS e, no gerenciado, a equipe do parceiro | A "sala de reuniões" da empresa                |
| **Bastidor** (nova, uma por conversa de atendimento, criada quando alguém precisa) | Equipe que atende, @ops e os GUIDS                                          | Conversa interna sobre aquele lead, em threads |
| **Negócio** (nova, uma por negociação)                                             | botmercado, vendedor, equipe da loja (assiste)                              | Compra agêntica                                |

O tipo vai no `m.room.create` (campo `type`: `chat.guidu.ops`, `chat.guidu.backstage`, `chat.guidu.deal`) e no espelho do Supabase. Só a sala de atendimento entra nas visões e nos avisos do Inbox.

### 4.2 GUIDS de fábrica

Todo cliente novo nasce com quatro GUIDS, criados a partir de **modelos de agente da plataforma** (A3a), com a divisão de campos editáveis de `src/core/ai/config/editing.ts`.

| GUIDS            | Onde                                                          | O que o cliente edita                                 | O que fica travado                                                                           |
| ---------------- | ------------------------------------------------------------- | ----------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| **@ops**         | Sala de operação e salas de bastidor                          | Nome, tom, instruções do negócio                      | Só age com @, ação externa por proposta, permissão de quem mencionou                         |
| **Orquestrador** | Único GUIDS ligado aos canais (uma rota por escopo, ADR 0011) | Nome e persona da loja, tom, mensagens de boas-vindas | Regras de encaminhamento ao atendente e ao vendedor, transferência para a equipe             |
| **Atendente**    | Por trás do orquestrador                                      | **Prompt livre**: SDR, agendador, suporte             | Guardrails comuns dos GUIDS                                                                  |
| **Vendedor**     | Por trás do orquestrador; sala de negócio                     | Tom, argumentos de venda                              | Preço e estoque só do banco, desconto só na faixa do comerciante, pagamento só pelo checkout |

Regras comuns:

1. **Chave do cliente.** Os quatro usam a chave do cliente e nascem **desligados**. Ligar um GUIDS exige um teste com sucesso usando a chave (A4b), então o onboarding pede a chave ou explica isso.
2. **Uma persona para o consumidor.** O consumidor só vê o orquestrador. Atendente e vendedor respondem por meio dele (delegação estruturada, um nível).
3. **Custo.** Cada mensagem passa pelo orquestrador e, quando ele encaminha, por mais um agente. Para conter isso, o orquestrador usa um modelo barato e responde sozinho o simples (saudação, horário, endereço).
4. **Vendedor antes do checkout.** Até as etapas CA1 e CA2, o vendedor só apresenta itens do Portfólio e passa para a equipe. O prompt de fábrica diz isso.
5. **Na sala de operação e no bastidor,** os quatro podem ser mencionados com @. Só o @ops (empresa) e o @guidu (plataforma) acionam outros agentes.

### 4.3 Sala de operação

Detalhada em [sala-de-operacao.md](sala-de-operacao.md): a "sala de reuniões" da empresa, com a equipe, o @ops, os agentes da plataforma e os GUIDS, threads por tarefa, delegação visível, aprovação na sala e a regra do @.

### 4.4 Sala de bastidor e notas

Numa sala de atendimento, o consumidor é membro e recebe todos os eventos, threads incluídas, e a interface não consegue esconder nada dele. Por isso o interno sobre um lead tem dois lugares:

|                           | **Nota** (Supabase, previsto na IN5)      | **Sala de bastidor** (Matrix)                |
| ------------------------- | ----------------------------------------- | -------------------------------------------- |
| Serve para                | Anotar: "cliente prefere entrega à tarde" | Conversar: threads, colegas, @vendedor, @ops |
| Agentes                   | Leem como contexto                        | Participam com a regra do @                  |
| Tempo real, menções, push | Não                                       | Sim, do Matrix                               |
| Lead vê                   | Nunca                                     | Nunca: não é membro                          |

**Sala de bastidor:**

- Criada pelo núcleo na primeira vez que alguém abre uma thread interna naquela conversa. Fica ligada à sala de atendimento no espelho do Supabase (`backstage_room_id`).
- **Membros:** a equipe com acesso ao Inbox daquele workspace e **todos os GUIDS** do workspace (decisão de 19/10/2026), incluindo o @ops. O consumidor nunca.
- **Na interface,** aparece no Inbox ao lado da timeline como **"Threads desta conversa (n)"**. Cada demanda vira uma thread ("orçamento de 30 peças").
- **O resultado volta à conversa só por um humano:** uma mensagem sugerida é inserida e enviada pelo atendente, e uma cotação passa por proposta.
- **Aparece na operação:** cada thread do bastidor vira uma tarefa visível na sala de operação, com a origem "conversa X", e o @ops enxerga tudo.

**Notas:** no Supabase por `room_id`, como previsto na IN5. São auditadas, e quem tem `inbox.view` lê. Uma nota pode virar thread ("discutir esta nota"), e uma thread pode gerar uma nota ("salvar conclusão").

### 4.5 Tradução do chat

Detalhada em [traducao.md](../modules/inbox/traducao.md). O comerciante lê e escreve em português, e o lead recebe no idioma dele. Isso é ligado nas configurações do Inbox, com a chave do cliente, por modelo de IA ou Google Translate, com fallback entre os dois. A tradução fica no Supabase, nunca na sala do lead.

## 5. Matrix nas janelas do painel

| Janela                                 | Hoje                                            | Proposta                                                                    |
| -------------------------------------- | ----------------------------------------------- | --------------------------------------------------------------------------- |
| Gaveta do cabeçalho (ADR 0015)         | "Em breve", reservada para a A8                 | A linha principal da sala de operação, com cartões de tarefa recolhíveis    |
| Gaveta de registro (`RecordWorkbench`) | Edição de CRM, Portfólio e outros               | "Perguntar à equipe" abre uma thread na sala de operação ligada ao registro |
| Painel do Inbox                        | Cartão do GUIDS; IN5 prevê notas e "Assistente" | Notas (Supabase) e "Threads desta conversa" (sala de bastidor)              |
| Gaveta do especialista GMN             | Responde dúvidas (GB1a)                         | Continua igual e grava a conversa como thread da sala de operação           |

Pontos a resolver:

- **Uma gaveta por vez.** Quando há um registro aberto e a pessoa chama um agente, ele abre com aquele registro como contexto, em vez de trocar de gaveta sem aviso.
- **Largura.** Em 350 px, cartões resumidos. A thread completa e as aprovações com detalhes ficam em 700 px.
- **URL.** `?thread=<id>`, como o `?edit=<id>` da ADR 0015.
- **Inbox em tela cheia.** Ele não usa o `WorkbenchLayout`. O componente de thread precisa funcionar nos dois lugares.
- **Streaming.** Pela sala, o texto chega por edição da mensagem (`m.replace`), com o turno no worker.

## 6. guidu.chat com modo loja

O guidu.chat ainda não existe: nos testes, o Element faz o papel dele. O modo loja depende do app.

- **O que mostra:** Não atribuídas, Minhas, Com o GUIDS, a conversa aberta com "Assumir" e "Devolver ao GUIDS", o resumo da transferência, as threads do bastidor e a sala de operação.
- **Push na transferência**, respeitando quem está de plantão.
- **Duas identidades.** Contas Matrix separadas para consumidor e atendente (`u_…`), com um seletor "Minha loja".
- **Estado pelo servidor.** Assumir, devolver e resolver chamam a API do console, que revalida a permissão e grava o estado.
- **Dados internos pela API.** Etiquetas, notas, traduções e o resumo do GUIDS vêm do Supabase, só no modo loja.
- **Quem atende.** Vale a regra do Inbox de 17/10/2026: só quem é marcado como atendente responde.

Primeiro recorte: só o handoff. Push, abrir, assumir, responder e devolver.

## 7. Segurança

### 7.1 Agentes

1. **Injeção de prompt.** Texto do consumidor, de outro agente, de documento ou de página buscada é dado. As ferramentas ficam em lista fixa validada no servidor a cada chamada, e nenhum argumento de ferramenta escolhe workspace, loja ou ficha (ADR 0019, regra 4).
2. **Agentes chamando agentes.** Só o @ops e o @guidu delegam, cada um no seu assunto, e o orquestrador encaminha só ao atendente e ao vendedor. Um nível de delegação, orçamento de tokens e de tempo por pedido, e limite de rodadas na sala de negócio.
3. **Autonomia limitada.** Toda ação externa passa por proposta. Desconto só dentro da faixa do comerciante. Pagamento sempre pela pessoa.
4. **Saídas com schema.** Cotação, carrinho e delegação são validados (Zod). Inválido: repara, repete ou passa para humano.
5. **Desligar sem deploy.** Botão para pausar um agente, uma ferramenta ou a compra agêntica de um workspace, e um para a plataforma inteira.
6. **Limites.** Por usuário, workspace, ferramenta e agente, separados por chave (nossa ou do cliente).

### 7.2 Matrix

1. **Quem vê o quê.** Todo membro de uma sala lê tudo nela. O detalhe sensível de um lead fica no bastidor ou no Supabase, e não na sala de operação.
2. **Gerenciado (ADR 0020).** A equipe do parceiro entra nas salas internas só no modo gerenciado, e sai na hora em que o cliente volta ao padrão.
3. **Usuários virtuais.** Namespace reservado (`@_guidu_.*`). Só o núcleo escreve estado, tipo de sala, propostas e decisões (nível 100).
4. **JWT.** As regras da ADR 0023 (RS256, `exp` curto, só `sub` de atendente) valem também no guidu.chat. No modo loja: 2FA, sessão mais curta e "sair de todos os dispositivos".
5. **Sem E2EE** (ADR 0023, regra 3): o servidor é nosso e o transporte é TLS. Backup e retenção das salas novas seguem as do Inbox.
6. **Ciclo de vida.** Membro que sai do workspace perde a conta e sai das salas. O workspace apagado apaga todas as salas: atendimento, operação, bastidor e negócio.

### 7.3 Compra

1. **Preço e estoque só do banco.** O carrinho é montado por código a partir das variantes. A cotação expira e a reserva de estoque é curta.
2. **Dados do consumidor (LGPD).** A loja recebe o mínimo, e só depois do aceite ou do pagamento. Consentimento registrado.
3. **Identidade.** Telefone verificado pelo canal. Mudança de endereço de entrega pede confirmação.
4. **Fraude e disputa.** Antifraude do provedor de pagamento, limite por consumidor novo, estorno com humano.
5. **Rastro.** Cada pedido liga a cotação, o carrinho, as mensagens da sala de negócio e o pagamento, com selo de integridade (ADR 0022, regra 5).

### 7.4 Números não oficiais

O Assistente fala hoje por um WhatsApp não oficial, pelo fluxo do parceiro (plano da A6). Trazê-lo para o núcleo (adaptador Evolution) traz risco de banimento e menos garantias. Para compra, a recomendação é o número oficial da Meta.

## 8. Inovação

1. **Equipe e IA na mesma sala.** Ferramentas como o Grok Bot são pessoais e os inbox do mercado põem a IA de lado. Aqui a equipe da loja e os agentes trabalham juntos, com histórico, pelo painel ou pelo celular.
2. **Delegação visível.** Cada pedido mostra quem fez o quê, em threads. Isso dá confiança ao pequeno comerciante para soltar tarefas para a IA.
3. **Equipe de IA pronta no primeiro dia.** Quatro GUIDS de fábrica que o cliente só ajusta.
4. **Compra entre agentes com protocolo aberto.** UCP na descoberta e fechamento estruturado entre o agente do comprador e o vendedor da loja, com o checkout nosso.
5. **Atendimento em qualquer idioma.** O turista escreve em espanhol, a loja lê e responde em português.
6. **Um app de bolso para o comerciante.** O guidu.chat como lugar para atender, aprovar e falar com o @ops.
7. **Entrevista de onboarding.** O @ops entrevista o comerciante e monta a memória do workspace que todos os agentes usam.

## 9. Alterações nas ADRs

| ADR                        | O que muda                                                                                                                                                                                                                                                                                                                                                                                                                     |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **0011** (canais)          | Regra 3: as salas internas também são escopos, com dono próprio. Regra 4: o orquestrador encaminha ao atendente e ao vendedor dentro da mesma rota, sem rota paralela. Novo adaptador para o número do botmercado e, se for mantido, o Evolution para o número não oficial do Assistente.                                                                                                                                      |
| **0013** (idiomas)         | Acrescentar o idioma do contato e a tradução das conversas, que não é tradução do painel.                                                                                                                                                                                                                                                                                                                                      |
| **0015** (gaveta)          | `?thread=<id>` ao lado do `?edit=<id>`. A gaveta do cabeçalho vira cliente da sala de operação. Regra para quando um agente é chamado com um registro aberto.                                                                                                                                                                                                                                                                  |
| **0017** (motor)           | O turno acionado pela sala roda no worker, com streaming por edição de mensagem. A tradução com a chave do cliente passa pelo motor.                                                                                                                                                                                                                                                                                           |
| **0019** (especialista)    | O Assistente fica com plataforma e conta. Regra 3: o especialista pode escrever nas threads da sala de operação, mas nunca com o consumidor. Acrescentar o limite de delegação e o orçamento por pedido.                                                                                                                                                                                                                       |
| **0020** (gerenciado)      | A equipe do parceiro entra nas salas internas só no gerenciado e sai junto com o acesso.                                                                                                                                                                                                                                                                                                                                       |
| **0022** (eventos)         | Novo destino `matrix`, que posta o aviso na sala de operação. Novos tipos: tarefa, delegação, cotação, carrinho, pedido, pagamento e transferência de GUIDS.                                                                                                                                                                                                                                                                   |
| **0023** (Inbox na Matrix) | Regra 1: as salas têm tipos (atendimento, operação, bastidor, negócio), e só a de atendimento entra nas visões do Inbox. Regra 5: o guidu.chat também é cliente do comerciante (modo loja). Regra 6: notas no Supabase e conversa interna na sala de bastidor. Regra 8: as salas novas têm outros donos de rota. Regra 9: as regras do JWT valem no guidu.chat. Regra 10: o espelho guarda o tipo da sala e o bastidor ligado. |
| **Plano da F5**            | O "fora da F5" (carrinho, checkout e pedido) vira as etapas CA da seção 10.                                                                                                                                                                                                                                                                                                                                                    |

ADRs novas propostas:

- **0024 — Salas de agentes na Matrix:** tipos de sala, sala de operação, sala de bastidor, threads, regra do @ e os GUIDS de fábrica.
- **0025 — Compra agêntica:** botmercado, vendedor, sala de negócio, protocolo de cotação e carrinho, estados, pagamento e neutralidade.

## 10. Roadmap

Os nomes das etapas são provisórios. A ordem de execução está em [prioridades-agentes-e-inbox.md](prioridades-agentes-e-inbox.md): P1 é o Inbox e os GUIDS de fábrica, P2 a sala de operação e P3 as janelas. O guidu.chat com modo loja e a compra agêntica ficam em espera, com a tomada pronta. A AM4 virou a SB1, no P1.

| Etapa         | Entrega                                                                                                                      | Depende de                         |
| ------------- | ---------------------------------------------------------------------------------------------------------------------------- | ---------------------------------- |
| **CA0**       | ADR 0025, decisão jurídica e comercial do pagamento, especificação de cotação, carrinho e estados                            | Respostas da seção 11              |
| **CA1**       | Carrinho e pedido no núcleo (tabelas, estados, eventos), montados das variantes do Portfólio, com reserva de estoque         | CA0                                |
| **CA2**       | Checkout no guidu.chat com Pix e cartão e repasse à loja; pagamento vira pedido                                              | CA1 e o pagamento de vendas ligado |
| **CA3**       | botmercado no WhatsApp: entrevista, busca e ranking por código, uma loja, preço fixo, retirada, estoque confirmado por botão | CA2                                |
| **CA4**       | Sala de negócio: botmercado ↔ vendedor com eventos estruturados e transferência para a equipe                                | CA3 e AM1                          |
| **CA5**       | Entrega e frete, descontos em faixas, várias lojas, pós-venda e avaliação                                                    | CA4                                |
| **GF1**       | Modelos de fábrica dos quatro GUIDS e criação automática no onboarding, desligados até a chave e o teste                     | —                                  |
| **GF2**       | Orquestrador encaminhando ao atendente e ao vendedor (delegação estruturada, uma persona)                                    | GF1                                |
| **AM0**       | ADR 0024, revisão das ADRs da seção 9 e prova curta contra o Synapse de teste                                                | —                                  |
| **AM1**       | Tipos de sala no núcleo Matrix e sala de operação por workspace, com o @ops e os GUIDS e a regra do @                        | AM0 e GF1                          |
| **AM2**       | A gaveta do cabeçalho como cliente da sala de operação                                                                       | AM1                                |
| **AM3**       | Delegação em thread (@ops aos GUIDS, @guidu ao @gmn) e aprovações na sala                                                    | AM2                                |
| **AM4**       | Sala de bastidor e "Threads desta conversa" no Inbox, com notas no Supabase (IN5)                                            | AM1                                |
| **AM5**       | Avisos da Central de Eventos na sala de operação (destino `matrix`)                                                          | AM1                                |
| **TR1 a TR6** | Tradução do chat ([traducao.md](../modules/inbox/traducao.md))                                                               | Inbox e chave do cliente           |
| **GC1**       | guidu.chat modo loja: push na transferência, assumir, responder, devolver                                                    | AM1 e o app guidu.chat             |
| **GC2**       | Modo loja completo: listas, etiquetas, notas, bastidor e sala de operação                                                    | GC1                                |

CA e AM podem andar em paralelo até a CA4, que precisa da AM1. A tradução é independente e pode entrar já no piloto de Búzios.

## 11. Perguntas para o Marcelo

1. O botmercado é o guidu.bot do plano da F5?
2. Número do botmercado: Meta oficial ou não oficial?
3. Comissão por pedido, split no Stripe Connect ou cobrança à parte?
4. Tokens do vendedor na negociação: plano do cliente, comissão ou nossa chave?
5. A sala de operação é uma por workspace ou uma por empresa?
6. No gerenciado, a equipe do parceiro entra nas salas internas de todos os workspaces da empresa?
7. Quanto o @ops pode ler das conversas dos GUIDS: só resumos e eventos, ou o histórico inteiro?
8. ~~Os quatro GUIDS de fábrica contam no limite do plano?~~ **Respondida (19/10/2026):** sim, com limite inicial de 4 GUIDS por workspace.
9. ~~Quem entra na sala de bastidor?~~ **Respondida (19/10/2026):** todos os GUIDS do workspace, além da equipe com acesso ao Inbox.
