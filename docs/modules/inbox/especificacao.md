# Inbox — especificação v0.1

- **Data:** 16/10/2026
- **Estado:** proposta da etapa IN0, para aprovação no PR. Decisões do Marcelo de 16/10/2026 marcadas **[Decidido]**; o resto é **[Proposta]**.
- **Base:** [ADR 0023](../../adr/0023-chat-interno-como-cliente-matrix.md) (chat interno como cliente Matrix) e a revisão de 16/10/2026 da [ADR 0014](../../adr/0014-shell-padrao-sidebar-08.md) (Inbox em tela cheia). Plano de etapas em [plano.md](plano.md).

## 1. O que é

O Inbox é o atendimento do comerciante dentro do dashboard, no estilo do Chatwoot: uma janela em tela cheia com a lista de conversas, a conversa e o painel de contexto. Cada conversa é uma sala Matrix. O GUIDS do workspace pode atender sozinho e transferir para um atendente.

## 2. Escopo da v1

**[Decidido]**

- **Canais:** conversas nativas do Matrix (o Element faz o papel do guidu.chat nos testes) e o **WhatsApp da Meta** ligado direto ao GUIDU. O Chatwoot continua como alternativa, escolhida por número, e não é espelhado.
- **Visões:** Minhas, Não atribuídas, Todas e Resolvidas.
- **Estado da conversa:** aberta, pendente ou resolvida, com responsável, no state event `chat.guidu.conversation`.
- **Etiquetas** no Supabase, por `room_id`. **Não-lidas** pelos recibos de leitura do Matrix.
- **Contato:** uma sala nova cria um contato no CRM com o nome do perfil, ligado pelo `room_id`; o atendente mescla quando souber mais.
- **GUIDS na sala** com as mesmas regras da A5b: agrupamento, máximo de mensagens, caracteres e intervalo, transferência e volta ao bot quando a conversa volta para "pendente".
- **Sem criptografia de ponta a ponta.**

**Fora da v1:** as ferramentas do painel de contexto (itens do portfólio, notas internas, respostas rápidas, Assistente de IA), a visão Pedidos e reservas, o Inbox do parceiro no modo gerenciado e outros canais (Evolution, Chatwoot espelhado).

## 3. Acesso

**[Decidido]** Nova função de workspace **Atendente** (chave `attendant`), que só entra no dashboard e no Inbox.

**[Proposta]** Permissões novas do módulo:

| Permissão      | O que libera                                                                | Owner | Admin | Editor | Viewer | Atendente |
| -------------- | --------------------------------------------------------------------------- | :---: | :---: | :----: | :----: | :-------: |
| `inbox.view`   | Abrir o Inbox e ler as conversas                                            |   ✓   |   ✓   |   ✓    |        |     ✓     |
| `inbox.reply`  | Responder, assumir uma conversa não atribuída, mudar status e etiquetas     |   ✓   |   ✓   |   ✓    |        |     ✓     |
| `inbox.manage` | Atribuir a outros, criar etiquetas, escolher onde cada número atende (rota) |   ✓   |   ✓   |        |        |           |

O Atendente não vê configurações, módulos, cobrança nem outras telas. O dashboard dele mostra só o atalho para o Inbox e o que for dele.

## 4. Plano e cota

**[Decidido]** O Inbox é um módulo de plano (chave `inbox`), com **cota de atendentes**.

**[Proposta]** Conta como atendente todo membro do workspace com `inbox.reply`. Ao atingir a cota, o convite de um novo membro com essa permissão é recusado com aviso; quem já está continua atendendo.

## 5. Dados

**[Proposta]** As tabelas nascem nas etapas IN3 e IN4, com as políticas de isolamento por workspace de sempre.

- **Contas Matrix** (núcleo): usuário, `mxid`, situação (ativa, desativada) e datas. Sem senha nem token guardado.
- **Salas** (módulo): workspace, `room_id`, origem (Matrix ou Meta), conversa do núcleo (para as da Meta), contato do CRM e datas.
- **Etiquetas** (módulo): catálogo por workspace e a ligação etiqueta × sala.

As mensagens não são copiadas para o Supabase.

## 6. Ciclo de vida

**[Decidido]** O workspace ganha exclusão suave (etapa WS1), e a sala acompanha o mesmo prazo: inacessível durante a exclusão suave e apagada no Synapse quando o workspace for apagado de vez.

**[Proposta]** Um membro que sai do workspace tem a conta Matrix desativada e sai das salas daquele workspace.

## 7. Avisos

**[Proposta]** Conversa nova, conversa atribuída a mim e conversa sem resposta há X minutos entram como eventos no catálogo da Central de Eventos ([ADR 0022](../../adr/0022-central-de-eventos.md)), com o sino como canal padrão.

## 8. Dúvidas em aberto

1. ~~Domínio do Synapse de dev~~ **Resolvido (17/10/2026):** o Synapse de teste no EasyPanel fica com `server_name` `multica-synapse.dtjkix.easypanel.host`, só para testes e descartável. O de dev e o de produção nascem depois com `dev.guidu.chat` e `guidu.chat`. Por isso o código nunca fixa o `server_name`: ele vem de variável de ambiente.
2. Tempo para o aviso de "conversa sem resposta".
