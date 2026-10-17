# ADR 0023 — Chat interno (Inbox) como cliente Matrix

- **Status:** Proposto; vira aceito com o merge do PR da etapa IN0
- **Data:** 16/10/2026
- **Aprovador:** Marcelo
- **Decisão de origem:** decisão de Marcelo em 16/10/2026, com as respostas da mesma data registradas no [plano do Inbox](../modules/inbox/plano.md) §0. O rascunho do Marcelo tinha o número 0022, que ficou com a Central de Eventos (etapa H1).
- **Relaciona-se com:** [ADR 0002](0002-jobs-e-hospedagem.md), [ADR 0006](0006-manifesto-de-modulos.md), [ADR 0011](0011-camada-de-canais-no-nucleo.md), [ADR 0014](0014-shell-padrao-sidebar-08.md) (revisão de 16/10/2026: Inbox em tela cheia), [ADR 0020](0020-modo-de-servico-gerenciado.md); [ADR 0022](0022-central-de-eventos.md) (Central de Eventos, H1); [canais.md](../modules/ai-agents/canais.md) §1 e §3; [especificação do Inbox](../modules/inbox/especificacao.md).

## Contexto

O console precisa de um chat de atendimento do comerciante, no estilo do Chatwoot, dentro do dashboard. O `canais.md` previa esse chat interno como um módulo hub com armazenamento próprio e tratava o Matrix como mais um adaptador de canal.

O guidu.chat, o app do consumidor, vai conversar com os comerciantes. Ele funciona como um widget de site e não foi feito para dados sensíveis. Se o chat interno guardasse as conversas em tabelas próprias, a chegada do guidu.chat exigiria uma ponte entre essas tabelas e o Matrix. Isso cria duas fontes da verdade, sincronização nos dois sentidos e risco de duplicidade.

A arquitetura do ecossistema já define o Matrix como espinha dorsal de eventos, com o Synapse rodando no EasyPanel.

## Decisão

1. **O Matrix é a fonte da verdade das conversas do Inbox.** Cada conversa é uma sala Matrix. Mensagens, participantes e histórico vivem no homeserver, não em tabelas do console.
2. **Um único Synapse, fechado.** Um homeserver e um `server_name` atendem todos os parceiros e workspaces; a marca do parceiro aparece só na interface. Federação e cadastro aberto ficam desligados. O `server_name` de produção é `guidu.chat` (servidor em `matrix.guidu.chat`, com `.well-known` na raiz); o de dev é `dev.guidu.chat`. O `server_name` não muda depois de criado. Instalação: [synapse-easypanel.md](../operacao/synapse-easypanel.md).
3. **Sem criptografia de ponta a ponta.** As salas são criadas sem E2EE e o núcleo reserva o evento `m.room.encryption` ao seu próprio usuário. O transporte usa TLS e o servidor é nosso. Motivo: o guidu.chat não foi feito para dados sensíveis, e com E2EE o agente, a busca e a auditoria deixariam de ler as mensagens.
4. **O Inbox é um cliente Matrix**, construído com `matrix-js-sdk` (Apache-2.0). A janela usa o bloco `sidebar-09` do shadcn em tela cheia (revisão de 16/10/2026 da ADR 0014), e a timeline e a caixa de mensagem vêm do `shadcn-ui/chatbot-template` (MIT). Não se usa fork do Element, que é AGPL-3.0. O Synapse é AGPL-3.0 e roda sem modificação, como serviço separado.
5. **O console e o guidu.chat são dois clientes das mesmas salas.** O consumidor escreve no guidu.chat e o atendente lê e responde no console, sem integração entre os dois.
6. **O Supabase guarda o que é de negócio e o que é interno**, ligado pelo `room_id`: contato do CRM, workspace, plano, uso, auditoria, **etiquetas e notas internas**. Não guarda cópia das mensagens. O consumidor é membro da sala e lê tudo o que está nela, inclusive os state events; por isso nada interno vai para a sala.
7. **O estado de atendimento fica na sala**, como state event versionado (`chat.guidu.conversation`, com status aberta, pendente ou resolvida e responsável). O console, o guidu.chat e o agente leem o mesmo estado. O consumidor também vê esse estado, o que é aceito.
8. **O agente entra na sala pelo adaptador Matrix do núcleo, em modo Application Service**, com usuários virtuais num namespace reservado (`@_guidu_.*`). Vale a regra 4 da ADR 0011: a rota da sala pertence ao Inbox, que aciona o agente pelo serviço público do módulo Agentes de IA e envia a resposta pelo serviço de saída do núcleo, em nome do usuário virtual do agente. As regras de atendimento da A5b (agrupamento, limites, transferência e volta ao bot) valem também aqui. O núcleo usa o `as_token` também na API admin do Synapse (o usuário remetente do Application Service é admin); a conta administrativa criada na instalação fica só para o primeiro acesso. As transações são deduplicadas pelo `event_id`, gravadas e processadas num job.
9. **Contas dos atendentes são provisionadas pelo núcleo**, pela API admin do Synapse, quando o usuário entra no workspace, e desativadas quando sai. O atendente nunca vê credenciais Matrix: o console emite um JWT curto para o usuário já autenticado e o navegador o troca por um token Matrix (login JWT do Synapse). A prova de conceito mostrou que **o segredo do JWT vale tanto quanto um admin** (com ele se entra como qualquer conta, inclusive a do núcleo, e o Synapse aceita JWT sem `exp` e reusado). Por isso: assinatura RS256 com a chave privada só no servidor do console; o console só assina `sub` de atendentes (localpart opaco com prefixo `u_`, sem o id interno do usuário) e sempre com `exp` curto; a sessão Matrix fica guardada no navegador, com refresh token, para não fazer um login por carregamento; o limite de login do Synapse (`rc_login`) é ajustado.
10. **Sliding Sync para a lista "Todas" e para a sala aberta; visões e busca pelo Supabase.** Na prova (IN1), com 300 salas, a primeira página veio em 31 ms contra 2,2 s do sync clássico. Mas o Synapse não filtra por state event customizado nem por nome de sala (`room_name_like` dá erro). Por isso o núcleo espelha no Supabase, por `room_id`, o status e o responsável, e as visões Minhas, Não atribuídas e Resolvidas e a busca saem de lá. Relatório: [prova-de-conceito.md](../modules/inbox/prova-de-conceito.md).
11. **O comerciante escolhe, por número de WhatsApp, onde atende:** no Chatwoot, como hoje (o GUIDS como Agent Bot), ou no Inbox. No Inbox, o número da Meta fica ligado direto ao GUIDU pelo adaptador Meta Cloud API do núcleo, e cada conversa do WhatsApp vira uma sala com o contato como usuário virtual. **O Chatwoot não é espelhado no Inbox.** Um número fica num lugar de cada vez; trocar é trocar a rota (ADR 0011), e o histórico fica onde estava.
12. **Ciclo de vida.** A sala acompanha o workspace: quando o workspace entra na exclusão suave, as salas ficam inacessíveis; quando ele é apagado de vez, o núcleo apaga as salas no Synapse (purge pela API admin).

## Esclarecimento sobre a ADR 0011

A regra 2 da ADR 0011 diz que um módulo nunca chama o provedor diretamente. O navegador do atendente falando com o Synapse pelo `matrix-js-sdk` não viola essa regra: quem fala é o cliente do próprio usuário humano, com a credencial dele, e não o módulo em nome do workspace. Continuam com o núcleo: o registro do Application Service, o provisionamento de contas, a emissão do JWT, a rota da sala, o envio em nome do agente, o adaptador Meta e a auditoria.

## Consequências

- A linha "Chat interno" do `canais.md` passa a descrever um cliente Matrix, e não um hub com armazenamento próprio.
- O guidu.chat nasce integrado: é um segundo cliente sobre as salas que o console já usa.
- Recursos de inbox que o Matrix não tem (etiquetas, notas) ficam no Supabase por `room_id`. Não-lidas por atendente vêm dos recibos de leitura do Matrix, porque cada atendente tem sua conta.
- O Chatwoot continua como opção do comerciante. Trocar um número de lugar é mudar a rota (ADR 0011).
- Ligar números de clientes direto ao GUIDU exige o app da Meta verificado (verificação da empresa), com prazo próprio.
- O Synapse passa a ser dependência de produção do console, com backup, monitoramento e plano de escala (migração para Conduit ou Dendrite já prevista). A operação de produção entra na F6c.
- Os avisos do Inbox (conversa nova, atribuição, sem resposta) entram no catálogo da Central de Eventos ([ADR 0022](0022-central-de-eventos.md)).
- Os e2e precisam de um Synapse no CI, com porta deslocada pelo `E2E_PORT_OFFSET`.
- **Prova de conceito antes da implementação completa (IN1):** Application Service registrado; login JWT; console com lista de salas, timeline e envio; o Element fazendo papel de consumidor; a IA respondendo na sala; e o status da conversa visível nos dois lados.
