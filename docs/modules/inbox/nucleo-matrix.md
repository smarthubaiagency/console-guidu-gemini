# Inbox — núcleo Matrix (IN3)

- **Data:** 17/10/2026
- **Branch:** `claude/in3-nucleo-matrix`. Migration `20261128090000_in3_matrix_core.sql`.
- **Base:** [ADR 0023](../../adr/0023-chat-interno-como-cliente-matrix.md), [plano](plano.md), conclusão da [prova de conceito](prova-de-conceito.md) e o plano do par IN3 + WS1 de 17/10/2026 (presença ligada, "digitando" visível).

Só núcleo, sem tela (a janela é a IN4). Sem as variáveis `MATRIX_*` tudo fica desligado: as rotas respondem 404, nenhum job é enfileirado e a CSP não muda.

## 1. O que entrou

| Peça                                    | Onde                                    | O que faz                                                                                                                                                                                                                                                                                    |
| --------------------------------------- | --------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Configuração                            | `src/core/matrix/config.ts`             | Lê as variáveis que o `scripts/matrix/setup.ts` gera. O `server_name` vem sempre do ambiente. A chave do JWT aceita PEM em base64 numa linha ou o PEM direto.                                                                                                                                |
| Tabelas                                 | migration `20261128090000`              | `matrix_accounts` (uma conta por pessoa, localpart opaco `u_` + 24 caracteres aleatórios), `matrix_rooms` (workspace, `room_id`, origem, situação da sala, `status` e `assignee` espelhados), `matrix_room_members`, `matrix_as_transactions` e `matrix_events` (chave única no `event_id`). |
| Rota do Application Service             | `/api/matrix/as/[...path]`              | `PUT transactions`, `POST ping`, `GET users` e `GET rooms` (sempre 404). `hs_token` comparado em tempo constante; grava e responde `{}` na hora; um job processa.                                                                                                                            |
| Processamento                           | `src/core/matrix/events.ts`             | Espelha o `chat.guidu.conversation` (o mais novo vence), acompanha entradas e saídas e recusa a sala criada pelo consumidor (o usuário do namespace sai dela). Mensagens não são gravadas.                                                                                                   |
| Salas                                   | `src/core/matrix/rooms.ts`              | Cria na ordem da prova: linha, sala sem o consumidor, `room_id` gravado, atendentes, convite. Sala v12, núcleo como criador fora de `users`, `guest_access: forbidden`, criptografia e power levels em 100, estado da conversa em 50.                                                        |
| Contas dos atendentes                   | `src/core/matrix/accounts.ts`           | Quem tem `inbox.view` num workspace ativo ganha conta e entra nas salas; quem perde sai das salas daquele workspace; sem nenhum workspace, a conta é desativada.                                                                                                                             |
| Sessão do navegador                     | `POST /api/matrix/session`              | JWT RS256 de 60 s, `sub` só de localpart `u_`, com `name`. Só para quem tem `inbox.view` num workspace ativo; garante a conta antes. Mesma origem.                                                                                                                                           |
| Saída do console                        | `/auth/signout`                         | Enfileira a remoção dos dispositivos Matrix da pessoa (API admin). Nunca atrasa a saída.                                                                                                                                                                                                     |
| CSP                                     | `src/core/security/headers.ts`, `proxy` | Origem do homeserver no `connect-src` quando configurado (só `https` em produção).                                                                                                                                                                                                           |
| Ciclo de vida do workspace (para a WS1) | `src/core/matrix/lifecycle.ts`          | `matrixWorkspaceLifecycle`: `onDeletionScheduled`, `onDeletionCanceled` e `purgeExternal`. Ver a seção 3.                                                                                                                                                                                    |
| Permissões                              | `src/core/permissions/catalog.ts`       | `inbox.view`, `inbox.reply` e `inbox.manage`, iguais às da AT1 (dono, admin e editor; o Atendente entra com a AT1).                                                                                                                                                                          |

A API admin do Synapse é chamada com o `as_token` (o remetente do AS é admin).

## 2. Jobs (plataforma, como `app_worker`)

Todos reconciliam o Synapse com o banco, então rodar duas vezes não muda nada. O web e o worker pedem os jobs pela função `private.matrix_enqueue`, que mantém uma execução pendente por tipo e payload.

| Job                     | Quando                                                                                                                                                                        |
| ----------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `matrix.process-events` | Cada transação nova do AS. Eventos de sala ainda não gravada esperam até 5 min.                                                                                               |
| `matrix.sync-account`   | Membro adicionado, removido ou com função trocada (workspace e empresa), convite aceito, sessão.                                                                              |
| `matrix.sync-workspace` | Workspace entrou em exclusão ou a exclusão foi cancelada (pela WS1).                                                                                                          |
| `matrix.logout-devices` | Saída do console.                                                                                                                                                             |
| `matrix.cleanup`        | De hora em hora: linhas presas em `creating`, salas do núcleo sem linha há mais de 1 h, retenção do registro do AS (7 dias as transações, 30 dias os eventos já processados). |

## 3. Ligação com a WS1

A IN3 só exporta `matrixWorkspaceLifecycle` (de `src/core/matrix`). Quem fizer o merge por último liga no registro de ganchos da WS1:

- `onDeletionScheduled(tx, { id })` e `onDeletionCanceled(tx, { id })`: rodam na transação do web que muda o workspace; só enfileiram `matrix.sync-workspace`. Fora de `active`, os atendentes saem de todas as salas (salas `blocked`); de volta a `active`, eles voltam. O consumidor continua na sala; quem impede o agente de responder é a WS1.
- `purgeExternal(tx, { id })`: roda no worker antes da limpeza do banco, numa transação curta de `app_worker`. Apaga as salas no Synapse com purge e marca as linhas como `closed`. Idempotente; se falhar, basta rodar de novo. As linhas saem com a limpeza do banco (`purgeWorkspace` já apaga `matrix_room_members` e `matrix_rooms`).

## 4. Como testar

```sh
export LOCAL_DB_NAME=guidu_in3 E2E_PORT_OFFSET=100 REDIS_URL=redis://127.0.0.1:6390/1
LOCAL_DB_NAME=guidu_in3 AS_MIGRATIONS=1 bash scripts/local/rebuild-db.sh   # inclui tests/core/matrix-rls.sql
bash scripts/local/synapse.sh setup    # venv (pip), banco synapse_in3 (UTF8, collation C), segredos, config
bash scripts/local/synapse.sh start    # Synapse em 8008+offset; promove o núcleo a admin na primeira vez
eval "$(bash scripts/local/synapse.sh env)"   # MATRIX_TEST_ENV_FILE e MATRIX_TEST_AS_PORT
# URLs do banco como no handoff de 12/10, §8, com o banco guidu_in3
pnpm vitest run --project integration tests/core/matrix.test.ts
pnpm vitest run --project unit src/core/matrix
bash scripts/local/synapse.sh stop     # ou reset, para apagar tudo
```

- O Synapse local roda em Postgres (o servidor da porta 54333), sem Docker, com a configuração gerada pelo `scripts/matrix/setup.ts generate`, os mesmos blocos que o guia manda pôr no servidor real, sem login por senha e com limites folgados para os testes. `SYNAPSE_VENV` reaproveita um venv já instalado.
- O Application Service aponta para `8009+offset`, onde o teste de integração sobe um servidor com o mesmo tratamento da rota. Para apontar para o `pnpm dev`, use `SYNAPSE_APP_URL=http://127.0.0.1:<porta do app>` no `setup`.
- O teste lê as variáveis do arquivo do Synapse local; o resto da suíte não vê o Matrix ligado.
- No CI, o job `db` sobe o mesmo Synapse no Postgres do Supabase local (`actions/setup-python` e pip).

## 5. Pendências e decisões a confirmar

1. **Atendente (AT1).** As políticas usam `private.matrix_inbox_roles()` (dono, admin, editor). Quando a AT1 entrar, uma migration nova acrescenta `attendant` a essa lista; o lado TypeScript já segue a matriz de permissões.
2. **Membros de suporte** (concessão temporária do parceiro) não ganham conta Matrix, mesmo com `inbox.view`.
3. **Quem abre a sala.** A IN3 tem o serviço que cria a sala, mas nada o chama ainda: a sala nasce na IN6 (agente) ou na IN7 (Meta), ou por uma API do guidu.chat. O convite do consumidor ao usuário virtual é recusado, sem abrir sala nova.
4. **Salas e workspaces.** Um atendente de dois workspaces vê as salas dos dois no Sliding Sync; separar por `room_types` ou pela lista do Supabase fica para a IN4.
5. **Reativação de conta** pela API admin só funciona sem senha quando o login por senha está desligado no Synapse (o caso depois do bootstrap).
6. **Sala órfã:** a limpeza apaga sala criada pelo núcleo que nenhuma linha conhece há mais de 1 h; toda sala do núcleo precisa ter linha em `matrix_rooms`.
