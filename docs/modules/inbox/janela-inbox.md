# Inbox — janela e conversa (IN4a)

- **Data:** 17/10/2026
- **Branch:** `claude/optimistic-lamport-rjehmm`. Migration `20261130090000_in4a_inbox_attendants.sql`.
- **Base:** [plano da IN4](plano-in4.md) com as respostas do Marcelo de 17/10/2026, [ADR 0023](../../adr/0023-chat-interno-como-cliente-matrix.md), revisão de 16/10/2026 da [ADR 0014](../../adr/0014-shell-padrao-sidebar-08.md) e o [núcleo Matrix](nucleo-matrix.md) (IN3).

Sem as variáveis `MATRIX_*` o módulo `inbox` fica desligado (portão técnico), como o núcleo.

## 1. O que entrou

| Peça                            | Onde                                                                                                                                        | O que faz                                                                                                                                                                                                                                                                                                                                                                                                                            |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Marca de atendente              | migration `20261130090000`, `inbox_attendants`                                                                                              | Uma linha por pessoa marcada no workspace. A função Atendente sempre responde, sem linha. Só Dono, Admin e Editor podem ser marcados; só quem gerencia o Inbox (Dono e Admin) marca e desmarca (política e serviço).                                                                                                                                                                                                                 |
| Nível de cada pessoa            | `private.matrix_access` e funções `matrix_user_access`, `matrix_workspace_access`, `matrix_my_access`, `inbox_my_level`, `inbox_my_manages` | `reply` (Atendente ou marcado), `read` (Dono ou Admin sem marca) ou nada (Editor sem marca, Viewer). As salas, os membros e o endereço são lidos por quem tem nível.                                                                                                                                                                                                                                                                 |
| Poderes na sala                 | `src/core/matrix/synapse.ts`                                                                                                                | Estado da conversa, convite e expulsão em 50 (núcleo e, na IN6, o agente); enviar em 10 (quem responde e o consumidor); 0 para quem só lê. `matrix_room_members.power` acompanha o poder dado, e o `matrix.sync-account` ajusta o poder quando a marca muda, sem tirar a pessoa da sala.                                                                                                                                             |
| Mudança de status e responsável | `src/core/matrix/conversation.ts`, ação `changeConversationAction`                                                                          | O atendente não tem poder sobre o estado na sala: o console confere e grava como núcleo. Assumir: quem responde, se a conversa está sem ninguém ou é dele (quem gerencia e responde pode tomar de alguém). Resolver e reabrir: quem responde. Atribuir (ou tirar o responsável): quem gerencia, para quem responde naquela sala.                                                                                                     |
| Endereço da loja                | `matrix_workspace_addresses`, `src/core/matrix/addresses.ts`                                                                                | Cada workspace ativo ganha `@_guidu_w_<16 base32>:<server>`, com o nome do workspace, registrado pelo `matrix.sync-workspace` (a página do Inbox pede o job quando falta). O consumidor que convida o endereço numa sala dele tem a sala recusada (regra da IN3) e ganha uma sala nova do núcleo, ou a conversa aberta que já tinha. O nome dele fica em `matrix_rooms.consumer_name` para a busca.                                  |
| Eventos de sala desconhecida    | `src/core/matrix/events.ts`                                                                                                                 | Só a sala criada pelo núcleo espera a linha (até 5 min); os eventos da sala de um consumidor são ignorados na hora.                                                                                                                                                                                                                                                                                                                  |
| Cota de atendentes              | `src/modules/inbox/quotas.ts`                                                                                                               | `inbox.attendants`, 5 por workspace quando o plano não define. Conta quem responde mais os convites pendentes como Atendente. Marcar, convidar como Atendente e trocar alguém para Atendente acima do limite é recusado; quem já está continua. Aparece em Consumo & Limites.                                                                                                                                                        |
| Módulo                          | `src/modules/inbox/manifest.ts`                                                                                                             | Chave `inbox`, rota `inbox`, entrada no menu com `inbox.view`. As permissões são do núcleo. O workspace liga o módulo em Módulos, como os outros.                                                                                                                                                                                                                                                                                    |
| Janela                          | `src/app/app/[workspaceSlug]/(fullscreen)/inbox/page.tsx`, `src/modules/inbox/components/`                                                  | Barra estreita do `sidebar-09` (Minhas, Não atribuídas, Todas, Resolvidas e o Dashboard embaixo) e três colunas redimensionáveis: lista, conversa e contexto. Ctrl/⌘+B recolhe a lista; o estado fica no cookie `inbox_sidebar_state`. No celular a lista ocupa a tela, a conversa empilha com "Voltar" e o contexto abre em `Sheet`. Retorno das ações pelo `SmartStatusBanner`.                                                    |
| Cliente Matrix                  | `src/modules/inbox/client/`                                                                                                                 | `matrix-js-sdk` 43.0.0. Login com o JWT de 60 s da IN3 pedindo refresh token; a sessão fica no `localStorage` e só há login novo quando ela morre (a saída do console apaga os dispositivos). Sliding Sync: lista de até 100 salas e a sala aberta como assinatura (50 mensagens e o estado completo). Digitando pela extensão do Sliding Sync; presença do consumidor consultada a cada 30 s; recibo de leitura da última mensagem. |
| Lista e busca                   | `src/modules/inbox/server/conversations.ts`                                                                                                 | Visões e busca pelo nome saem do espelho em `matrix_rooms` (até 100 por visão, com as contagens); a última mensagem e a ordem vêm do cliente Matrix. A lista atualiza a cada 8 s e depois de cada ação.                                                                                                                                                                                                                              |
| Quem só lê                      | página, conversa e contexto                                                                                                                 | Dono e Admin sem marca abrem o Inbox em "Todas", leem e atribuem; não veem a caixa de mensagem e a sala também não deixa enviar (poder 0).                                                                                                                                                                                                                                                                                           |
| Equipe                          | `settings/team`                                                                                                                             | Coluna "Inbox" com a chave de atendente por membro, para quem gerencia o Inbox. Atendente aparece sempre ligado e travado.                                                                                                                                                                                                                                                                                                           |
| Menu e dashboard                | `src/core/module-runtime/loaders.ts` e `navigation.ts`, dashboard                                                                           | `inbox.view` só vale com nível e módulo ligado: Editor sem marca não vê a entrada. O menu do Atendente ganha o Inbox; o dashboard dele, o botão "Abrir o Inbox".                                                                                                                                                                                                                                                                     |
| Componentes novos do shadcn     | `src/components/ui/resizable.tsx`, `scroll-area.tsx`                                                                                        | Copiados do registro oficial (v4). `SidebarProvider` ganhou a prop `cookieName` para o cookie próprio do Inbox.                                                                                                                                                                                                                                                                                                                      |

## 2. Como testar

Integração do núcleo (com o Synapse local apontando o AS para `8009+offset`), como na IN3:

```sh
export LOCAL_DB_NAME=guidu_in4 E2E_PORT_OFFSET=100 REDIS_URL=redis://127.0.0.1:6390/1
LOCAL_DB_NAME=guidu_in4 AS_MIGRATIONS=1 bash scripts/local/rebuild-db.sh   # inclui tests/core/inbox-attendants-rls.sql
bash scripts/local/synapse.sh setup && bash scripts/local/synapse.sh start
eval "$(bash scripts/local/synapse.sh env)"
pnpm vitest run --project integration tests/core/matrix.test.ts
```

E2E da janela (o AS aponta para o app do rig, `3000+offset`):

```sh
bash scripts/local/synapse.sh stop
SYNAPSE_APP_URL=http://127.0.0.1:3100 bash scripts/local/synapse.sh setup
bash scripts/local/synapse.sh start
MATRIX_E2E_ENV_FILE=/var/tmp/guidu-synapse-guidu_in4/setup/console.env \
  pnpm exec playwright test -c playwright.local.config.ts e2e/inbox.spec.ts
```

Sem `MATRIX_E2E_ENV_FILE` o `e2e/inbox.spec.ts` é pulado. No CI, o job `e2e` tem uma etapa própria: sobe o Postgres do runner, um Synapse local apontando para o app e roda só essa suíte.

Testar à mão com o Element (Synapse de teste do EasyPanel ou local): ligue o módulo Inbox no workspace, abra o Inbox e copie o endereço da loja que aparece na lista vazia; no Element, crie uma conversa direta com esse endereço. A sala do Element é recusada e chega um convite para a sala do atendimento.

## 3. Decisões e pendências

Adotadas por padrão nesta etapa (o Marcelo confirma no PR):

1. **Poderes na sala.** Os atendentes caíram de 50 para 10: só mandam mensagem. Status e responsável passam pelo console, que grava como núcleo. Assim a regra "só quem gerencia atribui" vale também contra um cliente Matrix qualquer. Salas criadas antes desta etapa (só de teste) ficam com os poderes antigos.
2. **"Todas"** mostra as conversas não resolvidas; as resolvidas ficam só em "Resolvidas".
3. **Quem só lê começa em "Todas"**; quem responde, em "Minhas".
4. **Reabrir** volta a conversa para "aberta", com o mesmo responsável (ou quem reabriu, se não havia).
5. **Atribuir para "Ninguém"** devolve a conversa para "pendente".
6. **Consumidor que chama de novo** a loja com uma conversa aberta ou pendente volta para a mesma sala; resolvida, abre outra.
7. **Membros de suporte** não podem ser marcados (como na IN3, não têm conta).
8. **Timeline e caixa de mensagem** feitas com os componentes do shadcn que já temos (`ScrollArea`, `Textarea`, `Button`); o `chatbot-template` não foi copiado nesta etapa porque o registro do shadcn está fora do alcance da sessão. Fica para a IN4b, se o Marcelo quiser o visual dele.
9. **Presença** do consumidor por consulta a cada 30 s: o Sliding Sync não tem extensão de presença.

Ficam para a IN4b: etiquetas, não lidas (o recibo de leitura já é enviado), contato do CRM, avisos na Central de Eventos e o número de não lidas no título da aba.
