# ADR 0014 — Shell padrão com a sidebar-08 do shadcn

- **Status:** Aceito (PR #49); revisado em 12/10/2026 (cabeçalho e regra do shadcn)
- **Data:** 12/10/2026
- **Aprovador:** Marcelo
- **Plano:** [ui-shell.md](../architecture/ui-shell.md)

## Contexto

O painel tinha duas sidebars feitas à mão (uma para `/app`, outra para `/admin` e `/platform`) e dois cabeçalhos de topo com o seletor de workspace, a conta, o idioma, o tema e o botão de sair. Cada área tinha um desenho diferente, e nenhum componente do shadcn/ui estava instalado, apesar do `components.json` existir.

Marcelo decidiu, em 12/10/2026, que `/app`, `/admin` e `/platform` usam **exatamente** o bloco `sidebar-08` do shadcn/ui (`npx shadcn@latest add sidebar-08`) e que esse modelo é o padrão do projeto.

## Decisão

1. **Um shell só.** Toda área com menu lateral usa `AppShell` (`src/components/layout/shell/app-shell.tsx`), que monta o bloco sidebar-08 na variante `inset`:
   - **topo:** seletor de workspace (`/app`) ou identidade do console (`/admin`, `/platform`);
   - **grupos de menu:** as seções geradas no servidor, com subitens recolhíveis, item ativo e selo;
   - **grupo secundário:** Documentação e Voltar ao app;
   - **rodapé:** a conta, com Minha conta, Idioma e Sair;
   - **conteúdo:** painel `SidebarInset` com o cabeçalho do conteúdo (revisão abaixo).

   O antigo cabeçalho de topo, fora do painel, deixa de existir.

2. **Não se cria sidebar própria.** Áreas novas passam as seções, o topo e o usuário para o `AppShell`. Módulos contribuem só com entradas de menu pelo manifesto (`navigation`), como antes.
3. **Origem dos componentes.** Os componentes ficam em `src/components/ui/`, o hook em `src/hooks/use-mobile.ts` e o bloco adaptado em `src/components/layout/shell/`. Eles vêm do registro oficial do shadcn (`apps/v4/registry/new-york-v4` do repositório `shadcn-ui/ui`, commit `993eb2c`). O `npx shadcn add` precisa de `ui.shadcn.com`, que a rede do ambiente de agentes bloqueia; numa máquina com acesso, o comando gera os mesmos arquivos.
4. **Mudanças mínimas nos arquivos do shadcn**, para seguir as atualizações dele:
   - os caminhos de import;
   - `bg-black/50` trocado por `bg-overlay` e `text-white` por `text-on-primary`;
   - o `checked` do `DropdownMenuCheckboxItem` passado só quando existe, por causa do `exactOptionalPropertyTypes`;
   - a formatação do Prettier.
5. **Design system.**
   - As cores do shadcn e as `--color-sidebar-*` apontam para os tokens do GUIDU no `globals.css`, no tema claro e no escuro.
   - Os tamanhos `text-xs`, `text-sm` e `text-base` e a sombra `shadow-md` entram como aliases.
   - As animações vêm do `tw-animate-css` 1.4.0.
   - O ESLint mantém `no-unknown-classes` nesses arquivos, mas libera os valores arbitrários, as variáveis CSS e o `style` do provider, só em `src/components/ui/`, `src/components/layout/shell/` e `src/hooks/`. O resto de `src/` continua sob a regra P0.
6. **Estado.** Aberta ou recolhida fica no cookie `sidebar_state` (do shadcn), lido no servidor para a primeira pintura já sair certa. Atalho Ctrl/⌘+B. No celular, o menu vira gaveta (`Sheet`).
7. **Dependências.** `radix-ui` 1.6.7 (a 1.7.0 tem menos de duas semanas) e `tw-animate-css` 1.4.0, com versões exatas.

## Consequências

- As três áreas têm o mesmo desenho e o mesmo comportamento. Corrigir ou atualizar a sidebar é mexer num lugar só.
- Subitens de um grupo ficam fechados até a pessoa abrir ou entrar numa página do grupo, como no modelo. Os e2e abrem o grupo antes de clicar num subitem (`e2e/support/sidebar.ts`).
- Sair e Idioma ficam no menu da conta, no rodapé; o Tema foi para o cabeçalho (revisão abaixo). O Sair continua sendo um POST para `/auth/signout` com a checagem de origem.
- A atualização de um componente do shadcn deve repetir as mudanças mínimas do item 4.
- A etapa U2 (modelo das janelas de edição) seguirá a mesma regra: componentes do shadcn em `src/components/ui/`, sem cópias próprias.

## Revisão de 12/10/2026 — cabeçalho do conteúdo e regra do shadcn

Marcelo definiu o cabeçalho de todas as páginas e que **todos os componentes do projeto seguem o padrão do shadcn/ui**.

1. **Cabeçalho do conteúdo** (`ShellMain`, `src/components/layout/shell/shell-main.tsx`), igual em `/app`, `/admin` e `/platform`:
   - **60 px de altura** (`h-15`) com **borda inferior** (`border-b`);
   - **esquerda:** `SidebarTrigger`, separador e o breadcrumb da página;
   - **centro:** campo de busca, o `Command` do shadcn sobre as páginas do menu gerado (Ctrl/⌘+K);
   - **direita:** modo de cor (claro ou escuro), assistente de IA (abre a gaveta interna da ADR 0015), **Console do parceiro** (`/admin`, só para membro do parceiro dono do domínio) e **Plataforma** (`/platform`, só para papel interno ativo no domínio da plataforma). Os atalhos vêm de `getConsoleAccess` (`src/core/auth/console-access.ts`); as próprias áreas continuam revalidando identidade, papel, domínio e MFA.
2. **Rolagem.** O `SidebarInset` tem a altura da tela e só o conteúdo rola: o cabeçalho fica parado e as gavetas abrem ao lado do conteúdo, abaixo do cabeçalho.
3. **O item "Painel Admin" sai da sidebar**, substituído pelos atalhos do cabeçalho.
4. **Regra do shadcn.** Todo componente de interface usa o componente do shadcn/ui equivalente em `src/components/ui/` (botão, campo, select, tabela, diálogo, abas, cartão, badge e o que mais houver). Não se cria versão própria de algo que o shadcn tem. Componentes novos vêm do registro oficial, com as mudanças mínimas do item 4. Telas antigas ainda feitas à mão migram na etapa **U3**.

   **U3a (12/10/2026):** entraram `label`, `textarea`, `select`, `native-select`, `switch`, `radio-group`, `table`, `card`, `badge`, `alert` e `tabs`, do mesmo registro (branch `main` de 12/10/2026), com uma única mudança: `text-white` virou o token `text-on-primary` no badge destrutivo, como no botão. Em formulário, a lista de opções é o `NativeSelect`: envia no `FormData` da server action e usa o seletor do celular; o `Select` (Radix) fica para listas ricas fora de formulário. O `sonner` do plano não entra: os avisos são do SmartStatusBanner (ADR 0016). O `Field` e o `SubmitButton` de `src/shared/ui/form.tsx` passam a usar `Label`, `Input` e `Button` com a mesma API. Catálogo em Plataforma › Configurações › Padrões de interface › Componentes (`/platform/design/components`).

   **U3b (12/10/2026):** as telas do `/app` (configurações, locais, módulos, execuções, propostas e conta) e os componentes compartilhados que elas usam (`ActionForm`, campos de local, formulários de módulo, botão Sair) passam ao shadcn. As janelas feitas à mão de credencial, chave MCP e convite viram `Dialog`; as tabelas viram `Table`. O `NativeSelect` vendorizado aplica o `className` no contêiner (segunda mudança mínima), para o campo ocupar a largura do formulário com a seta junto. Os campos ocultos (`type="hidden"`) continuam como `<input>`. Módulos (CRM, Portfólio, Hello World) ficam para a U3d e o protótipo congelado de Agentes de IA não muda.

   **U3c (12/10/2026):** as telas do `/admin` e do `/platform` (clientes, workspaces, usuários, parceiros, cobrança, idiomas, chaves de API, módulos, marca, jurídico e modelos) e os componentes delas (`BrandForm`, editor e aceite jurídico, seletor de papel) passam ao shadcn, assim como o checkbox do banner de avisos. As caixas de marcar usam o `Checkbox` do shadcn, que envia `on` no formulário como a nativa.

   **U3d (12/10/2026):** os formulários dos módulos (Portfólio, CRM e Hello World), as buscas de contatos e do portfólio e o botão do convite passam ao shadcn; a escolha de propriedade da hospedagem vira `RadioGroup`. Login, MFA e recuperação de senha já usavam o kit refeito na U3a. As classes de campo feitas à mão (`form-classes.ts`) saem. Fora do shadcn ficam só os campos ocultos e o protótipo congelado de Agentes de IA, que sai na etapa A2.

   **U3e (12/10/2026):** o ESLint (`no-restricted-syntax` em `eslint.config.mjs`) barra `<button>`, `<input>`, `<select>`, `<textarea>` e `<table>` crus em `src/**/*.tsx` fora de `src/components/ui/`; `<input type="hidden">` continua liberado. O protótipo congelado de Agentes de IA fica fora da regra até sair na A2. A demonstração da gaveta em `/platform/design/workbench`, que tinha escapado da U3d, passa a usar `Button`, `Table`, `Label` e `Textarea`.

5. **Dependência.** `cmdk` 1.1.1 (base do `Command`), versão exata.

## Revisão de 16/10/2026 — Inbox em tela cheia (sidebar-09)

Marcelo definiu que o Inbox do chat interno ([ADR 0023](0023-chat-interno-como-cliente-matrix.md)) abre em tela cheia, com o bloco `sidebar-09` do shadcn/ui, e que o foco da janela é a conversa: tudo o que é preciso para conduzir um atendimento deve estar ao alcance sem voltar ao dashboard.

1. **Exceção única ao "um shell só".** A rota `/app/[workspaceSlug]/inbox` usa o `InboxShell`, montado a partir do bloco `sidebar-09` do registro oficial, com as mesmas mudanças mínimas do item 4. Todas as demais rotas continuam no `AppShell` com a sidebar-08. Outro shell exige nova ADR.
2. **Rotas.** Para que o Inbox não herde a sidebar-08, `src/app/app/[workspaceSlug]/` passa a ter (etapa IN2):
   - `layout.tsx`: só as guardas (sessão, aceite legal e contexto do workspace), sem shell;
   - `(shell)/layout.tsx`: o `AppShell`, com todas as rotas atuais movidas para `(shell)/` (as URLs não mudam);
   - `(fullscreen)/inbox/`: o `InboxShell` e as páginas do Inbox (etapa IN4).

   `resolveRequestWorkspaceContext` é envolvida em `cache()` do React para não consultar o banco duas vezes por requisição.

3. **Barra de ícones exclusiva do Inbox.** A barra estreita do `sidebar-09` não repete o menu do console:
   - **topo:** as visões do Inbox: Minhas, Não atribuídas, Todas e Resolvidas (outras, como Pedidos e reservas, entram quando existirem);
   - **base:** no máximo **um** ícone, **Dashboard**, que volta para a navegação normal (`/app/[workspaceSlug]`).

   O seletor de workspace, o menu da conta e a busca ⌘K não aparecem no Inbox. Trocar de workspace ou de conta é feito pelo dashboard.

4. **Tudo para conduzir a conversa fica na janela.** Layout em três colunas (`Resizable`): lista de conversas, conversa e painel de contexto. Edições abrem em gaveta interna dentro da janela, nunca por navegação para outra tela. Na v1 o painel mostra o contato, o status, o responsável e as etiquetas; as ferramentas do atendimento (itens do portfólio, notas internas, respostas rápidas, Assistente de IA) entram depois da v1.
5. **O Inbox não lê tabelas de outros módulos.** Cada ferramenta do painel usa o serviço público do módulo dono (Adendo §7) e respeita habilitação, plano e permissão do mesmo jeito que o resto do console. **[Proposta]** Módulos contribuem ferramentas para o painel pelo manifesto (capacidade `inboxTools`, com chave do componente e permissão exigida), como já fazem com `navigation`.
6. **Estado da sidebar.** O `InboxShell` usa um cookie próprio (`inbox_sidebar_state`), para que recolher a barra no Inbox não recolha a sidebar-08 do resto do console.
7. **Celular.** A lista ocupa a tela. Ao abrir uma conversa, ela empilha por cima com botão de voltar, e o painel de contexto abre como gaveta (`Sheet`).
8. **Função Atendente.** O usuário com a função de workspace Atendente vê só o dashboard e o Inbox (especificação do Inbox §3).

### Consequências

- O console passa a ter dois shells, com fronteira explícita: o Inbox e todo o resto. Atualizar o shadcn significa atualizar os dois blocos.
- Mover as rotas atuais para `(shell)/` é uma mudança só de pastas, mas toca todos os arquivos de página. É um PR separado (IN2), sem outras alterações, para revisão fácil.
- Os e2e do Inbox não usam `e2e/support/sidebar.ts`; ganham um helper próprio para a barra de ícones e o painel de contexto.
- Uma ferramenta que hoje só existe como tela do dashboard precisa ganhar versão de painel ou gaveta antes de entrar no Inbox. Essa é a regra que mantém o atendente dentro da conversa.

## Revisão de 19/10/2026 — novo layout do Inbox (IN4c)

Marcelo pediu um novo layout da janela do Inbox antes das features do P1 ([plano da IN4c](../modules/inbox/plano-in4c-layout.md)). Muda o item 3 da revisão de 16/10/2026; os demais continuam valendo.

1. **A barra estreita do `sidebar-09` sai.** As visões (Minhas, Não atribuídas, Todas, Resolvidas) passam para um seletor acima da busca da lista, ao lado de um seletor de canais, e o Dashboard vai para o menu ⋯ do cabeçalho secundário.
2. **Dois cabeçalhos de 60 px** em toda a largura:
   - **primário:** botão que recolhe a lista (o mesmo cookie `inbox_sidebar_state` e Ctrl/⌘+B), a busca ⌘K do console, "+ Novo", modo de cor, notificações e o menu da conta;
   - **secundário:** título "Inbox" com "Central de Atendimento - {workspace}", e as ações IA, Pagamento, Recolher (o painel de contexto) e ⋯.
3. **A busca ⌘K e o menu da conta passam a aparecer no Inbox.** São os mesmos componentes do `AppShell` (`ShellSearch`, `NotificationBell`, `HeaderUserMenu`, `ThemeToggle`). O seletor de workspace continua só no dashboard.
4. **Painel de contexto com abas** segmentadas Contato e Threads (ADR 0021), com a aba na URL (`?tab=threads`).
5. **Caixa de mensagem no padrão dos chats de agente de IA** (`InputGroup`).
6. Uma coluna recolhida não renderiza o conteúdo, para o teclado não alcançar o que está fora da vista.

## Revisão proposta de 24/10/2026 — editor do Cliente Hub em tela cheia

- **Status:** proposta do gerente de projeto (decisão técnica CH3 da [especificação do Cliente Hub](../modules/cliente-hub/especificacao.md)); vira aceita com a aprovação do Marcelo no PR.

O editor da área da loja tem três painéis com a prévia de celular no centro, como o editor do Klaviyo. Com a sidebar-08 aberta, não cabe em telas de 1280 px. Como o item 1 da revisão de 16/10/2026 diz que outro shell exige nova ADR, esta revisão abre a **segunda exceção**:

1. A rota `/app/[workspaceSlug]/cliente-hub` fica no grupo `(fullscreen)/`, ao lado do Inbox, sem a sidebar-08.
2. **Não nasce um shell novo**: o editor reaproveita as peças do cabeçalho primário do Inbox (60 px com borda inferior, `ShellSearch` não entra, `ThemeToggle` e `HeaderUserMenu` entram) e um botão **Dashboard** à esquerda. Os três painéis usam `Resizable`, como o Inbox.
3. Abaixo de 1024 px o editor mostra o estado "Abra no computador para editar" (CH13).
4. Qualquer outra tela cheia continua exigindo revisão desta ADR.
