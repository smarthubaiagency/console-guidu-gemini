# Shell padrão (sidebar-08)

Decisões em [ADR 0014](../adr/0014-shell-padrao-sidebar-08.md) (shell, cabeçalho e regra do shadcn), [ADR 0015](../adr/0015-janela-de-edicao-gaveta-interna.md) (gaveta interna) e [ADR 0016](../adr/0016-smart-status-banner.md) (avisos). Toda área com menu lateral usa este shell; não se cria sidebar nem cabeçalho próprios, e todo componente usa o equivalente do shadcn em `src/components/ui/`.

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
| `src/components/patterns/*`                          | Padrões do projeto montados com o shadcn (ADR 0021)                         |

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

### Exceção: janela de onboarding em tela cheia

A janela "Adicionar local" do Google Meu Negócio (GB1a) abre em tela cheia por cima do painel (`fixed`, cobrindo menu e cabeçalho, abaixo do SmartStatusBanner). É uma exceção própria à ADR 0015: não é edição de registro, e sim um fluxo guiado de conexão (Conectar, Ler e analisar, Pronto) que termina abrindo outra página. Ela fecha com Esc e com o botão Fechar, recebe o foco ao abrir e usa só os componentes modelo dentro dela. Novos fluxos de onboarding podem seguir o mesmo formato; edição de registro continua na gaveta.

## Atualizar o shadcn

Baixe o arquivo novo do registro (`apps/v4/registry/new-york-v4/ui/<nome>.tsx` em `shadcn-ui/ui`) ou rode `npx shadcn@latest add <nome>` numa máquina com acesso a `ui.shadcn.com`. Depois, repita as mudanças mínimas listadas na ADR 0014 (item 4) e as variantes do GUIDU da ADR 0021 (item 3), e rode os e2e `e2e/shell.spec.ts`, `e2e/design-components.spec.ts` e `e2e/design-example.spec.ts`.

## Componentes modelo (ADR 0021)

Toda tela nova segue os componentes modelo; as telas antigas entram no padrão quando forem mexidas. Referências vivas: `/platform/design/components` (catálogo, com quando usar e o import) e `/platform/design/example` (página modelo).

```tsx
<PageCanvas>
  <PageTitle icon={<Bot className="size-6" />} title="…" description="…" actions={…} />
  <Card variant="panel" className="px-6">
    <Tabs defaultValue="overview">
      <TabsList variant="segmented">…</TabsList>
    </Tabs>
    <SectionHeader title="…" description="…" actions={…} />
    <Accordion type="single" collapsible variant="cards">…</Accordion>
  </Card>
</PageCanvas>
```

- **Cards:** `Card` com `variant` `surface` (padrão), `panel` (bloco que contém cards), `inset` (painel cinza interno) ou `framed` (moldura com card dentro); números com `StatCard` (`framed`, `flush` ou `plain`) e `StatGroup`.
- **Selos de situação:** `Badge` com `success`, `warning`, `danger`, `info` ou `neutral`.
- **Abas e filtros:** `TabsList variant="segmented"` e `ToggleGroup variant="segmented"`.
- **Listas:** `Item variant="card"`, `KeyValueList`, `Table variant="soft"`, `TagList`; vazio com `Empty`.
- **Raios:** `rounded-panel` (24 px) › `rounded-card` (18 px) › `rounded-inner` (12 px) › `rounded-control` (10 px).

## Avisos (ADR 0016)

Todo envio ou salvamento dá retorno pelo SmartStatusBanner, que o shell e o `PageStatus` (usado pelo `AuthShell` e pelas páginas fora do shell, como a escolha de workspace e as da conta) já montam. Não use mensagem inline, `alert()` nem `confirm()`; o ESLint recusa os diálogos do navegador. Referência viva: `/platform/design/status`.

Para o resultado de uma server action (`{ error, message, success, requestId }`), basta o `useActionStatus(state)`; o `ActionForm` já faz isso.

```tsx
const [state, action, pending] = useActionState(salvar, {});
useActionStatus(state); // erro vira `down` com a referência; mensagem vira `up`
```

```tsx
"use client";
import { useStatus } from "@/components/feedback/status-context";

const { showStatus, confirmStatus } = useStatus();

// Resultado
showStatus({ type: "up", title: "Contato salvo!", message: "…" });
showStatus({ type: "down", title: "Erro ao salvar", details: erro });

// Confirmação (no lugar do confirm())
const ok = await confirmStatus({
  title: "Remover membro?",
  checkboxLabel: "Entendo que o acesso é perdido na hora",
  confirmLabel: "Remover",
  cancelLabel: "Cancelar",
  tone: "destructive",
});
if (ok) await remover();
```

| Campo                       | Efeito                                                    |
| --------------------------- | --------------------------------------------------------- |
| `type`, `title`             | Obrigatórios: `up` sucesso, `oops` aviso, `down` erro     |
| `message`                   | Subtítulo sempre visível                                  |
| `details`                   | Texto atrás de um chevron; os botões vão para dentro dele |
| `action`, `secondaryAction` | Botão principal (na cor do aviso) e secundário (ghost)    |
| `checkboxLabel`             | Checkbox que libera o botão principal                     |
| `tone: "destructive"`       | Cores de perigo para ações destrutivas                    |
| `icon`                      | Troca o ícone do tipo                                     |
| `duration`                  | Milissegundos (padrão 4000); `0` só fecha pela pessoa     |

- Uma mensagem por vez; uma confirmação aberta não é apagada por outro aviso.
- Clicar no card pausa; "Retomar" continua do tempo que faltava.
- Esc fecha o aviso antes da gaveta embaixo.
- Conteúdo para copiar (link de convite, chave nova exibida uma vez) não é aviso: fica na página.
- Estado de página (link expirado, acesso negado) continua no `ErrorNotice` do `AuthShell`.
- Nos e2e, leia o aviso por `statusBanner(page)` (`e2e/support/status.ts`), que aponta para `getByTestId("smart-status")`.
