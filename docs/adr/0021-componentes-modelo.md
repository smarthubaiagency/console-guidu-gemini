# ADR 0021 — Componentes modelo: cards em camadas, acordeon e abas segmentadas

- **Status:** Proposto (U4a e U4b); vira aceito com a aprovação visual do Marcelo
- **Data:** 16/10/2026
- **Aprovador:** Marcelo
- **Plano:** [plano-u4.md](../architecture/planos-ui/plano-u4.md)
- **Guia:** [ui-shell.md](../architecture/ui-shell.md#componentes-modelo-adr-0021)
- **Páginas de referência:** `/platform/design/components` (catálogo) e `/platform/design/example` (página modelo)

## Contexto

Em 16/10/2026 Marcelo escolheu duas páginas de referência (`docs/architecture/planos-ui/u4/`) com o desenho que quer no painel: cards com cantos bem arredondados e em camadas (card dentro de card), fundo cinza claro atrás de cards brancos, acordeon em cards separados, abas segmentadas em pílula, selos de situação suaves e listas de rótulo e valor.

O catálogo da U3 mostrava o shadcn de fábrica, e as telas montavam caixas e selos à mão (cerca de 110 caixas `rounded-lg border` e 13 selos de situação), sem um padrão único.

## Decisão

1. **Base continua sendo o shadcn** (ADR 0014). O desenho novo entra como **variantes opcionais** dentro dos próprios arquivos de `src/components/ui/`; o padrão de cada componente não muda, então as telas antigas ficam como estão.
2. **Tokens novos** em `globals.css`, nos dois temas:
   - raios `rounded-panel` (24 px, bloco que contém cards), `rounded-card` (18 px, card), `rounded-inner` (12 px, painel interno, item, linha) e `rounded-control` (10 px, igual ao `rounded-md` dos botões e campos);
   - cores `surface-canvas` (fundo atrás dos cards) e `surface-inset` (painel cinza dentro do card e trilho das abas);
   - sombra `shadow-card` (mínima; nenhuma no escuro).

   O `cn()` conhece os raios e a sombra novos, para que substituam os do shadcn.

3. **Variantes nos componentes do shadcn:**

   | Componente               | Variante                                          | Uso                                                                            |
   | ------------------------ | ------------------------------------------------- | ------------------------------------------------------------------------------ |
   | `Card`                   | `surface`, `panel`, `inset`, `framed`             | Card padrão; bloco grande; painel cinza interno; moldura cinza com card dentro |
   | `Badge`                  | `success`, `warning`, `danger`, `info`, `neutral` | Situação, em pílula suave                                                      |
   | `Tabs` (`TabsList`)      | `segmented`                                       | Trilho cinza com a aba ativa em pílula                                         |
   | `ToggleGroup` / `Toggle` | `segmented`                                       | Filtro com o mesmo visual (período, por exemplo)                               |
   | `Accordion`              | `cards`                                           | Cada item é um card, com botão de seta quadrado                                |
   | `Table`                  | `soft`                                            | Cabeçalho numa faixa cinza arredondada                                         |
   | `Item`                   | `card`, `inset`                                   | Item de lista ou campo como card pequeno                                       |

4. **Componentes novos do registro oficial:** `accordion`, `toggle`, `toggle-group`, `item`, `input-group`, `empty` e `kbd`. Mudanças mínimas: caminhos de import e, no `input-group`, `rounded-[calc(var(--radius)-5px)]` trocado por `rounded-sm` (o GUIDU não define `--radius`).
5. **Padrões do projeto** em `src/components/patterns/`, montados só com peças do shadcn e tokens: `PageCanvas`, `PageTitle`, `SectionHeader`, `StatCard` (com moldura ou simples), `StatGroup`, `KeyValueList`, `FieldCard` (sobre o `Item`), `TagList` e `Amount` (centavos em cinza, opcional).
6. **Fundo cinza.** Uma página construída no padrão começa com `PageCanvas`; o shell (`ShellMain`) pinta o `surface-canvas` quando encontra `data-slot="page-canvas"`. O conteúdo usa a largura toda.
7. **Adoção (Marcelo, 16/10/2026):** as páginas existentes não são refeitas agora. Toda tela nova nasce no padrão; uma tela antiga entra no padrão quando for mexida por outro motivo.
8. **Fica de fora:** as cores dos modelos (a cor primária continua sendo a da marca do parceiro), o menu flutuante e a barra de ícones (continua a sidebar-08) e os gráficos, que entram depois com o `Chart` do shadcn, quando a primeira tela precisar.

## Consequências

- Uma tela nova usa `PageCanvas` e `PageTitle`, cards `surface` ou `panel`, selos de situação do `Badge` e os padrões de `src/components/patterns/`. Caixa ou selo feito à mão deixa de ser aceito na revisão.
- Atualizar um componente do shadcn passa a exigir repetir também as variantes do GUIDU listadas no item 3, além das mudanças mínimas da ADR 0014.
- O catálogo (`/platform/design/components`) e a página modelo (`/platform/design/example`) são a referência viva; os e2e `design-components` e `design-example` cobrem os dois.
