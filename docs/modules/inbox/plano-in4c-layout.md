# Plano da IN4c — novo layout da janela do Inbox

- **Estado:** proposta para aprovação. Começa depois do "pode começar" do Marcelo.
- **Data:** 19/10/2026
- **Origem:** pedido do Marcelo em 19/10/2026: ajustar o layout do Inbox antes das features do P1 ([prioridades](../../architecture/prioridades-agentes-e-inbox.md)), com uma referência visual de inbox em três colunas.
- **Sem migration.** Só interface, textos e testes.

## 1. Contexto

A janela do Inbox (IN4a, ADR 0014 revisada em 16/10/2026) fica em tela cheia, no grupo `(fullscreen)/`, sem o `AppShell`. Hoje ela tem:

- uma barra estreita à esquerda (`sidebar-09`) com as visões (Minhas, Não atribuídas, Todas, Resolvidas) e a volta ao dashboard;
- três colunas redimensionáveis: lista, conversa e painel de contexto;
- cabeçalhos de 60 px só na lista e na conversa;
- a caixa de mensagem como `Textarea` simples com um botão ao lado.

Não há busca global, sino, modo de cor nem os dados de quem atende, que o resto do painel tem no cabeçalho do `AppShell` (`src/components/layout/shell/shell-main.tsx`).

## 2. Objetivo

Deixar a janela com a estrutura em que as features do P1 vão entrar: as abas Contato e Threads, a tradução, a janela de 24 h e as threads de bastidor. Nenhuma regra de atendimento muda.

## 3. Requisitos

### 3.1 Cabeçalho primário (60 px, largura toda)

- **Esquerda:** botão que recolhe e abre a lista de conversas. Hoje isso é feito pelo `SidebarTrigger` e pelo Ctrl/⌘+B, com o cookie `inbox_sidebar_state`, e continua assim.
- **Centro:** a busca global do painel (`ShellSearch`), a mesma do `AppShell`.
- **Direita, nesta ordem:**
  - **+ Novo:** menu com "Nova conversa", desligado com "em breve";
  - **modo de cor:** o mesmo alternador do `ShellMain`;
  - **notificações:** o `NotificationBell`, com os dados de `loadNotificationBell`;
  - **quem atende:** avatar, nome e e-mail, com o menu do `NavUser` (perfil, idioma, sair).

### 3.2 Cabeçalho secundário (60 px, largura toda)

- **Esquerda:** título "Inbox" e o subtítulo "Conversas da equipe" (ou o nome do workspace).
- **Direita, ícones com dica:**
  - **IA:** situação do GUIDS da conversa aberta (ligado, com a equipe, sem GUIDS). Nesta etapa só mostra, com o mesmo dado do cartão do GUIDS;
  - **Pagamento:** espaço reservado da mensagem com link e do checkout (IN7b e IN8), desligado com "em breve";
  - **Recolher:** fecha e abre o painel de contexto;
  - **Opções (⋯):** menu com "Configurações do Inbox" (para quem tem `inbox.manage`) e "Voltar ao dashboard".

### 3.3 Lista de conversas

- Acima da busca, **dois seletores lado a lado:**
  - **Tipo de conversa:** Minhas, Não atribuídas, Todas e Resolvidas, com as contagens. Muda a mesma visão que a barra estreita muda hoje;
  - **Canais:** "Todos os canais", só como espaço reservado nesta etapa (desligado, com o número de canais ligados quando houver).
- A busca por nome e o filtro de etiqueta continuam como estão.
- O cabeçalho próprio da lista (60 px) sai, porque o título passa para o cabeçalho secundário.

### 3.4 Painel de contexto

- **Cabeçalho com abas segmentadas** (ADR 0021, `TabsList` `segmented`): **Contato** e **Threads**.
- **Contato,** a aba padrão ao abrir uma conversa: tudo o que o painel mostra hoje (contato, atendimento, GUIDS, etiquetas).
- **Threads:** estado vazio (`Empty`) com "As threads da equipe sobre esta conversa aparecem aqui", até a SB1.
- A aba aberta vai para a URL (`?tab=contact|threads`), como `view` e `room`.

### 3.5 Caixa de mensagem

- **No padrão do chat do agente de IA** (`InputGroup` com `InputGroupTextarea` e `InputGroupAddon` `block-end`, como em `src/modules/google-business/components/specialist-chat.tsx`):
  - **campo em cima,** com a dica "Escreva uma mensagem. Enter envia, Shift+Enter quebra a linha";
  - **barra embaixo:** anexo, emoji e mais (⋯) à esquerda, todos desligados com "em breve", e **Enviar** à direita.
- Mantém o que existe: Enter envia, só leitura para quem não é atendente, falha de envio pelo `useStatus()`.

### 3.6 Celular

- **Cabeçalho primário:** a busca vira ícone e "quem atende" vira só o avatar.
- **Cabeçalho secundário:** título e o menu ⋯, com os ícones dentro do menu.
- Lista, conversa e painel continuam como hoje: lista na tela, conversa por cima e painel numa `Sheet`.

## 4. Lógica

1. **`page.tsx` do Inbox:** carrega também o que o `AppShell` carrega para o cabeçalho (seções da navegação para a busca, o sino e o usuário), com as mesmas funções, e passa ao `InboxShell`.
2. **`InboxShell`:**
   - monta os dois cabeçalhos acima do `ResizablePanelGroup`;
   - o "Recolher" usa uma `panelRef` no painel de contexto, como a lista já usa;
   - a visão passa a ser controlada também pelo seletor de tipo.
3. **Barra estreita (`sidebar-09`):** com as visões no seletor, ela fica sem função. Proposta: **sair**, e a volta ao dashboard ir para o menu ⋯ e para o "Voltar" do celular. Ver a pergunta 1.
4. **Componentes novos** em `src/modules/inbox/components/`:
   - `inbox-header.tsx` (primário e secundário);
   - `list-filters.tsx` (os dois seletores);
   - `context-tabs.tsx`;
   - `composer.tsx` (a caixa no padrão do agente).

   As peças do `ShellMain` que forem reaproveitadas (o alternador de modo de cor e o `HeaderAction`) passam a ser exportadas de `src/components/layout/shell/`, sem duplicar código.

5. **Textos** novos em `inbox.json` nos três idiomas (pt-BR, en, es).
6. Só componentes do shadcn e os componentes modelo da ADR 0021 (`Select`, `Tabs` `segmented`, `InputGroup`, `DropdownMenu`, `Tooltip`, `Avatar`, `Empty`).

## 5. Testes

- **Unitários:**
  - a visão escolhida pelo seletor vai para a URL;
  - a aba do painel vai para a URL;
  - os botões "em breve" ficam desligados e com dica.
- **e2e** (`e2e/inbox.spec.ts` e `e2e/inbox-guids.spec.ts`, no job `e2e-inbox`):
  - atualizar os seletores que mudaram (visões pelo seletor, caixa de mensagem);
  - novo caso: recolher e abrir a lista e o painel, trocar de aba, buscar pelo cabeçalho;
  - celular: lista, conversa e painel.
- Os `data-testid` que já existem ficam onde a função continua a mesma.

## 6. Aceite

- `pnpm typecheck && pnpm lint && pnpm test && pnpm build` verdes.
- `e2e-inbox` verde no CI.
- Capturas de tela em desktop, com o painel aberto e recolhido, e no celular, anexadas ao PR para o Marcelo aprovar o visual.

## 7. Perguntas

1. **Barra estreita da esquerda:** sai, com as visões no seletor e o dashboard no menu ⋯ (proposta), ou fica só com a volta ao dashboard?
2. **"+ Novo":** só "Nova conversa" (em breve) ou mais itens, como "Nova thread" e "Nova nota"?
3. **Subtítulo do cabeçalho secundário:** "Conversas da equipe" ou o nome do workspace?
