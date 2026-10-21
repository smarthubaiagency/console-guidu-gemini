# Inbox — contexto, etiquetas e avisos (IN4b) e notas privadas (IN5a)

- **Data:** 17/10/2026
- **Branch:** `claude/optimistic-lamport-rjehmm`. Migration `20261214090000_in4b_inbox_context.sql`.
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

## 4. Notas privadas (IN5a)

- **Data:** 21/10/2026
- **Branch:** `claude/in5a-notas`. Migration `20261222090000_in5a_inbox_notes.sql`.
- **Base:** [plano da dupla TR2 e IN5a](plano-tr2-in5a.md), seção IN5a, com as respostas do Marcelo de 21/10/2026 (só o atendente escreve; o autor edita e apaga, com auditoria; menção a colega fica para a SB1).

### 4.1 Como ficou

| Peça | Onde | O que faz |
| --- | --- | --- |
| Tabela | `inbox_notes` (migration) | `id`, `organization_id`, `workspace_id`, `room_id`, autor (`user_id`), texto (1 a 4.000 caracteres), `created_at`, `edited_at`, `deleted_at`; índice por (`room_id`, `created_at`). Apagar a sala ou o workspace apaga as notas (cascata e limpeza da WS1 em `src/core/privacy/maintenance.ts`). A nota apagada fica sem texto (o banco exige `body = ''`). |
| Regras no banco (RLS) | políticas de `inbox_notes` | Leem todos com nível no Inbox do workspace (Atendente e Dono ou Admin só leitura). Escreve quem tem o nível `reply`, em nome próprio e numa sala do workspace. Só o autor, ainda atendente, edita ou apaga uma nota viva; o web não tem `delete` (apagar é suave). |
| Nomes dos autores | `private.inbox_note_authors()` | Os perfis não são legíveis por outros membros; a função devolve o nome de quem escreveu nota no workspace, só para quem tem nível no Inbox. Quem saiu do workspace aparece como "Ex-membro da equipe". |
| Serviço | `src/modules/inbox/server/notes.ts` | `listNotes`, `createNote`, `updateNote`, `deleteNote`, com a mesma checagem das políticas e o nível de quem chama (pronto para virar rota de API). Auditoria `inbox.note.create`, `inbox.note.update` e `inbox.note.delete`: quem, quando e qual nota (com a sala em `target`), nunca o texto. Nada vai ao Synapse. |
| Ações | `src/modules/inbox/notes-actions.ts` | As quatro ações do servidor, que resolvem de novo o workspace, o módulo e o nível. |
| Caixa de mensagem | `composer-frame.tsx`, `composer.tsx` | Moldura `surface-inset` com `rounded-card` (card-in-card), abas **Responder \| Nota privada** (`Tabs` na variante `line`) e o ✦ à direita, desligado com "em breve" (recebe a prévia da tradução na TR3). Dentro, a caixa da IN4c. No modo nota, a moldura fica em `surface-note` e o campo em `surface-note-subtle` (âmbar, claro e escuro, em `globals.css`), o texto de ajuda é "Escreva uma nota para a equipe. O contato não vê." e o botão é **Adicionar nota**. Enter envia e Shift+Enter quebra a linha. Cada modo tem o seu rascunho; o da nota pertence à conversa. O modo volta para Responder ao trocar de conversa. A nota não depende do chat: funciona mesmo com o Matrix fora. |
| Novo › Nova nota | `inbox-header.tsx` | Ligada: abre a conversa aberta no modo Nota privada, com o cursor no campo. Desligada sem conversa aberta ou para quem só lê. |
| Na conversa | `conversation-view.tsx`, `note-bubble.tsx`, `client/timeline.ts` | As notas entram na linha do tempo pela data (`mergeTimeline`; no mesmo instante, a mensagem vem antes). Balão âmbar do lado da equipe, com cadeado, "Nota privada", o autor, a hora e "editada"; a apagada mostra "Nota apagada". O menu (Editar, Apagar) só aparece para o autor que ainda responde. **Editar é no próprio balão** (campo com Salvar e Cancelar; Enter salva, Esc cancela), para não misturar com o rascunho da caixa. Apagar pede confirmação no `SmartStatusBanner`. |
| Painel de contexto | `notes-section.tsx` | Seção **Notas** no acordeon da aba Contato, fechada de início, com a contagem e a lista (a mais nova em cima); clicar rola a conversa até a nota e a destaca por um instante (no celular, fecha a gaveta antes). |
| Atualização | `client/use-room-notes.ts` | A lista vem ao abrir a conversa, depois de cada ação e a cada 8 s (notas dos colegas). |
| Quem só lê | — | Vê as notas e a seção, sem menu; a caixa continua bloqueada como antes. |

### 4.2 Como testar

```sh
export LOCAL_DB_NAME=guidu_in5a E2E_PORT_OFFSET=200 REDIS_URL=redis://127.0.0.1:6390/2
LOCAL_DB_NAME=guidu_in5a AS_MIGRATIONS=1 bash scripts/local/rebuild-db.sh   # inclui tests/core/inbox-notes-rls.sql
pnpm vitest run src/modules/inbox/client/timeline.test.ts                   # mistura por data
pnpm vitest run --project integration tests/core/inbox-notes.test.ts        # com as URLs do banco local
```

O `e2e/inbox.spec.ts` cobre: alternar para Nota privada, adicionar (Enter), ver o balão e a seção Notas, editar no balão, "Novo › Nova nota", apagar com confirmação, voltar para Responder com o rascunho guardado, o consumidor sem nenhuma nota, e o Dono só leitura vendo as notas sem poder escrever.

### 4.3 Decisões adotadas por padrão

1. **Editar no balão**, não carregando a nota na caixa: a caixa continua só para escrever, e o rascunho de cada modo fica intacto.
2. **Nome do autor pela função `inbox_note_authors`**, não copiado na nota: troca de nome aparece em todas as notas; quem saiu do workspace vira "Ex-membro da equipe".
3. **Rascunho da nota por conversa**: trocar de conversa limpa o rascunho da nota (uma nota escrita para uma conversa não vai parar em outra). O rascunho da resposta segue como na IN4c.
4. **Nota apagada sem texto** no banco, não só escondida: o texto some de vez; a auditoria guarda quem e quando.
5. **Tokens novos:** `surface-note` (moldura), `surface-note-subtle` (campo e balão), `note-border` e `note-text`, em claro e escuro.
