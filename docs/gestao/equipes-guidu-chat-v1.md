# guidu.chat V1: divisão de tarefas entre as equipes

- **Status:** proposta do gerente de projeto, 23/10/2026. Base: [ADR 0027](../adr/0027-guidu-chat-v1-console-bridge.md) e [plano de janeiro](plano-janeiro-2027.md).
- **Equipe console:** trabalha no repositório `console-guidu-gemini`.
- **Equipe guidu.chat:** trabalha no repositório `guidu-chat`; não abre PR no console, pede mudança de contrato.

## 1. O que cada equipe entrega

| Equipe console                                                                                                                 | Equipe guidu.chat                                                                                |
| ------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------ |
| Contrato: OpenAPI da API do guidu.chat, esquemas da ponte, catálogo de eventos e servidor simulado (`@guidu/contracts`)        | Revisão do contrato; guidu.chat web em Next.js no host `guidu.chat`                              |
| Segurança (L1, L2, L5), APISIX e agentgateway, produção                                                                        | Container `guidu-chat-web` e esteira de build                                                    |
| Vendure: canal por loja, sincronização do Portfólio, processo de pedido, meio "combinado com a loja", plugin `guidu-proposals` | Home, Local (banner, favoritos, últimos vistos), carrinho por loja, checkout com "Enviar pedido" |
| API do guidu.chat: entrada, lojas, itens, conta, carrinho, pedido, proposta, pagamento, entrega, conversas, eventos, push      | Login do turista (telefone com código) e sessão; Cliente Hub (minhas compras e histórico)        |
| Bridge API e SDK do mini-app                                                                                                   | Adaptador da ponte (iframe no web, WebView depois)                                               |
| Mini-apps em `apps.guidu.chat`: perfil, produto ou oferta, catálogo                                                            | Telas de proposta e aceite, "Pagar à loja", retirada e envio                                     |
| Inbox: espaço Pedidos, proposta versionada, gerar link de pagamento, confirmar recebimento                                     | Chat (pela API ou pelo WhatsApp da loja, conforme N9)                                            |
| Link de pagamento: 1 provedor por API e modo manual                                                                            | Testes de ponta a ponta do lado do turista                                                       |
| Turista no Matrix (usuário virtual), avisos e push                                                                             | Acessibilidade, idiomas da interface, desempenho em rede ruim                                    |

## 2. Semanas

| Semana | Equipe console                                                                 | Equipe guidu.chat                                                                                     |
| ------ | ------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------- |
| 27/10  | **Contrato v1 e servidor simulado**; ADRs; segurança L1, L2, L5; Vendure local | Revisar o contrato; esqueleto do guidu.chat web com o `@guidu/ui`; navegação Home, Local, Chat, Conta |
| 03/11  | Vendure no dev, sincronização do Portfólio; identidade do turista (N4)         | Leitura do QR (`/q/<código>`), Local, carrinho contra o simulado                                      |
| 10/11  | API: entrada, lojas, itens, carrinho, conta; mini-app de produto e perfil      | Login do turista; adaptador da ponte no iframe; `addToCart` pela ponte                                |
| 17/11  | API: Enviar pedido; Inbox Pedidos (lista e detalhe)                            | Checkout e "Enviar pedido"; trocar o simulado pela API real do dev                                    |
| 24/11  | Plugin `guidu-proposals`; API de proposta e eventos (SSE)                      | Telas de proposta, aceite e histórico; Cliente Hub                                                    |
| 01/12  | Link de pagamento (provedor N8 + manual); confirmação de recebimento; entrega  | "Pagar à loja", telas de retirada e envio; Chat (N9)                                                  |
| 08/12  | Gateways no dev; backup; teste de carga; revisão de segurança                  | Testes de ponta a ponta; rede ruim; idiomas; correções                                                |
| 15/12  | Produção; cadastro das lojas e QR impressos                                    | Deploy do `guidu-chat-web` em produção; teste com as lojas                                            |
| 22/12  | Congelamento e plantão                                                         | Congelamento e plantão                                                                                |

## 3. Pontos de encontro entre as equipes

| Quando | O quê                                                                                             |
| ------ | ------------------------------------------------------------------------------------------------- |
| 31/10  | Contrato v1 aprovado pelas duas equipes                                                           |
| 21/11  | guidu.chat web enviando pedido para o dev real                                                    |
| 05/12  | Fluxo completo no dev: QR → carrinho → pedido → proposta → aceite → link → confirmação → retirada |
| 12/12  | Teste de carga e revisão de segurança com as duas equipes                                         |
| 19/12  | Ensaio geral em produção com as lojas do piloto                                                   |

## 4. Decisões que as equipes esperam do Marcelo

N2 e N7 (lojas), N4 (projeto Supabase do turista), N8 (provedor de pagamento), N9 (chat em janeiro) e a aprovação das ADRs 0026 e 0027 ([painel](painel.md)).
