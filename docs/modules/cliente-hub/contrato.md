# Cliente Hub: pedidos de contrato (`@guidu/contracts`)

- **Status:** pedidos da conversa do Cliente Hub V1 à equipe console, 24/10/2026, para entrar no **contrato v1** publicado na semana de 27/10 (ADR 0027, seção 9). A equipe guidu.chat revisa no PR do contrato.
- **Especificações:** [módulo no console](especificacao.md) e [Hub do turista no guidu-chat](https://github.com/smarthubaiagency/guidu-chat/blob/main/docs/produto/cliente-hub.md).
- **Convenções:** base `https://api.guidu.chat/v1`; erros com `code` estável e `message` segura; escritas com `Idempotency-Key`; datas ISO 8601 em UTC; dinheiro em centavos (`amount`) com `currency`; textos que a loja escreveu chegam já no idioma pedido (`?locale=` ou `Accept-Language`), com o idioma usado em `locale`. Situações e códigos são estáveis e o **app traduz** os rótulos dele.

## Resumo

| #   | Pedido                                                                                 | Prioridade                   | Quem usa                     |
| --- | -------------------------------------------------------------------------------------- | ---------------------------- | ---------------------------- |
| H1  | `GET /stores/{slug}/hub`: a área publicada                                             | Contrato na semana 1         | Runtime e guidu.chat         |
| H2  | `GET /bridge/stores/{slug}/hub/me`: dados do turista naquela loja                      | Contrato na semana 1         | Runtime (sessão do mini-app) |
| H3  | Favoritos: esquema e filtro por loja                                                   | Contrato na semana 1         | guidu.chat e runtime         |
| H4  | Últimos vistos: filtro por loja e `POST /me/recent`                                    | Contrato na semana 1         | guidu.chat e runtime         |
| H5  | Perguntas frequentes dentro do H1                                                      | Junto com o H1               | Runtime                      |
| H6  | Ponte: `requestLogin`, `openOrder`, `openOrders`, `setFavorite`, evento `auth.changed` | Contrato na semana 1         | Runtime e adaptador          |
| H7  | "Com quem você está comprando": dados da empresa e do provedor                         | Contrato na semana 1         | guidu.chat                   |
| H8  | Conversas em janeiro pelo WhatsApp e "Falar com a loja" sobre um pedido                | Contrato na semana 1         | guidu.chat                   |
| H9  | Lista de pedidos para Minhas compras                                                   | Já previsto; fixar o esquema | guidu.chat                   |
| H10 | Perfil: endereços, tipo de usuário, notificações                                       | Contrato na semana 1         | guidu.chat                   |
| H11 | Resumo do cabeçalho do Hub                                                             | Pode vir na semana 5         | guidu.chat                   |
| H12 | Erros novos                                                                            | Junto com os demais          | Todos                        |

## H1 — `GET /stores/{slug}/hub`

Público, sem login. Cache conforme CH9 (`ETag` pela versão, `max-age=60`). Sempre devolve uma área: sem versão publicada (ou com o módulo desligado pela cascata), devolve o **modelo padrão da plataforma** com `version: null`.

```ts
type StoreHub = {
  store: { slug: string; name: string; logo: Image | null; initials: string };
  version: { id: string; number: number; published_at: string } | null; // null = modelo padrão
  locale: "pt-BR" | "en" | "es"; // idioma em que os textos vieram
  appearance: {
    cover: { small: Image; large: Image; alt: string } | null;
    accent: string; // #RRGGBB
    on_accent: string; // cor do texto sobre o destaque
    accent_ui: { light: string; dark: string }; // variante para ícones e bordas em cada tema (3:1)
    accent_text_ok: { light: boolean; dark: boolean }; // pode usar o destaque como cor de texto
  };
  status: {
    open_now: boolean;
    opens_at: string | null;
    closes_at: string | null;
    accepts_orders: boolean;
  };
  fixed: {
    login_prompt: { title: string; text: string; button: string };
    add_to_cart: {
      button: string;
      added: string;
      out_of_stock: string;
      closed: string;
    };
  };
  blocks: HubBlock[]; // já filtrados (ligados e permitidos pela cascata), na ordem da loja
};

type Image = { url: string; width: number; height: number };

type HubBlock =
  | {
      id: string;
      type: "my_orders";
      title: string;
      empty: string;
      see_all: string;
    }
  | { id: string; type: "favorites"; title: string; empty: string }
  | { id: string; type: "recent"; title: string }
  | {
      id: string;
      type: "chat";
      title: string;
      text: string;
      button: string;
      closed_text: string;
    }
  | {
      id: string;
      type: "faq";
      title: string;
      items: { id: string; q: string; a: string }[];
    };
```

Regras: tipos de bloco desconhecidos devem ser **ignorados** pelo cliente (o catálogo cresce na V1.1 sem `v2`); todos os textos chegam resolvidos (texto da loja no idioma → texto padrão no idioma → pt-BR), nunca vazios.

## H2 — `GET /bridge/stores/{slug}/hub/me`

Com a sessão do mini-app (cookie do `apps.guidu.chat` ou cabeçalho, ponte 11.6). Só dados do turista **naquela loja**, consultados com o `withContext` da loja.

```ts
type StoreHubMe = {
  orders: {
    id: string;
    code: string;
    situation: OrderSituation;
    total: Money;
    updated_at: string;
  }[]; // até 3
  orders_total: number;
  favorites: {
    item_id: string;
    title: string;
    image: Image | null;
    price: Money | null;
    available: boolean;
  }[]; // até 12
  store_favorited: boolean;
  recent: {
    item_id: string;
    title: string;
    image: Image | null;
    price: Money | null;
    viewed_at: string;
  }[]; // até 8
};
```

`OrderSituation` é o mesmo enum do H9. Sem sessão: `401 bridge_session_required`. A sessão do mini-app é presa a uma loja: o servidor usa a loja **da sessão**, e um `{slug}` diferente dela devolve `404 store_not_found` (o slug na rota é só conferência, nunca a fonte do filtro). Os dados vêm das bases do guidu.chat (Supabase do turista e Vendure, N4), filtrados pela loja.

## H3 — Favoritos

As rotas `GET/POST/DELETE /me/favorites` já estão na ADR 0027. Fixar:

- `POST /me/favorites` com `{ target: { kind: "store", store_slug } | { kind: "item", item_id } }`; idempotente (favoritar duas vezes não duplica); devolve o favorito.
- `DELETE /me/favorites/{id}` e `DELETE /me/favorites?target=...` (desfavoritar pelo alvo, sem precisar do id).
- `GET /me/favorites?kind=store|item&store=<slug>&cursor=`: cada item com loja (`slug`, `name`, `logo`, `accent`), título, imagem, preço atual e `available`. Item que saiu do catálogo volta com `available: false`, sem preço.
- Limite: 500 favoritos por conta (`favorites_full`).

## H4 — Últimos vistos

- `GET /me/recent?store=<slug>&limit=` (já previsto, com filtro por loja).
- **Novo:** `POST /me/recent` com `{ items: [{ item_id, viewed_at }] }` (até 20), para juntar à conta os vistos guardados no aparelho antes do login. O servidor ignora itens que não existem e mantém os 100 mais recentes por conta.
- O servidor também registra sozinho a visita quando o turista com login abre um item (sem chamada extra do app).

## H5 — Perguntas frequentes

Vêm dentro do H1 (`type: "faq"`). Sem rota própria na V1. O GUIDS da loja passa a usá-las como base de conhecimento na V1.1, lendo do console, não da API pública.

## H6 — Ponte (métodos de domínio novos)

| Método / evento               | Lado          | Comportamento                                                                                                                                                                                                                                                            |
| ----------------------------- | ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `requestLogin({ reason })`    | Ação do app   | O guidu.chat abre a entrada da plataforma (telefone com código) e volta para onde estava. `reason`: `my_orders`, `favorites`, `chat`. Resultado `{ signedIn: boolean }`; com login, o app emite `auth.changed` e o runtime refaz a sessão do mini-app pelo aperto de mão |
| `openOrder({ orderId })`      | Ação do app   | O guidu.chat abre o pedido em Minhas compras. O app confere no servidor que o pedido é do turista                                                                                                                                                                        |
| `openOrders({ storeSlug })`   | Ação do app   | "Ver todos" do bloco Meus pedidos: o guidu.chat abre Minhas compras filtrado pela loja (`GET /orders?store=`, H9). Sem login, pede login antes                                                                                                                           |
| `setFavorite({ target, on })` | Ação do app   | O guidu.chat chama o H3 com o token do turista (o mini-app nunca recebe o token). Sem login, o app pede login antes e completa a ação depois. Resultado `{ favorited: boolean }`                                                                                         |
| `subscribe("auth.changed")`   | Evento do app | `{ signedIn: boolean }`                                                                                                                                                                                                                                                  |

`openChat` (já previsto) passa a aceitar `{ storeSlug, itemId?, intent: "question" | "order", orderId? }`.

## H7 — "Com quem você está comprando"

- `GET /stores/{slug}` ganha `merchant: { legal_name, cnpj, verified, verified_at }` (`cnpj` formatado; `verified` só depois da aprovação à mão do piloto, pendência 2 do handoff de equipes).
- `GET /orders/{id}/payment` ganha `merchant` (o mesmo objeto, copiado no momento do link) e `processor: { name, domain, known: boolean }` (`known` = domínio da lista de provedores conhecidos: Mercado Pago, Pagar.me, Asaas). No modo manual, `processor.name` é "Pix" ou o domínio do link.
- O texto do aviso é do app (i18n), revisado pelo jurídico.

## H8 — Conversas em janeiro (N9)

- `POST /conversations/open` com `{ target: "store", store_slug, item_id?, intent?, order_id? }` devolve, em janeiro, `{ channel: "whatsapp", whatsapp_url, origin_code }`: o link `wa.me` da loja com a mensagem inicial já no idioma do turista e o código da origem, que o Inbox liga ao contexto comercial. `intent: "order"` exige `order_id` do próprio turista e põe o código do pedido na mensagem; é a única porta do app para ajuste, cancelamento, comprovante e problema com o pedido (princípio de poucas etapas, guidu-chat `docs/produto/cliente-hub.md`, seção 8.1).
- `GET /conversations` lista as conversas com `channel: "whatsapp" | "app"`, a loja (nome, logo, cor), a última atividade conhecida e, para o WhatsApp, `whatsapp_url`. A conversa com o guidu (C1 do BotCompara) vem com `kind: "guidu"`.
- Quando o chat das lojas no app chegar, as mesmas rotas passam a devolver `channel: "app"`, sem `v2`.

## H9 — Lista de pedidos

- `GET /orders?state=active|done&store=<slug>&cursor=` (já previsto; fixar filtros e paginação de 20).
- Cada pedido: `id`, `code` (curto, para o balcão), `store` (slug, nome, logo, cor), `situation`, `total`, `fulfillment: "pickup" | "delivery"`, `created_at`, `updated_at`, `next_action` (`accept_proposal`, `pay`, `pickup`, `none`).
- `OrderSituation`: `sent`, `proposal`, `accepted`, `awaiting_payment`, `paid`, `ready_for_pickup`, `shipped`, `completed`, `refused`, `cancelled` (as situações da ADR 0027, seção 6).
- `active` = qualquer situação antes de `completed`, `refused` e `cancelled`.
- **`GET /orders/{id}` traz a página inteira numa chamada:** `progress: { steps: [{ key: "sent" | "approved" | "paid" | "fulfilled", done_at | null }], current: <key>, your_turn: boolean, last_update_at }` calculado pelo servidor (o app não deduz o passo da situação), `proposal` atual (com `previous_count`), `payment` (o mesmo objeto do `GET /orders/{id}/payment`, com `merchant` e `processor` do H7), `fulfillment` (retirada ou envio) e `summary` (itens e totais). As rotas separadas continuam para atualização parcial.
- SSE `order.updated` com o mesmo objeto, para a página se atualizar sem recarregar.

## H10 — Perfil

- `GET /me` ganha `user_type: "visitor" | "resident" | "worker" | null` (o mesmo campo do C12 do BotCompara; `PATCH /me/profile`).
- **Endereços de entrega** (não estão na ADR 0027): `GET/POST /me/addresses`, `PATCH/DELETE /me/addresses/{id}`, com `label`, `street`, `number`, `complement`, `neighborhood`, `city`, `state`, `postal_code`, `reference`, `is_default`. Até 10 por conta. Endereço usado em pedido continua no pedido mesmo se apagado da lista.
- `PATCH /me` com `notifications: { order_updates_push: boolean }`. Avisos de pedido por push podem ser desligados; o pedido continua aparecendo em Minhas compras.
- Consentimentos e "O que o guidu sabe de você": rotas C5 e C12 do BotCompara, sem mudança.

## H11 — Resumo do cabeçalho do Hub

`GET /me/summary`: `{ active_orders: number, next_pickup: { order_id, store_name, at } | null, pending_actions: number }`. Uma chamada leve para abrir o Hub rápido; até a semana 5, o app pode calcular com o H9.

## H12 — Erros novos

`bridge_session_required`, `favorites_full`, `address_limit`, `order_not_found` (também para pedido de outro turista: mesma resposta, sem revelar que existe), `store_not_found`, `whatsapp_unavailable` (loja sem WhatsApp conectado; o app mostra "Esta loja ainda não atende por mensagem").
