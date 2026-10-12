# ADR 0014 — Shell padrão com a sidebar-08 do shadcn

- **Status:** Proposto (aceito com o PR da U1)
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
   - **grupo secundário:** Documentação, Painel Admin e Voltar ao app;
   - **rodapé:** a conta, com Minha conta, Idioma, Tema e Sair;
   - **conteúdo:** painel `SidebarInset` com o botão de recolher e o breadcrumb.

   O cabeçalho de topo deixa de existir.

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
- Sair, Tema e Idioma ficam no menu da conta, no rodapé. O Sair continua sendo um POST para `/auth/signout` com a checagem de origem.
- A atualização de um componente do shadcn deve repetir as mudanças mínimas do item 4.
- A etapa U2 (modelo das janelas de edição) seguirá a mesma regra: componentes do shadcn em `src/components/ui/`, sem cópias próprias.
