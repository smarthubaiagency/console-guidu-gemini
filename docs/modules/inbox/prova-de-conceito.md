# Inbox — prova de conceito (IN1)

- **Data:** 16/10/2026
- **Branch do código:** `claude/in1-prova-matrix` (a partir da IN2). O código da prova (scripts, rota e `src/core/channels/matrix-poc/`) fica só nessa branch, como referência para a IN3, e não vai para a `main`. Este relatório e as capturas vão.
- **Pergunta:** a arquitetura da [ADR 0023](../../adr/0023-chat-interno-como-cliente-matrix.md) funciona?
- **Resposta curta:** **segue, com mudanças.** Os 9 itens funcionaram. Sete pontos mudam a ADR ou o plano (seção "Conclusão").

## Versões

| Peça                | Versão                                                                 |
| ------------------- | ---------------------------------------------------------------------- |
| Synapse             | 1.163.0 (pip, `matrix-synapse[jwt]`, Python 3.13.16), SQLite           |
| `matrix-js-sdk`     | 43.0.0 (a 44.0.0 tem 3 dias; ficou de fora pela idade mínima)          |
| Next.js             | 16.4.0 (dev, Turbopack), Node 22.22.0                                  |
| Postgres do console | 16.15 local, banco `guidu_in1`                                         |
| Navegador           | Chromium 1194 (Playwright)                                             |
| Modelo do agente    | `MockLanguageModelV4` de `ai/test` (o mesmo dos testes), resposta fixa |

## Ambiente e decisões da prova

- Synapse em `127.0.0.1:8108`, `server_name: dev.guidu.chat`, só o recurso `client` (sem federação), `federation_domain_whitelist: []`, `enable_registration: false`, `password_config.enabled: false`, `encryption_enabled_by_default_for_room_type: off`, JWT HS256 (issuer `guidu-console-dev`, audience `guidu-matrix-dev`), Application Service `guidu-core` com namespace exclusivo `@_guidu_.*` e `rate_limited: false`.
- Limites de envio folgados para criar 300 salas. `rc_login` aumentado depois do item 2 (ver lá).
- O login do console usa o GoTrue falso dos e2e (`e2e/support/fake-gotrue.ts`) sobre o Postgres local. Usuária `ana@loja-poc.test`, workspace `loja-poc`.
- Sem migration. As tabelas da IN3 (contas Matrix, salas por `room_id`) viraram um arquivo JSON (`MATRIX_POC_STORE`).
- Todo o código da prova está atrás de `GUIDU_INBOX_POC=1`. Sem a flag, as rotas respondem 404.

## Como refazer

```sh
export SYNAPSE_POC_DIR=/algum/diretorio/descartavel
redis-cli -p 6390 ping || redis-server --port 6390 --save "" --appendonly no --daemonize yes
LOCAL_DB_NAME=guidu_in1 AS_MIGRATIONS=1 bash scripts/local/rebuild-db.sh
bash scripts/local/synapse-poc.sh setup      # venv, config, segredos em $SYNAPSE_POC_DIR/poc.env
bash scripts/local/synapse-poc.sh start
pnpm tsx scripts/local/inbox-poc.ts auth &   # GoTrue falso na 54420
pnpm tsx scripts/local/inbox-poc.ts seed
pnpm tsx scripts/local/inbox-poc.ts bootstrap
# app: variáveis do GoTrue falso (como no playwright.config.ts), o banco
# guidu_in1 como app_runtime, REDIS_URL=redis://127.0.0.1:6390/3,
# GUIDU_INBOX_POC=1, MATRIX_POC_STORE e o conteúdo de poc.env; PORT=3400.
pnpm dev
pnpm tsx scripts/local/inbox-poc-browser.ts conversa &   # atendente no navegador
pnpm tsx scripts/local/inbox-poc.ts consumer             # papel do guidu.chat
pnpm tsx scripts/local/inbox-poc.ts rooms300 @u_<id sem hífens>:dev.guidu.chat
pnpm tsx scripts/local/inbox-poc.ts measure <id do usuário>
pnpm tsx scripts/local/inbox-poc-browser.ts lista
# verificações avulsas (Node puro): ANA=u_<id sem hífens>, SALA=!<sala da conversa>
node scripts/local/inbox-poc-checks/jwt-checks.mjs $SYNAPSE_POC_DIR/poc.env $ANA "$SALA"
node scripts/local/inbox-poc-checks/jwt-core.mjs $SYNAPSE_POC_DIR/poc.env
node scripts/local/inbox-poc-checks/consumer-sees.mjs $SYNAPSE_POC_DIR/poc.env "$SALA" "@$ANA:dev.guidu.chat"
node scripts/local/inbox-poc-checks/ss-extra.mjs $SYNAPSE_POC_DIR/poc.env $ANA
node scripts/local/inbox-poc-checks/ss-types.mjs $SYNAPSE_POC_DIR/poc.env $ANA
bash scripts/local/synapse-poc.sh stop
```

## Código da prova

| Arquivo                                           | O que faz                                                                  |
| ------------------------------------------------- | -------------------------------------------------------------------------- |
| `scripts/local/synapse-poc.sh`                    | Instala, configura, sobe e para o Synapse                                  |
| `scripts/local/inbox-poc.ts`                      | GoTrue falso, semente, bootstrap do admin, consumidor, 300 salas, medições |
| `scripts/local/inbox-poc-browser.ts`              | Atendente no Chromium e as capturas                                        |
| `scripts/local/inbox-poc-checks/*.mjs`            | Verificações avulsas: JWT, o que o consumidor vê, filtros do Sliding Sync  |
| `src/core/channels/matrix-poc/`                   | Config, chamadas ao Synapse, JWT, transações do AS, agente, arquivo JSON   |
| `src/app/api/matrix/as/[...path]/route.ts`        | Entrada do Application Service                                             |
| `src/app/api/matrix/poc/session/route.ts`         | Provisiona a conta e entrega o JWT curto                                   |
| `src/app/app/[workspaceSlug]/(fullscreen)/inbox/` | Tela crua do Inbox                                                         |
| `src/core/security/headers.ts`, `src/proxy.ts`    | Origem do homeserver no `connect-src`, só com a flag                       |

---

## 1. Application Service — funcionou

O Synapse chama `PUT <app>/api/matrix/as/_matrix/app/v1/transactions/{txnId}` com `Authorization: Bearer <hs_token>`. O route handler confere o token em tempo constante, responde `{}` na hora e processa depois, com `after()`.

```
$ curl -X PUT -H "authorization: Bearer errado" .../api/matrix/as/_matrix/app/v1/transactions/teste1
{"errcode":"M_FORBIDDEN","error":"Bad hs_token"} HTTP 403
$ curl -X PUT -H "authorization: Bearer $MATRIX_HS_TOKEN" ... (mesmo endereço)
{} HTTP 200
$ curl -X POST -H "authorization: Bearer $MATRIX_AS_TOKEN" .../_matrix/client/v1/appservice/guidu-core/ping
{"duration_ms":17} HTTP 200        # o Synapse chamou /_matrix/app/v1/ping no app
```

O núcleo registrou `@_guidu_agent_loja-poc` pelo AS e mandou mensagens em nome dele (`?user_id=`). Ao longo da prova, o app recebeu 2.731 transações, todas 200. Tempo de resposta: mediana 6 ms, p95 28 ms.

**Ressalvas encontradas:**

- O App Router trata a pasta `_matrix` como privada. A rota usa um catch-all em `/api/matrix/as/[...path]` (a outra saída é a pasta `%5Fmatrix`).
- Com SQLite, o Synapse recomeça o `txnId` em 1 depois de reiniciar (o número vem do maior txn pendente). A prova perdeu eventos por deduplicar pelo `txnId`. Passou a deduplicar pelo `event_id`. Em Postgres há sequência de verdade, mas a chave única deve ser o `event_id` de qualquer forma (ADR 0011, regra 1).
- O AS recebe todos os eventos das salas onde um usuário `@_guidu_*` está, inclusive os do próprio núcleo. Criar 300 salas gerou cerca de 2.700 transações. A IN3 precisa descartar cedo o que é do próprio núcleo.

## 2. Provisionamento e login JWT — funcionou, com ressalvas importantes

O `@_guidu_core` (remetente do AS) foi promovido a admin uma vez, por um admin descartável criado com o `registration_shared_secret`, depois desativado. Daí em diante o núcleo usa **só o `as_token`**, também na API admin:

```
registro do usuário do núcleo pelo AS: HTTP 200 {"user_id":"@_guidu_core:dev.guidu.chat",...}
promove o núcleo a admin: HTTP 200 {"name":"@_guidu_core:dev.guidu.chat","admin":true,...,"appservice_id":"guidu-core",...}
API admin com as_token (lista de usuários): HTTP 200 {"users":[...]}
desativa o admin descartável: HTTP 200
```

`POST /api/matrix/poc/session` revalida a sessão do console e o acesso ao workspace, cria ou atualiza `@u_<id do usuário>` pela API admin (`PUT /_synapse/admin/v2/users/...`, sem senha), põe a conta nas salas do workspace e devolve um JWT de 60 s. O navegador troca o JWT por um token Matrix (`loginRequest({type: "org.matrix.login.jwt"})`). A atendente não vê senha nem token do núcleo.

Testes do JWT (`jwt-checks.mjs` e `jwt-core.mjs`):

```
JWT válido (60 s): HTTP 200 {"user_id":"@u_d147c732...:dev.guidu.chat",...}
mesmo JWT de novo (reuso dentro do prazo): HTTP 200
JWT vencido (exp há 5 min): HTTP 403 "expired_token: The token is expired"
JWT com audience errada: HTTP 403 "Invalid claim 'aud'"
JWT com issuer errado: HTTP 403 "Invalid claim 'iss'"
JWT com assinatura errada: HTTP 403 "Signature verification failed"
JWT sem exp: HTTP 200
JWT de usuário que não existe: HTTP 200 (o Synapse cria a conta)
JWT de localpart do namespace do AS: HTTP 200 {"user_id":"@_guidu_agent_loja-poc:..."}
JWT de usuário desativado: HTTP 403 {"errcode":"M_USER_DEACTIVATED"}
login JWT como _guidu_core: HTTP 200, API admin com esse token: HTTP 200
```

**O que isso muda:**

- **O segredo do JWT vale tanto quanto um admin do Synapse.** Com ele, qualquer um entra como `@_guidu_core` (admin) ou como o agente. O Synapse não restringe o `sub` nem respeita o namespace exclusivo do AS no login JWT. O plano (§2.4) dizia que o JWT evita "guardar um poder grande no servidor do console". Não evita: o console já guarda o `as_token` (admin) e o segredo do JWT é do mesmo nível. Recomendação: RS256, com a chave privada só no console e a pública no Synapse (um vazamento da config do Synapse deixa de permitir forjar), o emissor só assina `sub` com o prefixo `u_`, e os dois segredos no cofre com rotação.
- O Synapse aceita JWT sem `exp` e aceita o mesmo JWT várias vezes no prazo. O console precisa sempre pôr `exp` curto.
- O login JWT cria a conta se ela não existe. O provisionamento pela API admin continua necessário para nome, desativação e saída das salas. A desativação bloqueia o login, como esperado.
- **Limite de login.** O padrão do Synapse é 5 logins seguidos e depois 1 a cada ~5,5 min, por IP e por conta (`rc_login`). A tela crua fazia um login por carga e tomou 429 em poucos recarregamentos. Cada login também cria um dispositivo novo (a Ana ficou com 10). A IN3/IN4 precisa guardar a sessão Matrix no navegador e reaproveitá-la (com refresh token), sair junto com o console, e ajustar `rc_login` no Synapse (vários atendentes atrás do mesmo IP de um escritório).
- Duas criações ao mesmo tempo (o React de dev monta o efeito duas vezes) deram `M_USER_IN_USE`. O provisionamento por job, idempotente, como o plano prevê, resolve.

## 3. Rota do Inbox em tela cheia — funcionou

`/app/[workspaceSlug]/inbox` vive em `(fullscreen)/inbox/page.tsx`, sem o AppShell. As guardas vêm do `layout.tsx` do workspace (IN2). Sem `GUIDU_INBOX_POC=1`, a página chama `notFound()` e as duas rotas de API respondem 404:

```
sem a flag, PUT transação do AS: HTTP 404
sem a flag, /app/loja-poc/inbox (com sessão): HTTP 404
sem a flag, POST /api/matrix/poc/session (com sessão): HTTP 404
```

A tela usa o `matrix-js-sdk` no navegador: lista de salas, timeline, envio, status e responsável.

Capturas: [conversa transferida](prova-de-conceito/01-transferida.png) e [atendente respondeu](prova-de-conceito/02-atendente-respondeu.png).

**Ressalva:** a CSP do console só libera `connect-src 'self'`. O navegador precisa falar com o homeserver. A prova acrescenta a origem do Synapse quando a flag está ligada. A IN4 precisa disso em produção (`https://matrix.guidu.chat`).

## 4. Consumidor no lugar do Element — funcionou

`inbox-poc.ts consumer` usa uma conta comum (criada pelo segredo de cadastro, porque o cadastro aberto está desligado) e só a Client-Server API:

```
consumidor (papel do guidu.chat): @cliente_mvbm3xxn:dev.guidu.chat
consumidor cria sala e convida o agente: HTTP 200
convite do núcleo para a sala !OMI48SHRN_...
consumidor entra: HTTP 200
membros da sala do consumidor depois da recusa: @cliente_mvbm3xxn:dev.guidu.chat
consumidor envia: HTTP 200
resposta do agente em 142 ms: {"body":"[Agente loja-poc, modelo falso] Recebi: \"Oi, vocês abrem no sábado?\". ..."}
mensagem do atendente vista pelo consumidor: @u_d147c732...: {"body":"Olá! Aqui é a Ana. Sim, abrimos no sábado das 9h às 13h."}
```

**Decisão da prova:** o consumidor pede a conversa convidando `@_guidu_agent_<workspace>` para uma sala dele. O núcleo **recusa** essa sala (nela o dono seria o consumidor, que poderia ligar a criptografia e mudar permissões) e abre uma sala própria, convidando o consumidor. A IN3 escolhe entre esse caminho e uma API do guidu.chat que pede a sala ao núcleo.

**Ressalvas:**

- A sala precisa ser registrada (tabela da IN3) **antes** do convite ao consumidor. Na primeira rodada, o consumidor entrou e escreveu antes do registro, e a mensagem foi ignorada.
- `createRoom` não é atômico. Uma falha deixou uma sala pela metade (só o evento de criação). A IN3 precisa tratar salas órfãs.
- **Salas v12** (padrão do Synapse 1.163): o criador tem poder máximo permanente e não pode aparecer em `users` dos power levels (`"Creator user ... must not appear in content.users"`). Bom para o núcleo, que não pode ser rebaixado. O preset `private_chat` deixa `guest_access: can_join`; a IN3 deve pôr `forbidden`.

## 5. Agente na sala — funcionou

Caminho: transação do AS → `processTransaction` → `answerAsPocAgent` (AI SDK `generateText` com `MockLanguageModelV4`, sem chave e sem rede) → envio pelo `as_token` em nome de `@_guidu_agent_loja-poc`, com "digitando". Pedir "atendente" muda o status para `open`. O tempo entre a mensagem do consumidor e a resposta vista por ele foi de 121 a 142 ms.

**Não passou pelo `runGuidTurn`**: o serviço público `runTurn` para hubs (canais.md §3.5) ainda não existe e é a IN6. O processamento roda em `after()` dentro do route handler; na IN3 vira evento gravado e job no worker (ADR 0011, regras 1 e 5). Hoje, um evento marcado como visto e que falha no meio se perde.

## 6. Estado `chat.guidu.conversation` — funcionou

- Criado pelo núcleo junto com a sala: `{"version":1,"status":"pending","assignee":null}`.
- O núcleo escreve na transferência; o consumidor lê: `estado depois da transferência (escrito pelo núcleo): {"status":"open","assignee":null} por @_guidu_core`.
- O console escreve (botão "Assumir"); o consumidor lê: `{"assignee":"@u_d147c732...","status":"open"} por @u_d147c732...`.
- O console lê, ao vivo, o que o núcleo escreveu (captura 01: status `open`, responsável "ninguém").
- O consumidor **não** consegue escrever: `HTTP 403 user_level (0) < send_level (50)`. O nível 50 é do agente e dos atendentes.

## 7. Sliding Sync — funcionou, com limites

O Synapse 1.163 anuncia `org.matrix.simplified_msc3575` e serve o MSC4186 sem configuração. O `matrix-js-sdk` 43 tem `SlidingSync` (import profundo `matrix-js-sdk/lib/sliding-sync.js`, API marcada como experimental) e `startClient({ slidingSync })`.

Cenário: 300 salas criadas pelo núcleo para a Ana (cada uma com o estado da conversa e 3 mensagens), 305 no total. Criação: 100 s. Cinco rodadas por linha, login novo em cada uma:

| Medição                                                       |   Mediana |   Tamanho | Salas na resposta |
| ------------------------------------------------------------- | --------: | --------: | ----------------: |
| HTTP `/sync` inicial, sem filtro                              |  2.188 ms | 1.360 KiB |               305 |
| HTTP `/sync` inicial, timeline 1 e membros sob demanda        |  1.656 ms | 1.023 KiB |               305 |
| HTTP Sliding Sync, 20 primeiras                               |     31 ms |    23 KiB |                20 |
| HTTP Sliding Sync, rolar para 20–39                           |     48 ms |    24 KiB |                20 |
| HTTP Sliding Sync, lista inteira (0–304)                      |    711 ms |   347 KiB |               305 |
| `matrix-js-sdk` no Node, sync clássico até o primeiro `Sync`  |  1.701 ms |         — |               305 |
| `matrix-js-sdk` no Node, Sliding Sync até a primeira resposta |     63 ms |         — |                20 |
| Navegador, sync clássico (tela crua)                          | ~2.060 ms |         — |               308 |
| Navegador, Sliding Sync, 50 primeiras                         |   ~150 ms |         — |                50 |

O `count` da lista volta certo (305). Abrir uma sala vira assinatura (`modifyRoomSubscriptions`), com timeline e estado completos, e o envio funciona. Capturas: [lista clássica](prova-de-conceito/03-lista-classic.png), [lista com Sliding Sync](prova-de-conceito/03-lista-sliding.png) e [sala aberta com Sliding Sync](prova-de-conceito/04-sliding-sala.png).

**Limites encontrados:**

- Filtro `room_name_like`: **HTTP 500**, `NotImplementedError` em `synapse/handlers/sliding_sync/room_lists.py` (`filter_rooms_using_tables`). Filtro `spaces`: o mesmo 500.
- Não existe filtro por state event customizado. As visões Minhas, Não atribuídas e Resolvidas **não** saem do Sliding Sync.
- O filtro `room_types` funciona: salas criadas com `creation_content.type` diferente por workspace foram separadas (`count 2` e `count 1`). Serve para um atendente de dois workspaces.
- Na tela crua, a última mensagem que veio pela lista ficou no topo da timeline depois da assinatura (captura 04). A IN4 precisa ordenar pela timeline do SDK, não pela ordem de chegada.

## 8. Sem E2EE — funcionou

- As salas do núcleo não têm `m.room.encryption`: `GET .../state/m.room.encryption/` → `HTTP 404 M_NOT_FOUND`. A tela mostra "E2EE: não".
- Power levels da sala: `"m.room.encryption":100`, `"m.room.power_levels":100`, `state_default:100`; o núcleo é o criador (v12, poder máximo); agente e atendentes 50; consumidor 0.
- Consumidor tenta ligar: `HTTP 403 user_level (0) < send_level (100)`.
- Atendente tenta ligar: `HTTP 403 user_level (50) < send_level (100)`.
- Consumidor tenta mudar power levels: 403. Tenta convidar outra pessoa: 403.

## 9. O que o consumidor enxerga — confirmado

State events lidos pelo consumidor na sala:

```
chat.guidu.conversation [] {"assignee":null,"status":"pending","version":1}
m.room.create [] {"room_version":"12"}
m.room.guest_access [] {"guest_access":"can_join"}
m.room.history_visibility [] {"history_visibility":"shared"}
m.room.join_rules [] {"join_rule":"invite"}
m.room.member [@_guidu_agent_loja-poc] {"displayname":"Agente loja-poc","membership":"join"}
m.room.member [@_guidu_core] {"displayname":"_guidu_core","membership":"join"}
m.room.member [@cliente_...] ...
m.room.member [@u_d147c732c1ba48109effc67710346246] {"displayname":"Ana Atendente","membership":"join"}
m.room.name [] {"name":"Conversa @cliente_..."}
m.room.power_levels [] {...todos os mxids e níveis...}
```

E mais (`consumer-sees.mjs`):

```
presença da atendente vista pelo consumidor: {"presence":"offline","last_active_ago":27473}
perfil da atendente: {"displayname":"Ana Atendente"}
diretório de usuários (busca "Ana"): encontra @u_d147c732... "Ana Atendente"
consumidor tenta mensagem com tipo customizado (chat.guidu.note): HTTP 200
```

**Conclusões:**

- Tudo o que está na sala é visível ao consumidor, inclusive state events, power levels e membros. **Nota e etiqueta não podem ir para a sala**; ficam no Supabase por `room_id`, como a ADR já diz.
- O mxid `@u_<uuid>` expõe o id interno do usuário do console. A IN3 deve usar um localpart opaco, guardado na tabela de contas.
- A presença da atendente (online, último acesso) e o "digitando" chegam ao consumidor. Decidir: desligar a presença (`presence.enabled: false`) ou aceitar.
- O consumidor pode mandar eventos de qualquer tipo. O console só mostra os tipos que conhece.
- O nome do workspace aparece no nome da sala e no usuário do agente. Se isso importar, usar nomes opacos.

---

## Conclusão: segue, com mudanças

A arquitetura funciona: AS no núcleo, contas provisionadas, login JWT no navegador, o console e o consumidor como dois clientes da mesma sala, o agente respondendo em nome de um usuário virtual, o estado na sala e as salas sem E2EE.

**Muda na ADR 0023:**

1. **Regra 9 (JWT).** O segredo do JWT é tão poderoso quanto o admin do Synapse. Trocar para RS256, restringir o `sub` ao prefixo `u_` no emissor, `exp` sempre curto. Tirar do plano a ideia de que o JWT reduz o poder do console.
2. **Regra 10 (Sliding Sync).** Funciona e é rápido para a lista "Todas" e para a sala aberta. As visões Minhas, Não atribuídas e Resolvidas, e a busca por nome, saem do Supabase: o núcleo espelha `status` e `assignee` por `room_id` a partir das transações do AS (o estado continua sendo da sala).
3. **Regra 8 (AS).** O núcleo usa o `as_token` também para a API admin (o remetente do AS é admin). O `guidu-admin` do guia do EasyPanel serve só para o bootstrap e depois fica desativado.

**A IN3 precisa levar:**

1. Rota do AS em catch-all (ou `%5Fmatrix`), `hs_token` em tempo constante, chave única no `event_id`, evento gravado e job no worker.
2. Ordem: criar a sala sem o consumidor, gravar o `room_id`, pôr atendentes, só então convidar o consumidor. Tratar sala órfã.
3. Sala v12: núcleo como criador, fora de `users`; `guest_access: forbidden`; `m.room.encryption` e `m.room.power_levels` em 100; `chat.guidu.conversation` em 50.
4. A sala criada pelo consumidor é recusada; o núcleo abre a dele (ou o guidu.chat pede a sala por API).
5. Contas com localpart opaco; provisionamento idempotente por job; desativação na saída.
6. Sessão Matrix guardada no navegador, com refresh token e saída junto com o console; `rc_login` ajustado no Synapse.
7. Decidir presença e "digitando" visíveis ao consumidor.
8. `connect-src` com a origem do homeserver.
9. Synapse em Postgres no CI e em dev (o SQLite recomeça o `txnId` e avisa "you should port to postgres").
10. Se um atendente puder estar em dois workspaces, separar as salas por `room_types` (tipo na criação) ou pela lista do Supabase.

**Para o guia do Synapse (IN0):** acrescentar `rc_login`, a decisão de presença, `app_service_config_files` com o registro do AS e a promoção do remetente do AS a admin.
