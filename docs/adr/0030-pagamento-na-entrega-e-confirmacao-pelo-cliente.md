# ADR 0030 — Pagamento na entrega e confirmação do recebimento pelo cliente

- **Status:** Proposto; vira aceito com a aprovação do Marcelo no PR
- **Data:** 01/11/2026
- **Aprovador:** Marcelo
- **Decisão de origem:** telas de Pedidos e de detalhe do pedido do guidu.chat, aprovadas pelo Marcelo em 31/10/2026
- **Ajusta:** [ADR 0027](0027-guidu-chat-v1-console-bridge.md), seção 6 (situações do pedido), só no que diz respeito a quem aprova a proposta e a quem faz a transição `shipped` → `completed`
- **Relaciona-se com:** [contrato do Cliente Hub](../modules/cliente-hub/contrato.md) (H7 e H9)

## Contexto

O guidu.chat mostra o pedido em uma tela só (`GET /orders/{id}`). Nem toda compra é paga por link: na entrega por motoboy o cliente pode pagar ao receber. O contrato (H7) só previa o pagamento por link, com `merchant` e `processor`.

Duas ações do cliente mudam a situação do pedido e ainda não têm rota: aprovar a proposta da loja e confirmar que recebeu.

## Decisão

1. **O pagamento tem forma.** `payment.method` é `link` ou `on_delivery`. Em `on_delivery` o app não abre pagamento: `payment.url`, `merchant` e `processor` vêm `null`, e `payment.amount` é o valor a pagar ao entregador. Quem decide o método é o servidor, nunca o app.
2. **O cliente aprova a proposta:** `POST /orders/{id}/accept-proposal`, só em `proposal` (vai para `accepted`). Outra situação responde `409 invalid_situation`.
3. **O cliente confirma o recebimento:** `POST /orders/{id}/confirm-delivery`, só em `shipped` (vai para `completed`). Outra situação responde `409 invalid_situation`. Em `on_delivery`, a confirmação também encerra o pagamento.
4. As duas rotas exigem conta, usam `Idempotency-Key` e devolvem o pedido inteiro (o mesmo objeto do `GET /orders/{id}`). Pedido de outro turista responde `404 order_not_found`, como nas demais.

## Campos novos do pedido

Em `GET /orders` (cartão) e `GET /orders/{id}` (detalhe), além do que o H9 já fixa:

| Campo | Onde | Descrição |
| --- | --- | --- |
| `first_item` | cartão | nome do primeiro item, no idioma pedido |
| `state` e `q` | `GET /orders` | filtros (`active` \| `done`) e busca por código, loja ou item |
| `estimated_at` | detalhe | previsão de entrega ou retirada; `null` quando concluído |
| `reason` | detalhe | motivo, em `refused` e `cancelled`, no idioma pedido |
| `contact` | detalhe | `{ handle \| null, address, maps_url }` da loja |
| `payment.method` | detalhe | `link` \| `on_delivery` (decisão 1) |
| `fulfillment.note` | detalhe | recado da loja sobre a retirada ou entrega, ou `null` |
| `fulfillment.courier` | detalhe | `{ name, photo \| null, plate, phone \| null }`; `phone` só com o pedido a caminho; `null` na retirada |
| `fulfillment.timeline` | detalhe | passos da entrega: `{ key, title, description, state: done \| current \| pending }`; vazio na retirada |

Os textos (`title`, `description`, `reason`, `note`) vêm prontos no idioma pedido (`Accept-Language`).

## Alternativas que caíram

- **O app deduzir o método de pagamento pela ausência de `url`:** esconde a regra no cliente e quebra quando houver um terceiro método.
- **A loja confirmar a entrega:** não prova o recebimento e dá à loja o poder de encerrar o pedido sozinha.

## Perguntas abertas para a equipe console

- A loja pode marcar `completed` se o cliente não confirmar em N dias? Qual N?
- Em `on_delivery`, o valor pago é registrado pela loja, pelo entregador ou só pela confirmação do cliente?
- A foto do entregador (`courier.photo`) existe hoje no cadastro? O cartão do entregador no guidu.chat segue o modelo, que mostra a foto.

## Consequências

- O contrato do Cliente Hub passa a listar estas rotas e campos (H9a). O guidu.chat já os usa no servidor simulado e os trocará pelo contrato publicado.
- A tela do pedido não muda quando o contrato sair: o simulado foi escrito com estes nomes.
