# Capacidade para o pico de Búzios

- **Status:** estimativa do gerente de projeto, 23/10/2026, a confirmar no teste de carga (GW6 e prova técnica do app).
- **Referência de dimensionamento:** **número de lojas conectadas** (100, 200, 300, 500, 1.000 e 2.000), definida pelo Marcelo em 23/10/2026.
- **Base:** números de visitantes informados pelo Marcelo; capacidade do Synapse em [guidu-chat-app.md](../architecture/guidu-chat-app.md), seção 8.1.

## 1. Contexto da cidade (janeiro)

| Dado                                                                      | Valor                                            |
| ------------------------------------------------------------------------- | ------------------------------------------------ |
| Moradores                                                                 | ~42 mil                                          |
| Pessoas circulando ao mesmo tempo no pico (réveillon e começo de janeiro) | 350 mil a 470 mil                                |
| Passageiros de cruzeiro em janeiro                                        | 76 mil a 100 mil, concentrados nos dias de navio |

A cidade tem gente de sobra para qualquer número de lojas abaixo. Quem limita a carga é **quantas lojas estão conectadas** e quanto cada uma conversa.

## 2. Premissas por loja, num dia de pico

| Premissa                                             | Valor usado        | Observação                                             |
| ---------------------------------------------------- | ------------------ | ------------------------------------------------------ |
| Conversas novas por loja por dia                     | 30                 | Restaurante e pousada mais; serviço sob consulta menos |
| Mensagens por conversa                               | 12                 | Metade do turista, metade da loja ou do agente         |
| Parte do dia na hora de pico                         | 15%                | Rajada de até 3× em dia de navio                       |
| Turistas com conversa ativa ao mesmo tempo, por loja | 5                  | No app ou no WhatsApp                                  |
| Atendentes com o Inbox aberto, por loja              | 2                  | Cada atendente é um cliente Matrix (ADR 0023)          |
| Mensagens respondidas pelo GUIDS da loja             | 60% das do turista | Chave da loja                                          |
| Conversas que passam pelo BotCompara                 | 20%, com 8 turnos  | Chave da plataforma                                    |
| Tokens por turno de IA                               | ~4 mil             | Prompt, contexto e resposta                            |

Todas as contas abaixo crescem em linha reta com essas premissas: se as lojas conversarem o dobro, os números dobram.

## 3. Carga por número de lojas

| Lojas     | Conversas por dia | Mensagens na hora de pico | Mensagens por segundo (média / rajada) | Turistas ativos ao mesmo tempo | Atendentes conectados ao Synapse | Turnos do GUIDS por hora | Turnos do BotCompara por hora (nossa chave) | Tokens por dia na nossa chave |
| --------- | ----------------- | ------------------------- | -------------------------------------- | ------------------------------ | -------------------------------- | ------------------------ | ------------------------------------------- | ----------------------------- |
| **100**   | 3.000             | 5.400                     | 1,5 / 4,5                              | 500                            | 200                              | 1.600                    | 720                                         | ~19 milhões                   |
| **200**   | 6.000             | 10.800                    | 3 / 9                                  | 1.000                          | 400                              | 3.200                    | 1.440                                       | ~38 milhões                   |
| **300**   | 9.000             | 16.200                    | 4,5 / 13,5                             | 1.500                          | 600                              | 4.900                    | 2.160                                       | ~58 milhões                   |
| **500**   | 15.000            | 27.000                    | 7,5 / 22,5                             | 2.500                          | 1.000                            | 8.100                    | 3.600                                       | ~96 milhões                   |
| **1.000** | 30.000            | 54.000                    | 15 / 45                                | 5.000                          | 2.000                            | 16.200                   | 7.200                                       | ~192 milhões                  |
| **2.000** | 60.000            | 108.000                   | 30 / 90                                | 10.000                         | 4.000                            | 32.400                   | 14.400                                      | ~384 milhões                  |

Os turnos do GUIDS usam a chave de cada loja: cerca de 16 por hora por loja no pico, folgado para qualquer conta. Os do BotCompara se somam todos na **nossa** chave.

## 4. Infraestrutura por faixa

| Lojas     | Synapse                                                     | GUIDU web                      | Worker (IA e avisos) | Banco (Supabase)                    | Gateways  | Servidores            |
| --------- | ----------------------------------------------------------- | ------------------------------ | -------------------- | ----------------------------------- | --------- | --------------------- |
| **100**   | Um processo                                                 | 2 réplicas                     | 2                    | Plano atual                         | 1 de cada | 2                     |
| **200**   | Um processo, observado                                      | 2 réplicas                     | 2 a 3                | Plano atual, pool medido            | 1 de cada | 2                     |
| **300**   | Workers de sync (os atendentes já pesam)                    | 3 réplicas                     | 3 a 4                | Compute maior                       | 2 de cada | 2 a 3                 |
| **500**   | 2 workers de sync, 1 de leitura, banco próprio dimensionado | 3 a 4, serviço `apps` separado | 4 a 6                | Compute maior                       | 2 de cada | 3                     |
| **1.000** | Vários workers, Redis entre eles, servidor dedicado         | 4 a 6 em 2 servidores          | 6 a 8                | Compute grande, pool medido         | 2 de cada | 4 a 5                 |
| **2.000** | Muitos workers; avaliar Synapse Pro ou servidor em Rust     | 8 ou mais                      | 10 ou mais           | Compute grande e réplica de leitura | 3 de cada | 6 ou mais, por função |

**Caminho A ou B no app (ver [guidu-chat-app.md](../architecture/guidu-chat-app.md)):** os atendentes ficam sempre no Synapse. No caminho A, os turistas também (até 10 mil conexões a mais em 2.000 lojas). No caminho B, essas conexões ficam no GUIDU, que escala por réplicas. A partir de 500 lojas, isso pesa a favor do B.

## 5. O gargalo mais provável é a IA da plataforma

- O GUIDS de cada loja usa a chave da loja, então a carga se divide.
- O **BotCompara e o BotShop usam a nossa chave**. Em 1.000 lojas, são cerca de 7 mil turnos por hora no pico e perto de 200 milhões de tokens por dia numa conta só. Os limites do provedor e o custo viram o problema principal.
- Medidas: plano alto no provedor; mais de um provedor com troca automática (agentgateway); modelo rápido e barato para o BotCompara; respostas prontas para perguntas repetidas (horário, endereço); teto de gasto por dia; o custo por turno calculado com o modelo escolhido antes de abrir o BotCompara para a cidade.

## 6. Recomendação para janeiro de 2027

Faltam cerca de 10 semanas. App nativo, publicação nas lojas da Apple e do Google, Vendure e pagamento **não ficam prontos com segurança até lá**. Para aproveitar a temporada:

1. **Canal do turista em janeiro: WhatsApp** (já funciona: Meta, Inbox, GUIDS, tradução) **e mini-apps no navegador** (`apps.guidu.chat`, QR abre a página sem instalar nada).
2. **Venda em janeiro: solicitação confirmada à mão** (reserva, orçamento), sem pagamento pela plataforma.
3. **App guidu.chat, Vendure e pagamento** depois da temporada, dimensionados com os números reais.
4. **Antes de 15/12:** segurança (L1, L2, L5), gateways no ar, servidores da faixa escolhida, backup do Synapse e teste de carga com **folga de 2×** sobre a faixa-alvo.

A faixa-alvo de janeiro depende de quantas lojas estarão conectadas (pergunta N7 do [painel](../gestao/painel.md)).
