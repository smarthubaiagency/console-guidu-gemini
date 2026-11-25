# ADR 0032 — Chat do cartão Mobio pelo Matrix, com o DeskcommCRM como canal da sala

- **Status:** Proposto; vira aceito com a aprovação do Marcelo no PR. As seis decisões da seção 1 já foram tomadas pelo Marcelo; a seção 2 traz as decisões técnicas do gerente de projeto, que ele pode vetar.
- **Data:** 25/11/2026
- **Aprovador:** Marcelo
- **Decisão de origem:** conversa do Marcelo com o Claude Code em 25/11/2026, na sessão do repositório `mobio`, que fechou o plano do chat do cartão. O plano ficou no arquivo de planos da sessão, fora do repositório; esta ADR é o registro dele aqui.
- **Relaciona-se com:** [ADR 0011](0011-camada-de-canais-no-nucleo.md) (canais no núcleo), [ADR 0023](0023-chat-interno-como-cliente-matrix.md) (Matrix como fonte da verdade), [ADR 0026](0026-gateways-apisix-e-agentgateway.md) (borda), [ADR 0027](0027-guidu-chat-v1-console-bridge.md) (caminho B e API do guidu.chat), [app guidu.chat](../architecture/guidu-chat-app.md) (seções 2 e 8). Os números 0024 e 0025 seguem reservados (salas de agentes e compra agêntica).

## Contexto

Hoje o cartão digital Mobio (Laravel, repositório `mobio`, cartões em `*.mobio.pro` e em domínios próprios das empresas) abre o chat pelo widget do Chatwoot. O Marcelo quer uma janela de chat própria no cartão, no padrão visual Mobio Pro, com este caminho:

- **ida:** cartão → Matrix (o Synapse do GUIDU) → DeskcommCRM;
- **volta:** DeskcommCRM → Matrix → cartão.

O DeskcommCRM (`smarthub.guidu.co`) é o CRM em que as empresas clientes vão atender, uma organização por empresa.

Boa parte do que esse caminho exige já existe no console:

- **Matrix como fonte da verdade.** Cada conversa é uma sala, e o console e o guidu.chat são clientes das mesmas salas (ADR 0023, regras 1 e 5).
- **Contato de fora como usuário virtual.** O canal da Meta já faz isso:
  - `ensureContactUser` cria `@_guidu_c_…` (`src/core/matrix/meta.ts:73`);
  - `contactRoom` cria a sala com `consumerIsVirtual` (`meta.ts:160`, `src/core/matrix/rooms.ts:106`);
  - o núcleo escreve na sala em nome do contato;
  - a saída passa pela `matrix_outbound`, uma linha por evento, sem envio repetido (migration `20261217090000_in7a_meta_channel.sql`).
- **Lado consumidor da sala.** A fila de eventos já reabre a conversa, aciona o GUIDS e pede a tradução quando quem escreve é o consumidor (`src/core/matrix/events.ts`, perto da linha 410).
- **Saída fixa na Meta.** A saída da equipe e do agente está presa à Meta: `enqueueMetaSend` (`events.ts:426`).
- **Tipos de canal e origem da sala.** `CHANNEL_KINDS` só tem `chatwoot` e `meta_whatsapp` (`src/core/channels/contract.ts:13`; checagem no banco em `in7a_meta_channel.sql:39-41`), e `matrix_rooms.origin` só aceita `matrix` e `meta` (`20261128090000_in3_matrix_core.sql:60`).
- **Caminho B para quem é de fora.** A ADR 0027 (seção 7) e o [app guidu.chat](../architecture/guidu-chat-app.md) (seção 2) definem que o turista conversa **pelo GUIDU**:
  - ele é usuário virtual no Synapse;
  - fala pelas rotas de conversa da API e recebe em tempo real por SSE;
  - o Synapse não é acessado direto pelo público na V1 (tabela de endereços da ADR 0027).

Do lado do DeskcommCRM, conferido no código dele:

- **Extensões não servem para a ponte.** As extensões do CRM são só declarativas, sem código, sem rota e sem canal (`docs/doctrine/extensoes.md`).
- **Fork próprio se perde.** A instalação baixa a imagem oficial a cada atualização (`hostgator-setup-kit/update.sh`, `docs/doctrine/packaging.md`), então um fork nosso seria apagado.
- **A porta é a API pública do "Chat no site".** É um contrato versionado: `POST /api/v1/webchat/sessao`, `POST /api/v1/webchat/mensagens` e `GET /api/v1/webchat/eventos`.
- **Limites do CRM:** 10 conversas novas por minuto por empresa, 30 por minuto no total e 20 mensagens por minuto por visitante.
- **Módulo ainda travado.** O módulo `canal_webchat` está em `MODULOS_AINDA_NAO_LIGAVEIS` (`lib/instalacao/modulos.ts`). A liberação está no roteiro do mantenedor (spec 36, F4).

**Alternativa considerada e descartada:** dar ao navegador do visitante um token Matrix próprio, emitido pela API admin (`/_synapse/admin/v1/users/{id}/login`, a técnica dos testes em `tests/core/matrix.test.ts:193`), com `/sync` direto no Synapse. Ela caiu por três motivos:

- abriria uma exceção à regra 9 da ADR 0023 (o console só emite credencial Matrix para atendentes);
- poria o Synapse ao alcance do público, contra a tabela de endereços da ADR 0027 e a auditoria de borda da ADR 0026;
- criaria um terceiro modo de conversar, além do Inbox e do caminho B.

O caminho B entrega o mesmo resultado (tempo real, histórico e reabrir em outro dia) com o código que o guidu.chat já vai usar.

## Decisão

### 1. Decidido pelo Marcelo (25/11/2026)

1. **O Matrix fica no meio.** A conversa do cartão é uma sala no Synapse do GUIDU, e o DeskcommCRM é um canal dela.
2. **Uma organização do DeskcommCRM por empresa cliente.**
3. **O Chatwoot será substituído** no chat do cartão Mobio.
4. **A janela de chat é própria do Mobio**, no padrão Mobio Pro.
5. **Nenhum código nosso dentro do CRM**, para que as atualizações dele sejam seguras. A ponte mora no console e fala com o CRM só pela API pública.
6. **Freio de custo da IA em três camadas:**
   - o teto por resposta do agente do CRM ("Custo máximo por atendimento", `cost_budget_cents`, conferido a cada rodada da IA em `lib/ai/runtime/agent.ts`, `budgetGuard`);
   - o orçamento mensal de IA da organização (`ai_budgets`, com alarme por e-mail);
   - o limite de mensagens e de conversas novas na nossa ponte.

### 2. Decisões técnicas do gerente de projeto

1. **O visitante do cartão segue o caminho B** (ADR 0027, seção 7), como o contato do WhatsApp:
   - ele é um usuário virtual `@_guidu_v_<aleatório>`, no namespace do Application Service (ADR 0023, regra 8);
   - o núcleo escreve na sala em nome dele;
   - o navegador do visitante **nunca** recebe credencial Matrix, e o Synapse continua fechado.
2. **Canal novo `webchat` no núcleo** (ADR 0011):
   - uma conexão por workspace, com uma chave pública `wck_` e a lista de origens permitidas (por exemplo `https://*.mobio.pro` e os domínios próprios da empresa);
   - o workspace vem **só** da chave, nunca de um campo enviado pelo navegador;
   - a sala nasce com `origin = 'webchat'` e guarda de onde veio a conversa: a URL do cartão, o nome do cartão e o serviço, quando houver.
3. **API pública do chat do cartão, versionada**, servida pelo console atrás do APISIX:
   - `POST /visitas` cria ou reusa o visitante e a sala. Ela devolve um token de visitante opaco (`wcv_`):
     - o banco guarda só o hash dele;
     - o token vale para um workspace, uma conexão e uma sala;
     - a validade é deslizante (proposta: 30 dias), para a pessoa reabrir o cartão outro dia e ver o histórico;
   - `GET /mensagens` traz o histórico, paginado por `event_id`;
   - `POST /mensagens` envia, com chave de idempotência;
   - `GET /eventos` entrega o tempo real por SSE.

   O serviço por trás dessas rotas é **o mesmo** das rotas de conversa do guidu.chat (ADR 0027, seção 4: `/conversations/*` e `/events`). Só muda a porta: o guidu.chat entra com o login do turista, o cartão com o token de visitante. Quem construir primeiro constrói para os dois.

4. **Checagem antes de a mensagem entrar na sala** ([app guidu.chat](../architecture/guidu-chat-app.md), seção 8):
   - só texto, com tamanho máximo;
   - nenhum state event vindo do visitante;
   - o núcleo nunca confia no visitante para estado, preço ou pedido.

   Proteções de borda (ADR 0026, lacunas L3 e L7):
   - CORS só para as origens da conexão;
   - limite por IP, por chave e por visitante;
   - corpo pequeno, no APISIX e no app.

5. **Rota da conexão `webchat`** (ADR 0011, regra 3: uma rota ativa por conexão e escopo):
   - **`inbox`** (padrão): o atendimento é o do Inbox e do GUIDS, como já funciona para o WhatsApp;
   - **`deskcomm`**: quem atende é o DeskcommCRM da empresa. Nessa rota o GUIDS não responde na sala (quem responde é o agente do CRM), e o Inbox mostra a conversa só para leitura.

   Nas duas rotas a sala existe e guarda a conversa inteira. Trocar de uma para a outra é trocar a rota.

6. **Canal novo `deskcomm`:** um adaptador do núcleo (`src/core/channels/deskcomm.ts`) que faz, do servidor, o papel de visitante no "Chat no site" do CRM:
   - **sala nova:** `POST /api/v1/webchat/sessao` com a chave `wck_` da organização da empresa no CRM. O token de sessão do CRM fica cifrado no cofre, ligado à sala;
   - **mensagem do visitante:** `POST /api/v1/webchat/mensagens`, com `mensagem_id` derivado do `event_id` do Matrix, para que reenvio não duplique;
   - o aceite LGPD e o contato vão junto quando existirem;
   - a primeira mensagem leva a origem (cartão e serviço) no texto, até o CRM ter um campo próprio;
   - **respostas do CRM:** um worker mantém aberto o `GET /api/v1/webchat/eventos` de cada conversa ativa e reconecta a cada 60 s;
     - ele encerra depois de 30 min sem atividade e volta na próxima mensagem;
     - cada resposta entra na sala como `@_guidu_d_…`, do lado da equipe.

   **No CRM não se programa nada:** cada organização cria a conexão "Chat no site" e a empresa cola a chave dela na conexão `deskcomm` do console. Como a chamada sai do servidor, sem origem de navegador, não é preciso cadastrar domínios no CRM.

7. **Saída por tipo de canal.** Um despacho por tipo de canal substitui o `enqueueMetaSend` fixo (`events.ts:426`):

   | Canal           | O que sai da sala                       | Para onde           |
   | --------------- | --------------------------------------- | ------------------- |
   | `meta_whatsapp` | mensagens da equipe e do agente         | Meta                |
   | `deskcomm`      | mensagens do visitante                  | CRM                 |
   | `webchat`       | mensagens da equipe, do agente e do CRM | visitante, pela SSE |

   A idempotência continua pela `matrix_outbound`.

8. **LGPD e visitante anônimo:**
   - o aceite que o cartão já coleta vai na visita e fica gravado no Supabase, ligado ao `room_id`. Ele não vai para a sala (ADR 0023, regra 6);
   - o número de respostas da IA para o visitante que ainda não deixou contato é configurável por conexão (proposta: 20).

## Consequências

- **Banco:** migration nova, sem tocar nas já aplicadas. Ela inclui:
  - `webchat` e `deskcomm` em `CHANNEL_KINDS` e na checagem `channel_connections_kind_check`;
  - `webchat` na checagem de `matrix_rooms.origin`;
  - a tabela dos visitantes (workspace, conexão, `mxid`, `room_id`, hash do token, validade);
  - a chave pública e as origens da conexão `webchat`.

  Tudo com RLS e chave composta com `workspace_id`.

- **Testes de isolamento contra o Synapse real do CI:**
  - o visitante só alcança a própria sala;
  - a chave de outro workspace é recusada;
  - uma origem fora da lista não recebe CORS;
  - a ida e a volta funcionam com um CRM falso, que imita `/sessao`, `/mensagens` e `/eventos`;
  - o limite do anônimo é respeitado.
- **API do guidu.chat:** as rotas de conversa e a SSE da ADR 0027 ganham um segundo uso. Construir uma adianta a outra.
- **DeskcommCRM:** a única dependência é o módulo `canal_webchat` sair de `MODULOS_AINDA_NAO_LIGAVEIS`. Podemos pedir isso ao mantenedor ou contribuir pelo processo do projeto oficial (`melgarafael/DeskcommCRM`). Uma chave de servidor para pontes confiáveis, com limite por visitante e não por IP, e um campo `origem` são contribuições para quando o volume crescer.
- **Limites do CRM:** como toda chamada sai do IP da ponte, os limites dele (10 conversas novas por minuto por empresa, 30 no total, 20 mensagens por minuto por visitante) bastam para o começo.
- **Mobio:** o mobio ganha três PRs:
  - **provedor `guidu` no MobioChat:** chave `wck_` por empresa, conferida ao salvar, e a URL da API definida pelo superadmin;
  - **a janela `ChatSheet`:** um cliente HTTP com SSE, sem SDK do Matrix;
  - **depois, um PR que tira o Chatwoot do cartão.**
- **Produção:** o Synapse de produção já está no ar desde 25/11/2026, em `neo.guidu.chat`, no Coolify da Hostinger (revisão de 25/11/2026 da [ADR 0023](0023-chat-interno-como-cliente-matrix.md)). Falta o console em produção, com uma URL pública: sem ela, o Synapse não entrega as mensagens ao Application Service. O desenvolvimento e os testes automáticos continuam no Synapse local do CI.
- **Reversível:** sim.
  - Desligar o canal `webchat` devolve o cartão ao provedor anterior.
  - Trocar a rota move o atendimento entre o Inbox e o CRM sem perder a sala.
  - Se a medição do guidu.chat um dia levar ao caminho A (cliente Matrix direto), o cartão pode seguir o mesmo passo numa ADR nova.

## ⚠️ Pontos de atenção (decisão do Marcelo)

1. **O `neo.guidu.chat` é produção e já está exposto.** Na conferência de 25/11/2026, a API admin (`/_synapse/admin`) respondia ao público (lacuna L1 da ADR 0026), a federação respondia e o login por senha estava ligado. Sugestão: antes do primeiro cartão real, fechar `/_synapse/admin` no Traefik do Coolify, deixar só o listener `client`, aplicar a seção 7 do [guia do Synapse](../operacao/synapse-easypanel.md) e ligar o backup do Postgres do serviço. O console em produção com URL pública continua no caminho crítico (F6c).
2. **Domínio `mobio.pro`.** O console também serve páginas públicas de perfil num domínio configurável (`PUBLIC_DOMAIN_PROFILE`, `src/core/domains/public-hosts.ts`), e os cartões Laravel do Mobio respondem em `mobio.pro`. Sugestão: decidir, antes do deploy, qual sistema responde em `mobio.pro`. A API do chat do cartão pode ficar num host da plataforma (por exemplo `api.guidu.chat`), porque o token do visitante não depende de cookie.
3. **Visitante anônimo e custo.** O limite de 20 respostas sem contato e a validade de 30 dias do token são propostas. Sugestão: começar com esses números no piloto do Cartão PRO e ajustar com o uso real.
