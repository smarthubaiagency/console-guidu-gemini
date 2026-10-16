# Inbox (chat interno sobre Matrix): análise, dúvidas e plano

- **Data:** 16/10/2026
- **Base:** ADR "Chat interno como cliente Matrix" (no repositório, [ADR 0023](../../adr/0023-chat-interno-como-cliente-matrix.md)) e a revisão de 16/10/2026 da ADR 0014 "Inbox em tela cheia (sidebar-09)", enviadas pelo Marcelo, conferidas contra a `main` (b521a24).
- **Estado:** respostas do Marcelo de 16/10/2026 na seção 0. IN0 (este documento, a [ADR 0023](../../adr/0023-chat-interno-como-cliente-matrix.md) e a [especificação](especificacao.md)) e IN2 em andamento.

## 0. Decisões do Marcelo (16/10/2026)

1. **Synapse:** o Marcelo instala no EasyPanel pelo template, seguindo o [guia](../../operacao/synapse-easypanel.md). Federação desligada (padrão).
2. **Um Synapse e um `server_name`** para todos os parceiros e workspaces.
3. **Canais da v1:** Element para os testes e **WhatsApp da Meta** na v1. O comerciante escolhe, por número, onde atende: no Chatwoot (como hoje, com o GUIDS como Agent Bot) ou no Inbox do dashboard (número ligado direto ao GUIDU, cada conversa vira uma sala). O Chatwoot **não é espelhado** no Inbox. Trocar um número de lugar é trocar a rota (ADR 0011); o histórico fica onde estava.
4. **N1/H1** segue em outro chat; conferido abaixo (seção 0.1).
5. **Sem criptografia de ponta a ponta.** O guidu.chat é como um widget de site e não foi feito para dados sensíveis.
6. **Nova função de workspace "Atendente"** (chave `attendant`, confirmada) que só entra no dashboard e no `/inbox`.
7. Módulo de plano, **cota de atendentes**.
8. Visões: Minhas, Não atribuídas, Todas, Resolvidas; outras depois.
9. **Ferramentas do painel de contexto ficam para depois** da v1.
10. Etiquetas no Supabase; não-lidas pelos recibos de leitura do Matrix.
11. Sala nova cria o contato no CRM com o nome do perfil, ligado pelo `room_id`; o atendente mescla depois.
12. **Workspace terá exclusão suave**, e a sala segue o mesmo prazo (apagada no Synapse quando o workspace for apagado de vez).
13. O GUIDS responde na sala com as mesmas regras da A5b.

### 0.1 Conferência com a H1 (Central de Eventos, branch `claude/h1-event-hub`)

- **Número da ADR:** a H1 já usa a **ADR 0022** (Central de Eventos). A do chat interno passa a ser a **0023**, e a revisão da ADR 0014 aponta para ela.
- **Migration:** a H1 usa `20261125090000`; a AUD1 usa `20261126090000`; o Inbox começa em `20261127090000`.
- **Avisos do Inbox** (conversa nova, atribuição, sem resposta) entram no catálogo da H1. Por isso a janela do Inbox (IN4) começa depois do merge da H1. Documentos, prova de conceito e núcleo Matrix não dependem dela.
- **Rotas:** a H1 não mexe em `src/app/app/`, então a mudança de pastas (IN2) não conflita com ela.
- **Permissões:** a H1 mexe na parte da plataforma de `src/core/permissions/matrix.ts`; a função Atendente mexe na parte do workspace do mesmo arquivo. Conflito pequeno, resolvido no merge.
- **Exclusão suave de workspace** não existe hoje e não está na H1: vira uma etapa própria (WS1), antes do Inbox ir para produção.

## 1. Leitura das duas ADRs

As duas ADRs se encaixam no que já existe e não pedem para desfazer nada:

- **Camada de canais (ADR 0011).** Hoje `src/core/channels/` só tem o adaptador Chatwoot (`CHANNEL_KINDS = ["chatwoot"]` em `contract.ts`). O Matrix entra como segundo adaptador do núcleo, em modo Application Service. O Synapse empurra os eventos para um endpoint do núcleo (`/_matrix/app/v1/transactions/{txnId}`, com o `hs_token`), que faz o papel do webhook por conexão. Isso cabe na regra 1 da ADR 0011 sem exceção. O esclarecimento da ADR 0022 sobre o navegador falar direto com o Synapse está correto: é o cliente do próprio atendente.
- **Shell (ADR 0014).** O `layout.tsx` de `/app/[workspaceSlug]` faz as guardas e monta o `AppShell` no mesmo arquivo. A divisão em `layout.tsx` (só guardas), `(shell)/` e `(fullscreen)/inbox/` resolve isso sem mudar URLs. Hoje há 8 pastas de rota a mover (ai-agents, crm, executions, google-business, hello-world, portfolio, proposals, settings), mais o `page.tsx` do dashboard.
- **Painel de contexto.** CRM e portfólio já têm serviço público. "Pedidos e reservas" ainda não existe como módulo. O que mais se aproxima são as propostas (`proposals`).
- **Agente na sala.** A regra 4 da ADR 0011 (o hub aciona o agente pelo serviço público) já está prevista em `canais.md` §3.5, mas o `runTurn` público para hub ainda não foi construído. A A5b fez o agente como consumidor direto do canal, não chamado por um hub.

## 2. Pontos de atenção que encontrei

1. **Nota interna não pode ficar na sala.** O consumidor é membro da sala e lê tudo o que está nela. Qualquer mensagem é visível para ele, inclusive um evento customizado. A nota interna precisa ficar no Supabase, por `room_id`, ou numa segunda sala só da equipe. Recomendo o Supabase: é simples, é auditável e não depende do Matrix.
2. **O state event também é visível ao consumidor.** O `chat.guidu.conversation` com status e responsável fica legível para todos os membros da sala. Para o consumidor ver "em atendimento por Ana", tudo bem. Etiquetas e qualquer dado interno não podem ir no state event: vão para o Supabase.
3. **Criptografia de ponta a ponta.** Com E2EE ligada, o núcleo, o agente (Application Service), a busca do Synapse e a auditoria deixam de ler as mensagens. Recomendo salas **sem E2EE**: TLS no transporte e o servidor sob nosso controle. A política de privacidade precisa dizer isso.
4. **Login do atendente no Synapse.** A ADR diz que o atendente nunca vê credenciais, mas não diz como o navegador obtém o token. Recomendo o **login por JWT do Synapse** (`org.matrix.login.jwt`): o console assina um JWT curto para o usuário já logado, e o `matrix-js-sdk` troca esse JWT por um token Matrix. A alternativa é o console gerar o token pela API admin, que é mais simples, mas guarda um poder grande no servidor do console.
5. **Sliding Sync.** O Synapse já tem a versão "simplificada" (MSC4186) nativa, e o `matrix-js-sdk` tem suporte, mas ainda marcado como experimental. **Preciso confirmar na prova de conceito.** Se não funcionar bem, a lista de conversas sai do Supabase (por `room_id`) e só a sala aberta sincroniza.
6. **Licença do Synapse.** É AGPL-3.0 desde 2023. Rodar sem modificar, como serviço separado, não obriga a abrir o código do console. Modificar o Synapse obrigaria a publicar a modificação.
7. **CI e testes.** Os e2e vão precisar de um Synapse de verdade no CI (container de serviço, como o Supabase local), com porta deslocada pelo `E2E_PORT_OFFSET` para as duas etapas em paralelo. Testes de unidade usam um Synapse falso, como o Chatwoot falso de hoje.
8. **Notificações.** Conversa nova, atribuição e mensagem sem resposta são avisos. Pela ordem do handoff de 16/10, eles deveriam nascer na N1 (central de eventos), que ainda não foi feita.

## 3. Dúvidas

### Bloqueiam o começo

1. **Synapse hoje.** Ele já está rodando no EasyPanel? Qual é a versão, o endereço e o `server_name` (o domínio que aparece em `@ana:dominio`)? A federação com outros servidores fica desligada? _Recomendo desligada._ Existe um Synapse separado para dev?
2. **Um servidor para todos.** Um único Synapse e um único `server_name` atendem todos os parceiros e workspaces, com a marca do parceiro só na interface? _Recomendo que sim._
3. **Quais conversas entram no Inbox na primeira versão.** Opções:
   - (a) só conversas nativas do Matrix (o Element faz o papel do guidu.chat até ele existir);
   - (b) também WhatsApp e Meta, com o núcleo espelhando cada conversa numa sala (é uma ponte construída por nós);
   - (c) também as inboxes do Chatwoot.

   _Recomendo (a) na primeira versão e (b) numa etapa própria depois._ Pela ADR 0022, o Chatwoot continua até o Inbox estar pronto, e não vale espelhar o Chatwoot.

4. **Ordem frente à N1.** A N1 (central de eventos e notificações) era a próxima etapa. Faço o Inbox depois da N1, ou em paralelo com ela? _Recomendo a prova de conceito do Inbox em paralelo com a N1, e o módulo depois._ Os avisos do Inbox nascem direto no catálogo da N1.
5. **E2EE desligada** (ponto 2.3). Confirma? _Recomendo desligada._

### Podem ter padrão e ser confirmadas depois

6. **Quem atende.** Membros do workspace com uma permissão nova (`inbox.view`, `inbox.reply`, `inbox.manage`)? No modo gerenciado (ADR 0020), a equipe do parceiro também atende, por um Inbox no `/admin`? _Padrão: só membros do workspace na v1; parceiro gerenciado depois._
7. **Plano e cotas.** O módulo é um item de plano (chave `inbox`)? A cota conta atendentes, conversas por mês ou as duas? _Padrão: módulo de plano, cota de atendentes._
8. **Lista das visões da barra.** Minhas, Não atribuídas, Todas, Resolvidas. "Pedidos e reservas" fica para quando existir o módulo. _Padrão: as 4 primeiras._
9. **Ferramentas do painel na v1.** Contato do CRM, enviar item do portfólio, notas internas, respostas rápidas e o Assistente. Propostas entram como "Pedidos e reservas" ou esperam o módulo próprio? _Padrão: as 5 ferramentas, propostas depois._
10. **Etiquetas e não-lidas.** Não-lidas por atendente vêm dos recibos de leitura do próprio Matrix (cada atendente tem sua conta). Etiquetas no Supabase. _Padrão: assim._
11. **Contato do consumidor.** Uma sala nova cria ou liga um contato no CRM? Por qual dado (nome do perfil Matrix, telefone do guidu.chat)? _Padrão: cria o contato com o nome do perfil e liga pelo `room_id`; o atendente mescla quando souber mais._
12. **Retenção e LGPD.** Ao excluir um contato ou um workspace, a sala é apagada no Synapse (purge pela API admin)? Por quanto tempo guardamos as conversas? _Padrão: apagar junto, sem prazo de retenção definido até o jurídico responder._
13. **Agente na conversa.** O GUIDS responde sozinho até a transferência, como no Chatwoot (com as mesmas regras de agrupamento, limites e volta ao bot)? _Padrão: sim, reusando as regras da A5b._

## 4. Plano de implantação

Etapas pequenas, cada uma com PR próprio e o "pode começar" do Marcelo. Seguem as regras do `AGENTS.md`: duas por vez, cada uma no seu worktree.

| Etapa                                     | O que entra                                                                                                                                                                                                                                                                                                                            | Migration | Depende de      |
| ----------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------- | --------------- |
| **IN0 Documentos**                        | ADR 0022 e a revisão da ADR 0014 no repositório, com as respostas da seção 3; `canais.md` atualizado (linha do chat interno); especificação do módulo em `docs/modules/inbox/`.                                                                                                                                                        | —         | Respostas 1 a 5 |
| **IN1 Prova de conceito**                 | Branch descartável: Synapse em docker local, Application Service registrado, login por JWT, página crua com lista de salas, timeline e envio, Element como consumidor, o GUIDS respondendo na sala e o status visível nos dois lados. Mede o Sliding Sync. Resultado: relatório com "segue" ou "muda".                                 | —         | IN0             |
| **IN2 Rotas**                             | Só mudança de pastas: `layout.tsx` com as guardas, `(shell)/` com o `AppShell` e todas as rotas atuais, e `cache()` em `resolveRequestWorkspaceContext`. Sem outra alteração, para revisão fácil.                                                                                                                                      | —         | Nada (pode já)  |
| **IN3 Núcleo Matrix**                     | Adaptador `matrix` em `src/core/channels/` (transações do Application Service, verificação do `hs_token`, normalização, envio em nome do usuário virtual, digitando); contas dos atendentes provisionadas por job ao entrar e sair do workspace; troca do JWT; tabelas das contas Matrix e das conversas por `room_id`; Synapse no CI. | Sim       | IN1             |
| **IN4 Janela do Inbox**                   | Módulo `inbox` no manifesto com permissões e plano; `InboxShell` (sidebar-09, cookie próprio); três colunas com `Resizable`; lista, timeline e caixa de mensagem do `chatbot-template`; status e responsável pelo state event; visões; celular; helper de e2e próprio.                                                                 | Sim       | IN2, IN3        |
| **IN5 Painel de contexto (depois da v1)** | Capacidade `inboxTools` no manifesto; contato do CRM, enviar item do portfólio, notas internas e respostas rápidas (Supabase, por `room_id`), Assistente na gaveta (ADR 0015).                                                                                                                                                         | Sim       | IN4             |
| **IN6 GUIDS na sala**                     | Serviço público `runTurn` do módulo Agentes de IA para hubs (`canais.md` §3.5); rota da sala com o Inbox como dono; transferência = atribuir um atendente; volta ao bot pelo status; regras de atendimento da A5b reaproveitadas.                                                                                                      | Talvez    | IN3, IN4        |
| **IN7 WhatsApp da Meta (v1)**             | Adaptador Meta Cloud API no núcleo (webhook com assinatura, janela de 24 horas, modelos de mensagem), conversa espelhada numa sala com o contato como usuário virtual, resposta do atendente enviada pela Meta, e a troca de rota de "agente direto" para "Inbox com agente".                                                          | Sim       | IN6             |

**Pares sugeridos:** IN1 com IN2 (não se tocam); IN3 com a função Atendente; IN4 (depois do merge da H1) com IN6; IN7 com WS1 (exclusão suave). IN5 fica para depois da v1.

**Antes da produção (vai para a F6c):** Synapse de produção com backup do banco e da mídia, monitoramento, limites de upload e o plano de escala da ADR 0022 (Conduit ou Dendrite).

## 5. Riscos

- **Sliding Sync experimental no `matrix-js-sdk`.** Mitigação: a IN1 mede isso, e existe o plano B da lista vinda do Supabase.
- **O Synapse vira dependência de produção** sem experiência operacional nossa. Mitigação: a IN1 roda num Synapse de dev, e a operação entra no checklist da F6c.
- **Dois shells para manter.** A ADR 0014 já aceita esse custo.
- **Custo dos testes.** O e2e com Synapse fica mais lento. A regra de retestar só o que falhou ajuda.
