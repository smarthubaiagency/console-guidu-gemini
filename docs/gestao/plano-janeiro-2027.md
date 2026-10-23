# Plano até janeiro de 2027

- **Status:** proposta do gerente de projeto, 23/10/2026, a partir da decisão do Marcelo de ter **pedido com Vendure em janeiro**.
- **Produto:** [guidu-chat: v1-navegacao-e-pedido.md](https://github.com/smarthubaiagency/guidu-chat/blob/claude/produto-v1/docs/produto/v1-navegacao-e-pedido.md)
- **Painel:** [painel.md](painel.md)

## 1. O que vai ao ar em janeiro

| Entra                                                                                        | Fica para depois da temporada                                   |
| -------------------------------------------------------------------------------------------- | --------------------------------------------------------------- |
| guidu.chat V1 **no navegador** (`apps.guidu.chat`): Home, Local, Chat, Conta, aberto pelo QR | App nativo (React Native + Expo) nas lojas da Apple e do Google |
| Vendure com canal por loja, sincronizado com o Portfólio                                     | Pagamento pela plataforma, split, credencial reutilizável       |
| Carrinho por loja, **Enviar pedido** com cadastro ou login                                   | Carrinho com várias lojas num checkout só                       |
| Proposta da loja versionada (itens, frete, prazo) e aceite do turista                        | BotCompara e BotShop abertos para a cidade                      |
| Link de pagamento: **1 provedor por API** e os demais no modo manual                         | Integração com os outros provedores                             |
| Confirmação de recebimento pela loja, Cliente Hub, telas de retirada e envio                 | Modo loja no app                                                |
| Espaço Pedidos no Inbox                                                                      | —                                                               |
| Segurança (L1, L2, L5), gateways, produção e teste de carga                                  | —                                                               |

## 2. Semanas

As etapas andam em pares (`AGENTS.md`); cada uma com PR, testes e aprovação do Marcelo. Infraestrutura e produção exigem aprovação registrada no PR.

| Semana | Datas         | Entregas                                                                                                                      |
| ------ | ------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| 1      | 27/10 a 02/11 | Aprovação das ADRs 0026 (gateways), 0027 (Vendure) e 0028 (Mini App Bridge); segurança L1, L2 e L5; Vendure no ambiente local |
| 2      | 03/11 a 09/11 | Vendure no dev (server, worker, banco), canal por loja, sincronização Portfólio → Vendure; APISIX no ambiente local           |
| 3      | 10/11 a 16/11 | `apps.guidu.chat`: página do QR, Local e produto, carrinho por loja; login do turista por telefone                            |
| 4      | 17/11 a 23/11 | **Enviar pedido**; espaço Pedidos no Inbox (lista e detalhe); cartão do pedido na conversa                                    |
| 5      | 24/11 a 30/11 | Proposta versionada (plugin `guidu-proposals`), aceite do turista, Cliente Hub (minhas compras e histórico)                   |
| 6      | 01/12 a 07/12 | Link de pagamento (1 provedor por API + manual), confirmação de recebimento, telas de retirada e envio                        |
| 7      | 08/12 a 14/12 | Gateways no dev; backup do Synapse e do Vendure; teste de carga na faixa-alvo com folga de 2×; revisão de segurança           |
| 8      | 15/12 a 21/12 | Produção (F6c) com aprovação; cadastro das lojas do piloto, conteúdo e QR impressos; treino das equipes                       |
| 9      | 22/12 a 31/12 | Congelamento: só correções; plantão no réveillon                                                                              |

## 3. Cortes para caber no prazo

1. **Navegador primeiro:** sem esperar aprovação das lojas de aplicativo.
2. **Um provedor por API:** os outros pelo modo manual (colar link ou Pix).
3. **Chat:** se o Marcelo aprovar, "Conversar" abre o WhatsApp da loja, que já cai no Inbox, em vez de construir a conversa no navegador agora.
4. **BotCompara restrito:** só em teste interno; a cidade toda depois da temporada, com o custo medido.

## 4. Riscos

| Risco                                  | Impacto                               | Resposta                                                                   |
| -------------------------------------- | ------------------------------------- | -------------------------------------------------------------------------- |
| Produção ainda não existe (F6c)        | Nada vai ao ar                        | ADR de produção na semana 1; servidores contratados até a semana 6         |
| Lojas do piloto não definidas (N2, N7) | Conteúdo, QR e treino atrasam         | Definir até 07/11                                                          |
| Login por telefone: envio do código    | Custo e entrega do SMS ou do WhatsApp | Usar o número oficial da Meta com modelo de autenticação; SMS como reserva |
| Verificação do app da Meta             | WhatsApp das lojas não liga direto    | Marcelo já iniciou? Conferir na semana 1                                   |
| Vendure novo na equipe                 | Atraso nas semanas 2 a 6              | Começar pelo local na semana 1; escopo mínimo de plugin                    |
| Escopo crescendo                       | Não fica pronto                       | Este plano é o limite; o que não couber vai para depois da temporada       |

## 5. Decisões que destravam o plano

| #   | Pergunta                                                                 | Até   |
| --- | ------------------------------------------------------------------------ | ----- |
| N2  | Lojas do piloto                                                          | 07/11 |
| N7  | Quantas lojas em janeiro                                                 | 07/11 |
| N8  | Primeiro provedor de pagamento por API (Mercado Pago, Pagar.me ou Asaas) | 31/10 |
| N9  | Chat em janeiro: no navegador ou pelo WhatsApp da loja                   | 31/10 |
| —   | Aprovar as ADRs 0026, 0027 e 0028                                        | 31/10 |
