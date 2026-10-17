# Handoff — Inbox, 17/10/2026

Ponto de partida para continuar o **Inbox (chat interno sobre Matrix)** numa thread nova, sem contexto anterior. Escrito no fim da thread que fez da IN0 à AT1. Complementa os handoffs de [16/10](2026-10-16-handoff.md), [15/10](2026-10-15-handoff.md) e [12/10](2026-10-12-handoff.md), que continuam valendo para regras, validação e armadilhas.

## 1. Como começar a thread nova

Cole algo como:

> Leia `docs/handoff/2026-10-17-handoff-inbox.md` e as fontes que ele lista (`AGENTS.md`, `CLAUDE.md`, a ADR 0023, a especificação, o plano e o relatório da prova do Inbox). Trabalhe a partir da `main`. O próximo par é a **IN3, núcleo Matrix**, testando contra o Synapse de teste do EasyPanel, junto com a **WS1, exclusão suave do workspace**. Antes de codar, me mostre o plano das duas e espere meu "pode começar".

A thread nova precisa ser aberta **depois** de 17/10/2026 00:17 UTC, quando o Marcelo trocou o ambiente da nuvem do projeto. Só sessões novas alcançam o Synapse de teste.

## 2. Leitura obrigatória

- [ADR 0023](../adr/0023-chat-interno-como-cliente-matrix.md): o Inbox como cliente Matrix (regras 8, 9 e 10 revistas pela prova).
- [Revisão de 16/10 da ADR 0014](../adr/0014-shell-padrao-sidebar-08.md): o Inbox em tela cheia com a sidebar-09.
- [Especificação](../modules/inbox/especificacao.md), [plano](../modules/inbox/plano.md) e [relatório da prova de conceito](../modules/inbox/prova-de-conceito.md), sobretudo a conclusão: é a lista do que a IN3 leva.
- [Guia do Synapse no EasyPanel](../operacao/synapse-easypanel.md).
- `AGENTS.md`, seção "Trabalho em paralelo e testes": 2 etapas por vez, worktree e banco próprios, testes num subagente do modelo mais barato e reteste só do que falhou.

## 3. Estado

| Etapa                                      | Branch ou PR              | Situação                                                           | Migration        |
| ------------------------------------------ | ------------------------- | ------------------------------------------------------------------ | ---------------- |
| Regras de paralelo e testes no `AGENTS.md` | #104                      | Na `main`                                                          | —                |
| IN0 Documentos (ADR 0023, especificação)   | #102                      | Na `main`                                                          | —                |
| IN2 Rotas em `(shell)/`                    | #103                      | Na `main`                                                          | —                |
| IN1 Relatório da prova e este handoff      | #108                      | Na `main`                                                          | —                |
| IN1 Código da prova                        | `claude/in1-prova-matrix` | Só referência para a IN3; não vai para a `main`                    | —                |
| AT1 Função Atendente                       | #109                      | Na `main`                                                          | `20261127090000` |
| WS1 Exclusão suave do workspace            | #110                      | Na `main`                                                          | `20261129090000` |
| IN3 Núcleo Matrix (e decisões, #114)       | #112                      | Na `main`                                                          | `20261128090000` |
| IN4a Janela e conversa do Inbox            | #115                      | Na `main`; [janela-inbox.md](../modules/inbox/janela-inbox.md)     | `20261130090000` |
| IN4b Contexto, etiquetas e avisos          | #120                      | Na `main`; [contexto-inbox.md](../modules/inbox/contexto-inbox.md) | `20261214090000` |
| IN6 GUIDS na sala                          | `claude/in6-guids-sala`   | PR aberto; [guids-na-sala.md](../modules/inbox/guids-na-sala.md)   | `20261215090000` |

As próximas migrations do Inbox começam depois de `20261215090000` (IN6).

## 4. Synapse de teste

- Endereço: `https://multica-synapse.dtjkix.easypanel.host/`, em Postgres no EasyPanel.
- `server_name`: `multica-synapse.dtjkix.easypanel.host`. **Servidor descartável, só para testes.** O dev e a produção nascem depois em servidores novos, com `dev.guidu.chat` e `guidu.chat`, e nada passa de um para o outro. Por isso o código nunca fixa o `server_name`: vem de variável de ambiente.
- Os segredos (`registration_shared_secret`, JWT, senha do admin) ficam com o Marcelo, no EasyPanel. Peça que ele cadastre os necessários como variáveis de ambiente da sessão ou do dev; nunca no chat nem no repositório.
- O registro do Application Service é um arquivo que a IN3 gera e o Marcelo instala no servidor (`app_service_config_files`).

## 5. O que a IN3 leva (da prova)

- Rota do Application Service em `/api/matrix/as/[...path]` (a pasta `_matrix` é privada no App Router), `hs_token` em tempo constante, deduplicação pelo `event_id`, evento gravado e processado num job.
- O núcleo usa o `as_token` também na API admin; o remetente do AS é promovido a admin uma vez.
- JWT em RS256, `exp` curto, só para `sub` de atendente com localpart opaco (`u_...`, sem o id interno); sessão Matrix guardada no navegador com refresh token; `rc_login` ajustado.
- Sala criada e gravada antes do convite ao consumidor; salas órfãs tratadas; salas v12 (criador fora de `users` nos power levels) com `guest_access: forbidden`; `m.room.encryption` em nível 100.
- Status e responsável espelhados no Supabase por `room_id`, porque o Sliding Sync não filtra por state event.
- Origem do homeserver no `connect-src` da CSP.
- Synapse em Postgres no CI (pip `matrix-synapse` funciona; o Docker Hub não é alcançável da sessão).
- Decidir com o Marcelo se presença e "digitando" ficam visíveis ao consumidor.

## 6. Esperando o Marcelo

1. Abrir os PRs de `claude/in1-relatorio` e `claude/at1-funcao-atendente` e aplicar no dev a migration `20261127090000_at1_attendant_role`.
2. Perguntas da AT1:
   - fechar também a leitura de credenciais pelo Viewer no banco (a matriz nega, a política deixa)? Recomendado: sim;
   - o Atendente continua lendo `crm_contacts` e as outras tabelas "qualquer membro" pelo banco até o Inbox definir o que precisa? Recomendado: sim;
   - mudar um dono ou admin da empresa para Atendente rebaixa o papel dele na empresa para membro. Confirma?
3. Confirmar na especificação §3 e §4: Editor responde mas não atribui; Viewer sem Inbox; cota conta quem tem `inbox.reply`.
4. Verificação do app da Meta (pré-requisito da IN7).

## 7. Notas para a IN4

A AT1 deixou três pontos para quando o Inbox existir: `buildAppNavigation`, `resolveModulePageAccess` e o dashboard do Atendente só liberam o dashboard para quem não tem `workspace.read`; o Inbox entra nos três. As permissões `inbox.*` estão no catálogo do núcleo; o manifesto do módulo `inbox` só as referencia, sem declarar de novo.
