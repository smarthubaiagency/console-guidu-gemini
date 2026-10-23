# Mini-apps do guidu.chat e a Mini App Bridge

- **Status:** proposta para fechar com o Marcelo. Vira ADR (número sugerido: 0028) depois das respostas da seção 10.
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

| Peça                      | O que é                                                                                                                                                   | Onde vive                                                          |
| ------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| **Registro de mini-apps** | Templates da plataforma e instâncias publicadas por loja: `workspace_id`, id, slug, template, versão publicada, capacidades, política de origem, situação | GUIDU (tabelas novas), gerido pelo módulo **Mini Apps** do console |
| **Pontos de entrada**     | QR, NFC, link e chat, cada um com loja, item opcional e `sourceType`                                                                                      | GUIDU; o QR é gerado no console                                    |
| **Runtime**               | Site público e responsivo que renderiza os templates com os dados publicados, em Next.js com o `@guidu/ui`                                                | Host próprio (pergunta 1), servido pelo console no começo          |
| **Bridge API**            | Emite sessões curtas, autoriza as ações e coordena conversa, solicitação e checkout                                                                       | GUIDU (`/bridge/...`), atrás do APISIX                             |
| **Bridge SDK**            | `@guidu/miniapp-sdk`: métodos das duas camadas, envelope e validação (Zod)                                                                                | Pacote próprio, ao lado do `guiduchat-ui` (pergunta 2)             |
| **Adaptadores do app**    | Expo (WebView com origem conferida e rotas para telas nativas) e web (iframe com `postMessage`, ou chamada direta na mesma origem)                        | Repositórios do guidu.chat                                         |

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

1. **Host dos mini-apps:** um host próprio (por exemplo, `apps.guidu.chat` ou `m.guidu.chat`) servido pelo console no começo? É a recomendação, porque separa cookies, moldura e permissões do painel.
2. **SDK:** pacote `@guidu/miniapp-sdk` separado, com os contratos Zod, ou dentro do `guiduchat-ui`?
3. **Objeto global:** só o import do SDK, ou também um `window.WebApp` com a camada de aparelho no formato do MAX?
4. **Templates do piloto:** os do documento de visão para boutique, restaurante e pousada (detalhe do item, cardápio da mesa, concierge do quarto)?
5. **Mini-apps de parceiros:** só templates nossos no início?
