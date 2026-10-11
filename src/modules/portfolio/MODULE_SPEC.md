# Especificação do módulo Portfólio (`portfolio`)

- **Versão:** 0.1.0 (F5a)
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

| Tabela                         | Conteúdo                                                                                                                                                                                                                                                                                                                                      |
| ------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `portfolio_items`              | **Núcleo UCP:** `item_type`, `vertical`, `title`, `handle`, `description`, `categories`, `media`, `tags`, `url`, `rating`, `fulfillment_methods`, `location_ids`, `policies`, `links`, `price_display`. **Interno:** `status`, `visibility`, `priority`, `is_featured`, `featured_rank`, `availability_mode`, `ai_*`. **Extensão:** `details` |
| `portfolio_variants`           | **UCP:** `title`, `sku`, `barcodes`, preço e preço cheio (inteiros em centavos, com `currency`), `quantity_unit`, `unit_price`, `options`, `media`, `availability_status`. **Interno:** `track_inventory`, `stock_quantity`, `min_stock_alert`, `allow_backorder`                                                                             |
| `workspace_locations` (núcleo) | Location do UCP: nome, endereço (`street_address`, `address_locality`, `address_region`, `postal_code`, `address_country`, `phone_number`), `latitude` e `longitude`, horários semanais, exceções, fuso IANA, `amenities`; situação ativa ou desativada                                                                                       |

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

## 4. Saída UCP

`toUcpProduct` (`src/modules/portfolio/ucp.ts`) gera o Product do UCP:

- `price_range` e `list_price_range` calculados das variantes;
- `options` derivadas das opções das variantes;
- `availability` de cada variante calculada a partir da situação e do estoque interno (estoque zero vira `out_of_stock`, ou `backorder` quando o item vende sem estoque).

**Nunca saem pelo UCP:** situação, visibilidade, vitrine, campos `ai_*` e estoque.

Um item só é visível pelo UCP (`isUcpVisible`) quando está ativo, público, liberado para a IA e com preço. Itens sob consulta ficam só com o nosso agente (decisão 3).

A tela do item mostra a prévia da saída. Os testes validam a saída contra os JSON Schemas oficiais do protocolo (`tests/fixtures/ucp`, commit `ad9950b`).

## 5. Ações e auditoria

| Ação                     | Auditoria                   |
| ------------------------ | --------------------------- |
| Criar item               | `portfolio.item.create`     |
| Editar item              | `portfolio.item.update`     |
| Criar variante           | `portfolio.variant.create`  |
| Editar variante          | `portfolio.variant.update`  |
| Remover variante         | `portfolio.variant.delete`  |
| Criar loja               | `workspace.location.create` |
| Editar ou desativar loja | `workspace.location.update` |

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

- `portfolioDataContract` exporta itens e variantes e os apaga na exclusão definitiva do workspace.
- As lojas entram na exportação e na exclusão do núcleo.
- Sem retenção própria.

## 8. Jobs, eventos e MCP

Nada nesta etapa. A F5d traz `search_catalog`, `lookup_catalog` e `get_product` (nomes do UCP), os escopos `portfolio:read`, `portfolio:agent` e `portfolio:write`, e as propostas de escrita pelo agente.

## 9. Critérios de aceite e testes

| Critério                                                       | Evidência                                 |
| -------------------------------------------------------------- | ----------------------------------------- |
| Saída válida contra o JSON Schema oficial do UCP; nada interno | `tests/unit/portfolio-ucp.test.ts`        |
| RLS, autoria, imutabilidade, SKU e handle únicos               | `tests/core/portfolio-rls.sql` (job `db`) |
| Serviços, cotas da plataforma, lojas, viewer, isolamento       | `tests/core/portfolio.test.ts` (job `db`) |
| Habilitar, cadastrar loja, criar produto e variante, prévia    | `e2e/portfolio.spec.ts`                   |
