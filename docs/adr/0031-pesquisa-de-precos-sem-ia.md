# ADR 0031 — Pesquisa de preços sem IA e página do produto padronizado no guidu.chat

- **Status:** Proposto; vira aceito com a aprovação do Marcelo no PR
- **Data:** 06/11/2026
- **Aprovador:** Marcelo
- **Decisão de origem:** telas da pesquisa de preços do guidu.chat, aprovadas pelo Marcelo em 05 e 06/11/2026 (PRs #59 e #61 de `guiduchat/guidu-chat`, kits 0.39.0 e 0.40.0 de `@guiduchat/ui`)
- **Ajusta:** [ADR 0027](0027-guidu-chat-v1-console-bridge.md), seção 3, só para a pesquisa e a página do produto padronizado. O restante dela continua valendo
- **Relaciona-se com:** [ADR 0028](0028-qr-mini-app-publico-e-telas-nativas.md) (telas nativas), [campos do Portfólio](../modules/portfolio/ucp-campos.md) (pesquisa de preço local) e [plano da F5](../operacao/plano-f5.md)

## Contexto

O Portfólio já prevê a pesquisa de preço local entre lojas, mas fora do módulo: `plano-f5.md` diz que ela entra com módulo próprio, e `ucp-campos.md` indica `unit_price`, `quantity_unit` e a busca de lojas como base. Faltava decidir onde ela mora e como a pessoa a usa.

A ADR 0027, seção 3, põe "produto ou oferta" no conteúdo da loja, feito pela equipe console como mini-app. Esse caso é o de um item de uma loja. A pesquisa é outro caso: ela compara várias lojas e não pertence a nenhuma delas. Um mini-app roda dentro do contexto de uma loja, então não serve para essa comparação.

O guidu.chat construiu as telas com dados simulados, sem ligação com o console. Os campos abaixo são os que essas telas usam hoje.

## Decisão

1. **A pesquisa de preços é uma função do guidu.chat, sem IA.** A pessoa busca e a lista vem do servidor, sem passar pelo agente. A pesquisa com o guidu continua em Conversas.
2. **A pesquisa e a página do produto padronizado são telas do guidu.chat**, não mini-apps. É uma exceção à seção 3 da ADR 0027, porque comparam lojas. A página de um item de uma única loja segue sem decisão e, até nova ADR, continua como a ADR 0027 define.
3. **Há dois tipos de resultado.**
   - **Produto padronizado** (cerveja, protetor solar): um cartão por apresentação (long neck, lata). Ele abre a página do produto, com as lojas do menor para o maior preço.
   - **Produto não padronizado** (moda praia): não há o que comparar, então vem um cartão por loja, com quantos itens ela tem para a busca. Ele abre a lista dos itens daquela loja.
4. **O item de destaque do cartão da loja é escolhido pelo servidor:** o mais relevante para a busca e, entre eles, o de melhor preço. Foto, nome e preço do cartão são sempre do mesmo item.
5. **Tudo o que é número ou regra vem pronto da API:** preço, menor preço, desconto máximo, total de ofertas, ordem das lojas, taxa de entrega e situação da loja. O app só formata (regra de ouro da ADR 0027).
6. **As leituras são públicas, sem login.** O dado é do catálogo e das lojas, não da pessoa. O idioma segue o `Accept-Language`.
7. **Salvar, alerta de preço e enviar pedido ficam fora desta decisão.** Hoje mostram "Em breve". "Enviar pedido para loja" vai levar ao chat da loja, e como isso funciona ainda será definido.

## Rotas pedidas à equipe console

| Rota | Devolve |
| --- | --- |
| `GET /products/search?q=` | `items` (produtos padronizados), `total` e `stores` (produtos não padronizados) |
| `GET /products/{id}` | o produto, `max_discount`, `description` e `offers`, do menor para o maior preço; `404` se não existir |
| `GET /stores/{slug}/items?q=` | `store`, `status` e `items` da loja para a busca; `404` se a loja não existir |

## Campos

| Objeto | Campos |
| --- | --- |
| Produto | `id`, `name`, `brand`, `image`, `category { key, label }`, `size`, `offer_count`, `lowest_price`, `fulfillment` |
| Oferta de uma loja | `store`, `price`, `fulfillment`, `shipping_included`, `updated_at`, `payment_methods`, `status` |
| Loja nos resultados | `store`, `status`, `item_count`, `featured` (item), `delivery_fee` |
| Item da loja | `id`, `name`, `category`, `image`, `description`, `price`, `fulfillment`, `shipping_included`, `updated_at`, `payment_methods` |
| `store` | `slug`, `name`, `logo`, `accent`, `address` |
| `status` | `open_now`, `opens_at`, `closes_at` |

`fulfillment` é `pickup`, `delivery` ou `both`. `max_discount` é um número inteiro em %, ou `null`. Nomes, categorias, descrições e `payment_methods` vêm prontos no idioma pedido.

## Perguntas abertas para a equipe console

- **Como separar os dois tipos:** o Portfólio precisa dizer o que é produto padronizado. Hoje o `barcodes` (GTIN) é o candidato natural, mas falta decidir.
- **`delivery_fee`:** no simulado é da loja, não do item. Com um destaque só de retirada, o cartão ainda diria "Retirada ou entrega hoje por R$ 8,00". Definir se a taxa acompanha o item.
- **Base do `max_discount`:** contra qual preço o desconto é calculado.
- **Histórico de preços:** a aba existe com um aviso provisório. Falta decidir se o console guarda esse histórico.

## Consequências

- **Equipe console:** três rotas novas na API do guidu.chat, com origem no Portfólio. Nada muda nos mini-apps.
- **Equipe guidu.chat:** ao sair o contrato, troca os esquemas simulados pelos dele. As telas não mudam.
- **Banco:** esta ADR não muda schema. O que a pesquisa exigir vai por migration própria, no módulo que a implementar.
- **Reversível:** sim. A entrada na pesquisa é só pelo endereço `/search`, sem menu, e as telas usam dados simulados até o contrato sair.
