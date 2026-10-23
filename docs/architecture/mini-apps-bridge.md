# Mini-apps do guidu.chat e a Mini App Bridge

- **Status:** proposta para fechar com o Marcelo. Vira ADR (número sugerido: 0028) depois das respostas da seção 10. O funcionamento por dentro e onde cada peça mora estão na seção 11. O documento de visão e o MAX Bridge são referências, não decisões.
- **Data:** 23/10/2026
- **Fontes:** [visão do Guidu.chat v1.0](../spec/guidu-chat-visao-produto-v1.0.md), seção 7 (desenho de domínio), e o MAX Bridge (desenho de capacidades do aparelho). Comparação em [analise-visao-guidu-chat.md](analise-visao-guidu-chat.md).
- **Relaciona-se com:** [commerce do guidu.chat](commerce-guidu-chat.md), [ADR 0023](../adr/0023-chat-interno-como-cliente-matrix.md) (Matrix e JWT), [ADR 0026](../adr/0026-gateways-apisix-e-agentgateway.md) (gateways), [guiduchat-ui](https://github.com/smarthubaiagency/guiduchat-ui) (kit de UI).

## 1. Duas referências, uma ponte

"Bridge" aqui é o protocolo entre o mini-app web e o app hospedeiro, não a ponte Matrix ↔ WhatsApp.

| Referência                                         | O que traz                                                                                                                                                                                                                                                                        | Onde está                                                                                                                                                                                                         |
| -------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Visão do Guidu.chat v1.0** (21/10/2026), seção 7 | Desenho **de domínio**: registro de mini-apps, runtime, Bridge API com sessão curta, métodos `getContext`, `openChat`, `createRequest`, `close`, `subscribe` e, depois, `openCheckout` e `getPaymentStatus`; envelope versionado com resposta; pagamento numa tela do próprio app | [docs/spec](../spec/guidu-chat-visao-produto-v1.0.md)                                                                                                                                                             |
| **MAX Bridge**                                     | Desenho **de aparelho**: `window.WebApp` com `initData`, `BackButton`, `openLink`, `requestContact`, `openCodeReader`, `HapticFeedback`, confirmação ao fechar, links `?startapp=`                                                                                                | Organização [max-messenger](https://github.com/max-messenger), [`max-agents-skill`](https://github.com/max-messenger/max-agents-skill), `references/mini-apps-bridge.md` (conferido com dev.max.ru em 21/09/2026) |

O `guiduchat-ui` (fork do `@maxhub/max-ui` 0.7.0) é só o kit visual e não depende da ponte. O MAX Bridge também não depende dele.

**Decisão proposta:** a ponte do guidu.chat tem **duas camadas**. A camada de domínio vem do documento de visão e é o coração do contrato. A camada de aparelho segue os nomes e as formas do MAX Bridge.

## 2. Peças

| Peça                      | O que é                                                                                                                                                   | Onde vive                                                                      |
| ------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| **Registro de mini-apps** | Templates da plataforma e instâncias publicadas por loja: `workspace_id`, id, slug, template, versão publicada, capacidades, política de origem, situação | GUIDU (tabelas novas), gerido pelo módulo **Mini Apps** do console             |
| **Pontos de entrada**     | QR, NFC, link e chat, cada um com loja, item opcional e `sourceType`                                                                                      | GUIDU; o QR é gerado no console                                                |
| **Runtime**               | Site público e responsivo que renderiza os templates com os dados publicados, em Next.js com o `@guidu/ui`                                                | `apps.guidu.chat`, servido pelo container web do GUIDU (decisão de 23/10/2026) |
| **Bridge API**            | Emite sessões curtas, autoriza as ações e coordena conversa, solicitação e checkout                                                                       | GUIDU (`/bridge/...`), atrás do APISIX                                         |
| **Bridge SDK**            | `@guidu/miniapp-sdk`: métodos das duas camadas, envelope e validação (Zod)                                                                                | Pacote próprio, ao lado do `guiduchat-ui` (pergunta 2)                         |
| **Adaptadores do app**    | Expo (WebView com origem conferida e rotas para telas nativas) e web (iframe com `postMessage`, ou chamada direta na mesma origem)                        | Repositórios do guidu.chat                                                     |

**Templates são da plataforma; instâncias são do comerciante.** O comerciante escolhe um template, preenche o conteúdo (itens do Portfólio, coleções, textos) e publica. Ninguém sobe código próprio, e a origem do runtime é fixa.

## 3. Abertura e sessão

1. **Visitante sem login.** O QR (`https://<host dos mini-apps>/<loja>/<item>`) abre o runtime direto no navegador, sem o app instalado. O runtime lê só dados publicados (`GET /public/miniapps/:slug`, `GET /public/portfolio/:itemId`). Se o guidu.chat estiver instalado, o link universal abre o app.
2. **No app, com login.** O app pede à Bridge API uma **`bridgeSession`** (`POST /bridge/sessions`) com o token do turista, o mini-app, o ponto de entrada e um nonce de uso único. A resposta é um código curto (até 5 minutos, uso único), que **nunca vai na URL**.
3. **Aperto de mão.** A WebView abre a origem permitida (https). O SDK pede o código ao app pela ponte, e o runtime troca o código por uma sessão própria do mini-app no servidor (cookie `HttpOnly`, só no host dos mini-apps, curta). O aperto de mão inclui a versão do contrato e as capacidades disponíveis naquele app.
4. **Cada ação** (`openChat`, `createRequest`, `openCheckout`) é revalidada no servidor: turista, loja e objeto. O servidor nunca confia em `workspace_id`, preço ou URL vindos da página.
5. **Expiração, logout, revogação e erro de rede** devolvem um estado seguro e permitem tentar de novo.

Equivalência com o MAX: a `bridgeSession` faz o papel do `initData`. A diferença é que quem emite é a Bridge API do GUIDU, e não um segredo compartilhado com o bot. Isso responde a pergunta "quem assina": o GUIDU, que já assina o JWT do Matrix pelo mesmo princípio (ADR 0023, regra 9).

## 4. Contrato: camada de domínio (documento de visão)

| Método                                | Fase   | Comportamento                                                                                                                                                                  |
| ------------------------------------- | ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `getContext()`                        | v1     | Loja, item publicado, idioma, ponto de entrada e capacidades                                                                                                                   |
| `openChat(itemId, intent)`            | v1     | O servidor valida o item e acha ou cria a sala da pessoa com a loja (a mesma regra da IN7a), com o item como contexto; o app abre a conversa                                   |
| `createRequest(itemId, qty, details)` | v1     | Cria uma **solicitação comercial** pendente (reserva, orçamento, disponibilidade), confirmada à mão pelo comerciante no Inbox                                                  |
| `close(result?)`                      | v1     | Volta ao app e preserva o estado anterior                                                                                                                                      |
| `subscribe(event, cb)`                | v1     | Avisos do app: tema, voltar, visibilidade, mudança de estado da solicitação                                                                                                    |
| `openCheckout(orderId)`               | Futuro | O app abre a **tela de pagamento própria** (nativa ou em contexto seguro), que busca preço e loja no servidor (Vendure). O mini-app nunca mostra nem coleta dados de pagamento |
| `getPaymentStatus(paymentId)`         | Futuro | Situação confirmada pelo servidor, a partir do retorno do PSP                                                                                                                  |

**Envelope:** `{ v: 1, id, type: "guidu.openChat", sessionId, payload }`. A resposta é `{ v: 1, id, type: "guidu.result", ok, payload | error }`. Cada pedido tem timeout, lista de métodos permitidos, validação Zod nos dois lados e proteção contra repetição (id único por sessão). O lado que não conhece um `type` responde erro de método desconhecido.

## 5. Contrato: camada de aparelho (formato do MAX Bridge)

| Membro                                                        | v1         | Observação                                                              |
| ------------------------------------------------------------- | ---------- | ----------------------------------------------------------------------- |
| `platform`, `version`                                         | Sim        | `platform` alimenta o `GuiduUI`                                         |
| `colorScheme`                                                 | Sim        | Extensão Guidu (o MAX não tem API de tema)                              |
| `BackButton` (`show`, `hide`, `onClick`, `offClick`)          | Sim        | Igual ao MAX                                                            |
| `openLink(url)`                                               | Sim        | Só https e só depois de um toque do usuário, como no MAX                |
| `HapticFeedback`                                              | Sim        | Só no app nativo                                                        |
| `enableClosingConfirmation()`, `disableClosingConfirmation()` | Sim        | Formulário de solicitação pela metade                                   |
| `requestContact()`                                            | Depois     | Telefone verificado do turista, se o login não trouxer                  |
| `openCodeReader()`                                            | Não        | O leitor de QR fica no shell nativo (documento de visão, 5.1)           |
| `shareContent`, brilho máximo, `downloadFile`                 | Depois     | Compartilhar loja, mostrar comprovante em QR                            |
| Armazenamento no aparelho, biometria, NFC, captura de tela    | Fora da v1 | Biometria e passkeys ficam na tela de pagamento do app, não no mini-app |

## 6. Regras

- Nenhuma decisão de dinheiro ou de permissão passa pela ponte. Preço, loja e situação de pagamento vêm sempre do servidor.
- Os eventos da conversa (solicitação criada, pedido pago) são postados na sala Matrix **pelo servidor**, nunca pelo mini-app. A sala leva o id do registro, não os dados.
- O contexto comercial (`sourceType`, loja, item, variante, idioma, conversa, sala) fica gravado no servidor. Quando a conversa começa, o agente consulta o item atual, não uma cópia de quando o QR foi lido.
- Uma ação repetida por rede instável não duplica sala, solicitação, pedido nem cobrança (idempotência por id do envelope e chave de domínio).

## 7. Segurança

1. **Origem fixa.** O app só abre o host dos mini-apps; a WebView bloqueia navegação para fora da lista; o `postMessage` confere a origem nos dois lados, sem `*`.
2. **Moldura.** Hoje o console responde `frame-ancestors 'none'` e `X-Frame-Options: DENY` (`src/core/security/headers.ts`). O host dos mini-apps libera só as origens do guidu.chat web. O painel continua sem moldura.
3. **Sessão do mini-app separada** do console e do Supabase do turista: host, cookie e duração próprios. Nada de segredo no JavaScript.
4. **Permissões do navegador** liberadas só no host dos mini-apps e só para as capacidades declaradas pelo template. Hoje o `Permissions-Policy` do console desliga todas.
5. **Pelo APISIX** (ADR 0026): limite por IP e tamanho de corpo nas rotas públicas, na Bridge API e no runtime.
6. **Isolamento entre lojas:** o id global do turista não dá a uma loja acesso a dados de outra; cada consulta da Bridge API passa pelo `withContext` da loja.

## 8. Interface

O `AGENTS.md` manda usar shadcn/ui em toda tela do console. O runtime dos mini-apps é a exceção: usa o `@guidu/ui`, para ter a cara do guidu.chat. A exceção entra no `AGENTS.md` com a ADR, valendo só para o host dos mini-apps. O shell nativo do app (React Native + Expo) não usa o `@guidu/ui`, que é React DOM: os tokens de marca precisam ser compartilhados entre os dois.

## 9. Etapas sugeridas

| Etapa   | Entrega                                                                                                                                                        | Depende de         |
| ------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------ |
| **MA0** | ADR 0028 com as respostas da seção 10 e a exceção de interface no `AGENTS.md`                                                                                  | Marcelo            |
| **MA1** | Registro de mini-apps, pontos de entrada e QR por item no console (módulo Mini Apps); runtime público com o template de detalhe do item, sem login             | MA0                |
| **MA2** | Bridge API (`/bridge/sessions`), SDK v1 (camada de domínio com `getContext`, `openChat` e `close`, mais a camada de aparelho básica), adaptador web por iframe | MA1                |
| **MA3** | `createRequest` e a solicitação comercial no Inbox, com confirmação à mão e aviso ao turista no idioma dele                                                    | MA2                |
| **MA4** | Adaptador Expo (WebView), depois da prova do Matrix no React Native (documento de visão, 6.2)                                                                  | App nativo         |
| **MA5** | `openCheckout` e `getPaymentStatus` sobre o Vendure e o PSP escolhido                                                                                          | Commerce VC3 e CA0 |

## 10. Perguntas para o Marcelo

1. ~~**Host dos mini-apps.**~~ **Decidido em 23/10/2026:** `apps.guidu.chat`, servido pelo container web do GUIDU (opção A da seção 11.5). A opção B (mesma imagem num segundo serviço) fica para antes da alta temporada.
2. **SDK:** pacote `@guidu/miniapp-sdk` separado, com os contratos Zod, ou dentro do `guiduchat-ui`?
3. **Objeto global:** só o import do SDK, ou também um `window.WebApp` com a camada de aparelho no formato do MAX?
4. **Templates do piloto:** os do documento de visão para boutique, restaurante e pousada (detalhe do item, cardápio da mesa, concierge do quarto)?
5. **Mini-apps de parceiros:** só templates nossos no início?

## 11. Como funciona por dentro e onde mora

### 11.1 A ponte não é um serviço: são três pedaços em três lugares

| Pedaço                         | O que faz                                                                                                                                                    | Roda em                                                                      | Container                                    |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------- | -------------------------------------------- |
| **SDK** (`@guidu/miniapp-sdk`) | Biblioteca JavaScript dentro da página do mini-app. Descobre onde está rodando, faz o aperto de mão, manda e recebe as mensagens do envelope, valida com Zod | Navegador ou WebView do turista                                              | **Nenhum.** Vai empacotado no runtime        |
| **Adaptador do app**           | Recebe as mensagens do SDK, confere a origem, executa a ação (abrir a conversa, fechar, abrir o pagamento) e responde                                        | Dentro do guidu.chat: no app Expo (código React Native) ou no guidu.chat web | **Nenhum próprio.** Faz parte do app         |
| **Bridge API**                 | Emite e troca a sessão curta, guarda o contexto comercial, executa as ações do lado do servidor (achar ou criar a sala, criar a solicitação)                 | Servidor do GUIDU                                                            | **O mesmo container web do GUIDU** (`guidu`) |

E duas peças ao lado, que não são a ponte mas trabalham com ela:

| Peça                                                          | Roda em                                                                              | Container                                               |
| ------------------------------------------------------------- | ------------------------------------------------------------------------------------ | ------------------------------------------------------- |
| **Runtime dos mini-apps** (as páginas)                        | Next.js, rotas públicas num host próprio (`apps.guidu.chat`, decidido em 23/10/2026) | **No começo, o mesmo container web do GUIDU**; ver 11.5 |
| **Avisos ao turista** (solicitação confirmada, pedido pronto) | Worker do GUIDU (pg-boss), postando na sala Matrix                                   | O container do worker que já existe                     |

### 11.2 Por que a Bridge API mora no GUIDU

Tudo o que ela faz já está no GUIDU: as salas Matrix e o Application Service (`src/core/matrix`), o Portfólio, o Inbox, o CRM, o `withContext` com RLS, a auditoria e a Central de Eventos. Um serviço separado teria de repetir identidade, permissões e acesso ao banco: o mesmo motivo pelo qual o MCP em Go foi descartado ([AVALIACAO.md](../mcp/AVALIACAO.md)). Ela entra como um subsistema do núcleo (`src/core/bridge/`) com rotas em `src/app/bridge/`, atrás do APISIX (ADR 0026).

### 11.3 O caminho das mensagens

O SDK decide o transporte na abertura:

| Onde o mini-app está                                             | Como fala com o app                                                                                                                                    | Conferência de origem                                                                                                                                                           |
| ---------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **WebView do app Expo**                                          | Mini-app → app: `window.ReactNativeWebView.postMessage(texto)`. App → mini-app: `webview.postMessage(texto)`, que chega como evento `message`          | O app só carrega URLs do host dos mini-apps (`originWhitelist` e bloqueio de navegação com `onShouldStartLoadWithRequest`) e confere a URL de cada mensagem (`nativeEvent.url`) |
| **iframe do guidu.chat web**                                     | `window.postMessage` com a origem exata nos dois sentidos. Depois do aperto de mão, um `MessageChannel` próprio, para nenhuma outra janela escutar     | `event.origin` e `event.source` conferidos nos dois lados, nunca `*`                                                                                                            |
| **Navegador comum** (QR lido com a câmera do celular, sem o app) | Não há ponte. O SDK entra em modo visitante: mostra os dados publicados e, nas ações que pedem login, oferece abrir no app ou entrar no guidu.chat web | —                                                                                                                                                                               |

### 11.4 Uma abertura do começo ao fim

```
Turista          App guidu.chat               Mini-app (SDK + runtime)        GUIDU (Bridge API)
   │ toca no item    │                                 │                               │
   │────────────────▶│ POST /bridge/sessions ───────────────────────────────────────────▶│ confere o token do turista,
   │                 │ (token do turista, mini-app, ponto de entrada, nonce)            │ o mini-app publicado e o ponto;
   │                 │◀───────────────────────────────────────────── código (5 min, 1 uso) grava a sessão pendente
   │                 │ abre a WebView no host dos mini-apps (sem código na URL)          │
   │                 │────────────────────────────────▶│ carrega a página pública      │
   │                 │◀──── guidu.hello {v, capacidades pedidas}                        │
   │                 │──── guidu.welcome {v, código, plataforma, tema, capacidades} ───▶│
   │                 │                                 │ POST /bridge/sessions/exchange ▶│ marca o código como usado,
   │                 │                                 │◀──────── sessão do mini-app ───│ grava o contexto comercial
   │ "Quero reservar"│                                 │ createRequest → servidor ─────▶│ cria a solicitação, avisa a loja
   │                 │                                 │                               │ no Inbox, posta na sala pelo worker
   │ "Conversar"     │◀──── guidu.openChat {itemId} ───│                               │
   │                 │ POST /conversations/open (token do turista) ─────────────────────▶│ acha ou cria a sala da pessoa
   │                 │◀─────────────────────────────────────────────────── room_id       │ com a loja, com o item no contexto
   │                 │ fecha a WebView e abre a conversa na tela nativa                  │
```

Há dois tipos de ação, e o SDK esconde a diferença:

- **Ações do servidor** (`getContext`, `createRequest`): o runtime chama a Bridge API com a sessão do mini-app. O app não participa.
- **Ações do app** (`openChat`, `close`, `openCheckout`, botão voltar, vibração): o SDK manda o envelope ao app, que executa com o token do próprio turista e responde `guidu.result`. Assim a página do mini-app nunca recebe o token do turista.

### 11.5 O runtime dos mini-apps: mesmo container ou separado?

| Opção                                                          | Como                                                                                                                                                   | A favor                                                                                                | Contra                                                                           |
| -------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------- |
| **A. Rotas no GUIDU, host próprio** (escolhida em 23/10/2026)  | `apps.guidu.chat` aponta para o container web do GUIDU; o `proxy.ts` separa por host, como já faz com os domínios públicos (`resolvePublicHost`, CF2c) | Nada novo para operar; usa direto o Portfólio e a Bridge API                                           | O tráfego de turista e o do painel disputam o mesmo container                    |
| **B. Mesma imagem, serviço separado** (para o pico de Búzios)  | O mesmo código sobe como um segundo serviço no EasyPanel (`guidu-apps`), e o APISIX manda o host `apps.*` só para ele                                  | Escala o lado do turista sem mexer no painel; um pico de QR não derruba o console; sem duplicar código | Mais um serviço para monitorar (mesma imagem, então pouco trabalho)              |
| **C. App Next.js separado** (o monorepo do documento de visão) | Repositório ou pacote próprio, com API de leitura do GUIDU                                                                                             | Ciclo de deploy independente                                                                           | Duplica autenticação, acesso a dados e build; só faz sentido com equipe separada |

Recomendação: **A no desenvolvimento e no começo do piloto, B antes da alta temporada.** A passagem de A para B é só configuração de deploy e de rota, sem mudar código. Em todos os casos, as páginas públicas ficam em cache no Cloudflare e no APISIX, porque o QR gera muitas leituras do mesmo item.

### 11.6 Sessão no iframe: por que o host deve ficar sob `guidu.chat`

No guidu.chat web, o mini-app abre num iframe. Os navegadores bloqueiam cookies de terceiros em iframes de **outro site**. Se o runtime ficar em `apps.guidu.chat`, ele é do **mesmo site** que o `guidu.chat`, e o cookie da sessão do mini-app funciona com `SameSite=Lax`. Num domínio do console (`*.guidu.co`), o cookie seria de terceiros e falharia no Safari. A alternativa é guardar a sessão do mini-app só na memória da página e mandá-la num cabeçalho, sem cookie. No app Expo, a WebView abre a página como principal e a questão não existe.

### 11.7 O que é gravado no GUIDU

| Tabela (nomes provisórios) | Para quê                                                                                 |
| -------------------------- | ---------------------------------------------------------------------------------------- |
| `miniapp_templates`        | Templates da plataforma: id, versão, capacidades que podem pedir                         |
| `miniapps`                 | Instância por loja: `workspace_id`, template, slug, conteúdo publicado, versão, situação |
| `miniapp_entry_points`     | QR, NFC e links: loja, item opcional, `source_type`, slug curto do QR                    |
| `bridge_sessions`          | Código (só o hash), turista, mini-app, ponto de entrada, validade, usado ou não          |
| `commerce_contexts`        | Contexto comercial: origem, loja, item, variante, idioma, conversa, sala                 |
| `commercial_requests`      | Solicitações (reserva, orçamento, disponibilidade), situação, sala ligada                |

Todas com `workspace_id` e RLS, como o resto do núcleo. As migrations saem na etapa MA1 e passam pela aprovação do PR.
