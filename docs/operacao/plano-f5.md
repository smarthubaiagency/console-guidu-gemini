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
- **`workspace_locations`** (núcleo): lojas e propriedades no formato Location do UCP (endereço, geo, horários, exceções, fuso, `amenities`). Itens apontam para elas (retirada, atendimento no local, propriedade de hospedagem, local de evento).
- **Hospedagem:** `portfolio_accommodation_types` (com `capacity`) e `portfolio_rate_plans`, ligados à propriedade.

Tudo por workspace, com RLS FORCE, contrato de dados da F3e (exportação e exclusão), cota e auditoria, como no CRM.

## Etapas

### F5a — Base do Portfólio (produto simples)

**Estado:** pronta para revisão. A migration `20261022090000_f5a_portfolio.sql` é aplicada como `app_migrations`. Especificação em [MODULE_SPEC.md](../../src/modules/portfolio/MODULE_SPEC.md).

Entregue:

- O módulo `catalog` virou `portfolio` (Portfólio, beta), com rota `/app/[slug]/portfolio`. A migration renomeia a chave em todas as tabelas que a citam (estado do workspace e da plataforma, oferta e modelos do parceiro, planos). O placeholder antigo saiu.
- Lojas no núcleo (`workspace_locations`, Location do UCP), em **Configurações › Lojas**, com permissão nova `workspace.locations.manage` (owner e admin). Entram na exportação e na exclusão do workspace.
- `portfolio_items` e `portfolio_variants` com RLS FORCE, travas de imutabilidade, SKU e handle únicos, preço em centavos e variante obrigatória.
- Serviços de item e variante (criar, editar, adicionar e remover variante), com estado do módulo, permissão, cotas e auditoria. Uma edição parcial muda só o que foi enviado.
- Serializador UCP (`toUcpProduct`), validado nos testes contra os JSON Schemas oficiais copiados em `tests/fixtures/ucp` (commit `ad9950b`). A tela do item mostra a prévia da saída.
- Telas: lista com busca e filtro de situação e criação de produto; item com dados UCP, entrega/atendimento, lojas, governança de IA e vitrine, e variantes. A mídia é só por URL, com o aviso de que o envio de arquivos chega com o Storage.
- Cotas `portfolio.items` (1.000) e `portfolio.variants` (10.000). O padrão é configurável em **Plataforma › Configurações de módulos › Portfólio**, abaixo do limite do plano. O padrão da plataforma vale para qualquer módulo com cota.
- Testes: unitário `portfolio-ucp.test.ts` (schema oficial), SQL `portfolio-rls.sql`, integração `portfolio.test.ts` e e2e `portfolio.spec.ts`.

Planejado:

- Renomear o módulo `catalog` para `portfolio` (manifesto, rota `/app/[slug]/portfolio`, menu "Portfólio"). Hoje o catálogo é só um placeholder "em breve", sem dados.
- Migration de `portfolio_items`, `portfolio_variants` e, no núcleo, `workspace_locations`.
- Esquemas Zod do núcleo, da variante e da Location, nos nomes do UCP. O serializador UCP de Product e Variant é testado contra os JSON Schemas oficiais, copiados para `tests/fixtures/ucp` com o commit de origem.
- Permissões `portfolio.items.read` e `portfolio.items.write`, cota de itens e de variantes, auditoria, exportação e exclusão.
- Telas: lista com busca e filtros, criação e edição de item com variantes (mídia por URL, com envio simulado) e, em Configurações do workspace, Lojas.
- `item_type = product` com a vertical `general`.

### F5b — Verticais

**Estado:** pronta para revisão. Sem migration: o `details` em JSONB e o `item_type` já existiam.

Entregue:

- `src/modules/portfolio/verticals.ts`: uma declaração por campo gera o schema Zod, o formulário e a leitura do formulário. Cobre produto, serviço (base, saúde, estética, beleza e corporativo), imobiliário (venda e aluguel) e evento, com as correções da revisão do piloto: snake_case, enums minúsculos, centavos e `Measure`.
- Um rascunho pode ficar incompleto. Ativar exige os campos obrigatórios da vertical: operação e tipo do imóvel, início do evento.
- Na saída UCP, os dados da vertical vão em `metadata` como `co.guidu.portfolio.<item_type>[.<vertical>]`, validados contra o schema oficial.
- Telas: categoria escolhida na criação, campos da vertical na página do item e filtro por categoria na lista.
- Testes: unitário `portfolio-verticals.test.ts`, integração (vertical errada, campo de outra vertical, camelCase do piloto, ativação sem obrigatórios, eventos com ingressos como variantes) e e2e de um serviço de saúde.

Planejado:

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
- Visão do nosso agente: serviço interno para o módulo Agentes de IA e escopo `portfolio:agent` no MCP para agentes externos, com a governança (`ai_*`) e os itens sob consulta, separada da saída UCP.
- Escrita pelo agente por proposta: `portfolio.items.create`, `portfolio.items.update` e `portfolio.variants.update` (preço e disponibilidade).

### F5e — Mídia

- Envio de imagens para o Storage escolhido nas configurações da plataforma (Supabase ou Cloudflare R2), com tamanho, tipo e cota controlados. Espera essa definição; até lá a mídia é por URL com envio simulado.

## Fora da F5

- Carrinho, checkout e pedido do UCP (vender pelo agente): dependem de pagamento (P6) e do fluxo de pedido.
- Reserva de hospedagem e agenda de serviços.
- Publicação no Perfil da Empresa no Google (módulo Google Business) e a pesquisa de preço local entre lojas: usam o Portfólio como fonte e entram com os seus módulos.
- Perfil público `/.well-known/ucp` só de descoberta e o checkout próprio no guidu.chat (fase 2).

## Respostas de Marcelo (11/10/2026)

1. **Lojas no núcleo.** As Locations são do negócio e não do Portfólio. Ficam no núcleo do workspace (`workspace_locations`), usadas pelo Portfólio, pelo Google Business e pelo agente (horários). Entram na F5a.
2. **Mídia simulada por enquanto.** `media` aceita URL e a tela usa um envio simulado. O provedor de Storage será escolhido nas configurações da plataforma (provavelmente Supabase ou Cloudflare R2); a F5e fica para quando houver essa definição.
3. **Dois consumidores do agente.** O padrão é o módulo Agentes de IA, com um serviço interno que já inclui a governança (`ai_*`) e os itens sob consulta. Agentes externos entram pelo MCP: a saída UCP com `portfolio:read` e, para a visão de atendimento, o escopo `portfolio:agent`.
4. **Descoberta sim, conversa e checkout nossos.** O Portfólio permite descoberta, mas a conversa é sempre com o agente orquestrador **guidu.bot**, e o checkout é sempre o nosso, no **guidu.chat** (fase 2). Por enquanto fica previsto:
   - a saída UCP já traz `url` e `continue_url` apontando para o nosso fluxo (configurável);
   - o perfil `/.well-known/ucp`, se publicado, anuncia só descoberta (`catalog.search` e `catalog.lookup`), sem `checkout` de terceiros;
   - nada de checkout UCP para outras plataformas nesta fase.
5. **Cotas** (sem resposta; ficam as provisórias): 1.000 itens e 10.000 variantes por workspace, em configuração do plano.
6. **Ordem confirmada:** F5a → F5b → F5c → F5d; a F5e espera a escolha do Storage.
