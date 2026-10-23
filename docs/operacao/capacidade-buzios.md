# Capacidade para o pico de Búzios

- **Status:** estimativa do gerente de projeto, 23/10/2026, a confirmar no teste de carga (GW6 e prova técnica do app).
- **Base:** números de visitantes informados pelo Marcelo em 23/10/2026; capacidade do Synapse em [guidu-chat-app.md](../architecture/guidu-chat-app.md), seção 8.1.

## 1. Os números da cidade (janeiro)

| Dado                                                                      | Valor                                                                                    |
| ------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| Moradores                                                                 | ~42 mil                                                                                  |
| Pessoas circulando ao mesmo tempo no pico (réveillon e começo de janeiro) | 350 mil a 470 mil                                                                        |
| Passageiros de cruzeiro em janeiro                                        | 76 mil a 100 mil, concentrados nos dias de navio (milhares desembarcando na mesma manhã) |

## 2. Dos visitantes aos usuários conectados

Ninguém usa um app novo na proporção da cidade inteira. A conta tem três filtros: quantos visitantes usam o guidu.chat (adoção), quantos estão com ele aberto no mesmo minuto (simultaneidade) e quantas lojas participam.

| Cenário                   | Adoção (sobre 470 mil)                                 | Usuários no dia | Abertos ao mesmo tempo (10 a 20%) | Mensagens por segundo no pico (1 por minuto por pessoa ativa) |
| ------------------------- | ------------------------------------------------------ | --------------- | --------------------------------- | ------------------------------------------------------------- |
| **Piloto** (poucas lojas) | Limitada pelas lojas: algumas centenas a 2 mil pessoas | até ~2.000      | 200 a 400                         | ~5                                                            |
| **Crescimento**           | 1%                                                     | ~4.700          | 470 a 940                         | ~15                                                           |
| **Cidade aderindo**       | 5%                                                     | ~23.500         | 2.350 a 4.700                     | ~80                                                           |
| **Ambicioso**             | 15%                                                    | ~70.500         | 7.000 a 14.000                    | ~235                                                          |

Os percentuais são hipóteses de planejamento, não medições. **Dias de navio** criam rajadas: milhares de pessoas lendo QR na mesma hora. As páginas públicas em cache (Cloudflare e APISIX) absorvem isso; o que pesa é a conversa.

## 3. O que cada cenário exige

| Peça                  | Piloto                       | Crescimento (1%)              | Cidade (5%)                         | Ambicioso (15%)                 |
| --------------------- | ---------------------------- | ----------------------------- | ----------------------------------- | ------------------------------- |
| Synapse, caminho B    | Como está                    | Como está                     | Alguns workers                      | Workers e Redis entre eles      |
| Synapse, caminho A    | Um processo bem dimensionado | Workers de sync               | Muitos workers, banco próprio forte | Synapse Pro ou servidor em Rust |
| GUIDU (web)           | 2 réplicas                   | 2 a 3                         | 4 a 6, serviço `apps` separado      | 8 ou mais, servidores dedicados |
| Worker (turnos de IA) | 1 a 2                        | 2 a 3                         | 4 a 8                               | Fila dimensionada por medição   |
| Postgres (Supabase)   | Plano atual                  | Compute maior                 | Compute maior e pool medido         | Réplica de leitura              |
| **IA**                | Folgado                      | Atenção à chave da plataforma | **Gargalo provável**                | **Gargalo certo**               |

## 4. O gargalo mais provável é a IA, não o Synapse

- Os GUIDS de cada loja usam a **chave da loja**, então a carga se divide entre muitas contas.
- O **BotCompara e o BotShop usam a nossa chave**. Todos os turistas que compararem lojas passam por ela. No cenário de 5%, são dezenas de conversas por segundo numa conta só: os limites do provedor e o custo viram o problema principal.
- Medidas: plano alto no provedor, mais de um provedor com troca automática (o agentgateway faz isso), modelo rápido e barato para o BotCompara, respostas prontas para perguntas repetidas (horário, endereço), teto de gasto por dia.

## 5. Recomendação para janeiro de 2027

Faltam cerca de 10 semanas. App nativo, publicação nas lojas da Apple e do Google, Vendure e pagamento **não ficam prontos com segurança até lá**. Para aproveitar a temporada:

1. **Canal do turista em janeiro: WhatsApp** (já funciona: Meta, Inbox, GUIDS, tradução) **e mini-apps no navegador** (`apps.guidu.chat`, QR abre a página sem instalar nada).
2. **Venda em janeiro: solicitação confirmada à mão** (reserva, orçamento), sem pagamento pela plataforma.
3. **App guidu.chat, Vendure e pagamento** depois da temporada, com os números reais de janeiro para dimensionar.
4. **Antes de 15/12:** segurança (L1, L2, L5), gateways no ar, dois servidores, backup do Synapse e teste de carga com o cenário "Crescimento" e folga de 2 vezes.

Se isso for aceito, a meta de capacidade para janeiro é o cenário **Crescimento com folga de 2×**: cerca de 2 mil pessoas conectadas e 30 mensagens por segundo, com o WhatsApp como canal principal.
