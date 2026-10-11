# Plano da F5 — Módulo Portfólio

A F5 vem depois da F4, pela [ADR 0003](../adr/0003-ordem-das-fases.md). O primeiro módulo de produto, antes chamado "Catálogo", passa a se chamar **Portfólio** (decisão do Marcelo, 11/10/2026). O Portfólio é a ferramenta do agente de IA no atendimento e a base para commerce agentic, para a pesquisa de preço local e para a lista de produtos no Perfil da Empresa no Google.

Referências:

- [Campos do UCP](../modules/portfolio/ucp-campos.md): Universal Commerce Protocol, commit `ad9950b`.
- [Revisão do piloto](../modules/portfolio/revisao-piloto.md): campos do Cartão Pro, correções e decisões.

Critérios de saída:

- Itens de todas as categorias (produto, serviço, imobiliário, hospedagem e evento) cadastrados pela tela, com as verticais do piloto corrigidas.
- Saída pela API e pelo MCP exatamente no formato do UCP (`search_catalog`, `lookup_catalog`, `get_product`), validada contra os JSON Schemas do protocolo em teste.
- Governança de IA (`ai_*`), vitrine e itens sob consulta nunca aparecem na saída UCP.
- Escrita pelo agente só por proposta com aprovação humana (F4d).

## Decisões de Marcelo

1. **Saída 100% UCP.** Nomes e enums do protocolo em snake_case e minúsculas; o código TypeScript usa camelCase, mapeado para o banco como no resto do projeto. Os dados internos (status, vitrine, `ai_*`) ficam separados e nunca saem.
2. **Variante obrigatória.** Todo item tem ao menos uma variante, que guarda preço, SKU, códigos de barras e disponibilidade. Preços inteiros em centavos.
3. **Sob consulta só pelo agente.** Item sem preço (`price_display = quote`) fica fora da busca e da compra pelo UCP e aparece só para o nosso agente.
4. **Fonte única de preço.** A unidade de venda (`quantity_unit`: unidade, hora, dia, pessoa, mês, kg, m²…) define o preço. O `price_model` dos serviços sai.
5. **Temporário é hospedagem.** Imóvel tem só venda e aluguel; temporada vai para `lodging`, que segue o desenho de hospedagem do UCP.
6. **Extensões em `co.guidu.*`**, com nome reverso de domínio, como o UCP prevê. O namespace fica numa constante única, já que o nome GUIDU é provisório.
7. **Ferramentas MCP com os nomes do UCP.**

## Modelo de dados

- **`portfolio_items`** (STI): `item_type` (`product`, `service`, `real_estate`, `lodging`, `event`) e `vertical` como discriminadores.
  - Núcleo UCP: `title`, `handle`, `description` (`plain`, `markdown`), `categories`, `media`, `tags`, `url`, `rating`, `fulfillment_methods`, `policies`, `links`.
  - Interno: `status`, `visibility`, `priority`, `is_featured`, `featured_rank`, `availability_mode`, `ai_discovery_enabled`, `ai_keywords`, `ai_aliases`, `ai_do_not_say`, `ai_safety_rules`.
  - `details` JSONB: extensão da vertical, validada pela discriminated union de `item_type` + `vertical`.
- **`portfolio_variants`**: `title`, `sku`, `barcodes`, `price`, `list_price`, `quantity_unit`, `unit_price`, `options`, `media` e `availability`, mais o estoque interno (`track_inventory`, `stock_quantity`, `min_stock_alert`, `allow_backorder`).
- **`portfolio_locations`**: lojas e propriedades no formato Location do UCP (endereço, geo, horários, exceções, fuso, `amenities`). Itens apontam para elas (retirada, atendimento no local, propriedade de hospedagem, local de evento).
- **Hospedagem:** `portfolio_accommodation_types` (com `capacity`) e `portfolio_rate_plans`, ligados à propriedade.

Tudo por workspace, com RLS FORCE, contrato de dados da F3e (exportação e exclusão), cota e auditoria, como no CRM.

## Etapas

### F5a — Base do Portfólio (produto simples)

- Renomear o módulo `catalog` para `portfolio` (manifesto, rota `/app/[slug]/portfolio`, menu "Portfólio"). Hoje o catálogo é só um placeholder "em breve", sem dados.
- Migration de `portfolio_items`, `portfolio_variants` e `portfolio_locations`.
- Esquemas Zod do núcleo, da variante e da Location, nos nomes do UCP. O serializador UCP de Product e Variant é testado contra os JSON Schemas oficiais, copiados para `tests/fixtures/ucp` com o commit de origem.
- Permissões `portfolio.items.read` e `portfolio.items.write`, cota de itens e de variantes, auditoria, exportação e exclusão.
- Telas: lista com busca e filtros, criação e edição de item com variantes, lojas.
- `item_type = product` com a vertical `general`.

### F5b — Verticais

- Discriminated union de `details` para produto (marca, modelo, condição, peso e dimensões em `Measure`, garantia como política), serviço (base e saúde, estética, beleza, corporativo), imobiliário (venda e aluguel) e evento (ingressos como variantes, `starts_at` e `ends_at`).
- Formulários dinâmicos por categoria e vertical.
- Saída das extensões como `co.guidu.portfolio.<item_type>[.<vertical>]`.

### F5c — Hospedagem (UCP lodging)

- Propriedade (Location), tipos de acomodação com capacidade, planos tarifários, política de cancelamento e regras da casa.
- Só o cadastro. A reserva (`create_booking_session`…) depende de agenda e pagamento e fica para depois.

### F5d — API e MCP no formato UCP

- REST e MCP do workspace: `search_catalog` (texto, categorias, faixa de preço, paginação), `lookup_catalog` (por IDs de produto, variante ou SKU) e `get_product` (com seleção de opções), com a saída validada contra o UCP.
- Escopos novos nas chaves: `portfolio:read` e `portfolio:write`.
- Itens `quote`, inativos ou com `ai_discovery_enabled = false` ficam fora.
- Visão do nosso agente: leitura com os campos de governança (`ai_*`) e os itens sob consulta, separada da saída UCP (pergunta 3).
- Escrita pelo agente por proposta: `portfolio.items.create`, `portfolio.items.update` e `portfolio.variants.update` (preço e disponibilidade).

### F5e — Mídia

- Envio de imagens para o Storage (pergunta 2), com tamanho, tipo e cota controlados; `media` aponta para a URL servida.

## Fora da F5

- Carrinho, checkout e pedido do UCP (vender pelo agente): dependem de pagamento (P6) e do fluxo de pedido.
- Reserva de hospedagem e agenda de serviços.
- Publicação no Perfil da Empresa no Google (módulo Google Business) e a pesquisa de preço local entre lojas: usam o Portfólio como fonte e entram com os seus módulos.
- Perfil público `/.well-known/ucp` para agentes de fora sem chave (pergunta 4).

## Perguntas antes da F5a

1. **Lojas (Location):** ficam no Portfólio ou no núcleo do workspace? Elas servem também ao Google Business e ao agente (horário de funcionamento). A proposta é o núcleo, porque são do negócio e não do Portfólio.
2. **Imagens:** começamos só com URL (F5a a F5d) e o Storage entra na F5e, ou o envio precisa vir já na F5a? E onde fica o Storage: Supabase Storage do projeto dev ou outro?
3. **Agente de atendimento:** o agente que vai usar o Portfólio é o módulo Agentes de IA (hoje congelado, C04) ou um agente externo conectado pelo MCP? Isso decide como entregamos a visão interna: serviço interno ou escopo de MCP próprio, por exemplo `portfolio:agent`.
4. **UCP público:** em algum momento cada negócio publica `/.well-known/ucp` no domínio do parceiro, para qualquer agente comprar sem chave? Se sim, fica para uma fase própria, depois da F5.
5. **Cotas provisórias:** sugestão de 1.000 itens e 10.000 variantes por workspace.
6. **Ordem:** F5a → F5b → F5c → F5d → F5e?
