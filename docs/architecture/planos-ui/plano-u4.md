# Plano da U4 — Componentes modelo (cards, acordeon e abas)

- **Versão:** 0.1, 16/10/2026. Nada aqui foi implementado.
- **Origem:** pedido do Marcelo em 16/10/2026, com dois modelos de referência em [u4/](u4/): `modelo-1-carteira.webp` (painel de carteira) e `modelo-2-campanha.webp` (campanha de mensagens).
- **Regra de adoção (Marcelo, 16/10/2026):** as páginas que já existem **não** são ajustadas agora. As telas novas nascem no padrão; uma tela antiga entra no padrão quando for mexida por outro motivo.
- **Continua valendo:** shadcn como base (ADR 0014), sidebar-08, cabeçalho de 60 px, gaveta de edição (ADR 0015) e SmartStatusBanner (ADR 0016). As cores continuam as nossas (a cor primária é a da marca do parceiro); dos modelos vêm a forma, o espaçamento e a hierarquia, não o azul nem o laranja.

## 1. O que os dois modelos têm em comum

1. **Cantos bem arredondados e em camadas:** o bloco externo tem o raio maior, o card dentro dele um pouco menor e os controles menores ainda. É isso que dá a sensação de "card dentro de card".
2. **Fundo cinza bem claro atrás, cards brancos na frente**, com borda fina e sombra quase invisível.
3. **Card dentro de card:** um card de fora com cabeçalho (ícone pequeno e rótulo) e um card de dentro com o conteúdo (modelo 1: Portfolio Growth, Total Profit, Total Cash); ou um card branco com um painel cinza dentro (modelo 2: os números do acordeon aberto).
4. **Cabeçalho de seção:** título, descrição em cinza e uma ação à direita (`View More`, `History Transaction`).
5. **Abas segmentadas:** trilho cinza e a aba ativa em "pílula" branca elevada, com ícone (modelo 2) ou só texto (filtro de período do modelo 1).
6. **Acordeon em cards separados:** cada item é um card com ícone à esquerda, título, selo de situação e botão quadrado com a seta à direita; aberto, mostra painel de números e etiquetas.
7. **Selos de situação coloridos e suaves:** verde, vermelho, amarelo e cinza com fundo claro (`Finished`, `On-Hold`, `+18.52%`, `-2.37%`).
8. **Botões de ícone quadrados com borda** (voltar, seta, mais opções, copiar, informação).
9. **Listas de "rótulo e valor"** separadas por linhas finas (Quote Rate, Fee Transaction).
10. **Campo em card:** rótulo pequeno em cima, valor grande embaixo e ação à direita (endereço da carteira com copiar; destino com seta).
11. **Tabela leve:** cabeçalho numa faixa cinza arredondada, linhas só com divisória, ação no fim da linha.
12. **Etiquetas removíveis** (`#newvisitor ×`) com contador de excesso (`+4`).

## 2. Tokens novos

Hoje o maior raio é 16 px (`--radius-2xl`) e o `Card` usa 12 px. Para não mexer nas telas antigas, entram tokens **novos e com nome de uso**, sem alterar os atuais:

| Token                    | Valor proposto                                    | Onde                                                          |
| ------------------------ | ------------------------------------------------- | ------------------------------------------------------------- |
| `--radius-panel`         | 24 px                                             | Bloco externo (coluna, painel grande, card que contém outros) |
| `--radius-card`          | 18 px                                             | Card comum e card de dentro                                   |
| `--radius-inner`         | 12 px                                             | Painel cinza interno, item de lista, linha de tabela, campo   |
| `--radius-control`       | 10 px                                             | Botão, campo de texto, botão de ícone                         |
| `--radius-pill`          | total                                             | Selo, etiqueta, aba segmentada, busca                         |
| `--color-surface-canvas` | cinza bem claro (claro) e o equivalente no escuro | Fundo da área de conteúdo atrás dos cards                     |
| `--color-surface-inset`  | cinza um tom acima do canvas                      | Painel interno e trilho das abas                              |
| `--shadow-card`          | sombra mínima                                     | Card e aba ativa                                              |

Todos com versão no modo escuro, testados nos dois temas.

## 3. Componentes

**Tudo parte do shadcn.** A aparência nova entra como variantes (`cva`) dentro dos próprios arquivos do shadcn em `src/components/ui/`, que é como o shadcn foi feito para ser usado. Onde o shadcn já tem o componente (inclusive os mais novos: `Item`, `Input Group`, `Empty`, `Kbd`), usamos ele. O que não existe no shadcn é só composição de peças do shadcn, em `src/components/patterns/`, sem HTML ou estilo solto.

| Componente                                     | Base                                              | Referência                      | O que faz                                                                                      |
| ---------------------------------------------- | ------------------------------------------------- | ------------------------------- | ---------------------------------------------------------------------------------------------- |
| `Card` (variantes `default`, `inset`, `panel`) | shadcn Card                                       | Os dois                         | Card branco; painel cinza interno; bloco externo grande                                        |
| `FramedCard` (card com moldura)                | Card                                              | Modelo 1, três cards de números | Moldura cinza com ícone e rótulo em cima, card branco dentro                                   |
| `SectionHeader`                                | composição de `Item` ou `CardHeader`/`CardAction` | Os dois                         | Título, descrição e ações à direita                                                            |
| `PageTitle` com ícone                          | composição de `Item` (mídia, título e descrição)  | Modelo 2, "Sales Consultation"  | Quadrado com ícone, título e descrição (dentro da página; o cabeçalho de 60 px continua igual) |
| `Tabs` variante `segmented`                    | shadcn Tabs                                       | Modelo 2                        | Trilho cinza, aba ativa em pílula, ícone opcional                                              |
| `ToggleGroup` variante `segmented`             | shadcn ToggleGroup (instalar)                     | Modelo 1, filtro de período     | Mesmo visual das abas, para filtros que não trocam de conteúdo                                 |
| `Accordion` variante `cards`                   | shadcn Accordion (instalar)                       | Modelo 2                        | Itens em cards separados, ícone, selo e botão de seta                                          |
| `StatCard`                                     | Card                                              | Modelo 1 e "Total New Partner"  | Rótulo, número grande, variação e legenda                                                      |
| `StatGroup`                                    | Card `inset`                                      | Modelo 2, acordeon aberto       | Números lado a lado com divisórias, em painel cinza                                            |
| `Badge` variantes de situação                  | shadcn Badge                                      | Os dois                         | `success`, `warning`, `danger`, `info` e `neutral`, em pílula suave                            |
| `Button` raio novo e `IconButton`              | shadcn Button                                     | Os dois                         | Botão com `--radius-control`; botão quadrado de ícone com borda                                |
| `KeyValueList`                                 | composição de `Item` e `Separator`                | Modelo 1, Quote Rate            | Pares rótulo e valor com divisórias                                                            |
| `FieldCard`                                    | shadcn `Item` (instalar)                          | Modelo 1, endereço e destino    | Rótulo pequeno, valor grande, ação (copiar, abrir)                                             |
| `ListItemCard`                                 | shadcn `Item` (instalar)                          | Modelo 2, anexos                | Item de lista em card com ícone e ação                                                         |
| `TagInput` / `Tag`                             | composição de `Badge` e `Button`                  | Modelo 2, Target User           | Etiqueta removível e contador `+N`                                                             |
| `DataTable` estilo leve                        | shadcn Table                                      | Modelo 1, All My Assets         | Cabeçalho em faixa cinza, ação no fim da linha                                                 |
| `Composer`                                     | shadcn `Input Group` (instalar)                   | Modelo 2, caixa de mensagem     | Texto com barra de botões (anexar, "Perguntar à IA", enviar); útil para a IA                   |

Cada componente: claro e escuro, celular, teclado e leitor de tela (o Accordion e as abas do Radix já cuidam do foco e do `aria`), e os estados desabilitado, carregando e somente leitura.

## 4. Catálogo e documentação

- A página `/platform/design/components` é refeita no novo padrão e vira a referência: grupos "Base" e "Padrões", cada um com exemplo, quando usar, quando não usar e o import.
- Uma página de exemplo montada só com os componentes, reproduzindo a estrutura dos dois modelos com dados fictícios do GUIDU (por exemplo, a visão geral de um GUIDS com abas, acordeon de mensagens e coluna de estatísticas), para aprovação visual.
- **ADR 0021 — Padrão de cards e componentes modelo**, depois da sua aprovação, mais o `docs/architecture/ui-shell.md` atualizado. A partir daí, tela nova fora do padrão não passa na revisão.

## 5. Etapas

| Etapa | Entrega                                                                                                                                                                                                               | Migration |
| ----- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------- |
| U4a   | Tokens, `Card` com variantes, `Badge` de situação, `Button`/`IconButton`, `Tabs` e `ToggleGroup` segmentados, `SectionHeader` e `PageTitle`. Catálogo com esses itens. Capturas claro, escuro e celular para aprovar. | Não       |
| U4b   | `Accordion` em cards, `FramedCard`, `StatCard`, `StatGroup`, `KeyValueList`, `FieldCard`, `ListItemCard`, `Tag`, `DataTable` leve e `Composer`. Página de exemplo. Capturas para aprovar.                             | Não       |
| U4c   | Após a aprovação: ADR 0021, `ui-shell.md`, catálogo final, testes (e2e do catálogo e da página de exemplo) e o plano copiado para `docs/architecture/planos-ui/`.                                                     | Não       |

Pode correr em paralelo com etapas de dados (CF2d, CF2e e as seguintes), porque não mexe no banco.

## 6. Decisões para você confirmar

1. **Raios** 24 / 18 / 12 / 10 px e pílula para selos, abas e busca. Recomendo assim (os modelos estão entre 16 e 24 px).
2. **Fundo cinza atrás dos cards** na área de conteúdo das páginas novas. Recomendo: sem ele, os cards brancos não se destacam como nos modelos.
3. **Botões:** cantos arredondados de 10 px (modelo 2) em vez de pílula (modelo 1). Recomendo 10 px, que combina com os campos de texto.
4. **Números com centavos em cinza** (`$121,890.92`) nos `StatCard`. Recomendo como opção do componente, não obrigatório.
5. **Gráficos** (o do modelo 1 e as barras do modelo 2): ficam para uma etapa própria com o `Chart` do shadcn. Recomendo deixar para depois, quando a primeira tela precisar.
6. **Sidebar:** continua a sidebar-08. O menu flutuante em card do modelo 2 e a barra de ícones do modelo 1 não entram.
