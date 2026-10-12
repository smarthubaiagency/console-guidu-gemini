# Shell padrão (sidebar-08)

Decisões em [ADR 0014](../adr/0014-shell-padrao-sidebar-08.md) (shell, cabeçalho e regra do shadcn) e [ADR 0015](../adr/0015-janela-de-edicao-gaveta-interna.md) (gaveta interna). Toda área com menu lateral usa este shell; não se cria sidebar nem cabeçalho próprios, e todo componente usa o equivalente do shadcn em `src/components/ui/`.

## Peças

| Arquivo                                              | Papel                                                                       |
| ---------------------------------------------------- | --------------------------------------------------------------------------- |
| `src/components/layout/shell/app-shell.tsx`          | Server component: provider, sidebar e painel inset com a altura da tela     |
| `src/components/layout/shell/shell-main.tsx`         | Cabeçalho de 60 px, conteúdo com rolagem e gaveta do assistente             |
| `src/components/layout/shell/shell-search.tsx`       | Busca do cabeçalho: `Command` do shadcn sobre as páginas do menu (Ctrl/⌘+K) |
| `src/core/auth/console-access.ts`                    | Quais atalhos de console (`/admin`, `/platform`) o cabeçalho mostra         |
| `src/components/layout/shell/shell-sidebar.tsx`      | O bloco sidebar-08: topo, menu, links secundários e conta                   |
| `src/components/layout/shell/nav-main.tsx`           | Seções geradas no servidor (`NavSection[]`), subitens recolhíveis e selo    |
| `src/components/layout/shell/nav-secondary.tsx`      | Documentação e Voltar ao app                                                |
| `src/components/layout/shell/nav-user.tsx`           | Menu da conta: Minha conta, Idioma e Sair                                   |
| `src/components/layout/shell/workspace-switcher.tsx` | Topo do `/app`: marca, workspace atual e troca de workspace                 |
| `src/components/layout/shell/console-header.tsx`     | Topo do `/admin` e do `/platform`: marca e nome do console                  |
| `src/components/layout/shell/shell-breadcrumb.tsx`   | Breadcrumb do item ativo (seção › grupo › página)                           |
| `src/components/layout/workbench/*`                  | Gaveta interna: `WorkbenchLayout`, `WorkbenchPanel`, `WorkbenchDrawer`      |
| `src/components/ui/*`, `src/hooks/use-mobile.ts`     | Componentes do shadcn/ui                                                    |

## Uso numa área nova

```tsx
import { AppShell } from "@/components/layout/shell/app-shell";
import { ConsoleHeader } from "@/components/layout/shell/console-header";

export default async function Layout({ children }) {
  // Guard de servidor primeiro (a sidebar só desenha).
  const identity = await requireAlgumaCoisaPage("/rota");
  return (
    <AppShell
      access={await getConsoleAccess(identity.userId)}
      area="admin"
      sections={translateNavigation(minhasSecoes, "partner", t)}
      header={<ConsoleHeader href="/rota" brandName={...} title={...} subtitle={...} />}
      user={{ email: identity.email, role: "..." }}
    >
      {children}
    </AppShell>
  );
}
```

- **Menu:** vem do servidor, como `NavSection[]` (`src/core/module-runtime/navigation.ts`), já filtrado por permissão e traduzido por `translateNavigation`. A autorização continua no servidor; a sidebar só desenha.
- **Item ativo:** o de rota mais específica (`nav-active.ts`). O grupo que contém o item ativo abre sozinho.
- **Textos:** namespace `shell`, nos três idiomas.
- **Estado:** cookie `sidebar_state`; atalho Ctrl/⌘+B; gaveta abaixo de 768 px.

## Cabeçalho (60 px)

| Lado     | Conteúdo                                                                                       |
| -------- | ---------------------------------------------------------------------------------------------- |
| Esquerda | `SidebarTrigger`, separador e breadcrumb da página                                             |
| Centro   | Busca (`Command`) sobre as páginas do menu; Ctrl/⌘+K abre                                      |
| Direita  | Modo de cor, assistente de IA, Console do parceiro (se membro) e Plataforma (se papel interno) |

As páginas não repetem o breadcrumb nem criam cabeçalho próprio: começam pelo título (`ModulePageHeader`, com `actions` para botões como "Novo"). O cabeçalho fica parado e só o conteúdo rola.

## Gaveta interna (ADR 0015)

Edição de registro e chat abrem na gaveta interna, nunca em modal ou página separada. Numa lista de registros, use `RecordWorkbench`: a página (server component) lê `?edit=` e passa o formulário como `panel`.

```tsx
const editKey = (await searchParams).edit ?? null; // "new" ou o id
const panel =
  editKey === "new" ? (
    <WorkbenchPanel title="Novo contato">
      <ContactForm />
    </WorkbenchPanel>
  ) : registro ? (
    <WorkbenchPanel title={registro.name}>
      <ContactForm values={registro} />
    </WorkbenchPanel>
  ) : null;

return (
  <RecordWorkbench
    main={<Lista />} // links para `?edit=<id>` e botão "Novo" para `?edit=new`
    panel={panel}
    panelLabel="Contato"
    closeHref={base} // a lista sem o registro
    editKey={editKey}
    defaultPanelSize="wide" // formulários longos, como o Portfólio
  />
);
```

Para conteúdo que não é registro de lista (um chat, um painel), use `WorkbenchLayout` diretamente:

```tsx
<WorkbenchLayout
  left={<Lista />} // opcional; vira Sheet no celular
  leftLabel="Conversas"
  main={<Conteudo />}
  panelLabel="Assistente"
  panelOpen={aberto}
  onPanelOpenChange={setAberto}
  panel={<WorkbenchPanel title="Assistente">…</WorkbenchPanel>}
/>
```

- 350 px empurra o conteúdo; 700 px (botão de expandir) cobre parte dele; abaixo de `lg`, largura total.
- Esc fecha, mesmo com o foco fora da gaveta; o foco entra ao abrir e volta a quem abriu ao fechar.
- A edição tem URL própria (`?edit=<id>`).
- Referência viva: `/platform/design/workbench`.

## Atualizar o shadcn

Baixe o arquivo novo do registro (`apps/v4/registry/new-york-v4/ui/<nome>.tsx` em `shadcn-ui/ui`) ou rode `npx shadcn@latest add <nome>` numa máquina com acesso a `ui.shadcn.com`. Depois, repita as mudanças mínimas listadas na ADR 0014 (item 4) e rode o e2e `e2e/shell.spec.ts`.
