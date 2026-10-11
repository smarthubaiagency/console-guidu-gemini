# Portfólio — campos do protocolo UCP

Referência para o módulo **Portfólio** (antigo "Catálogo", F5). Decisão do Marcelo em 11/10/2026: os campos do Portfólio são exatamente os do [Universal Commerce Protocol](https://github.com/Universal-Commerce-Protocol/ucp). O Portfólio vai servir de ferramenta para o agente de IA no atendimento, para commerce agentic, para a pesquisa de preço local e para a lista de produtos no Perfil da Empresa no Google. As verticais (projeto legado Cartão Pro) vêm numa segunda conversa.

- **Fonte:** `Universal-Commerce-Protocol/ucp`, branch principal, commit `ad9950b` (09/10/2026), pasta `source/schemas`. Licença Apache 2.0.
- **Versões:** o UCP usa datas (`YYYY-MM-DD`) por componente. A mais recente vista nos exemplos é `2026-08-25`.
- **Convenção:** nomes de campos em `snake_case`, iguais ao protocolo. `*` marca campo obrigatório no schema. Os valores de dinheiro são inteiros em **unidades mínimas ISO 4217** (centavos para `BRL`).

## 1. Produto

### 1.1 Product (`shopping/types/product.json`)

| Campo              | Tipo            | Descrição                                                     |
| ------------------ | --------------- | ------------------------------------------------------------- |
| `id` \*            | string          | ID global do produto                                          |
| `handle`           | string          | Slug para URL (ex.: `tenis-azul-pro`)                         |
| `title` \*         | string          | Título                                                        |
| `description` \*   | Description     | Texto em `plain`, `html` e/ou `markdown`                      |
| `url`              | string          | Página canônica do produto                                    |
| `categories`       | Category[]      | Categorias, com taxonomia opcional                            |
| `price_range` \*   | PriceRange      | Menor e maior preço entre as variantes (`min`, `max`)         |
| `list_price_range` | PriceRange      | Faixa de preço "de" (antes do desconto)                       |
| `media`            | Media[]         | Imagens, vídeos e modelos 3D; o primeiro é o destaque         |
| `options`          | ProductOption[] | Opções (Tamanho, Cor…) com seus valores                       |
| `variants` \*      | Variant[]       | Variantes compráveis; a primeira é a destaque                 |
| `rating`           | Rating          | Avaliação agregada                                            |
| `tags`             | string[]        | Tags para busca                                               |
| `metadata`         | object          | Dados livres do negócio (ponto de extensão para as verticais) |

### 1.2 Variant (`shopping/types/variant.json`): o que de fato se vende

| Campo            | Tipo                | Descrição                                                                                                                 |
| ---------------- | ------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| `id` \*          | string              | ID global; vira `item.id` no checkout                                                                                     |
| `sku`            | string              | Código interno do negócio                                                                                                 |
| `barcodes`       | `{type*, value*}[]` | Códigos de barras: `UPC`, `EAN`, `ISBN`, `GTIN`, `JAN`                                                                    |
| `handle`         | string              | Slug da variante                                                                                                          |
| `title` \*       | string              | Ex.: "Azul / G"                                                                                                           |
| `description` \* | Description         | `plain`, `html`, `markdown`                                                                                               |
| `url`            | string              | Página da variante                                                                                                        |
| `categories`     | Category[]          | Categorias da variante                                                                                                    |
| `price` \*       | Price               | Preço atual (`amount*`, `currency*`), por unidade de `quantity_unit`                                                      |
| `quantity_unit`  | QuantityUnit        | Base de venda: `unit*` (código UN/CEFACT Rec 20, ex.: `C62` = unidade, `KGM` = kg), `scale`, `display_text*`, `increment` |
| `list_price`     | Price               | Preço "de" (riscado)                                                                                                      |
| `unit_price`     | UnitPrice           | Preço por medida padrão (ex.: R$/kg): `amount*`, `currency*`, `measure*`, `reference*`                                    |
| `availability`   | Availability        | `available` (bool) e `status`: `in_stock`, `backorder`, `preorder`, `out_of_stock`, `discontinued`                        |
| `options`        | SelectedOption[]    | Valores que definem a variante (`name*`, `label*`, `id`)                                                                  |
| `media`          | Media[]             | Mídia própria da variante                                                                                                 |
| `rating`         | Rating              | Avaliação da variante                                                                                                     |
| `tags`           | string[]            | Tags                                                                                                                      |
| `metadata`       | object              | Dados livres do negócio                                                                                                   |
| `seller`         | `{name, links[]}`   | Vendedor da variante (para marketplace)                                                                                   |

### 1.3 Tipos usados pelo produto

| Tipo          | Campos                                                                                                                                                                                                             |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Description   | `plain`, `html` (a plataforma deve sanitizar), `markdown`                                                                                                                                                          |
| Category      | `value*` (ex.: `Vestuário > Camisetas` ou `1604`), `taxonomy` (`google_product_category`, `shopify`, `merchant`)                                                                                                   |
| Price         | `amount*` (inteiro, unidades mínimas), `currency*` (ISO 4217)                                                                                                                                                      |
| PriceRange    | `min*`, `max*` (Price)                                                                                                                                                                                             |
| Media         | `type*` (`image`, `video`, `external_video`, `model_3d`), `url*`, `name`, `alt_text`, `width`, `height`, `duration`, `preview{url*, width, height}`, `sources[]{url*, mime_type, format, width, height, filesize}` |
| ProductOption | `name*`, `values*[]` (`id`, `label*`)                                                                                                                                                                              |
| Measure       | `unit*`, `scale`, `display_text*`, `value*` (inteiro)                                                                                                                                                              |
| Rating        | `value*`, `scale_min`, `scale_max*`, `count`                                                                                                                                                                       |

## 2. Comprador

### 2.1 Buyer (`shopping/types/buyer.json`)

| Campo          | Tipo   | Descrição                                        |
| -------------- | ------ | ------------------------------------------------ |
| `first_name`   | string | Nome                                             |
| `last_name`    | string | Sobrenome                                        |
| `email`        | string | E-mail                                           |
| `phone_number` | string | Telefone no padrão E.164 (ex.: `+5511999990000`) |

Nenhum campo é obrigatório. A extensão **Buyer Consent** (`shopping/buyer_consent.json`) acrescenta consentimentos por finalidade, com o estado `granted` e a origem. A extensão **Loyalty** (`common/loyalty.json`) traz programa de fidelidade, nível e recompensas.

### 2.2 Endereço: PostalAddress (`common/types/postal_address.json`)

Usado em entrega, cobrança e lojas: `street_address`, `extended_address` (complemento), `address_locality` (cidade), `address_region` (UF), `address_country` (ISO alfa-2, `BR`), `postal_code` (CEP), `first_name`, `last_name`, `phone_number`.

### 2.3 Contexto da compra: Context (`common/types/context.json`)

São sinais provisórios, não dados confirmados:

| Campo                                              | Descrição                                             |
| -------------------------------------------------- | ----------------------------------------------------- |
| `address_country`, `address_region`, `postal_code` | Localidade aproximada do comprador                    |
| `location`                                         | Loja de preferência (ID de Location do negócio)       |
| `intent`                                           | Intenção em texto livre (ex.: "presente até R$ 100")  |
| `language`                                         | Idioma BCP 47 (`pt-BR`)                               |
| `currency`                                         | Moeda preferida (`BRL`)                               |
| `eligibility`                                      | Benefícios alegados (fidelidade, vantagens de cartão) |
| `payment`                                          | Meios de pagamento preferidos (`handler*`, `types`)   |

Signals (`common/types/signals.json`), fornecidos pela plataforma e nunca pelo comprador: `dev.ucp.buyer_ip`, `dev.ucp.user_agent`.

## 3. Vendedor (o negócio)

No UCP o vendedor é o **Business**, e não há um cadastro "loja" com razão social. Ele se apresenta por quatro peças:

### 3.1 Perfil do negócio: `/.well-known/ucp` (`profile.json` e `ucp.json#business_schema`)

| Campo                     | Descrição                                                                                                                       |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| `ucp.version` \*          | Versão do protocolo (`YYYY-MM-DD`)                                                                                              |
| `ucp.supported_versions`  | Versões anteriores aceitas, com a URL de cada perfil                                                                            |
| `ucp.services` \*         | Serviços oferecidos (REST, MCP, A2A, embedded), por nome reverso de domínio                                                     |
| `ucp.capabilities`        | Capacidades: `dev.ucp.shopping.catalog.search`, `.catalog.lookup`, `.cart`, `.checkout`, `.order`, `.fulfillment`, `.discount`… |
| `ucp.payment_handlers` \* | Meios de pagamento aceitos (seção 4)                                                                                            |
| `keys`                    | Chaves públicas (JWK) para assinar requisições e webhooks                                                                       |

Cada serviço, capacidade ou meio de pagamento é uma **Entity**: `version*`, `spec`, `schema`, `id`, `config`.

### 3.2 Lojas físicas: Location (`common/types/location.json`)

É a base para a pesquisa de preço local e para o Google:

| Campo             | Descrição                                                                      |
| ----------------- | ------------------------------------------------------------------------------ |
| `id` \*           | ID da loja no negócio                                                          |
| `name` \*         | Nome exibido                                                                   |
| `address`         | PostalAddress                                                                  |
| `geo`             | `latitude*`, `longitude*` (WGS 84)                                             |
| `amenities`       | Recursos da loja (estacionamento, retirada…), por ID reverso de domínio        |
| `hours`           | Horário semanal: `day` (`monday`…`sunday`), `opens`, `closes` (HH:MM)          |
| `exception_hours` | Feriados e exceções: `title`, `valid_from`, `valid_through`, `opens`, `closes` |
| `timezone`        | Fuso IANA (`America/Sao_Paulo`)                                                |

A busca de lojas (`common/location_search.json`) aceita `query`, `distance{center*, max*}` (metros), `serves` (ponto ou localidade), `filters{hours, amenities, items}` e `pagination`. O filtro `items` encontra lojas que têm determinados produtos agora, o que é o caso de uso "onde tem perto de mim".

### 3.3 Vendedor na variante e políticas

- `variant.seller`: `name` e `links[]`.
- Link (`common/types/link.json`): `type*` (`privacy_policy`, `terms_of_service`, `refund_policy`, `shipping_policy`, `faq`), `url*`, `title`, `id`. O checkout exige `links` (termos e privacidade).
- Policy (`common/types/policy.json`): `type*` (nome reverso de domínio, ex.: troca e garantia), `description*`, `applies_to` (JSONPath dos itens), `url`.

### 3.4 Configuração de entrega do negócio

`business_fulfillment_config`: `multi_destination[]{method*}` e `method_combinations` (ex.: entrega e retirada no mesmo carrinho).

## 4. Pagamento

### 4.1 Meio de pagamento: Payment Handler (`payment_handler.json`)

O negócio declara, no perfil, quais meios aceita. Cada um é uma Entity (`version*`, `spec`, `schema`, `id`, `config`) com:

- `available_instruments[]`: `type*` (ex.: `card`, `gift_card`) e `constraints` (restrições sobre o instrumento).

**PIX e boleto não existem no protocolo.** Eles entram como handlers próprios, com nome reverso de domínio (ex.: `br.com.guidu.pix`) e schema próprio. Isso é extensão prevista pelo UCP, não desvio.

### 4.2 Instrumento: PaymentInstrument (`common/types/payment_instrument.json`)

| Campo             | Descrição                                 |
| ----------------- | ----------------------------------------- |
| `id` \*           | ID do instrumento                         |
| `handler_id` \*   | Handler que o produziu                    |
| `type` \*         | Categoria (`card`, `tokenized_card`…)     |
| `billing_address` | PostalAddress de cobrança                 |
| `credential`      | Credencial: `type*` e, no token, `token*` |
| `display`         | Dados para exibir                         |

- **Cartão** (`card_payment_instrument.json`): `type = "card"`, `network` e `display{brand, last_digits, expiry_month, expiry_year, description, card_art}`.
- **Payment** (`common/types/payment.json`), no checkout: `instruments[]` com `selected` (bool).
- **PaymentIdentity**: `access_token*`, para vincular tokens a um participante.
- O número do cartão nunca trafega aberto: as credenciais são tokens (`token_credential`, `network_token_credential`) ou PAN só sob regras do handler.

### 4.3 Condições de pagamento (extensão `common/payment_terms.json`)

- **PaymentTerm:** `id*`, `title*` (ex.: "À vista", "3x sem juros", "Sinal + saldo"), `description`, `schedules*[]`.
- **PaymentSchedule:** `id*`, `type*` (`immediate` ou outro), `description*`, `due_at`, `amount*`.

Também há extensões de pagamento dividido (`payment_split_payments.json`), autenticação (`payment_authentication.json`) e mandato AP2 para agentes (`payment_ap2_mandate.json`).

### 4.4 Totais: Total (`common/types/total.json`)

`type*` (`subtotal`, `items_discount`, `discount`, `fulfillment`, `tax`, `fee`, `total`), `display_text`, `amount*` (com sinal). Totals sempre tem exatamente um `subtotal` e um `total`.

## 5. Shopping (jornada de compra)

### 5.1 Catálogo: busca e consulta

- **catalog.search** (`shopping/catalog_search.json`): `query`, `context`, `signals`, `attribution`, `filters{categories[], price{min, max}}`, `pagination{cursor, limit}`. A resposta traz Products.
- **catalog.lookup** (`shopping/catalog_lookup.json`): busca por IDs de produto ou variante, e detalhe de um produto.

### 5.2 Carrinho (`shopping/cart.json`) e Checkout (`shopping/checkout.json`)

O carrinho tem o mesmo desenho do checkout, sem pagamento. O checkout é uma sessão, com validade padrão de 6 horas.

| Campo                               | Descrição                                                                                                  |
| ----------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| `id` \*                             | ID da sessão                                                                                               |
| `line_items` \*                     | Itens (5.3)                                                                                                |
| `buyer`                             | Buyer                                                                                                      |
| `context`, `signals`, `attribution` | Contexto, sinais e origem (campanha)                                                                       |
| `status` \*                         | `incomplete`, `requires_escalation`, `ready_for_complete`, `complete_in_progress`, `completed`, `canceled` |
| `currency` \*                       | Moeda definida pelo negócio                                                                                |
| `totals` \*                         | Totals                                                                                                     |
| `actions`                           | Ações pendentes de extensões                                                                               |
| `messages`                          | Erros, avisos e informações                                                                                |
| `links` \*                          | Termos e privacidade (obrigatório)                                                                         |
| `policies`                          | Políticas que valem para os itens                                                                          |
| `expires_at`                        | Validade                                                                                                   |
| `continue_url`                      | Link para a pessoa terminar no site quando o agente não consegue (`requires_escalation`)                   |
| `payment`                           | Payment                                                                                                    |
| `order`                             | Confirmação do pedido criado                                                                               |

`requires_escalation` com `continue_url` é como o agente passa a compra para uma pessoa.

### 5.3 Itens

- **LineItem:** `id*`, `item*`, `quantity*` (inteiro, em passos da base de venda), `totals*`, `parent_id` (itens aninhados, como kit e acessório).
- **Item:** `id*` (normalmente o ID da variante ou o SKU), `title*`, `price*` (unidades mínimas), `quantity_unit`, `unit_price`, `image_url`.

### 5.4 Entrega e retirada (extensão `shopping/fulfillment.json`)

- **Fulfillment:** `methods[]` e `available_methods[]`.
- **Method:** `id*`, `type*` (`shipping`, `pickup`), `line_item_ids*`, `destinations[]` (endereço de entrega ou loja), `selected_destination_id`, `groups[]`.
- **Group:** `id*`, `line_item_ids*`, `options[]`, `selected_option_id`.
- **Option:** `id*`, `title*` (ex.: "Normal", "Expressa", "Retirar na loja"), `description`, `carrier`, `earliest_fulfillment_time`, `latest_fulfillment_time`, `totals*`.
- **Disponibilidade:** `type*`, `line_item_ids*`, `fulfillable_on` (`now` ou data), `description` (ex.: "Retire hoje na loja Centro").

### 5.5 Desconto (extensão `shopping/discount.json`)

- `codes[]` (cupons enviados) e `applied[]`.
- Cada aplicado tem `code`, `title*`, `amount*`, `automatic`, `method` (`each` ou `across`), `priority`, `provisional`, `eligibility` e `allocations[]`.

### 5.6 Pedido (`shopping/order.json`)

| Campo                                 | Descrição                                                                                                                                                                                                                |
| ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `id` \*                               | ID do pedido                                                                                                                                                                                                             |
| `label`                               | Número legível dado pelo negócio                                                                                                                                                                                         |
| `checkout_id` \*                      | Checkout de origem                                                                                                                                                                                                       |
| `permalink_url` \*                    | Link do pedido no site do negócio                                                                                                                                                                                        |
| `line_items` \*                       | Itens do pedido: `quantity{original, total, fulfilled}`, `status` (`processing`, `partial`, `fulfilled`, `removed`)                                                                                                      |
| `fulfillment` \*                      | `expectations[]` (o que foi prometido: `method_type`, `destination`, `description`, `fulfillable_on`) e `events[]` (o que aconteceu: `type`, `occurred_at`, `tracking_number`, `tracking_url`, `carrier`, `description`) |
| `adjustments`                         | Reembolso, devolução, crédito, cancelamento: `type*`, `status*` (`pending`, `completed`, `failed`), `occurred_at*`, `line_items`, `totals`, `description`                                                                |
| `currency` \*                         | Moeda do checkout                                                                                                                                                                                                        |
| `totals` \*                           | Totals                                                                                                                                                                                                                   |
| `policies`, `messages`, `attribution` | Políticas e origem congeladas na compra; mensagens                                                                                                                                                                       |

## 6. Leituras para a conversa das verticais

1. **O que o Portfólio guarda e o que é sessão.** O Portfólio guarda Product, Variant, Category, Media, Location, Policy e Link. Cart, Checkout e Order são sessões e transações. Entram depois, se formos vender pelo agente, e se apoiam no CRM e na cobrança.
2. **Extensão por vertical já prevista.** `metadata` (produto e variante), `tags`, `categories.taxonomy` e `amenities` comportam campos de vertical sem sair do protocolo. Campo de vertical que não couber vira extensão com nome reverso de domínio (ex.: `br.com.guidu.vertical.*`), como o UCP faz com as suas.
3. **Google.** `categories.taxonomy = google_product_category`, `barcodes` (GTIN), `availability.status`, `price` e `list_price`, `media` e `Location` (endereço, geo, horários) cobrem o que o Perfil da Empresa no Google pede para produtos e lojas.
4. **Pesquisa de preço local.** `unit_price` (preço por kg ou litro), `quantity_unit` e a busca de lojas com `distance` e `filters.items` permitem comparar preço por unidade entre lojas próximas.
5. **Brasil.** Moeda `BRL` em centavos; UF em `address_region`; CEP em `postal_code`; PIX, boleto e parcelamento como handlers e payment terms próprios. CPF/CNPJ não existem no Buyer; se forem necessários, entram como extensão.
