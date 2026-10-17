# Plano da IN4: a tela do Inbox

- **Data:** 17/10/2026. Base: `main` com IN2 (rotas), IN3 (núcleo Matrix), AT1 (Atendente), H1 (Central de Eventos) e WS1 (exclusão suave).
- **Estado:** respostas do Marcelo de 17/10/2026 na seção 6. IN4a entregue na branch `claude/optimistic-lamport-rjehmm`, esperando PR: o que entrou, como testar e as decisões adotadas por padrão em [janela-inbox.md](janela-inbox.md). IN4b a seguir, em paralelo com a IN6.

## 1. O que você vai ver no fim

Uma tela em `/app/<workspace>/inbox`, em tela cheia, parecida com o Chatwoot:

- **Barra estreita à esquerda** com as visões **Minhas**, **Não atribuídas**, **Todas** e **Resolvidas**, e embaixo um único botão para voltar ao **Dashboard**.
- **Coluna da lista:** as conversas da visão escolhida, com nome do cliente, última mensagem, hora, quem atende e a marca de não lida. Tem busca por nome.
- **Coluna da conversa:** as mensagens, o "digitando..." e a presença, e a caixa para responder.
- **Painel de contexto à direita:** o contato, o status (aberta, pendente ou resolvida), o responsável e as etiquetas. Daí o atendente assume a conversa, resolve, reabre, atribui (quem tem permissão) e põe etiquetas, sem sair da tela.
- As três colunas podem ser redimensionadas. No celular, viram três telas em sequência: lista, depois conversa, depois contexto.

As ferramentas do painel (portfólio, notas internas, respostas rápidas, Assistente de IA) ficam para depois da v1, como você decidiu.

## 2. Divisão proposta em duas entregas

| Entrega                               | O que entra                                                                                                                                                                                                                                                                                                                                                                                                                                                           | Banco                                                               |
| ------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------- |
| **IN4a Janela e conversa**            | Módulo `inbox` no catálogo de módulos e de planos; a janela com a barra de visões (bloco `sidebar-09`, que guarda o próprio estado recolhido/aberto); as três colunas; a lista das visões; abrir, ler e responder uma conversa; "digitando" e presença; status e responsável (assumir, resolver, reabrir, atribuir); o celular; a sessão do chat guardada no navegador (para não fazer login no chat a cada carga de página); a porta de entrada de teste da seção 4. | Sem migration nova                                                  |
| **IN4b Contexto, etiquetas e avisos** | Etiquetas (catálogo por workspace e etiqueta por conversa); não lidas; o contato do CRM ligado à conversa (criado com o nome do perfil quando a conversa nasce); avisos na Central de Eventos (conversa nova, atribuída a mim, sem resposta); a cota de atendentes do plano.                                                                                                                                                                                          | Migration `20261130090000` (etiquetas e ligação conversa ↔ contato) |

Assim a IN4a fica revisável sozinha (só tela e uso do que a IN3 já entregou), e a IN4b junta tudo o que mexe no banco.

## 3. Como funciona por dentro (resumo)

- A tela é um **cliente Matrix** no navegador (`matrix-js-sdk` 43, a mesma versão da prova; dependência nova, prevista na ADR 0023). O atendente entra no chat com o JWT de 60 s que a IN3 já entrega.
- A lista **Todas** e a conversa aberta vêm do Synapse pelo Sliding Sync (rápido na prova: ~150 ms para 50 conversas). As visões **Minhas**, **Não atribuídas** e **Resolvidas** e a busca vêm do espelho no Supabase (`matrix_rooms`), porque o Matrix não filtra por status; a prova já tinha mostrado isso.
- Status e responsável continuam sendo da sala (evento `chat.guidu.conversation`); mudar pela tela grava na sala e o núcleo espelha.
- Componentes do shadcn: o bloco `sidebar-09`, `resizable` e `scroll-area`, e a lista, a timeline e a caixa de mensagem adaptadas do `chatbot-template` (MIT). Cards e títulos seguem o padrão U4. Mensagens de erro e sucesso pelo `SmartStatusBanner`.
- O Atendente vê só o dashboard e o Inbox (já é assim desde a AT1). Com o workspace em exclusão suave, o Inbox não abre (a IN3 já recusa a sessão do chat).
- **Testes:** unidade com Synapse falso; e2e com o Synapse local no job de e2e do CI (hoje ele só está no job de banco), com helper próprio para a barra de visões e o painel, como pede a ADR 0014.

## 4. Perguntas (minha sugestão entre parênteses)

1. **Dividir em IN4a e IN4b, nessa ordem?** (Sim. Dois PRs menores; a IN4b depende da IN4a.)
2. **De onde vêm as conversas para testar?** Hoje nada cria conversa: o guidu.chat ainda não existe, e o WhatsApp da Meta é a IN7. Proposta: o cliente, no Element, chama o endereço da loja (cada workspace ganha um endereço próprio no chat); o núcleo recusa a sala que o cliente criou (regra da IN3) e abre uma sala nova, do jeito certo, convidando o cliente. Isso também serve depois para o guidu.chat. (Sim, entra na IN4a.)
3. **Cota de atendentes quando o plano não define número:** conta como atendente quem pode responder no Inbox (Dono, Admin, Editor e Atendente). Ao passar do limite, o convite de mais um é recusado com aviso; quem já está continua. (Limite provisório de 5 por workspace, editável no catálogo de planos.)
4. **Aviso de "conversa sem resposta":** depois de quanto tempo sem resposta do atendente? (15 minutos, fixo na v1; vira configuração depois.)
5. **Quem recebe o aviso de conversa nova:** só os atendentes do workspace, no sino. (Sim. E-mail fica desligado por padrão, e cada um pode ligar nas preferências.)
6. **Aviso na aba do navegador:** mostrar o número de conversas não lidas no título da aba, sem som na v1. (Sim.)
7. **Quem pode resolver e reabrir:** quem pode responder (Dono, Admin, Editor e Atendente). Atribuir a outra pessoa só Dono e Admin. (Assim, como na especificação.)
8. **Paralelo:** o plano do Inbox sugere a IN6 (GUIDS respondendo na sala) junto com a IN4. Como a IN6 precisa das salas da IN4a, proponho **IN4a sozinha primeiro**, e depois **IN4b em paralelo com a IN6**. (Sim.)

## 5. Fora desta etapa

Ferramentas do painel (IN5), GUIDS na sala (IN6), WhatsApp da Meta (IN7), visão Pedidos e reservas, Inbox do parceiro no modo gerenciado e a dívida técnica das chamadas ao Synapse dentro da transação (anotada em `docs/pendencias.md`).

## 6. Respostas do Marcelo (17/10/2026)

1. Sim, IN4a e depois IN4b.
2. Sim, a conversa de teste nasce do Element chamando o endereço da loja.
3. **Só atende quem for adicionado como atendente, mesmo sendo admin.** O papel (Dono, Admin, Editor) não basta: a pessoa precisa ser marcada como atendente na Equipe. A função Atendente já vem marcada. A cota conta os marcados.
4. 15 minutos.
5. Aviso de conversa nova só para os atendentes.
6. Sim, número de não lidas no título da aba.
7. Qualquer atendente pode reabrir.
8. Sim, IN4a sozinha; depois IN4b em paralelo com a IN6.

### O que muda com a resposta 3

- Nasce a marca "atendente" por membro do workspace (na Equipe, quem tem permissão de gerenciar o Inbox marca e desmarca). Quem tem a função Atendente é sempre atendente.
- Só os marcados ganham conta no chat, abrem o Inbox, respondem, assumem, resolvem e reabrem. Hoje (IN3) a conta é dada pelo papel; isso passa a olhar a marca.
- Atribuir conversas a outros, criar etiquetas e marcar atendentes continua com Dono e Admin.
- **Dono e Admin que não forem atendentes abrem o Inbox só para ver** (escolha do Marcelo, 17/10/2026): leem as conversas e atribuem, sem responder, assumir, resolver ou reabrir, e não contam na cota. Ganham conta no chat só de leitura (sem permissão de enviar na sala). Editor não marcado não abre.
- Por isso a IN4a passa a ter migration (`20261130090000`): a marca, a cota e o ajuste das regras da IN3. As etiquetas da IN4b ficam na migration seguinte (`20261201090000`).
