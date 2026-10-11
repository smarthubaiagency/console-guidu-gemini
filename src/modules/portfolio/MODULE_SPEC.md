# Especificação do módulo Portfólio (`portfolio`)

- **Versão:** 0.3.0 (F5c)
- **Estado:** beta. Substitui o placeholder "Catálogo" (decisão do Marcelo, 11/10/2026).
- **Modelo de origem:** `module-templates/standard` 1.0.0
- **Referências:** [plano da F5](../../../docs/operacao/plano-f5.md), [campos do UCP](../../../docs/modules/portfolio/ucp-campos.md) e [revisão do piloto](../../../docs/modules/portfolio/revisao-piloto.md).

## 1. Problema que resolve

Guardar o que o negócio oferece (produtos, serviços, imóveis, hospedagem e eventos) num formato que agentes de IA entendem sem adaptação: o [Universal Commerce Protocol](https://github.com/Universal-Commerce-Protocol/ucp).

- O Portfólio é a ferramenta do agente de atendimento: o módulo Agentes de IA por padrão e agentes externos pelo MCP.
- É também a fonte do commerce agentic, da pesquisa de preço local e da lista de produtos no Perfil da Empresa no Google.
- A conversa é sempre com o orquestrador guidu.bot, e o checkout é sempre o nosso (guidu.chat, fase 2).

## 2. Quem usa e com quais permissões

| Permissão                             | Papéis padrão                | Uso                                                      |
| ------------------------------------- | ---------------------------- | -------------------------------------------------------- |
| `portfolio.items.read`                | owner, admin, editor, viewer | Ver itens e variantes                                    |
| `portfolio.items.write`               | owner, admin, editor         | Criar e editar itens e variantes                         |
| `workspace.locations.manage` (núcleo) | owner, admin                 | Cadastrar e desativar lojas (todos os membros as veem)   |
| `platform.modules.read` / `.manage`   | papéis internos              | Limites padrão do módulo nas configurações da plataforma |

## 3. Dados que guarda

| Tabela                          | Conteúdo                                                                                                                                                                                                                                                                                                                                      |
| ------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `portfolio_items`               | **Núcleo UCP:** `item_type`, `vertical`, `title`, `handle`, `description`, `categories`, `media`, `tags`, `url`, `rating`, `fulfillment_methods`, `location_ids`, `policies`, `links`, `price_display`. **Interno:** `status`, `visibility`, `priority`, `is_featured`, `featured_rank`, `availability_mode`, `ai_*`. **Extensão:** `details` |
| `portfolio_variants`            | **UCP:** `title`, `sku`, `barcodes`, preço e preço cheio (inteiros em centavos, com `currency`), `quantity_unit`, `unit_price`, `options`, `media`, `availability_status`. **Interno:** `track_inventory`, `stock_quantity`, `min_stock_alert`, `allow_backorder`                                                                             |
| `portfolio_accommodation_types` | Hospedagem. **UCP AccommodationType:** `title`, `description`, `capacity` (`adults`, `children`, `child_age_ranges`, `total`), `media`. **Extensão:** `accommodation_kind`, `bedrooms`, `beds_count`, `bathrooms`, `amenities`                                                                                                                |
| `portfolio_rate_plans`          | Hospedagem. **UCP RatePlan:** `title`, `description`; política de cancelamento (`refundability`, texto). **Extensão:** `board` (alimentação), `free_cancellation_hours`                                                                                                                                                                       |
| `workspace_locations` (núcleo)  | Location do UCP: nome, endereço (`street_address`, `address_locality`, `address_region`, `postal_code`, `address_country`, `phone_number`), `latitude` e `longitude`, horários semanais, exceções, fuso IANA, `amenities`; situação ativa ou desativada                                                                                       |

Regras:

- Todo item tem ao menos uma variante. A primeira variante é a de destaque.
- `handle` é único no workspace; quando não é informado, é gerado do título.
- SKU é único no workspace.
- O preço é obrigatório em toda variante, salvo no item `price_display = quote`.
- Todas as variantes de um item usam a mesma moeda.
- Itens são arquivados (`archived`), nunca apagados. Variantes podem ser removidas, desde que reste uma.
- Lojas são desativadas, nunca apagadas; um item só aponta para lojas ativas.
- Uma trava no banco impede mudar o workspace, o autor, a data de criação e o item de uma variante.
- Mídia: só URL nesta fase. O envio de arquivos chega quando o Storage for definido nas configurações da plataforma (F5e).

## 3a. Categorias e verticais (F5b)

O `details` de cada item é validado pelo schema da sua categoria (`item_type`) e vertical. A declaração fica em `src/modules/portfolio/verticals.ts` e gera o schema, o formulário e a leitura do formulário. Valem as convenções do UCP: snake_case, enums minúsculos, dinheiro em centavos e medidas como `Measure`.

| Categoria     | Verticais                                                        | Campos principais                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| ------------- | ---------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `product`     | `general`                                                        | `brand`, `model`, `condition`, `weight` (kg), `dimensions` (cm), `warranty_months`, `attributes`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| `service`     | `general`, `healthcare`, `aesthetics`, `beauty`, `b2b_corporate` | Base: `duration_minutes`, `capacity`, `service_type`, `specialties`, `requirements`, `callout_fee`, `min_hours`, `includes_materials`, `min_notice_minutes`, `warranty_days`, `service_area`, `technical_notes`. Saúde: `professional_registry`, `insurance_providers`, `patient_type`, `prescriptions_included`, `emergency_service`. Estética: `treated_areas`, `contraindications`, `pre_care`, `post_care`, `sessions_recommended`, `session_interval_days`, `single_session_possible`, `recovery_time`, `has_discomfort`, `results_onset`. Beleza: `target_gender`, `target_age`, `scheduling_mode`, `maintenance_level`. Corporativo: `deliverables`, `contract_models`, `sla_hours`, `project_phases`, `tools_used` |
| `lodging`     | `general`                                                        | `check_in_time`\* e `check_out_time`\* (HH:MM), `quiet_hours` (`opens`, `closes`), `min_nights`, `smoking_allowed`, `pets_allowed`, `parties_allowed`, `house_rules`, `cleaning_fee`, `security_deposit`, `amenities`. Acomodações e tarifas na seção 3b                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| `real_estate` | `general`                                                        | `operation_type`\* (`sale`, `rent`), `property_type`\*, `usable_area` e `total_area` (m²), `bedrooms`, `suites`, `bathrooms`, `parking_spaces`, `condo_fee`, `property_tax`, `financing_available`, `furnished_status`, `amenities`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| `event`       | `general`                                                        | `starts_at`\*, `ends_at` (RFC 3339), `is_recurring`, `recurrence`, `topics`, `speakers`, `age_rating`, `target_audience`, `capacity`; cada tipo de ingresso é uma variante                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |

Regras das verticais:

- `*` marca campo exigido só para **ativar** o item; um rascunho pode ficar incompleto.
- Campo de outra vertical, ou no formato do piloto (camelCase, maiúsculas), é recusado.
- `price_model` saiu dos serviços (decisão 4): o preço segue a unidade de venda da variante.
- O aluguel temporário saiu do imóvel (decisão 5): vai para hospedagem.
- A hospedagem (`lodging`) segue o desenho de hospedagem do UCP (seção 3b).

## 3b. Hospedagem (F5c)

Segue `lodging/types/*.json` do UCP. Só o cadastro: a reserva (`create_booking_session`…) depende de agenda e pagamento e fica para depois.

- **Propriedade:** a loja do item (Location do UCP). Uma hospedagem fica em uma única propriedade.
- **Acomodações:** cada tipo de quarto ou unidade, com a capacidade de hóspedes.
- **Tarifas:** as condições comerciais, com a política de cancelamento (`dev.ucp.lodging.policy.cancellation`, com `refundability`) e a alimentação.
- **Preço:** cada variante é a diária (`quantity_unit` `DAY`, "diária") de uma acomodação numa tarifa. É o mesmo par que a Stay do UCP liga na reserva.

Regras:

- Ao criar, a hospedagem já ganha uma acomodação com o nome do item e a "Tarifa padrão". O primeiro preço fica ligado às duas.
- A acomodação e a tarifa de uma variante são do mesmo item. Chaves estrangeiras compostas e uma trava no banco garantem isso, e só itens de hospedagem têm acomodações e tarifas.
- Uma acomodação ou tarifa com preços não pode ser removida.
- **Ativar** exige os horários de check-in e check-out, a propriedade, ao menos uma acomodação (todas com capacidade total), ao menos uma tarifa e todos os preços ligados a uma acomodação e a uma tarifa. Um item ativo continua completo: edições que quebrem essas regras são recusadas.
- Capacidade como no UCP: total de 1 a 200 e nunca menor que o máximo de adultos ou de crianças; faixas de idade de criança com limite opcional.
- O horário de silêncio exige início e fim (`time_interval`).

## 4. Saída UCP

`toUcpProduct` (`src/modules/portfolio/ucp.ts`) gera o Product do UCP:

- `price_range` e `list_price_range` calculados das variantes;
- o `details` da vertical em `metadata`, sob `co.guidu.portfolio.<item_type>[.<vertical>]` (o UCP define `metadata` como dado próprio do negócio);
- `options` derivadas das opções das variantes;
- `availability` de cada variante calculada a partir da situação e do estoque interno (estoque zero vira `out_of_stock`, ou `backorder` quando o item vende sem estoque).

Na hospedagem (`toUcpLodgingProduct`, `src/modules/portfolio/lodging.ts`), o `metadata` `co.guidu.portfolio.lodging` leva as regras da casa e:

- `property`: Property do UCP (nome, endereço, geo, fuso, horários, comodidades e as fotos do item);
- `accommodation_types`: AccommodationType do UCP, com a extensão `co.guidu.portfolio.accommodation_type`;
- `rate_plans`: RatePlan do UCP, com `policies` de cancelamento e a extensão `co.guidu.portfolio.rate_plan`.

Cada variante sai com as opções "Acomodação" e "Tarifa" e, no seu `metadata`, os ids das duas.

**Nunca saem pelo UCP:** situação, visibilidade, vitrine, campos `ai_*` e estoque.

Um item só é visível pelo UCP (`isUcpVisible`) quando está ativo, público, liberado para a IA e com preço. Itens sob consulta ficam só com o nosso agente (decisão 3).

A tela do item mostra a prévia da saída. Os testes validam a saída contra os JSON Schemas oficiais do protocolo (`tests/fixtures/ucp`, commit `ad9950b`).

## 5. Ações e auditoria

| Ação                     | Auditoria                             |
| ------------------------ | ------------------------------------- |
| Criar item               | `portfolio.item.create`               |
| Editar item              | `portfolio.item.update`               |
| Criar variante           | `portfolio.variant.create`            |
| Editar variante          | `portfolio.variant.update`            |
| Remover variante         | `portfolio.variant.delete`            |
| Criar acomodação         | `portfolio.accommodation_type.create` |
| Editar acomodação        | `portfolio.accommodation_type.update` |
| Remover acomodação       | `portfolio.accommodation_type.delete` |
| Criar tarifa             | `portfolio.rate_plan.create`          |
| Editar tarifa            | `portfolio.rate_plan.update`          |
| Remover tarifa           | `portfolio.rate_plan.delete`          |
| Criar loja               | `workspace.location.create`           |
| Editar ou desativar loja | `workspace.location.update`           |

Todas as ações conferem o estado do módulo (desabilitado ou não contratado bloqueia; suspenso deixa só a leitura), a permissão e, na criação, a cota.

## 6. Limites

| Cota                 | Padrão |
| -------------------- | ------ |
| `portfolio.items`    | 1.000  |
| `portfolio.variants` | 10.000 |

A ordem de decisão é:

1. o limite do plano da empresa (Plataforma › Cobrança);
2. o padrão definido em **Plataforma › Configurações de módulos › Portfólio** (`platform_modules.config.quotaDefaults`);
3. o padrão do manifesto.

Esse padrão da plataforma vale para qualquer módulo que declare cotas.

## 7. Exportação, exclusão e retenção

- `portfolioDataContract` exporta itens, variantes, acomodações e tarifas e os apaga na exclusão definitiva do workspace.
- As lojas entram na exportação e na exclusão do núcleo.
- Sem retenção própria.

## 8. Jobs, eventos e MCP

Nada nesta etapa. A F5d traz `search_catalog`, `lookup_catalog` e `get_product` (nomes do UCP), os escopos `portfolio:read`, `portfolio:agent` e `portfolio:write`, e as propostas de escrita pelo agente.

## 9. Critérios de aceite e testes

| Critério                                                       | Evidência                                                               |
| -------------------------------------------------------------- | ----------------------------------------------------------------------- |
| Saída válida contra o JSON Schema oficial do UCP; nada interno | `tests/unit/portfolio-ucp.test.ts`                                      |
| RLS, autoria, imutabilidade, SKU e handle únicos               | `tests/core/portfolio-rls.sql` (job `db`)                               |
| Hospedagem: RLS, item imutável, vínculos do mesmo item         | `tests/core/lodging-rls.sql` (job `db`)                                 |
| Hospedagem válida contra os schemas `lodging` do UCP           | `tests/unit/portfolio-lodging.test.ts` e `tests/core/portfolio.test.ts` |
| Serviços, cotas da plataforma, lojas, viewer, isolamento       | `tests/core/portfolio.test.ts` (job `db`)                               |
| Habilitar, cadastrar loja, criar produto e variante, prévia    | `e2e/portfolio.spec.ts`                                                 |
| Hospedagem: propriedade, acomodação, tarifa, diária, prévia    | `e2e/portfolio.spec.ts`                                                 |
