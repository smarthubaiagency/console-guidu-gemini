# Portfólio — revisão do piloto contra o UCP

Compara os campos do piloto (`portfolio-item.schemas.ts`, projeto Cartão Pro: STI com `details` JSONB e discriminated union no Zod) com o protocolo UCP ([ucp-campos.md](ucp-campos.md), commit `ad9950b`). O piloto não foi finalizado. Este documento propõe a correção e lista o que precisa da decisão do Marcelo.

Legenda das ações:

- **UCP**: renomear ou mover para o campo do protocolo.
- **Interno**: dado de gestão do GUIDU que nunca sai pelo UCP.
- **Extensão**: dado de vertical que o UCP não tem; sai num namespace próprio.

## 1. Problemas de nomenclatura do piloto

1. **Caixa misturada.** O núcleo usa camelCase (`priceType`, `basePrice`, `isFeatured`), os `details` usam snake_case (`stock_quantity`) e até dentro dos `details` há mistura (`treatedAreas`). O UCP é todo snake_case.
2. **Enums em maiúsculas.** `DRAFT`, `IN_STOCK`, `NEW`… O UCP usa minúsculas em snake_case (`in_stock`, `out_of_stock`, `shipping`, `pickup`).
3. **`category` no lugar errado.** No piloto, `category` é o tipo do item (PRODUCT, SERVICE…). No UCP, `categories` é a taxonomia de classificação (`Vestuário > Camisetas`, `google_product_category`). Usar o mesmo nome para as duas coisas confunde o agente, o Google e quem integra.
4. **Preço em `number`.** `basePrice` e `promoPrice` são números decimais. O UCP usa inteiro em unidades mínimas (centavos) com `currency` junto, para não ter erro de arredondamento.
5. **Preço e estoque no produto.** No UCP o produto **sempre** tem ao menos uma variante, e preço, SKU, código de barras e disponibilidade ficam na variante. O piloto põe tudo no item e trata variante como exceção (`has_variants`).

**Regra proposta:**

- **Saída** (API, MCP, Google, `details`): nomes e enums exatamente como no UCP, em snake_case e minúsculas.
- **Código TypeScript e Prisma:** camelCase, mapeado para snake_case no banco, como no resto do projeto.
- **Extensões:** snake_case, com namespace reverso de domínio.

## 2. Campos do núcleo: piloto → UCP

| Piloto                                                                         | Ação           | Proposta                                                                                                                                                                                                                                             |
| ------------------------------------------------------------------------------ | -------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `category` (PRODUCT, SERVICE, REAL_ESTATE, LODGING, EVENT)                     | Interno        | Renomear para `item_type`, com valores `product`, `service`, `real_estate`, `lodging`, `event`. É o discriminador do STI. `categories` fica reservado para a taxonomia do UCP                                                                        |
| `vertical` (GENERAL…)                                                          | Interno        | `vertical`, em minúsculas (`general`, `healthcare`, `aesthetics`, `beauty`, `b2b_corporate`…). Também é discriminador do `details`                                                                                                                   |
| `title`                                                                        | UCP            | `title` (sem mudança)                                                                                                                                                                                                                                |
| `slug`                                                                         | UCP            | `handle`                                                                                                                                                                                                                                             |
| `shortDescription`, `description`                                              | UCP            | `description` vira objeto `{plain, markdown, html}`. O resumo curto não existe no UCP: vai para a extensão `summary`, ou é derivado das primeiras linhas                                                                                             |
| `basePrice`, `promoPrice`, `currency`                                          | UCP            | Sem promoção: `price = {amount, currency}`. Com promoção: `price` = promocional e `list_price` = cheio. Valores inteiros em centavos; `currency` dentro de cada preço (padrão `BRL`)                                                                 |
| `priceType`                                                                    | UCP + extensão | Ver 2.1                                                                                                                                                                                                                                              |
| `availabilityMode`                                                             | Interno        | `availability_mode` (`always`, `schedule`, `stock`, `calendar`, `seasonal`) é configuração de gestão. Para fora sai o resultado calculado: `availability = {available, status}`                                                                      |
| `status` (DRAFT… ARCHIVED)                                                     | Interno        | `status` em minúsculas. Só `active` aparece pelo UCP. `UNAVAILABLE` sai do status: indisponível é `availability.status` (`out_of_stock`, `discontinued`)                                                                                             |
| `locationMode` (ONLINE, IN_PERSON, HYBRID, DELIVERY)                           | UCP            | `fulfillment_methods[]`, com os valores do UCP `shipping` (entrega), `pickup` (no local), `digital` (online) e a extensão `on_site` (no endereço do cliente). HYBRID vira mais de um método                                                          |
| `coverImage`, `images`, `videoUrl`                                             | UCP            | `media[]` (`type`: `image`, `video`, `external_video`; `url`; `alt_text`…). A capa é o primeiro item                                                                                                                                                 |
| `attachments`                                                                  | Extensão       | `attachments[]` (`url`, `title`, `mime_type`) na extensão. Termos e políticas viram `links` e `policies` do UCP                                                                                                                                      |
| `tags`                                                                         | UCP            | `tags` (sem mudança)                                                                                                                                                                                                                                 |
| `categoryIds`                                                                  | UCP            | `categories[] = {value, taxonomy}`, com `merchant` para as categorias do negócio e `google_product_category` para o Google                                                                                                                           |
| `internalCode`                                                                 | UCP            | `sku` da variante                                                                                                                                                                                                                                    |
| `address`, `serviceArea`                                                       | UCP            | Referência a `location_ids[]` (Location do UCP: endereço, geo, horários). A área de atendimento usa o formato de `location_serves`/`distance` (raio em metros ou cidades)                                                                            |
| `minNoticeMinutes`                                                             | Extensão       | `min_notice_minutes`                                                                                                                                                                                                                                 |
| `visibility`, `priority`, `isFeatured`, `featuredRank`                         | Interno        | `visibility`, `priority`, `is_featured`, `featured_rank`: vitrine e ordenação do GUIDU                                                                                                                                                               |
| `aiDiscoveryEnabled`, `aiKeywords`, `aiAliases`, `aiDoNotSay`, `aiSafetyRules` | Interno        | Governança do agente: `ai_discovery_enabled`, `ai_keywords`, `ai_aliases`, `ai_do_not_say`, `ai_safety_rules`. **Nunca saem pelo UCP.** `ai_do_not_say` e `ai_safety_rules` são instruções para o nosso agente, não conteúdo para outras plataformas |
| `disclaimer`                                                                   | UCP            | `policies[]` (`type` próprio, ex.: `co.guidu.policy.disclaimer`, e `description`)                                                                                                                                                                    |
| (faltava)                                                                      | UCP            | `rating` (`value`, `scale_max`, `count`) e `url` (página canônica) entram como opcionais                                                                                                                                                             |

### 2.1 `priceType` no UCP

| Piloto       | UCP                                                                                                                                                                                                                                      |
| ------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `FIXED`      | `price` normal, `quantity_unit` padrão (`C62`, unidade)                                                                                                                                                                                  |
| `PER_UNIT`   | `quantity_unit` com o código UN/CEFACT da unidade (`C62` unidade, `KGM` kg, `LTR` litro, `MTK` m²) e `unit_price` quando houver comparação                                                                                               |
| `PER_HOUR`   | `quantity_unit.unit = HUR`                                                                                                                                                                                                               |
| `PER_DAY`    | `quantity_unit.unit = DAY`                                                                                                                                                                                                               |
| `PER_PERSON` | `quantity_unit.unit = IE` (pessoa, UN/CEFACT)                                                                                                                                                                                            |
| `FROM`       | `price_range` (o produto mostra o menor preço entre as variantes); extensão `price_display = "from"` quando não houver variantes                                                                                                         |
| `QUOTE`      | **O UCP não tem preço sob consulta:** `price` é obrigatório na variante. Proposta: item `QUOTE` fica fora da busca de compra (`availability.available = false`) e só aparece para o nosso agente, com extensão `price_display = "quote"` |

## 3. Estrutura proposta

Quatro camadas (o STI continua na tabela principal):

1. **Núcleo UCP**, em colunas: `item_type`, `vertical`, `title`, `handle`, `description`, `categories`, `media`, `tags`, `url`, `rating`, `fulfillment_methods`, `location_ids`, `policies`, `links`.
2. **Variantes UCP**, em tabela filha (`portfolio_variants`): `title`, `sku`, `barcodes[]{type, value}`, `price`, `list_price`, `quantity_unit`, `unit_price`, `options[]`, `media`, `availability` e os dados internos de estoque. Todo item tem ao menos uma variante; um item simples tem uma só, criada junto. `has_variants` deixa de existir.
3. **Interno GUIDU**, em colunas que não saem pelo UCP: `status`, `visibility`, `priority`, `is_featured`, `featured_rank`, `availability_mode`, `ai_*`.
4. **Extensão por vertical**, no `details` JSONB: chaves snake_case, validadas pela discriminated union de `item_type` + `vertical`. Na saída UCP vai como extensão nomeada `co.guidu.portfolio.<item_type>[.<vertical>]` (o UCP define extensões assim; um consumidor que não conhece a extensão ignora).

O namespace `co.guidu` segue o domínio da ADR 0004. Como o nome é provisório, ele fica numa constante única.

## 4. Verticais

Correções comuns a todas: snake_case em tudo (`treatedAreas` → `treated_areas`), enums minúsculos, valores em centavos (`callout_fee`, `condo_fee`, `cleaning_fee`…) e medidas no formato `Measure` do UCP quando forem medidas (`{value, unit, scale, display_text}`).

### 4.1 Produto (`product`)

| Piloto                                                                    | Ação                                                                                                                                              |
| ------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| `sku`, `barcode`                                                          | Para a **variante**: `sku` e `barcodes[] = {type: "GTIN"\|"EAN"…, value}`                                                                         |
| `brand`, `model`                                                          | Extensão (`brand`, `model`). O Google pede `brand`; continua sendo extensão no UCP                                                                |
| `condition`                                                               | Extensão: `new`, `used`, `refurbished`                                                                                                            |
| `track_inventory`, `stock_quantity`, `min_stock_alert`, `allow_backorder` | Interno, na variante. Para fora: `availability.status` = `in_stock`, `out_of_stock` ou `backorder` (este quando `allow_backorder` e estoque zero) |
| `weight_kg`, `dimensions`                                                 | Extensão de logística como `Measure`: `weight {unit: "KGM"}` e `dimensions {length, width, height}` com `unit: "CMT"`                             |
| `warranty_months`                                                         | `policies[]` do UCP: `type = co.guidu.policy.warranty`, com descrição e duração                                                                   |
| `attributes` (chave/valor)                                                | Os que definem variante viram `options` do UCP (Cor, Tamanho); os descritivos (material, voltagem) vão para `metadata`                            |
| `has_variants`, `variants`                                                | `variants[]` do UCP, sempre presente (seção 3)                                                                                                    |

### 4.2 Serviços (`service`)

O UCP não tem vertical de serviço: o serviço é um Product com `quantity_unit` de tempo (`HUR`) ou unidade, `fulfillment_methods` (`pickup` no local, `on_site` no cliente, `digital` online) e `location_ids`. O resto é extensão.

- **Base comum:**
  - `duration_minutes` (era `duration`), `capacity`, `service_type`, `specialties[]`, `requirements[]`;
  - `pricing`: `price_model` (`fixed`, `hourly`, `visit_plus_hourly`, `quote`), `callout_fee` em centavos, `min_hours`, `includes_materials`. O `price_model` precisa conversar com o `quantity_unit` da variante para não ter duas fontes da verdade (decisão 4);
  - `service_area`: sai do `details` e usa a área do núcleo (raio em metros ou cidades);
  - `job`: `estimated_duration_minutes` (duplica `duration_minutes`; manter um só), `warranty_days` (vira `policies` de garantia), `technical_notes`.
- **Saúde (`healthcare`):** `professional_registry` (`{type: "crm"|"cro"|…, number, region}`), `insurance_providers[]`, `patient_type` (`human`, `animal`), `telemedicine_available` (redundante com `fulfillment_methods` contendo `digital`), `prescriptions_included`, `emergency_service`.
- **Estética (`aesthetics`):** `treated_areas[]`, `contraindications[]`, `pre_care`, `post_care`, `sessions_recommended`, `session_interval_days`, `single_session_possible`, `recovery_time` (`immediate`, `24h`, `48h_plus`), `has_discomfort`, `results_onset`.
- **Beleza (`beauty`):** `subcategory` (melhor como `categories` do UCP com `taxonomy = merchant`), `target_gender` (`female`, `male`, `unisex`), `target_age` (`adult`, `child`, `all`), `scheduling_mode` (`appointment`, `walk_in`), `maintenance_level` (`low`, `medium`, `high`).
- **Corporativo (`b2b_corporate`):** `deliverables[]`, `contract_models[]` (`retainer`, `fixed_project`, `time_and_materials`), `sla_hours`, `project_phases[]`, `tools_used[]`.

### 4.3 Imobiliário (`real_estate`)

O UCP não tem imóveis; é extensão inteira. As correções:

- `operation_type`: `sale`, `rent`, `temporary`. A locação temporária se sobrepõe à hospedagem (decisão 5).
- `property_type` em minúsculas.
- Áreas como `Measure` com `unit: "MTK"` (m²): `usable_area`, `total_area`.
- `bedrooms`, `suites`, `bathrooms`, `parking_spaces`.
- `condo_fee` e `property_tax` (IPTU) em centavos.
- `financing_available`.
- `amenities[]` no formato do UCP (`amenity_type` reverso de domínio: `dev.ucp.amenity.parking`, `co.guidu.amenity.pool`…).
- `furnished_status`.
- O preço do imóvel é o `price` da variante; no aluguel, `quantity_unit = MON` (mês).

### 4.4 Hospedagem (`lodging`)

**O UCP tem hospedagem** (`dev.ucp.lodging`, com o booking e as ferramentas MCP `create_booking_session`…). O piloto deve seguir esse desenho:

| Piloto                                               | UCP lodging                                                                                                                             |
| ---------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| item de hospedagem                                   | **Property**: é uma Location (nome, endereço, geo, mídia, horários)                                                                     |
| `property_type` (WHOLE_HOUSE, PRIVATE_ROOM…)         | **AccommodationType**: `id`, `title`, `description`, `media` (a unidade alugável). O tipo do piloto vira extensão `accommodation_kind`  |
| `max_guests`                                         | `capacity.total` (com `adults`, `children`, `child_age_ranges`)                                                                         |
| `bedrooms`, `beds_count`, `bathrooms`                | Extensão                                                                                                                                |
| `check_in_time`, `check_out_time`, `quiet_hours`     | Extensão (o UCP traz as datas da estadia na reserva, não os horários da casa); `quiet_hours` no formato `time_interval {opens, closes}` |
| `smoking_allowed`, `pets_allowed`, `parties_allowed` | `policies[]` (regras da casa) ou `amenities`                                                                                            |
| `cleaning_fee`, `security_deposit`                   | Na reserva viram `totals` (`fee`); no cadastro, extensão em centavos                                                                    |
| `amenities`                                          | `amenities` com `amenity_type` (`dev.ucp.amenity.wi_fi`, `dev.ucp.amenity.parking`…)                                                    |
| (faltava)                                            | **RatePlan** (`id`, `title`, `description`) e a política de cancelamento da extensão `policy_cancellation`                              |

`vertical = HOSTING` com `category = LODGING` é redundante: basta `item_type = lodging`.

### 4.5 Eventos (`event`)

O UCP não tem eventos; é extensão. As correções:

- `event_format` vira `fulfillment_methods` do núcleo (`pickup` presencial, `digital` online).
- `event_date` + `start_time` + `end_time` viram `starts_at` e `ends_at` em RFC 3339, com o fuso da Location.
- `is_recurring`, com uma regra de recorrência se for usada.
- `venue_name`, `address` e `city` viram `location_ids` do núcleo.
- `ticket_mode` (`individual`, `table`, `pass`): cada tipo de ingresso vira uma **variante** com seu preço.
- `capacity` e `limited_spots`: interno, alimentando `availability`.
- `cancellation_policy` vira `policies`.
- Mantidos como extensão: `topics[]`, `speakers[]`, `age_rating`, `target_audience`.

## 5. Decisões para o Marcelo

1. **Saída 100% UCP e interno separado.** API, MCP e Google com nomes e enums do UCP; governança de IA e vitrine nunca saem. Concorda?
2. **Variante obrigatória.** Todo item tem ao menos uma variante, com preço, SKU e disponibilidade (exigência do UCP).
3. **Preço sob consulta.** O UCP não tem: item `quote` fora da compra pelo protocolo e visível só para o nosso agente. Ok?
4. **Fonte única de preço em serviços.** `price_model` dos serviços contra `quantity_unit`: proposta de manter só `quantity_unit` e a taxa de visita como variante ou `fee`.
5. **Aluguel temporário × hospedagem.** `real_estate` com `operation_type = temporary` duplica `lodging`. Proposta: temporário é sempre `lodging`.
6. **Namespace das extensões:** `co.guidu.*` (domínio da ADR 0004) ou outro?
7. **Ferramentas MCP do Portfólio** com os nomes do UCP: `search_catalog`, `lookup_catalog`, `get_product` e, para hospedagem, as de booking. Assim qualquer agente compatível com o UCP usa o Portfólio sem adaptação.
