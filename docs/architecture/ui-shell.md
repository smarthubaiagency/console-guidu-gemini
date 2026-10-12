# Shell padrão (sidebar-08)

Decisão em [ADR 0014](../adr/0014-shell-padrao-sidebar-08.md). Toda área com menu lateral usa este shell; não se cria sidebar própria.

## Peças

| Arquivo                                              | Papel                                                                            |
| ---------------------------------------------------- | -------------------------------------------------------------------------------- |
| `src/components/layout/shell/app-shell.tsx`          | Server component: provider, sidebar, painel inset, botão de recolher, breadcrumb |
| `src/components/layout/shell/shell-sidebar.tsx`      | O bloco sidebar-08: topo, menu, links secundários e conta                        |
| `src/components/layout/shell/nav-main.tsx`           | Seções geradas no servidor (`NavSection[]`), subitens recolhíveis e selo         |
| `src/components/layout/shell/nav-secondary.tsx`      | Documentação, Painel Admin e Voltar ao app                                       |
| `src/components/layout/shell/nav-user.tsx`           | Menu da conta: Minha conta, Idioma, Tema e Sair                                  |
| `src/components/layout/shell/workspace-switcher.tsx` | Topo do `/app`: marca, workspace atual e troca de workspace                      |
| `src/components/layout/shell/console-header.tsx`     | Topo do `/admin` e do `/platform`: marca e nome do console                       |
| `src/components/layout/shell/shell-breadcrumb.tsx`   | Breadcrumb do item ativo (seção › grupo › página)                                |
| `src/components/ui/*`, `src/hooks/use-mobile.ts`     | Componentes do shadcn/ui (sidebar e dependências)                                |

## Uso numa área nova

```tsx
import { AppShell } from "@/components/layout/shell/app-shell";
import { ConsoleHeader } from "@/components/layout/shell/console-header";

export default async function Layout({ children }) {
  // Guard de servidor primeiro (a sidebar só desenha).
  const identity = await requireAlgumaCoisaPage("/rota");
  return (
    <AppShell
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

## Atualizar o shadcn

Baixe o arquivo novo do registro (`apps/v4/registry/new-york-v4/ui/<nome>.tsx` em `shadcn-ui/ui`) ou rode `npx shadcn@latest add <nome>` numa máquina com acesso a `ui.shadcn.com`. Depois, repita as mudanças mínimas listadas na ADR 0014 (item 4) e rode o e2e `e2e/shell.spec.ts`.
