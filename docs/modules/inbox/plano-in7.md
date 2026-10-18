# Plano da IN7: WhatsApp da Meta

- **Data:** 17/10/2026. Base: `main` com IN3, IN4a, IN4b e IN6 ([guids-na-sala.md](guids-na-sala.md)), canais da A5a e da A5b ([canais.md](../ai-agents/canais.md)).
- **Estado:** aprovado em 17/10/2026 (seção 6, perguntas 1 a 16). IN7a feita em `claude/optimistic-lamport-rjehmm` ([whatsapp-meta.md](whatsapp-meta.md)); IN7b em seguida.
- **Fontes:** [plano do Inbox](plano.md) (resposta 3 e linha IN7), [especificação](especificacao.md), ADR 0023 (regras 8 e 11), [canais.md](../ai-agents/canais.md) (§2 contrato, linha Meta, §3 rotas, §3.5 hubs, cenários).
- **Migrations reservadas:** IN7a `20261217090000_in7a_meta_channel`, IN7b `20261218090000_in7b_inbox_meta_rooms`.

## 0. Princípio: a conversa não se interrompe

Pedido do Marcelo (17/10/2026): o GUIDS manda pelo WhatsApp um checkout que abre o mini app do guidu.chat; o cliente paga, e a confirmação aparece no chat. Pode ser a primeira experiência dele no guidu.chat: ele vê que a conversa continua, tem o histórico da compra e pode instalar o app (ou PWA), tudo a partir de uma conversa, sem interrupção.

Para isso a IN7 adota três regras:

1. **Toda conversa do WhatsApp mora numa sala do núcleo Matrix**, qualquer que seja a rota. A rota só decide **quem responde**:
   - **Só o GUIDS** (o antigo "agente direto"): o GUIDS responde e a equipe não é chamada; transferir pausa o GUIDS.
   - **GUIDS com a equipe** (o antigo "Inbox com agente"): como na IN6, com a equipe no Inbox.
   - Trocar a rota não move nada: o histórico já está na sala. Isso responde a pergunta 6.
2. **Um fio por pessoa e loja.** O contato é a pessoa (pelo telefone) no workspace, e não o par contato e número. Se a loja tiver dois números, ou a pessoa chegar depois pelo guidu.chat, a conversa é a mesma sala.
3. **A conversa pode sair e voltar.** Um link assinado e curto, gerado pelo núcleo para aquela pessoa e sala, abre o guidu.chat. Lá, a pessoa vê a mesma sala, e o que acontece fora (pagamento confirmado) volta para a sala como mensagem. No WhatsApp, a mesma mensagem sai como texto, ou como botão com link quando a janela está aberta.

O checkout e o mini app do guidu.chat são uma etapa própria, a **IN8**, com plano à parte. Ela depende do guidu.chat, do Portfólio e pedidos e do gateway (CF7 e P6). A IN7 só deixa o caminho pronto: a sala única, o contato por telefone e o formato das mensagens que saem e voltam.

## 1. O que você vai ver no fim

**Ligar um número (Configurações › Canais)**

- Um tipo novo de conexão, **WhatsApp (Meta)**, ao lado do Chatwoot, com dois jeitos de ligar (resposta 2):
  - **Conectar com a Meta (Embedded Signup):** o dono ou admin clica, entra com a conta do Facebook da empresa, escolhe ou cria a conta do WhatsApp Business e o número, e volta para o console com o número ligado.
  - **Manual:** informa o número (o `phone_number_id` e a conta do WhatsApp Business) e o token permanente de usuário do sistema.
  - Nos dois, o console confere com a Meta e mostra o número e o nome verificado.
- Para cada número, **quem responde**: **só o GUIDS** ou **o GUIDS com a equipe** (seção 0). As duas usam a sala do núcleo.
- **Trocar** é uma ação explícita e auditada, e o histórico continua na sala.

**No Inbox (rota "GUIDS com a equipe")**

- A conversa chega com o nome do perfil do WhatsApp e o telefone, ganha o contato do CRM (ligado pelo telefone quando ele já existe) e segue as regras da IN4b e da IN6: avisos, etiquetas, não lidas, GUIDS e transferência.
- O que o atendente ou o GUIDS escrevem na sala **sai pelo WhatsApp**. Imagem, documento e áudio do cliente aparecem na conversa.
- **Janela de 24 horas:** depois de 24 horas sem mensagem do cliente, a Meta só aceita **modelo aprovado**. A caixa de mensagem avisa que a janela fechou e oferece os modelos aprovados do número. Se um envio falhar, a falha aparece na conversa, só para a equipe.

## 2. Como funciona por dentro

**IN7a: adaptador da Meta no núcleo (`src/core/channels/`)**

- **Conexão `meta_whatsapp`** em `channel_connections`: o `config` guarda o `phone_number_id`, a conta (WABA), o número exibido, o nome verificado e como foi ligada (`embedded` ou `manual`). O token fica cifrado em `encrypted_secrets`, como o do Chatwoot.
- **Embedded Signup:**
  - A tela carrega o SDK JavaScript da Meta (`connect.facebook.net`, que entra na CSP) e abre o login com a configuração do Login do Facebook para empresas.
  - A Meta devolve um código e a conta e o número escolhidos. O servidor troca o código pelo token da empresa (com o app secret) e assina o app na conta do WhatsApp Business (`subscribed_apps`), para os webhooks chegarem.
  - Registra o número na Cloud API quando ele ainda não estiver registrado, com o PIN de duas etapas que a pessoa informa.
  - Variáveis públicas da plataforma: `META_APP_ID` e `META_EMBEDDED_SIGNUP_CONFIG_ID`.
- **Webhook único do app.** A Meta manda os eventos de todos os números do app para **um** endereço, e não um por conexão como o Chatwoot. Por isso a IN7a cria uma rota própria, `/api/channels/meta`:
  - `GET`: o desafio de cadastro (`hub.verify_token`).
  - `POST`: confere a assinatura `X-Hub-Signature-256` com o app secret, sobre o corpo cru, em tempo constante e com limite de tamanho. Depois acha a conexão pelo `phone_number_id` e entrega ao mesmo `channel_ingest` de hoje.
  - O app secret e o verify token são do app da GUIDU na Meta. Ficam em variáveis de ambiente da plataforma, nunca no banco nem no chat.
- **Normalização** para o contrato da A5a:
  - mensagem de texto, imagem, documento e áudio (a mídia é baixada pelo id na Graph API, com limite);
  - nome do perfil e `wa_id` como contato;
  - os status de entrega (`sent`, `delivered`, `read`, `failed`) viram eventos de entrega, sem acordar o agente.
- **Envio (`ChannelOutbound`):** texto, modelo aprovado e marcar como lida. A capacidade `messagingWindow: "meta_24h"` entra no contrato. O núcleo guarda a última mensagem do cliente por conversa e recusa texto livre fora da janela, com erro explícito (canais.md, linha Meta).
- **Sala para toda conversa:** a mensagem que chega vira mensagem na sala da pessoa (a parte de "contato como usuário virtual" e "uma sala por pessoa", descrita na IN7b abaixo, sobe para a IN7a). O GUIDS responde pelo turno da IN6 (`inbox.guids-turn`), e o que ele escreve sai pela Meta. Assim a rota "só o GUIDS" já funciona na IN7a, sem a equipe. O `channels.dispatch` do Chatwoot não muda.
- **Modelos:** a lista dos modelos aprovados é lida da Graph API e guardada por pouco tempo (cache curto), para a tela.
- **Testes:** uma Graph API falsa no rig (`MetaDouble`), a suíte de conformidade dos adaptadores (canais.md §2) e casos de assinatura, desafio, mensagem repetida e janela fechada.

**IN7b: a equipe na conversa da Meta (`src/core/matrix/`, módulo `inbox`)**

Com a regra da seção 0, a sala e o contato passam para a IN7a. Ficam na IN7b: a rota "GUIDS com a equipe", a resposta do atendente pela Meta, os modelos na janela fechada, as falhas na conversa e a troca de rota. A descrição abaixo vale para as duas, cada peça na sua etapa.

- **Rota do Inbox:** `channel_routes` com `consumer_module = 'inbox'`. O consumidor do Inbox não chama o agente: ele leva a mensagem para a sala.
- **Contato como usuário virtual:**
  - `@_guidu_c_<16 base32>` por pessoa e workspace (seção 0, regra 2), registrado pelo Application Service com o nome do perfil, como o endereço da loja e o usuário do agente.
  - A tabela nova `matrix_contacts` liga a pessoa (telefone no workspace), o usuário virtual e os canais por onde ela fala (`channel_conversations` de cada número). O guidu.chat usará a mesma linha na IN8.
  - O namespace `@_guidu_.*` já é do Application Service.
- **Uma sala por pessoa e loja:**
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
- **Troca de rota:** uma ação nova `switchChannelRoute`, com a permissão `channels.manage` e auditoria `channels.route.switch`, troca "só o GUIDS" por "GUIDS com a equipe" e vice-versa. Nada sai da sala. Na volta para "só o GUIDS", as conversas abertas com a equipe voltam para o GUIDS (pendentes), com um aviso para quem estava nelas.
- **Mensagem com link (preparação da IN8):** uma mensagem estruturada do núcleo (`chat.guidu.card`, com título, texto e link) que o Inbox mostra como cartão e que sai no WhatsApp como botão com link (mensagem interativa `cta_url`) quando a janela está aberta, ou como texto com o link. A IN7b só cria o formato e o envio; quem gera o checkout é a IN8.
- **Testes:**
  - integração com o Synapse local e a Graph API falsa: entra mensagem, a sala nasce, o GUIDS responde e sai pela Meta, o atendente responde e sai, janela fechada recusa texto e aceita modelo, troca de rota;
  - e2e no `e2e-inbox`: conexão Meta (com a Graph API falsa), conversa chegando e resposta do atendente.

## 3. Testes de verdade

O Marcelo já tem um número verificado para teste (resposta 2). Para o dev, ele cadastra `META_APP_SECRET`, `META_WEBHOOK_VERIFY_TOKEN`, `META_APP_ID` e `META_EMBEDDED_SIGNUP_CONFIG_ID` (as duas últimas para o Embedded Signup) e aponta o webhook do app para `https://<dev>/api/channels/meta`. O token do número entra pela tela do console, cifrado, nunca no chat. Os testes automáticos usam a Graph API falsa.

## 4. Ordem

A IN7b depende da IN7a (o adaptador e o envio). Proposta: **IN7a primeiro, sozinha**, e a IN7b em seguida. Se você quiser duas etapas ao mesmo tempo (AGENTS.md), a IN5 (ferramentas do painel) pode andar em paralelo com a IN7a, porque não se tocam.

## 5. Fora da IN7 (vira dívida técnica em `docs/pendencias.md`)

- Envio de mídia para o WhatsApp, reações, respostas citadas e botões interativos (fora o botão com link da mensagem estruturada).
- Criar ou editar modelos pelo console: são criados no WhatsApp Manager e só listados aqui.
- GUIDS diferente por número: na v1 o GUIDS do Inbox atende todas as conversas do Inbox (IN6).
- Áudio respondido em áudio pelo GUIDS.
- Tiques de enviado, entregue e lido na conversa (só as falhas aparecem, resposta 8).
- Marcar como lida na Meta quando o atendente abre a conversa (resposta 9).
- Variáveis dos modelos só em texto livre, sem cabeçalho de mídia nem botões (resposta 10).

## 6. Perguntas e respostas (17/10/2026)

1. **Dividir em IN7a (adaptador e agente direto) e IN7b (Inbox com a Meta), nessa ordem?** Sim.
2. **Como o número é ligado na v1?** Os dois: Embedded Signup e manual, na IN7a. Já há um número verificado para teste.
3. **App secret e verify token da plataforma, em variáveis de ambiente?** Sim.
4. **A rota "agente direto" da Meta entra na IN7a?** Sim. Com a seção 0, ela vira "só o GUIDS", na sala (pergunta 13).
5. **Mídia:** imagem, documento e áudio do cliente aparecem no Inbox; a equipe envia só texto e modelos. Sim.
6. **Conversas em andamento quando o número muda de lugar.** Respondida pela seção 0: a conversa fica na sala, e a troca só muda quem responde. O texto abaixo era a pergunta original. Um número atende num lugar de cada vez. Quando o dono troca o lugar, algumas conversas podem estar no meio:
   - **Do "agente direto" para o Inbox.** Exemplo: a Maria está conversando com o GUIDS direto pelo WhatsApp e o dono muda o número para o Inbox. Proposta: a conversa dela com o agente direto termina ali, e a próxima mensagem da Maria já abre uma conversa no Inbox, onde o GUIDS do Inbox continua e a equipe pode assumir. O que foi dito antes fica no histórico do agente, não é copiado para o Inbox.
   - **Do Inbox para o "agente direto".** Exemplo: um atendente está no meio de uma conversa com a Maria no Inbox e o dono volta o número para o agente direto. Proposta: as conversas abertas no Inbox são marcadas como resolvidas, com um aviso para a equipe ("o número saiu do Inbox"), e a próxima mensagem da Maria vai para o agente direto.
   - Alternativa: não deixar trocar enquanto houver conversa aberta, e o dono resolve antes.
   - (Sugestão: as duas propostas acima, sem bloquear a troca.)
7. **Contato do CRM ligado pelo telefone, criando só quando não houver?** Sim.
8. **Status de entrega: só as falhas na v1?** Sim (os tiques ficam como dívida).
9. **Marcar como lida na Meta?** Não na v1 (dívida).
10. **Janela fechada: modelo aprovado com variáveis em texto?** Sim.
11. **Variáveis no dev:** Sim.
12. **Embedded Signup:** fica simulado por enquanto. A IN7a entrega o botão e o fluxo testados com a Graph API falsa; o ligar manual funciona com o número de teste.
13. **A sala como casa de toda conversa do WhatsApp**, e a rota decidindo só quem responde ("só o GUIDS" ou "GUIDS com a equipe"), no lugar do "agente direto" pelo despacho do Chatwoot? Isso substitui as respostas 4 e 6. (Sim.)
14. **Um fio por pessoa e loja**, pelo telefone, mesmo com dois números ou vindo depois pelo guidu.chat? (Sim.)
15. **A rota "só o GUIDS" funciona sem o módulo Inbox ligado?** A sala existe no núcleo e o GUIDS responde, mas ninguém vê a conversa no console até ligar o Inbox; ao ligar, o histórico já está lá. (Sim. Sem o Inbox, o GUIDS do número é escolhido na tela do canal.)
16. **Checkout e guidu.chat como etapa própria (IN8)**, com plano à parte, depois da IN7, e a IN7b entregando só a mensagem com link? (Sim.)
