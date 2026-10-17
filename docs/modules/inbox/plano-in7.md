# Plano da IN7: WhatsApp da Meta

- **Data:** 17/10/2026. Base: `main` com IN3, IN4a, IN4b e IN6 ([guids-na-sala.md](guids-na-sala.md)), canais da A5a e da A5b ([canais.md](../ai-agents/canais.md)).
- **Estado:** proposta; esperando as respostas da seção 6 e o "pode começar".
- **Fontes:** [plano do Inbox](plano.md) (resposta 3 e linha IN7), [especificação](especificacao.md), ADR 0023 (regras 8 e 11), [canais.md](../ai-agents/canais.md) (§2 contrato, linha Meta, §3 rotas, §3.5 hubs, cenários).
- **Migrations reservadas:** IN7a `20261216090000_in7a_meta_channel`, IN7b `20261217090000_in7b_inbox_meta_rooms`.

## 1. O que você vai ver no fim

**Ligar um número (Configurações › Canais)**

- Um tipo novo de conexão, **WhatsApp (Meta)**, ao lado do Chatwoot. O dono ou admin informa o número (o `phone_number_id` e a conta do WhatsApp Business) e o token de acesso. O console confere com a Meta e mostra o número e o nome verificado.
- Para cada número, **onde ele atende**:
  - **Agente direto:** o GUIDS responde sozinho, como no Chatwoot hoje, sem atendentes. Transferir só pausa o bot naquela conversa.
  - **Inbox com agente:** cada conversa do WhatsApp vira uma conversa do Inbox. O GUIDS do Inbox responde enquanto ela está pendente, e a equipe assume, como na IN6.
- **Trocar de lugar** é uma ação explícita e auditada. O histórico fica onde estava.

**No Inbox (rota "Inbox com agente")**

- A conversa chega com o nome do perfil do WhatsApp e o telefone, ganha o contato do CRM (ligado pelo telefone quando ele já existe) e segue as regras da IN4b e da IN6: avisos, etiquetas, não lidas, GUIDS e transferência.
- O que o atendente ou o GUIDS escrevem na sala **sai pelo WhatsApp**. Imagem, documento e áudio do cliente aparecem na conversa.
- **Janela de 24 horas:** depois de 24 horas sem mensagem do cliente, a Meta só aceita **modelo aprovado**. A caixa de mensagem avisa que a janela fechou e oferece os modelos aprovados do número. Se um envio falhar, a falha aparece na conversa, só para a equipe.

## 2. Como funciona por dentro

**IN7a: adaptador da Meta no núcleo (`src/core/channels/`)**

- **Conexão `meta_whatsapp`** em `channel_connections`: o `config` guarda o `phone_number_id`, a conta (WABA), o número exibido e o nome verificado. O token fica cifrado em `encrypted_secrets`, como o do Chatwoot.
- **Webhook único do app.** A Meta manda os eventos de todos os números do app para **um** endereço, e não um por conexão como o Chatwoot. Por isso a IN7a cria uma rota própria, `/api/channels/meta`:
  - `GET`: o desafio de cadastro (`hub.verify_token`).
  - `POST`: confere a assinatura `X-Hub-Signature-256` com o app secret, sobre o corpo cru, em tempo constante e com limite de tamanho. Depois acha a conexão pelo `phone_number_id` e entrega ao mesmo `channel_ingest` de hoje.
  - O app secret e o verify token são do app da GUIDU na Meta. Ficam em variáveis de ambiente da plataforma, nunca no banco nem no chat.
- **Normalização** para o contrato da A5a:
  - mensagem de texto, imagem, documento e áudio (a mídia é baixada pelo id na Graph API, com limite);
  - nome do perfil e `wa_id` como contato;
  - os status de entrega (`sent`, `delivered`, `read`, `failed`) viram eventos de entrega, sem acordar o agente.
- **Envio (`ChannelOutbound`):** texto, modelo aprovado e marcar como lida. A capacidade `messagingWindow: "meta_24h"` entra no contrato. O núcleo guarda a última mensagem do cliente por conversa e recusa texto livre fora da janela, com erro explícito (canais.md, linha Meta).
- **Despacho:** hoje o `channels.dispatch` está preso ao Chatwoot. A IN7a separa o que é do provedor (enviar, transferir) num adaptador, para a rota **agente direto** da Meta usar o mesmo turno da A5b.
- **Modelos:** a lista dos modelos aprovados é lida da Graph API e guardada por pouco tempo (cache curto), para a tela.
- **Testes:** uma Graph API falsa no rig (`MetaDouble`), a suíte de conformidade dos adaptadores (canais.md §2) e casos de assinatura, desafio, mensagem repetida e janela fechada.

**IN7b: Inbox com a Meta (`src/core/matrix/`, módulo `inbox`)**

- **Rota do Inbox:** `channel_routes` com `consumer_module = 'inbox'`. O consumidor do Inbox não chama o agente: ele leva a mensagem para a sala.
- **Contato como usuário virtual:**
  - `@_guidu_c_<16 base32>` por contato e número, registrado pelo Application Service com o nome do perfil, como o endereço da loja e o usuário do agente.
  - A tabela nova `matrix_channel_contacts` liga contato, conexão e usuário virtual.
  - O namespace `@_guidu_.*` já é do Application Service.
- **Uma sala por contato e número:**
  - Reaproveita a sala aberta ou pendente (como o `openConsumerRoom`); conversa resolvida reabre como pendente (IN6).
  - Sala nova com `origin = 'meta'`, já permitido desde a IN3, ligada à `channel_conversations` por uma coluna nova em `matrix_rooms`.
  - O núcleo entra com o usuário do contato na sala (`forceJoin`) e publica a mensagem como ele.
  - Mídia: o arquivo vai para o repositório de mídia do Synapse e entra como `m.image`, `m.file` ou `m.audio`.
- **O que sai:**
  - Mensagem de texto da equipe ou do agente numa sala da Meta (o `messageSide` já separa "team" e "agent") agenda o job `inbox.meta-send` {eventId}.
  - O job lê o texto no Synapse (o banco não guarda texto, ADR 0023) e envia pela Meta, uma vez por evento.
  - Envio recusado (janela fechada, número inválido) vira um aviso na sala, visível só para a equipe.
  - A IN7b não envia mídia para a Meta.
- **Modelos na janela fechada:** a caixa de mensagem pergunta ao servidor se a janela está aberta (última mensagem do cliente). Fechada, mostra só a escolha do modelo, com os campos de variável em texto. O envio vai pelo mesmo job.
- **Troca de rota:** uma ação nova `switchChannelRoute`, com a permissão `channels.manage` e auditoria `channels.route.switch`, fecha a rota antiga e abre a nova na mesma transação. As conversas abertas seguem a regra da pergunta 6.
- **Testes:**
  - integração com o Synapse local e a Graph API falsa: entra mensagem, a sala nasce, o GUIDS responde e sai pela Meta, o atendente responde e sai, janela fechada recusa texto e aceita modelo, troca de rota;
  - e2e no `e2e-inbox`: conexão Meta (com a Graph API falsa), conversa chegando e resposta do atendente.

## 3. Testes de verdade antes da verificação do app

Um app da Meta sem verificação já tem um **número de teste** e manda mensagens para até 5 telefones cadastrados. Com ele dá para provar a IN7 de ponta a ponta no dev, antes da verificação da empresa; a verificação só é exigida para ligar números dos clientes. Para isso, preciso que você crie o app no Meta for Developers, ative o WhatsApp e cadastre no dev as variáveis `META_APP_SECRET` e `META_WEBHOOK_VERIFY_TOKEN`. O token do número de teste vai pela tela do console, cifrado.

## 4. Ordem

A IN7b depende da IN7a (o adaptador e o envio). Proposta: **IN7a primeiro, sozinha**, e a IN7b em seguida. Se você quiser duas etapas ao mesmo tempo (AGENTS.md), a IN5 (ferramentas do painel) pode andar em paralelo com a IN7a, porque não se tocam.

## 5. Fora da IN7

- Cadastro do número pelo **Embedded Signup** da Meta (Login do Facebook para empresas); exige o app verificado e o programa de Tech Provider.
- Envio de mídia para o WhatsApp, reações, respostas citadas e botões interativos.
- Criar ou editar modelos pelo console: são criados no WhatsApp Manager e só listados aqui.
- GUIDS diferente por número: na v1 o GUIDS do Inbox atende todas as conversas do Inbox (IN6).
- Áudio respondido em áudio pelo GUIDS.

## 6. Perguntas (minha sugestão entre parênteses)

1. **Dividir em IN7a (adaptador e agente direto) e IN7b (Inbox com a Meta), nessa ordem?** (Sim. Em paralelo com a IN7a, só se você quiser puxar a IN5.)
2. **Como o número é ligado na v1?** (Formulário manual, como o Chatwoot: `phone_number_id`, conta e token permanente de usuário do sistema do cliente. Embedded Signup fica para depois da verificação.)
3. **O app secret e o verify token são da plataforma (um app da GUIDU), em variáveis de ambiente?** (Sim. Um webhook para todos os números.)
4. **A rota "agente direto" da Meta entra na IN7a?** (Sim. É o caso mais simples, usa o turno da A5b e testa o adaptador antes do Inbox.)
5. **Mídia na v1:** imagem, documento e áudio do cliente aparecem no Inbox; a equipe envia só texto e modelos? (Sim.)
6. **Conversas abertas na troca de rota:**
   - de agente direto para o Inbox, a conversa do agente é encerrada e a próxima mensagem abre a sala;
   - do Inbox para agente direto, as salas abertas são resolvidas com um aviso para a equipe.
   - (Sim, as duas. Responde a D-AG-13 para a Meta.)
7. **Contato do CRM:** ligar ao contato que já tem o mesmo telefone, e criar só quando não houver? (Sim. Com mais de um igual, liga ao mais antigo e o atendente troca pela busca da IN4b.)
8. **Status de entrega:** mostrar só as falhas na conversa, sem os tiques de enviado, entregue e lido na v1? (Sim.)
9. **Marcar como lida na Meta:** quando o atendente abre a conversa, os tiques azuis aparecem para o cliente? (Não na v1: o cliente vê "lida" só se a gente marcar, e isso pode criar expectativa de resposta rápida. Fica como opção depois.)
10. **Janela fechada:** a equipe escolhe um modelo aprovado e preenche as variáveis em texto livre? (Sim. Sem modelo aprovado, a caixa explica que a janela fechou.)
11. **Número de teste:** você cria o app da Meta e cadastra as duas variáveis no dev agora, para eu testar com o número de teste antes da verificação? (Sim.)
