# ADR 0027 — guidu.chat V1: a ligação console ↔ bridge ↔ guidu.chat e a divisão entre as equipes

- **Status:** Proposto; vira aceito com a aprovação do Marcelo no PR
- **Data:** 23/10/2026
- **Aprovador:** Marcelo
- **Decisão de origem:** decisões do Marcelo de 23/10/2026 (Vendure na V1, pedido enviado à loja com pagamento pela loja, proposta com histórico, janeiro de 2027, duas equipes)
- **Relaciona-se com:** [ADR 0011](0011-camada-de-canais-no-nucleo.md) (canais), [ADR 0017](0017-sdk-dos-agentes-de-ia.md) (motor), [ADR 0023](0023-chat-interno-como-cliente-matrix.md) (Matrix), [ADR 0026](0026-gateways-apisix-e-agentgateway.md) (gateways). Os números 0024 e 0025 seguem reservados (salas de agentes e compra agêntica).
- **Substitui como fonte de decisão:** as propostas em [mini-apps-bridge.md](../architecture/mini-apps-bridge.md), [guidu-chat-app.md](../architecture/guidu-chat-app.md), [commerce-guidu-chat.md](../architecture/commerce-guidu-chat.md) e no [documento de produto V1](https://github.com/smarthubaiagency/guidu-chat/blob/claude/produto-v1/docs/produto/v1-navegacao-e-pedido.md), naquilo em que divergirem desta ADR.

## Contexto

O guidu.chat é o app do turista; o console (GUIDU) é a plataforma do comerciante e o servidor de tudo. Duas equipes vão trabalhar em paralelo até janeiro de 2027: uma no console e outra no guidu.chat. Para que a equipe do guidu.chat não precise mexer no console, nem refazer o que ele já faz, a fronteira entre os dois precisa ser um **contrato escrito**, entregue antes do código.

## Decisão

### 1. Três peças, dois donos

| Peça                | O que é                                                                                                                                                   | Dono                                                                             |
| ------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| **Console (GUIDU)** | Servidor de tudo: Portfólio, Inbox, CRM, agentes, salas Matrix, Vendure e seus plugins, Bridge API, **API do guidu.chat**, mini-apps, gateways e produção | Equipe console                                                                   |
| **Contrato**        | API do guidu.chat (OpenAPI), contrato da Mini App Bridge (esquemas Zod) e catálogo de eventos em tempo real, versionados                                  | Equipe console escreve e publica; equipe guidu.chat revisa e aprova cada mudança |
| **guidu.chat**      | O cliente do turista: guidu.chat web (janeiro) e app Expo (depois), telas, adaptador da ponte, sessão do turista                                          | Equipe guidu.chat                                                                |

**Regra de ouro:** o guidu.chat fala **só** com a API do guidu.chat e com os mini-apps pela ponte. Nunca com o banco, o Vendure, o Synapse, o Supabase do console ou os provedores de pagamento. Tudo o que o turista precisa e não está no contrato é pedido à equipe console, que acrescenta ao contrato.

### 2. Endereços

| Host                              | Serve                                                        | Dono                                                | Gateway |
| --------------------------------- | ------------------------------------------------------------ | --------------------------------------------------- | ------- |
| `guidu.chat`                      | guidu.chat web (Next.js, container próprio `guidu-chat-web`) | guidu.chat                                          | APISIX  |
| `guidu.chat/.well-known/matrix/*` | Arquivos do Matrix (ADR 0023, `server_name` de produção)     | console (o APISIX responde, antes de chegar ao web) | APISIX  |
| `api.guidu.chat`                  | API do guidu.chat e Bridge API, no container do GUIDU        | console                                             | APISIX  |
| `apps.guidu.chat`                 | Mini-apps (runtime), no container do GUIDU                   | console                                             | APISIX  |
| `matrix.guidu.chat`               | Synapse (o turista não acessa direto na V1)                  | console                                             | APISIX  |

Os quatro hosts são do mesmo site (`guidu.chat`), o que mantém cookies e iframe funcionando sem bloqueio de terceiros.

### 3. Quem faz cada tela da V1

| Tela ou função                                                                                                                                    | Onde roda                                                                 | Dono                                                     |
| ------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------- | -------------------------------------------------------- |
| Home, Chat, Conta e Cliente Hub, carrinho, checkout ("Enviar pedido"), proposta e aceite, cartão "Pagar à loja", telas de retirada e envio, login | guidu.chat (telas do app)                                                 | guidu.chat                                               |
| Leitura do QR: `guidu.chat/q/<código>` resolve o ponto de entrada pela API e abre o Local                                                         | guidu.chat                                                                | guidu.chat                                               |
| Local: banner, favoritos e últimos vistos                                                                                                         | guidu.chat                                                                | guidu.chat                                               |
| Conteúdo da loja dentro do Local: perfil completo, produto ou oferta, catálogo, cardápio (templates)                                              | Mini-apps em `apps.guidu.chat`, abertos por iframe (web) ou WebView (app) | console                                                  |
| Área da loja (blocos e cores escolhidos pela loja no módulo Cliente Hub do console), no Local e no Cliente Hub                                    | Mini-app em `apps.guidu.chat`, lendo `GET /stores/{slug}/hub`             | console ([proposta](../modules/cliente-hub/proposta.md)) |
| Espaço Pedidos no Inbox, proposta versionada, gerar link de pagamento, confirmar recebimento, pronto, enviado, concluído                          | Console                                                                   | console                                                  |

### 4. API do guidu.chat (v1)

Base `https://api.guidu.chat/v1`, descrita em OpenAPI. A autenticação do turista é um token do Supabase Auth do turista (telefone com código), conferido pelo GUIDU a cada chamada. O guidu.chat nunca recebe credencial do Vendure, do Matrix nem de provedor de pagamento.

| Grupo               | Rotas (nomes de referência)                                                                                                                                                                                                                                                                        | Precisa de login                                     |
| ------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------- |
| Entrada             | `GET /entry/{code}` (QR, NFC, link → loja, item, mini-app)                                                                                                                                                                                                                                         | Não                                                  |
| Lojas e itens       | `GET /stores/{slug}`, `GET /stores/{slug}/items`, `GET /items/{id}`                                                                                                                                                                                                                                | Não                                                  |
| Conta               | `GET /me`, `PATCH /me` (idioma, notificações), `POST /me/export`, `DELETE /me`                                                                                                                                                                                                                     | Sim                                                  |
| Favoritos e vistos  | `GET/POST/DELETE /me/favorites`, `GET /me/recent`                                                                                                                                                                                                                                                  | Sim (vistos também sem login, guardados no aparelho) |
| Carrinho            | `GET /carts`, `PUT /carts/{storeId}/lines`, `DELETE /carts/{storeId}/lines/{lineId}` (um carrinho por loja; o carrinho do visitante passa para a conta no login)                                                                                                                                   | Não para montar                                      |
| Pedido              | `POST /orders` (Enviar pedido, com chave de idempotência), `GET /orders`, `GET /orders/{id}`, `POST /orders/{id}/cancel`                                                                                                                                                                           | Sim                                                  |
| Proposta            | `GET /orders/{id}/proposals` (todas as versões), `POST /orders/{id}/proposals/{version}/accept`, `POST /orders/{id}/proposals/{version}/request-change`                                                                                                                                            | Sim                                                  |
| Pagamento e entrega | `GET /orders/{id}/payment` (link ou Pix, valor, domínio, situação), `POST /orders/{id}/payment/receipt` (anexo de comprovante), `GET /orders/{id}/fulfillment` (retirada ou envio)                                                                                                                 | Sim                                                  |
| Conversas           | `POST /conversations/open` (loja e item de origem), `GET /conversations`, `GET /conversations/{id}/messages`, `POST /conversations/{id}/messages`. Cada conversa traz a loja (nome, logo, cor) e quem fala agora (`ia`, `pessoa` ou `guidu`, nome de exibição, avatar); cada mensagem traz o autor | Sim                                                  |
| Tempo real          | `GET /events` (Server-Sent Events: mensagem nova, mudança de pedido, nova versão de proposta)                                                                                                                                                                                                      | Sim                                                  |
| Push                | `POST /me/devices`, `DELETE /me/devices/{id}`                                                                                                                                                                                                                                                      | Sim                                                  |
| Lista de compras    | `GET /me/shopping-list` (do BotCompara)                                                                                                                                                                                                                                                            | Sim                                                  |
| Ponte               | `POST /bridge/sessions`, `POST /bridge/sessions/exchange`                                                                                                                                                                                                                                          | Sim (exchange é do mini-app)                         |

Regras da API: preço, estoque, frete, situação do pedido e do pagamento vêm sempre do servidor; erros têm código estável e mensagem segura; toda escrita aceita chave de idempotência; limites por turista e por IP no APISIX.

### 5. Mini App Bridge (v1)

O contrato da [ponte](../architecture/mini-apps-bridge.md) vale com estas fixações:

- Envelope `{ v: 1, id, type, sessionId, payload }`, resposta `guidu.result`, validação Zod nos dois lados, timeout e proteção contra repetição.
- **Métodos de domínio v1:** `getContext`, `openChat`, `addToCart(itemId, variantId, qty)`, `close`, `subscribe`. O `addToCart` é novo: o mini-app pede, o guidu.chat chama a API com o token do turista e atualiza o carrinho.
- **Camada de aparelho v1** no formato do MAX Bridge: `platform`, `colorScheme`, `BackButton`, `openLink`, `HapticFeedback` (só no app), confirmação ao fechar.
- O pagamento e o checkout **nunca** acontecem no mini-app.
- O lado do mini-app (SDK) é da equipe console; o lado do app (adaptador iframe e WebView) é da equipe guidu.chat.

### 6. Comércio na V1

- **Vendure** com canal por loja, customers do guidu.chat ligados ao `sub` do turista, processo de pedido próprio e meio de pagamento "combinado com a loja".
- **Proposta da loja versionada** (itens, frete, prazo, validade) por plugin próprio (`guidu-proposals`); só a versão aceita pelo turista define o valor.
- **Link de pagamento** gerado a partir do pedido selecionado no Inbox: um provedor por API (N8) e os demais no modo manual; credencial da loja cifrada no cofre do GUIDU.
- **"Pago" só com a confirmação da loja**; o aviso do provedor só sinaliza.
- Situações: `enviado` → `proposta da loja` → `aceito pelo turista` → `aguardando pagamento` → `pago` → `pronto para retirada` / `enviado` → `concluído`; `recusado` e `cancelado` antes de `pago`.

### 7. Conversa na V1

O turista conversa pelo GUIDU (caminho B de [guidu-chat-app.md](../architecture/guidu-chat-app.md)): usuário virtual no Synapse, rotas de conversa da API e tempo real por SSE. Se o Marcelo escolher o WhatsApp para janeiro (N9), a aba Chat abre o WhatsApp da loja com o código da origem, e as rotas de conversa entram depois, sem mudar o resto do contrato.

### 8. Identidade do turista

Supabase Auth com telefone e código, num projeto próprio do guidu.chat (recomendação N4, a confirmar). O GUIDU confere o token pelas chaves públicas desse projeto e liga o `sub` ao customer do Vendure, ao usuário virtual do Matrix e aos pedidos. O console nunca usa esse token para acessar o painel do comerciante.

### 9. Como as equipes trabalham juntas

1. **Contrato antes do código:** a equipe console publica a OpenAPI e os esquemas da ponte na primeira semana, num pacote versionado (`@guidu/contracts`, no GitHub Packages), junto com um **servidor simulado** gerado da OpenAPI. A equipe guidu.chat desenvolve contra o simulado até a API real existir.
2. **Versão:** mudança compatível sobe a versão menor; mudança que quebra cria `v2` e mantém a `v1` até o guidu.chat migrar.
3. **Mudança de contrato** é um PR no console, com revisão obrigatória da equipe guidu.chat.
4. **Ambientes:** dev com contas de teste de turista e de loja, Vendure de testes e provedor de pagamento em sandbox.
5. **Contexto da equipe guidu.chat:** `docs/contexto.md` no repositório `guidu-chat`, com tudo o que ela precisa saber sem ler o console.
6. **Divisão de tarefas e semanas:** [equipes-guidu-chat-v1.md](../gestao/equipes-guidu-chat-v1.md).

## Consequências

- A equipe guidu.chat não abre PR no console; pede mudança de contrato.
- A equipe console passa a manter uma API pública com versão, um servidor simulado e um pacote de contratos.
- Surge um container novo (`guidu-chat-web`), da equipe guidu.chat, com deploy pela mesma esteira.
- O APISIX ganha os hosts `api.guidu.chat` e `guidu.chat`, e a rota estática do `.well-known` do Matrix.
- O app nativo (Expo) depois de janeiro usa o mesmo contrato; só muda o adaptador da ponte (WebView no lugar do iframe).
- O pagamento pela plataforma, o carrinho com várias lojas e o cliente Matrix direto no app ficam fora da V1.
