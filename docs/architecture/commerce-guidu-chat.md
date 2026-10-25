# Comércio do guidu.chat com o Vendure

- **Status:** proposta para discussão. Organiza a ideia do Marcelo de 23/10/2026; vira ADR (número sugerido: 0027) depois das decisões da seção 9.
- **Data:** 23/10/2026
- **Relaciona-se com:** [compra agêntica](agentes-na-matrix-e-compra-agentica.md), [plano da F5](../operacao/plano-f5.md) (Portfólio e UCP), [revisão do Portfólio](../modules/portfolio/revisao-piloto.md), [ADR 0023](../adr/0023-chat-interno-como-cliente-matrix.md) (Matrix), [ADR 0026](../adr/0026-gateways-apisix-e-agentgateway.md) (gateways), [análise da proposta de infraestrutura](analise-proposta-infra-2026-10-22.md).

## 1. A ideia

> Os customers pertencem ao guidu.chat. A ideia é ter um motor de commerce para atender a nossa visão de uma ferramenta única para o turista usar em todos os comércios da cidade. O comerciante atualiza os produtos pelo Portfólio do console e, no futuro, isso possibilita o comércio agêntico. O console sozinho não atende essa parte, e é desnecessário construir um commerce completo dentro do console. (Marcelo, 23/10/2026)

Em uma frase: **o console é a ferramenta do comerciante, o guidu.chat é a ferramenta do turista e o Vendure é o motor de comércio do guidu.chat.**

## 2. Três domínios

| Domínio             | Para quem            | É dono de                                                                                                                                           | Não faz                                                                         |
| ------------------- | -------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| **Console (GUIDU)** | Comerciante e equipe | Portfólio (conteúdo do catálogo, UCP, governança de IA), CRM, conversas (Matrix), agentes, permissões do workspace, cadastro da loja como vendedora | Carrinho, checkout, pagamento, conta do turista                                 |
| **guidu.chat**      | Turista              | A conta do turista (uma só para a cidade inteira), carrinho, pedidos, histórico, conversas com as lojas                                             | Gestão de produto e de loja                                                     |
| **Vendure**         | Motor do guidu.chat  | Catálogo vendável (cópia do Portfólio), preço e estoque na hora da compra, carrinho, pedido, divisão do pedido por loja, pagamento e repasse        | Edição de produto pelo comerciante (o dashboard do Vendure não é usado por ele) |

**Fronteira de permissão.** O que é do workspace (produto, equipe, conversa, agente) continua decidido no GUIDU, como manda a regra 2 da ADR 0026. O que é do próprio turista (o carrinho e os pedidos dele) é decidido pelo Vendure, com a identidade do guidu.chat. São donos diferentes, então não existem duas regras para a mesma coisa.

## 3. Quem é dono de cada dado

| Dado                                                             | Fonte da verdade                                                      | Cópia ou leitura                                                                                |
| ---------------------------------------------------------------- | --------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| Título, descrição, mídia, categorias, variantes, preço de tabela | **Portfólio**                                                         | Copiado para o Vendure, num só sentido                                                          |
| Governança de IA (`ai_*`), vitrine, situação interna             | **Portfólio**                                                         | Nunca vai ao Vendure nem sai pelo UCP                                                           |
| Estoque                                                          | **A decidir** (seção 9, pergunta 1)                                   | —                                                                                               |
| Conta do turista (Customer)                                      | **guidu.chat**, com identidade no Supabase Auth e Customer no Vendure | O comerciante só recebe o mínimo, depois do aceite ou do pagamento (LGPD, compra agêntica §7.3) |
| Carrinho, pedido, pagamento, repasse                             | **Vendure**                                                           | O console lê os pedidos da loja pela Admin API                                                  |
| Contato do CRM do comerciante                                    | **GUIDU (CRM)**                                                       | Criado ou ligado quando o turista compra ou conversa com a loja                                 |
| Conversas                                                        | **Matrix** (ADR 0023)                                                 | Eventos de pedido entram na sala da loja como id do registro                                    |
| Ligação workspace ↔ vendedor e canal do Vendure                  | **GUIDU** (tabela nova)                                               | —                                                                                               |

## 4. Como as peças se ligam

```
Comerciante ─▶ Console (Portfólio) ──job de sincronização──▶ Vendure Admin API (rede interna)
                     │                                         │
                     └── tela "Pedidos" ◀── Admin API ─────────┤
                                                               │
Turista ─▶ guidu.chat ─▶ APISIX ─▶ Vendure Shop API ───────────┘
              │                         ▲
              └─ salas Matrix           └── ferramentas do motor (comércio agêntico, pelo GUIDU)
```

- **Um canal (Channel) e um vendedor (Seller) do Vendure por loja**, criados quando o comerciante liga a venda pelo guidu.chat, e **um canal marketplace** com todos os produtos vendáveis da cidade. O Vendure já divide um pedido com itens de várias lojas em pedidos por vendedor (`OrderSellerStrategy`), com frete, pagamento e taxa da plataforma separados.
- **A Admin API nunca é pública.** Só o GUIDU fala com ela, pela rede interna. A Shop API sai pelo APISIX para o guidu.chat (ADR 0026).
- **O dashboard do Vendure** fica só para a operação da plataforma, na rede interna ou com lista de IPs.

## 5. Fluxos

### 5.1 O comerciante publica um produto

1. Edita no Portfólio, como hoje.
2. Ao salvar um item `active`, vendável e com a venda ligada, o GUIDU grava um evento e enfileira um job de sincronização (pg-boss, idempotente pela versão do item).
3. O worker grava produto, variantes, preço e mídia no canal da loja e no marketplace, pela Admin API. Itens sob consulta (`quote`) e hospedagem não vão (revisão do Portfólio, decisão 3; reservas ficam fora do Vendure).
4. Uma rotina de conciliação compara os dois lados e corrige as diferenças. O Vendure nunca é editado à mão.

### 5.2 O turista compra em várias lojas

1. Entra no guidu.chat com o telefone, uma vez, e usa a mesma conta em toda a cidade.
2. Busca e monta o carrinho pela Shop API (canal marketplace).
3. No checkout, o Vendure divide o pedido por loja, cobra e registra o repasse de cada uma.
4. Cada loja recebe o seu pedido. Um evento vai para a Central de Eventos (ADR 0022) e para a sala da loja no Matrix.

### 5.3 O comerciante atende o pedido

Uma tela **Pedidos** no console, sobre a Admin API: lista, detalhe, confirmar, pronto para retirada, entregue e cancelar. Só o essencial do atendimento. Promoções, regras de frete e devoluções complexas entram depois, e sempre como telas do console sobre o Vendure, nunca como commerce próprio.

### 5.4 Comércio agêntico (futuro)

O botmercado e o GUIDS vendedor (compra agêntica, seção 3) usam ferramentas do motor do GUIDU que leem o canal marketplace e montam o carrinho no Vendure **em nome do turista**, com um token curto e de escopo só de carrinho. O pagamento é sempre do turista, no guidu.chat. A regra "preço e estoque só do banco" continua valendo, e o "banco" passa a ser o Vendure.

## 6. O que o console faz e o que não faz

| O console faz                                                    | O console não faz                        |
| ---------------------------------------------------------------- | ---------------------------------------- |
| Portfólio (já existe)                                            | Carrinho e checkout                      |
| Ligar a loja à venda pelo guidu.chat (cria o vendedor e o canal) | Conta do turista                         |
| Tela de pedidos da loja                                          | Motor de preço, promoção e frete próprio |
| Configuração de recebimento da loja                              | Pagamento e repasse próprios             |
| Ferramentas do motor para o comércio agêntico                    | Dashboard de commerce paralelo           |

## 7. Identidade do turista

- **Uma pessoa, um `sub`.** A conta do turista no Supabase Auth (telefone com código pelo WhatsApp) liga o Customer do Vendure, por uma AuthenticationStrategy própria que valida o token do Supabase, e o usuário Matrix do turista (ADR 0023).
- O turista não é membro de nenhum workspace e não entra no console. Para o comerciante, ele vira um contato do CRM só quando conversa com a loja ou compra dela.
- Falta decidir se o turista fica no mesmo projeto Supabase do console, com tipo de usuário separado, ou num projeto próprio do guidu.chat (seção 9, pergunta 4).

## 8. Impacto nos documentos atuais

| Documento                                                                     | O que muda                                                                                                                                                                                                                                 |
| ----------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| [Compra agêntica](agentes-na-matrix-e-compra-agentica.md)                     | §2.2 "O que vale é o banco": preço, estoque, carrinho e pedido passam a ser do Vendure. CA1 deixa de ser "carrinho e pedido no núcleo" e vira a sincronização e a integração com o Vendure. CA2 é o checkout do guidu.chat sobre o Vendure |
| [Plano da F5](../operacao/plano-f5.md)                                        | O "fora da F5" (carrinho, checkout e pedido) vai para o Vendure                                                                                                                                                                            |
| [ADR 0026](../adr/0026-gateways-apisix-e-agentgateway.md)                     | O APISIX passa a publicar a Shop API e os assets do Vendure; a Admin API e o dashboard ficam internos                                                                                                                                      |
| [Análise da proposta de infraestrutura](analise-proposta-infra-2026-10-22.md) | O Portfólio continua no console e o Vendure entra como motor do guidu.chat, não como lugar de edição do comerciante                                                                                                                        |
| ADR nova (0027)                                                               | Commerce do guidu.chat no Vendure: domínios, donos dos dados, sincronização, identidade, pagamento                                                                                                                                         |

## 9. Decisões em aberto

1. **Estoque.** (a) O Portfólio continua mandando e o Vendure recebe o número; a venda baixa no Vendure e devolve um evento ao Portfólio. Ou (b) depois que a venda é ligada, o estoque passa a ser do Vendure e o Portfólio só mostra. A (b) evita conflito; a (a) mantém tudo num lugar para o comerciante.
2. **Pagamento e marketplace (CA0).** Ao cobrar do turista e repassar às lojas, a plataforma vira intermediária (CDC, estorno, nota fiscal). Falta a decisão jurídica e comercial e a escolha do provedor com divisão de pagamento, Pix e cartão. O Stripe Connect já está configurado no console (CF7); a Iugu está prevista para as assinaturas.
3. **Um carrinho para várias lojas ou um por loja no piloto.** Com divisão de pagamento, o Vendure faz um checkout só; sem ela, um checkout por loja.
4. **Projeto Supabase do turista:** o mesmo do console ou separado.
5. **Quem pode vender:** opt-in do comerciante, por plano ou por módulo; quais tipos de item (produto, serviço, evento).
6. **Nota fiscal:** emitida pela loja; como o pedido chega ao emissor dela.
7. **Versão e hospedagem do Vendure:** server, worker e banco próprio no EasyPanel (ADR 0026), com backup do banco e das imagens.
8. **Busca dos agentes:** o comércio agêntico busca no Vendure (preço e estoque da hora) ou no Portfólio (UCP e governança de IA)?

## 10. Riscos

| Risco                                                                                     | Mitigação                                                                                                                                             |
| ----------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| Duas cópias do catálogo divergirem                                                        | Sincronização num só sentido, idempotente, com conciliação periódica; Vendure nunca editado à mão                                                     |
| O marketplace dar mais trabalho que o previsto (cadastro de vendedores, repasse, estorno) | O Vendure já divide os pedidos; começar com uma loja, preço fixo e retirada (compra agêntica, §3.6); o plugin multi-vendor de exemplo é só referência |
| Licença GPLv3 do Vendure                                                                  | Personalizar só por plugin (o Vendure tem exceção de licença para plugins); não alterar o core; revisar o FAQ de licença                              |
| Mais serviços para operar                                                                 | Config versionada, backup do banco e das imagens, entrada no teste de carga de Búzios                                                                 |
| guidu.chat ainda não existe                                                               | O motor pode ser instalado e sincronizado antes; o checkout depende do app                                                                            |

## 11. Etapas sugeridas

Decisão do Marcelo de 23/10/2026: o **Vendure entra na V1** do guidu.chat, com pedido enviado à loja e pagamento por link da própria loja ([guidu-chat: v1-navegacao-e-pedido.md](https://github.com/smarthubaiagency/guidu-chat/blob/claude/produto-v1/docs/produto/v1-navegacao-e-pedido.md)). O pagamento pela plataforma (CA0) fica para depois.

| Etapa   | Entrega                                                                                                                                                                                                        | Depende de              |
| ------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------- |
| **VC0** | ADR 0027 com as respostas da seção 9                                                                                                                                                                           | Marcelo                 |
| **VC1** | Vendure no local e no dev (server, worker e banco próprio), canal marketplace e AuthenticationStrategy com o Supabase                                                                                          | VC0, ADR 0026 (GW1/GW2) |
| **VC2** | Ligar a loja à venda (vendedor e canal), tabela workspace ↔ vendedor, sincronização Portfólio → Vendure e conciliação                                                                                          | VC1                     |
| **VC3** | Checkout no guidu.chat sobre a Shop API com **Enviar pedido** (sem pagamento pela plataforma): processo de pedido com situações próprias, meio de pagamento "combinado com a loja", cadastro ou login no envio | VC2, app guidu.chat     |
| **VC4** | Espaço Pedidos no Inbox: aceitar, recusar, gerar link de pagamento a partir do pedido, confirmar recebimento, pronto, enviado, concluído; cartões na sala e histórico no Cliente Hub                           | VC3                     |
| **VC5** | Várias lojas, divisão do pedido e repasse                                                                                                                                                                      | VC4 e decisão 3         |
| **VC6** | Ferramentas do motor para o comércio agêntico (botmercado e vendedor)                                                                                                                                          | VC5, CA3 e CA4          |

## 12. Fontes

- Vendure, marketplaces com vários vendedores: [docs.vendure.io — multi-vendor marketplaces](https://docs.vendure.io/guides/how-to/multi-vendor-marketplaces/) e [OrderSellerStrategy](https://docs.vendure.io/reference/typescript-api/orders/order-seller-strategy)
- Vendure 2, divisão de pedidos, frete, pagamento e taxa da plataforma: [anúncio do Vendure 2](https://vendure.io/blog/announcing-vendure-2), [marketplace](https://vendure.io/product/features/marketplace)
- Licença: [anúncio da mudança de licença](https://vendure.io/blog/license-change-announcement) e [README do Vendure](https://raw.githubusercontent.com/vendurehq/vendure/master/README.md)
