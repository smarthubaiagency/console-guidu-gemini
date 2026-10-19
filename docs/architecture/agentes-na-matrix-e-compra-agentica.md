# Agentes na Matrix e compra agêntica

- **Status:** Proposta para discussão. Nada aqui foi decidido nem implementado.
- **Data:** 19/10/2026
- **Origem:** conversa de Marcelo com o Claude em 18 e 19/10/2026, a partir do padrão "chief of staff" do Grok Bot (xAI) e do desenho atual do Inbox na Matrix.
- **Relaciona-se com:** [ADR 0011](../adr/0011-camada-de-canais-no-nucleo.md) (canais), [ADR 0015](../adr/0015-janela-de-edicao-gaveta-interna.md) (gaveta), [ADR 0017](../adr/0017-sdk-dos-agentes-de-ia.md) (motor), [ADR 0019](../adr/0019-subagente-especialista.md) (especialista), [ADR 0020](../adr/0020-modo-de-servico-gerenciado.md) (gerenciado), [ADR 0022](../adr/0022-central-de-eventos.md) (eventos), [ADR 0023](../adr/0023-chat-interno-como-cliente-matrix.md) (Inbox na Matrix), [plano da F5](../operacao/plano-f5.md) (Portfólio e UCP), [GUIDS na sala](../modules/inbox/guids-na-sala.md).

Estamos em desenvolvimento: as ADRs são referência, não decisão final. Onde a proposta contraria uma ADR, a seção 9 diz o que muda.

## 1. Resumo

1. **Compra agêntica (prioridade).** O consumidor pede pelo WhatsApp ao nosso agente de compras (o orquestrador guidu.bot, chamado aqui de **botmercado**). Ele pesquisa no Portfólio das lojas, o consumidor escolhe, o botmercado negocia com o GUIDS da loja numa **sala de negócio** e o carrinho é montado por código. O consumidor paga no checkout do guidu.chat. Nenhum agente paga nem inventa preço.
2. **Sala de operação.** Cada workspace ganha uma sala Matrix interna onde a equipe, o Assistente GUIDU e os especialistas (GMN e os próximos) trabalham juntos. Cada delegação vira uma **thread** visível, como no chief of staff do Grok Bot, mas com a equipe inteira, não uma pessoa só.
3. **Mesma sala, várias janelas.** A gaveta do cabeçalho, a gaveta de registro, o painel de contexto do Inbox e o guidu.chat mostram recortes das mesmas salas. Não precisa de tela nova.
4. **guidu.chat com "modo loja".** O comerciante acompanha as conversas e responde as transferências pelo celular, com push.

## 2. Papéis e princípios

### 2.1 Quem é quem

| Agente                                        | Fala com                              | Chave e consumo                          | Papel                                                |
| --------------------------------------------- | ------------------------------------- | ---------------------------------------- | ---------------------------------------------------- |
| **Assistente GUIDU** (agente de conta)        | Comerciante, equipe, parceiro         | Nossa ou do parceiro (ADR 0019, regra 5) | Chief of staff da operação. Delega aos especialistas |
| **Especialistas** (GMN, depois site e outros) | O Assistente e, nas threads, a equipe | Nossa ou do parceiro                     | Executam um domínio. Nunca falam com o consumidor    |
| **GUIDS** (SDR, suporte, agendador)           | O consumidor                          | Do cliente, contando no plano            | Atendimento da loja                                  |
| **botmercado** (guidu.bot)                    | O consumidor que compra               | Nossa                                    | Pesquisa preço, escolhe a loja e negocia com o GUIDS |

### 2.2 Princípios

1. **Um lado para cada orquestrador.** Para dentro, só o Assistente GUIDU. Para fora, só os GUIDS (e o botmercado, do lado do comprador). Dois orquestradores nunca disputam a mesma pessoa.
2. **O que vale é o banco.** Preço, estoque, frete, carrinho, pedido, proposta e aprovação ficam no Supabase. A sala Matrix mostra a conversa e leva só o id do registro.
3. **Texto de agente é dado, nunca instrução.** Isso vale entre agentes (botmercado ↔ GUIDS, Assistente ↔ especialista) e para o texto do consumidor que entra no contexto do Assistente.
4. **Nada interno na sala do consumidor** (ADR 0023, regra 6). Pedido de ajuda, resumo, nota e negociação ficam em salas internas.
5. **Ação externa só por proposta** (ADR 0019, regra 7). Pagamento é sempre feito pela pessoa.
6. **Uma persona por lado.** O consumidor vê um nome, o da loja ou o do botmercado, mesmo quando há vários agentes por trás.

## 3. Compra agêntica de ponta a ponta (prioridade)

### 3.1 O que já existe

- O Portfólio guarda itens e variantes no formato do UCP, com preço em centavos, estoque e lojas (`workspace_locations`), e é "a fonte do commerce agentic" ([especificação do Portfólio](../../src/modules/portfolio/MODULE_SPEC.md)).
- Decisão de 11/10/2026: "a conversa é sempre com o orquestrador guidu.bot, e o checkout é sempre o nosso, no guidu.chat (fase 2)". A saída UCP já traz `url` e `continue_url` para o nosso fluxo.
- Carrinho, checkout e pedido ficaram fora da F5. O Stripe Connect está configurado na aba Gateway, com a cobrança real desligada ([pendências](../pendencias.md)).

### 3.2 Fluxo

1. **Pedido.** O consumidor escreve ao botmercado no WhatsApp. O botmercado pergunta o que falta (local, orçamento, entrega ou retirada, prazo) e pede o consentimento para compartilhar dados com a loja escolhida.
2. **Busca, por código.** Um serviço interno consulta o Portfólio das lojas participantes: preço, disponibilidade, distância, horário e avaliação. O ranking é código, com critério explicável ("mais barato", "mais perto", "entrega hoje"). O modelo só resume.
3. **Escolha.** O consumidor recebe 2 ou 3 opções e escolhe, ou diz "escolha o melhor", e o botmercado aplica o critério que mostrou.
4. **Negociação na sala de negócio** (seção 3.3). O botmercado pede cotação estruturada (SKUs, quantidades, entrega, CEP). O GUIDS confirma estoque, frete e prazo e pode dar desconto só dentro dos limites que o comerciante configurou. Item sob consulta ou pedido fora da regra vira transferência para a equipe.
5. **Carrinho, por código.** O serviço cria o carrinho a partir das variantes do Portfólio, com reserva de estoque por tempo curto. O texto dos agentes nunca define preço.
6. **Aceite e pagamento.** O botmercado manda o resumo e o link do checkout no guidu.chat (`continue_url`). O consumidor confirma e paga (Pix ou cartão).
7. **Pedido.** O pagamento confirmado vira pedido. A loja é avisada na sala de operação e o Assistente resume. Abre-se uma sala de atendimento no Inbox entre consumidor e loja para o pós-venda.
8. **Pós-venda.** O botmercado acompanha a entrega e pede avaliação. Devolução, estorno e disputa seguem por regra, com humano.

### 3.3 Sala de negócio

- Uma sala Matrix por negociação, com o botmercado e o GUIDS da loja como usuários virtuais e a equipe da loja podendo assistir e entrar. O consumidor não é membro.
- As mensagens levam eventos próprios, por exemplo `chat.guidu.quote_request`, `chat.guidu.quote`, `chat.guidu.cart`, com o id do registro no Supabase e um esquema validado (Zod). Linguagem natural fica para o que não cabe na estrutura.
- Limite de rodadas e de tempo por negociação. Estourou, vai para a equipe da loja.
- Histórico auditável do que cada agente disse, ligado à Central de Eventos.

### 3.4 Estados

| Registro | Estados                                                                                                          |
| -------- | ---------------------------------------------------------------------------------------------------------------- |
| Cotação  | pedida → respondida → expirada ou recusada                                                                       |
| Carrinho | rascunho → proposto → aceito → pago → cancelado ou expirado                                                      |
| Pedido   | criado → confirmado pela loja → em preparo → entregue ou retirado → concluído; cancelado e estornado em paralelo |

Cada transição é feita por código, emite evento (ADR 0022) e fica auditada.

### 3.5 Decisões em aberto

1. **botmercado = guidu.bot?** Este documento assume que sim.
2. **Neutralidade.** Somos a plataforma do comprador e da loja. Regras de ranking públicas, patrocínio sempre identificado, e o critério mostrado em toda recomendação.
3. **Quem paga os tokens da negociação.** O lado do GUIDS usa a chave do cliente: conta no plano dele, entra na comissão ou corre na nossa chave?
4. **Comissão e repasse.** Split do pagamento pelo Stripe Connect (já configurado) ou cobrança à parte.
5. **Carrinho com várias lojas.** Um pedido por loja; checkout único ou um por loja.
6. **Lojas participantes.** Opt-in do comerciante, com limites de desconto e itens que o botmercado pode oferecer.
7. **Número do botmercado.** Meta Cloud API (oficial, com janela de 24 h e templates) ou número não oficial. Para compra, a recomendação é o oficial.

### 3.6 Primeiro recorte

Uma loja, um item com preço fixo, retirada na loja, sem desconto. O GUIDS só confirma estoque e o consumidor paga no guidu.chat. Depois entram entrega e frete, descontos em faixas, várias lojas e carrinho com várias lojas.

## 4. Agentes na Matrix

### 4.1 Tipos de sala

| Tipo                                   | Membros                                                                                    | Para quê                                  |
| -------------------------------------- | ------------------------------------------------------------------------------------------ | ----------------------------------------- |
| **Atendimento** (já existe, IN4 a IN7) | Consumidor, atendentes, o GUIDS do Inbox                                                   | Conversa da loja com o consumidor         |
| **Operação** (nova, uma por workspace) | Dono, admins, atendentes, Assistente, especialistas e, no gerenciado, a equipe do parceiro | Trabalho interno da equipe com os agentes |
| **Negócio** (nova, uma por negociação) | botmercado, GUIDS da loja, equipe da loja (assiste)                                        | Compra agêntica                           |

O tipo vai no `m.room.create` (campo `type`, por exemplo `chat.guidu.ops` e `chat.guidu.deal`) e no espelho do Supabase. As salas de operação e de negócio ficam fora das visões e dos avisos do Inbox.

### 4.2 Sala de operação

- **Delegação em thread.** O Assistente delega (`delegate_to_specialist`, ADR 0019) e cada delegação abre uma thread (`m.thread`). O especialista mostra o andamento ali, e a linha principal recebe só o resumo e o resultado.
- **Regra de roteamento.** Antes de agir, o Assistente verifica se algum especialista é dono da tarefa, pela descrição de uma linha de cada um. Se for, delega; senão, faz ele mesmo.
- **Aprovação na sala.** O resultado chega como evento próprio com "Aprovar / Recusar". A proposta fica no Supabase (F4d) e o evento leva o id.
- **Avisos.** Lead quente, transferência de GUIDS, pedido novo e rotina concluída chegam na sala, como novo destino da Central de Eventos (seção 9).
- **Memória em duas camadas.** A memória do workspace (negócio, produtos, horários, ferramentas) é lida por todos os agentes de conta. Cada especialista tem a sua. Os GUIDS não leem a memória do Assistente.
- **Skills.** Em camadas (ADR 0019, regra 6). Primeira sugestão: um skill de entrevista de onboarding, que pergunta ao comerciante até entender o negócio (o "grill-me" do Grok Bot).
- **Rotinas.** Jobs do worker com gatilho por horário ou por evento, que postam o resultado na sala.

### 4.3 Acionamento a partir do Inbox

Numa conversa de atendimento, o atendente escolhe "Perguntar ao Assistente" ou escreve `@assistente` no campo interno.

- O pedido **não vai para a sala do consumidor**. Ele abre uma thread na sala de operação com o link da conversa.
- O servidor monta o contexto (contato, histórico, CRM). O texto do consumidor entra como dado (princípio 3).
- A resposta volta no painel de contexto e na thread. Se for uma sugestão de resposta, o atendente insere com um clique, e o envio é sempre dele.

### 4.4 Equipe de GUIDS do cliente

Hoje o Inbox aceita um GUIDS por workspace e o Chatwoot um agente por inbox. Para ter SDR, suporte e agendador no mesmo número, há três caminhos:

1. **Um GUIDS com papéis como skills.** Uma persona e um prompt base, com SDR, suporte e agendamento como skills. Resolve a maioria e é o mais barato.
2. **Roteamento por regra.** Canal, horário ou um classificador de intenção, e uma ferramenta "passar para o agendador" entre GUIDS. Previsível, mas rígido.
3. **GUIDS principal com sub-GUIDS.** A recepção delega e os outros trabalham por trás, sem falar com o consumidor. Vale quando um papel precisa de ferramentas, permissões ou modelos diferentes.

Recomendação: começar pelo 1 e ir para o 3 quando um papel pedir ferramentas próprias. Os GUIDS reportam ao Assistente pela sala de operação. O Assistente supervisiona e sugere ajustes, mas nunca responde o consumidor.

## 5. Matrix nas janelas do painel

| Janela                                 | Hoje                                    | Proposta                                                                                    |
| -------------------------------------- | --------------------------------------- | ------------------------------------------------------------------------------------------- |
| Gaveta do cabeçalho (ADR 0015)         | "Em breve", reservada para a A8         | A linha principal da sala de operação, com cartões de delegação recolhíveis                 |
| Gaveta de registro (`RecordWorkbench`) | Edição de CRM, Portfólio e outros       | "Perguntar à equipe" abre uma thread ligada ao registro, com o contexto montado no servidor |
| Painel de contexto do Inbox            | Cartão do GUIDS; IN5 prevê "Assistente" | Thread ligada à conversa de atendimento, com "inserir na resposta"                          |
| Gaveta do especialista GMN             | Responde dúvidas (GB1a)                 | Continua igual e grava a conversa como thread da sala de operação                           |

Pontos a resolver:

- **Uma gaveta por vez.** Quando há um registro aberto e a pessoa chama o Assistente, a proposta é abrir o Assistente com aquele registro como contexto, em vez de trocar de gaveta sem aviso.
- **Largura.** Em 350 px, cartões resumidos. A thread completa e as aprovações com detalhes ficam em 700 px.
- **URL.** `?thread=<id>`, como o `?edit=<id>` da ADR 0015, para voltar a uma delegação ou compartilhá-la.
- **Inbox em tela cheia.** Ele não usa o `WorkbenchLayout`. O componente de thread precisa funcionar nos dois lugares.
- **Streaming.** Hoje o turno do Assistente roda na requisição, com streaming (ADR 0017). Pela sala, o texto chega por edição da mensagem (`m.replace`) ou indicador de digitação, com o turno no worker.

## 6. guidu.chat com modo loja

- **O que mostra:** Não atribuídas, Minhas, Com o GUIDS, a conversa aberta com "Assumir" e "Devolver ao GUIDS", o resumo da transferência e a sala de operação.
- **Push na transferência**, respeitando quem está de plantão.
- **Duas identidades.** Contas Matrix separadas para consumidor e atendente (`u_…`), com um seletor "Minha loja". A loja nunca fala com o perfil pessoal, e vice-versa.
- **Estado pelo servidor.** Assumir, devolver e resolver chamam a API do console, que revalida permissão e grava o estado (o cliente não escreve o state event).
- **Dados internos pela API.** Etiquetas, notas e o resumo do GUIDS vêm do Supabase, só no modo loja.
- **Quem atende.** Vale a regra do Inbox de 17/10/2026: só quem é marcado como atendente responde. Dono e admin sem a marca só leem e atribuem.

Primeiro recorte: só o handoff. Push, abrir, assumir, responder e devolver.

## 7. Segurança

### 7.1 Agentes

1. **Injeção de prompt.** Texto do consumidor, de outro agente, de documento ou de página buscada é dado. As ferramentas ficam em lista fixa validada no servidor a cada chamada, e nenhum argumento de ferramenta escolhe workspace, loja ou ficha (ADR 0019, regra 4).
2. **Agentes chamando agentes.** Só o Assistente delega. Um nível de delegação, orçamento de tokens e de tempo por pedido, e limite de rodadas na sala de negócio.
3. **Autonomia limitada.** Toda ação externa passa por proposta. Desconto só dentro da faixa do comerciante. Pagamento sempre pela pessoa.
4. **Saídas com schema.** Cotação, carrinho e delegação são validados (Zod). Inválido: repara, repete ou passa para humano.
5. **Desligar sem deploy.** Botão para pausar um agente, uma ferramenta ou a compra agêntica de um workspace, e um para a plataforma inteira.
6. **Limites.** Por usuário, workspace, ferramenta e agente, contra uso descontrolado e custo.

### 7.2 Matrix

1. **Quem vê o quê.** Todo membro de uma sala lê tudo nela. Contexto de cliente na sala de operação fica visível para a equipe inteira, então o detalhe sensível fica na thread mínima ou só no Supabase. O atendente vê as threads que abriu e as do Inbox, e o dono vê tudo.
2. **Gerenciado (ADR 0020).** A equipe do parceiro entra na sala de operação só no modo gerenciado, e sai na hora em que o cliente volta ao padrão.
3. **Usuários virtuais.** Namespace reservado (`@_guidu_.*`) com poder mínimo. Só o núcleo escreve estado e tipo de sala.
4. **JWT.** As regras da ADR 0023 (RS256, `exp` curto, só `sub` de atendente) valem também no guidu.chat. No modo loja: 2FA, sessão mais curta e "sair de todos os dispositivos".
5. **Sem E2EE** (ADR 0023, regra 3), então o servidor é nosso e o transporte é TLS. Backup e retenção das salas novas seguem as do Inbox.
6. **Ciclo de vida.** Membro que sai do workspace perde a conta e sai das salas. O workspace apagado apaga todas as salas, inclusive as de operação e de negócio.

### 7.3 Compra

1. **Preço e estoque só do banco.** O carrinho é montado por código a partir das variantes. A cotação expira e a reserva de estoque é curta.
2. **Dados do consumidor (LGPD).** A loja recebe o mínimo, e só depois do aceite ou do pagamento. Consentimento registrado.
3. **Identidade.** Telefone verificado pelo canal. Mudança de endereço de entrega pede confirmação.
4. **Fraude e disputa.** Antifraude do provedor de pagamento, limite por consumidor novo, estorno com humano.
5. **Rastro.** Cada pedido liga a cotação, o carrinho, as mensagens da sala de negócio e o pagamento, com selo de integridade (ADR 0022, regra 5).

### 7.4 Números não oficiais

O Assistente fala hoje por um WhatsApp não oficial, pelo fluxo do parceiro (plano da A6). Trazê-lo para o núcleo (adaptador Evolution) traz risco de banimento e menos garantias. Para compra, a recomendação é o número oficial da Meta.

## 8. Inovação

1. **Equipe e IA na mesma sala.** Ferramentas como o Grok Bot são pessoais e os inbox do mercado põem a IA de lado. Aqui a equipe da loja, o Assistente e os especialistas trabalham juntos, com histórico, pelo painel ou pelo celular.
2. **Delegação visível.** Cada pedido mostra quem fez o quê, em threads. Isso dá confiança ao pequeno comerciante para soltar tarefas para a IA.
3. **Compra entre agentes com protocolo aberto.** UCP na descoberta e negociação estruturada entre o agente do comprador e o da loja, com o checkout nosso.
4. **Um app de bolso para o comerciante.** O guidu.chat como lugar para atender, aprovar e falar com o Assistente, no lugar do WhatsApp Business.
5. **Entrevista de onboarding.** O Assistente entrevista o comerciante e monta a memória do workspace que todos os agentes usam.
6. **Relatório da equipe de IA.** O Assistente resume o que cada GUIDS fez ("o SDR qualificou 5 leads hoje, 2 querem orçamento") e sugere ajustes.

## 9. Alterações nas ADRs

| ADR                        | O que muda                                                                                                                                                                                                                                                                                                                                                   |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **0011** (canais)          | Regra 3: a sala de negócio e a de operação também são escopos, com dono próprio (compra agêntica e Assistente). Regra 4: um GUIDS principal pode delegar a sub-GUIDS dentro da mesma rota, sem rota paralela. Novo adaptador para o número do botmercado e, se for mantido, o Evolution para o número não oficial do Assistente.                             |
| **0015** (gaveta)          | `?thread=<id>` ao lado do `?edit=<id>`. A gaveta do cabeçalho vira cliente da sala de operação. Regra para quando o Assistente é chamado com um registro aberto.                                                                                                                                                                                             |
| **0017** (motor)           | O turno do Assistente acionado pela sala roda no worker. O streaming na sala é por edição de mensagem.                                                                                                                                                                                                                                                       |
| **0019** (especialista)    | Regra 3: o especialista pode escrever nas threads de delegação da sala de operação, falando com a equipe, mas nunca com o consumidor. Aprovações continuam pelo Assistente e pelas propostas. Acrescentar o limite de delegação e o orçamento por pedido.                                                                                                    |
| **0020** (gerenciado)      | A equipe do parceiro entra na sala de operação só no gerenciado e sai junto com o acesso.                                                                                                                                                                                                                                                                    |
| **0022** (eventos)         | Novo destino `matrix`, que posta o aviso na sala de operação. Novos tipos: delegação, cotação, carrinho, pedido, pagamento e transferência de GUIDS.                                                                                                                                                                                                         |
| **0023** (Inbox na Matrix) | Regra 1: as salas passam a ter tipos (atendimento, operação, negócio), e só a de atendimento entra nas visões do Inbox. Regra 5: o guidu.chat também é cliente do comerciante (modo loja). Regra 8: as salas novas têm outros donos de rota. Regra 9: as regras do JWT valem no guidu.chat, com 2FA no modo loja. Regra 10: o espelho guarda o tipo da sala. |
| **Plano da F5**            | O "fora da F5" (carrinho, checkout e pedido) vira as etapas CA da seção 10.                                                                                                                                                                                                                                                                                  |

ADRs novas propostas:

- **0024 — Salas de agentes na Matrix:** tipos de sala, sala de operação, threads de delegação, memória em duas camadas e acionamento pelo Inbox.
- **0025 — Compra agêntica:** botmercado, sala de negócio, protocolo de cotação e carrinho, estados, pagamento e neutralidade.

## 10. Roadmap

Os nomes das etapas são provisórios. A ordem põe a compra agêntica primeiro, como pedido.

| Etapa   | Entrega                                                                                                              | Depende de                     |
| ------- | -------------------------------------------------------------------------------------------------------------------- | ------------------------------ |
| **CA0** | ADR 0025 e especificação: protocolo de cotação e carrinho, estados, neutralidade, comissão                           | Respostas da seção 11          |
| **CA1** | Carrinho e pedido no núcleo (tabelas, estados, eventos), montados das variantes do Portfólio, com reserva de estoque | CA0                            |
| **CA2** | Checkout no guidu.chat com Pix e cartão pelo Stripe Connect; pagamento vira pedido                                   | CA1 e a cobrança real ligada   |
| **CA3** | botmercado no WhatsApp: entrevista, busca e ranking por código, uma loja, preço fixo, retirada                       | CA2                            |
| **CA4** | Sala de negócio: botmercado ↔ GUIDS com eventos estruturados, confirmação de estoque, transferência para a equipe    | CA3 e AM1                      |
| **CA5** | Entrega e frete, descontos em faixas, várias lojas, pós-venda e avaliação                                            | CA4                            |
| **AM0** | ADR 0024 e revisão das ADRs da seção 9                                                                               | —                              |
| **AM1** | Tipos de sala no núcleo Matrix e sala de operação por workspace, fora das visões do Inbox                            | AM0                            |
| **AM2** | A8 nasce como cliente da sala de operação na gaveta do cabeçalho                                                     | AM1                            |
| **AM3** | Delegação em thread com o especialista GMN e aprovações na sala                                                      | AM2 e `delegate_to_specialist` |
| **AM4** | "Perguntar ao Assistente" no painel do Inbox e na gaveta de registro                                                 | AM2                            |
| **AM5** | Avisos da Central de Eventos na sala de operação (destino `matrix`)                                                  | AM1                            |
| **GC1** | guidu.chat modo loja: push na transferência, assumir, responder, devolver                                            | AM1 e o app guidu.chat         |
| **GC2** | Modo loja completo: listas, etiquetas e notas pela API, sala de operação                                             | GC1                            |
| **GS1** | GUIDS com papéis como skills (SDR, suporte, agendador)                                                               | —                              |
| **GS2** | GUIDS principal com sub-GUIDS                                                                                        | GS1 e AM3                      |

CA e AM podem andar em paralelo até a CA4, que precisa da AM1.

## 11. Perguntas para o Marcelo

1. O botmercado é o guidu.bot do plano da F5?
2. Número do botmercado: Meta oficial ou não oficial?
3. Comissão por pedido, split no Stripe Connect ou cobrança à parte?
4. Tokens da negociação do lado do GUIDS: plano do cliente, comissão ou nossa chave?
5. A sala de operação é uma por workspace ou uma por empresa?
6. No gerenciado, a equipe do parceiro entra na sala de operação de todos os workspaces da empresa?
7. Quanto o Assistente pode ler das conversas dos GUIDS: só resumos e eventos, ou o histórico inteiro?
8. Os especialistas continuam definidos só pela plataforma, ou o cliente poderá criar os seus?
9. O sub-GUIDS conta como um GUIDS no limite do plano?
