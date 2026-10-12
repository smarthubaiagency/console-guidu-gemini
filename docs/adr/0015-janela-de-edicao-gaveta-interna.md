# ADR 0015 — Janelas de edição e de chat na gaveta interna

- **Status:** Aceito (aprovação visual do Marcelo em 12/10/2026)
- **Data:** 12/10/2026
- **Aprovador:** Marcelo
- **Guia:** [ui-shell.md](../architecture/ui-shell.md#gaveta-interna-adr-0015)
- **Página de referência:** `/platform/design/workbench` (catálogo de padrões)

## Contexto

O painel abria edições de formas diferentes: páginas inteiras, formulários no meio da lista e diálogos. O projeto legado já tinha um modelo aprovado, o `AiWorkbenchLayout`, em que a edição e o chat abrem numa **gaveta interna** ao lado do conteúdo, sem cobrir o menu nem o cabeçalho.

A etapa U2a trouxe esse modelo para o GUIDU (`WorkbenchLayout`) com uma página de teste. Marcelo aprovou o modelo em 12/10/2026.

## Decisão

1. **Toda edição de registro e todo chat abrem na gaveta interna.** Não se usa modal (`Dialog`) nem página separada para editar um registro. Diálogos ficam para confirmações curtas (excluir, sair sem salvar).
2. **A gaveta é interna, não flutuante.** Ela é `absolute` à direita do conteúdo (`relative`), nunca `fixed`, com `z-index` local: não cobre a sidebar nem o cabeçalho do shell.
3. **Dois tamanhos.**
   - **350 px** (`lg:w-drawer`): empurra o conteúdo (`lg:pr-drawer`), que continua visível e clicável.
   - **700 px** (`lg:w-drawer-wide`): cobre parte do conteúdo, para formulários longos ou conversas.
   - Abaixo de `lg`, a gaveta ocupa toda a largura do conteúdo.
4. **Lista lateral opcional.** Quando a página tem lista de registros à esquerda, ela fica fixa a partir de `md` e vira `Sheet` no celular. A `Sheet` fecha quando a gaveta abre.
5. **Acessibilidade.** A gaveta é um `aside` com rótulo, recebe o foco ao abrir, devolve o foco a quem abriu ao fechar e fecha com Esc.
6. **URL por registro.** A edição de um registro tem URL própria (por exemplo `?edit=<id>`), para recarregar e compartilhar com a gaveta aberta.
7. **Peças** (`src/components/layout/workbench/`):
   - `WorkbenchLayout`: lista opcional, conteúdo e gaveta, controlado ou não;
   - `WorkbenchPanel`: cabeçalho com título e descrição, botões de expandir e fechar, corpo com rolagem e rodapé de ações;
   - `WorkbenchDrawer` e `WorkbenchProvider`: a gaveta sozinha, para quem já tem o próprio conteúdo (o assistente do cabeçalho do shell usa assim);
   - `useWorkbench`: abre, fecha e redimensiona de qualquer ponto dentro do layout.
8. **Componentes do shadcn** dentro da gaveta (`Button`, `Input`, `Sheet` e o que vier), como em todo o projeto (ADR 0014, revisão de 12/10/2026).

## Consequências

- Editar um registro não tira a pessoa da lista. O padrão é o mesmo em `/app`, `/admin` e `/platform`.
- A migração das telas que já existem é a etapa **U2b**: edições do CRM, do Portfólio e do Hello World passam para a gaveta, e os breadcrumbs repetidos dentro das páginas saem (o breadcrumb fica só no cabeçalho do shell).
- A página `/platform/design/workbench` continua como catálogo do padrão e referência visual. Os e2e `e2e/workbench.spec.ts` cobrem empurrar, expandir, fechar, foco e celular.
- O assistente de IA do cabeçalho abre na mesma gaveta. Enquanto o módulo de agentes de IA estiver congelado, ela mostra só o aviso "em breve".
