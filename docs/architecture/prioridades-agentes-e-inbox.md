# Prioridades: Inbox, agentes e salas internas

- **Status:** Prioridades definidas pelo Marcelo em 19/10/2026. As etapas ainda não começaram.
- **Origem:** conversa de Marcelo com o Claude em 18 e 19/10/2026.
- **Documentos:** [agentes na Matrix e compra agêntica](agentes-na-matrix-e-compra-agentica.md), [sala de operação](sala-de-operacao.md), [tradução do chat](../modules/inbox/traducao.md).

## 1. Decisões de 19/10/2026

1. **Ordem:**
   - **P1:** ajustes no Inbox e os quatro GUIDS de fábrica;
   - **P2:** sala de operação;
   - **P3:** Matrix nas janelas do painel.
2. **Em espera:** o guidu.chat com modo loja e a compra agêntica. Do nosso lado, deixamos a "tomada" pronta: tudo o que der para prever e for barato fazer agora (seção 5).
3. **Quatro GUIDS de fábrica** (@ops, orquestrador, atendente, vendedor), com **limite inicial de 4 GUIDS** por workspace (cota `ai-agents.max`).
4. **Um idioma por workspace** para a equipe (`workspaces.default_locale`).
5. **Google Translate Basic** (v2, só com chave de API) como fallback da tradução.

## 2. P1: ajustes no Inbox e GUIDS de fábrica

| Etapa    | Entrega                                                                                                                                                                                                    | Depende de |
| -------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------- |
| **GF1**  | Modelos de fábrica dos quatro GUIDS (prompts, campos editáveis e travados) e criação automática no onboarding de cada workspace, desligados até haver chave e teste (A4b). Cota padrão `ai-agents.max` = 4 | —          |
| **TR1**  | Idioma do contato: detecção, gravação no contato e no espelho da sala, indicação no Inbox                                                                                                                  | —          |
| **TR2**  | Configuração da tradução no Inbox (interruptor, motor principal, fallback, credencial do Google Basic no cofre, glossário) e tradução das mensagens que chegam, com "ver original"                         | TR1        |
| **TR3**  | Resposta da equipe com prévia traduzida e fallback                                                                                                                                                         | TR2        |
| **IN5a** | Notas internas no Supabase por `room_id`, no painel de contexto (parte da IN5 já prevista)                                                                                                                 | —          |
| **SB1**  | Fundação das salas internas e sala de bastidor: tipo de sala no núcleo Matrix, regra do @, componente de thread e "Threads desta conversa" no Inbox, com o @ops e os GUIDS como membros                    | GF1        |
| **GF2**  | Orquestrador encaminhando ao atendente e ao vendedor (delegação estruturada, uma persona)                                                                                                                  | GF1        |
| **TR4**  | Áudio: transcrição e tradução                                                                                                                                                                              | TR2        |

**Pares sugeridos** (duas etapas por vez, `AGENTS.md`):

1. GF1 e TR1;
2. TR2 e IN5a;
3. TR3 e SB1;
4. GF2 e TR4.

TR1 a TR3 fecham a tradução de texto para o piloto de Búzios. Antes de começar, confirmar que a IN7 (WhatsApp da Meta) foi para a `main`, porque a TR1 detecta o idioma das mensagens do WhatsApp.

**Antes da SB1:** uma prova curta contra o Synapse de teste (o AM0 da [sala de operação](sala-de-operacao.md), seção 11), com o tipo de sala, as threads, as menções, as edições e os níveis de poder.

## 3. P2: sala de operação

Detalhada em [sala-de-operacao.md](sala-de-operacao.md). Reaproveita a fundação da SB1.

| Etapa   | Entrega                                                                                                                                                                       |
| ------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **AM1** | Sala de operação por workspace, com o @ops, os GUIDS, o @guidu e o @gmn, a regra do @, uma thread por pedido, streaming por edição e os avisos de transferência e lead quente |
| **AM3** | Delegação (@ops aos GUIDS, @guidu ao @gmn), propostas e aprovação na sala                                                                                                     |
| **AM5** | Avisos da Central de Eventos na sala (destino `matrix`)                                                                                                                       |

## 4. P3: Matrix nas janelas do painel

| Etapa   | Entrega                                                                                            |
| ------- | -------------------------------------------------------------------------------------------------- |
| **AM2** | A gaveta do cabeçalho como cliente da sala de operação                                             |
| **AM6** | "Perguntar à equipe" na gaveta de registro, `?thread=<id>` na URL e a conversa do @gmn como thread |

## 5. Em espera, com a tomada pronta

O que entra nas etapas acima, por ser barato e evitar retrabalho depois.

### 5.1 Para o guidu.chat com modo loja

| Tomada                                                                                                                                                                       | Onde entra     |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------- |
| Ações do Inbox (assumir, devolver, resolver, nota, tradução) num serviço do servidor, chamado pelas telas e pronto para virar rota de API, com a mesma checagem de permissão | TR3, IN5a, SB1 |
| Traduções e notas por `event_id` e `room_id` no Supabase, legíveis por qualquer cliente pela API                                                                             | TR2, IN5a      |
| Componente de thread sem dependência do `WorkbenchLayout`, para servir também num app                                                                                        | SB1            |
| Contas de atendente separadas das de consumidor (`u_…`), como já é hoje                                                                                                      | —              |

### 5.2 Para a compra agêntica

| Tomada                                                                                                                                                                                                             | Onde entra |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------- |
| O GUIDS vendedor já nasce de fábrica, com o prompt dizendo que cotação e carrinho ainda não existem e passando para a equipe                                                                                       | GF1        |
| Encaminhamento do orquestrador ao vendedor já com contrato estruturado (Zod e versão)                                                                                                                              | GF2        |
| Nomes de eventos reservados no catálogo (`chat.guidu.quote_request`, `chat.guidu.quote`, `chat.guidu.cart`) e tipos da Central de Eventos reservados (cotação, carrinho, pedido, pagamento), sem destino até a CA1 | SB1        |
| Tipo de sala `chat.guidu.deal` reservado no núcleo Matrix, recusado até a CA4                                                                                                                                      | SB1        |
| Idioma do contato gravado, que o botmercado vai usar                                                                                                                                                               | TR1        |
| Portfólio no formato UCP com `continue_url` configurável                                                                                                                                                           | Já existe  |

Pagamento, carrinho e pedido não começam antes da decisão jurídica e comercial da CA0.

### 5.3 Para as salas internas e as janelas

| Tomada                                                                                                                                           | Onde entra |
| ------------------------------------------------------------------------------------------------------------------------------------------------ | ---------- |
| Enum de tipos de sala com `support`, `backstage`, `ops` e `deal` desde o início, e só `support` nas visões do Inbox                              | SB1        |
| Regra do @ num roteador único (menção → turno), usado pelo bastidor e depois pela sala de operação                                               | SB1        |
| Eventos `chat.guidu.task`, `chat.guidu.proposal` e `chat.guidu.decision` com schema e versão num lugar só, com propostas e decisões em nível 100 | SB1        |
| Conversa do agente por thread em `ai_conversations` (id da raiz da thread)                                                                       | SB1        |

## 6. Respostas que fecharam perguntas

| Pergunta                                      | Resposta                                                        |
| --------------------------------------------- | --------------------------------------------------------------- |
| Os GUIDS de fábrica contam no limite?         | Sim. Limite inicial de 4 GUIDS por workspace                    |
| Idioma da equipe por workspace ou por pessoa? | Por workspace                                                   |
| Google Translate Basic ou Advanced?           | Basic (v2, chave de API)                                        |
| Quem entra na sala de bastidor?               | Todos os GUIDS do workspace, além da equipe com acesso ao Inbox |
| Idiomas do piloto                             | Português, inglês e espanhol                                    |
| Limite de tradução                            | Nenhum limite nosso: vale o limite da chave do cliente          |

## 7. Perguntas que continuam abertas

1. **Na P1:** nenhuma; as três foram respondidas em 19/10/2026 (seção 6).
2. **Na P2:** editor e leitor entram na sala de operação? Histórico desde a entrada ou desde a criação? GUIDS pausado continua na sala? Quanto o @ops lê das conversas dos GUIDS?
3. **Em espera:** as perguntas da compra agêntica (seção 11 do [documento principal](agentes-na-matrix-e-compra-agentica.md)).
