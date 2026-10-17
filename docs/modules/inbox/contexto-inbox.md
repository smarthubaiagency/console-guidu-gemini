# Inbox — contexto, etiquetas e avisos (IN4b)

- **Data:** 17/10/2026
- **Branch:** `claude/optimistic-lamport-rjehmm`. Migration `20261212090000_in4b_inbox_context.sql`.
- **Base:** [plano do par IN4b + IN6](plano-in4b-in6.md), com todas as sugestões da seção 5 aceitas pelo Marcelo em 17/10/2026; [janela do Inbox](janela-inbox.md) (IN4a).

## 1. O que entrou

| Peça | Onde | O que faz |
| --- | --- | --- |
| Marcas de mensagem | migration (seção 1), `src/core/matrix/events.ts` | O núcleo registra **quando** chegou mensagem e **de quem** (consumidor, equipe ou agente), nunca o texto: `matrix_events` aceita `m.room.message` só com o tipo da mensagem (o banco recusa `body`), e `matrix_rooms` guarda `last_consumer_message_at`, `last_team_message_at` e `last_agent_message_at`. Base do aviso "sem resposta" e do turno do GUIDS (IN6). |
| Etiquetas | `inbox_labels`, `inbox_room_labels`, `src/modules/inbox/server/labels.ts` | Catálogo por workspace (nome único sem diferenciar maiúsculas, 5 cores, até 50), mantido por quem gerencia o Inbox (Dono e Admin). Quem responde põe e tira etiquetas. Nada vai para a sala. |
| Contato do CRM | `inbox_conversations`, `src/modules/inbox/server/{room-opened,jobs,contacts}.ts` | Sala aberta → linha da conversa e job `inbox.link-contact`, que cria o contato com o nome do perfil pelo serviço público do CRM (`createContact`), em nome de um dono ou admin do workspace. Cota cheia → `quota`; CRM desligado → `none`; o painel diz o motivo. Quem lê o CRM (Dono, Admin, Editor) busca e liga a conversa a outro contato. |
| Cartão do contato | `getContactCard` no CRM | Nome, telefone, e-mail e empresa para quem lê o CRM **ou** o Inbox: o Atendente vê com quem fala sem ganhar acesso ao CRM. |
| Ganchos do núcleo | `src/core/matrix/room-hooks.ts` | `runRoomOpened` (fim de `createConversationRoom`) e `runRoomAssigned` (atribuição espelhada do estado da sala), chamados como app_worker na transação do núcleo. |
| Quem atribuiu | `setConversationState(..., by)` | O estado gravado pelo console leva `by` (quem pediu). Assumir sozinho não gera aviso; atribuir a outra pessoa, sim. |
| Avisos | catálogo da Central de Eventos, `src/modules/inbox/server/notices.ts` | `inbox.conversation.new` (para quem responde), `inbox.conversation.assigned` (para o responsável) e `inbox.conversation.unanswered` (job `inbox.unanswered` a cada 5 minutos: última mensagem do consumidor há 15 minutos ou mais, sem resposta da equipe nem do agente, no último dia; para o responsável ou, sem ele, para quem responde; uma vez por mensagem). Um evento por pessoa (rota `subject_person`), no sino, com link para a conversa. Textos nos 3 idiomas (sino, nomes, modelo de WhatsApp). |
| Não lidas | `src/modules/inbox/client/room-data.ts` | Contagem de cada sala pelos recibos de leitura do Matrix: a do Synapse (por regras de push) ou, se maior, as mensagens de outros na linha do tempo carregada depois do recibo da pessoa. Na lista, um número por conversa; na aba, "(N) Inbox". Nada vai para o banco. |
| Tela | lista e painel de contexto | Etiquetas em cada conversa, filtro por etiqueta, cartão do contato e cartão das etiquetas (com criar e apagar para quem gerencia). |
| Limpeza da WS1 | `src/core/privacy/maintenance.ts` | Etiquetas e ligações saem com o workspace apagado de vez. |

## 2. Como testar

```sh
export LOCAL_DB_NAME=guidu_in4b E2E_PORT_OFFSET=100 REDIS_URL=redis://127.0.0.1:6390/1
LOCAL_DB_NAME=guidu_in4b AS_MIGRATIONS=1 bash scripts/local/rebuild-db.sh   # inclui tests/core/inbox-context-rls.sql
bash scripts/local/synapse.sh setup && bash scripts/local/synapse.sh start
eval "$(bash scripts/local/synapse.sh env)"
pnpm vitest run --project integration tests/core/matrix.test.ts   # caso "IN4b: a new room gets its CRM contact..."
```

O `e2e/inbox.spec.ts` (job `e2e-inbox` do CI) cobre o contato criado no CRM, a etiqueta criada pelo dono e aplicada pela Atendente, o filtro por etiqueta e as não lidas na lista e na aba.

## 3. Decisões adotadas por padrão

1. **Avisos um por pessoa** (rota `subject_person`), emitidos pelo worker, em vez de uma rota nova "atendentes do Inbox" nas funções de destinatários da H1 e da H2. Assim nada da Central de Eventos mudou; na tela Eventos, um aviso de conversa nova aparece uma vez por atendente.
2. **Só sino nos avisos do Inbox.** O e-mail precisa de modelo próprio (CF3b) para cada tipo; fica para uma etapa curta depois, se o Marcelo quiser. O WhatsApp por pessoa da H2 já funciona com os textos novos, se a pessoa ligar.
3. **Quem cria o contato** é o primeiro dono (ou, sem ele, um admin) ativo do workspace, porque o CRM exige permissão de escrita; o registro de auditoria do contato fica em nome dessa pessoa.
4. **O Atendente vê o cartão do contato, mas não busca nem liga a outro contato:** isso exige ler o CRM, que a função Atendente não tem (AT1).
5. **Sem renomear etiqueta na tela** nesta etapa: quem gerencia cria e apaga (o serviço já aceita renomear).
6. **"Sem resposta" olha só o último dia**, para que a primeira execução não avise conversas antigas.
