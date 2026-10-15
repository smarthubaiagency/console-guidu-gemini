# Plano da etapa U2 — Janela de edição e chat (gaveta interna)

Proposta para aprovação do Marcelo, 12/10/2026. Nada foi codado ainda.

## Contexto

- **Modelo:** `AiWorkbenchLayout.tsx` do projeto legado, com o padrão de **gaveta interna** (Internal Drawer):
  - até três colunas: contexto à esquerda (350 px), conteúdo no centro e uma gaveta à direita;
  - a gaveta é `absolute` dentro do `<main>` (que é `relative`), ancorada à direita, com z-index local. Ela nunca usa `fixed`, então não cobre a sidebar nem o cabeçalho;
  - largura telescópica: 350 px no padrão (o conteúdo central abre espaço com `padding-right`) ou 600/700 px expandida (a gaveta passa por cima do conteúdo, crescendo para a esquerda);
  - rolagem própria e modo controlado ou não controlado.
- **No GUIDU hoje:**
  - editar um registro abre outra página (por exemplo, `crm/contacts/[contactId]`, `contact-form.tsx` e os formulários do Hello World e do Portfólio);
  - a tela de Agentes de IA (congelada) tem um layout próprio de colunas (`h-panel`);
  - não há nenhuma gaveta lateral.
- **Regras que o modelo precisa seguir aqui:**
  - **Design system P0:** só tokens, sem `style` inline e sem valores arbitrários. O legado usa `style={{ width }}`, `w-[350px]`, `-m-6` e `h-screen`.
  - **Shell da U1:** o conteúdo fica no painel inset da sidebar-08, que tem padding e cabeçalho de 64 px.

Não tenho dúvidas que precisem do Gemini: o arquivo é autoexplicativo. Os pontos abaixo são adaptações ao GUIDU, não mudanças de comportamento.

## Objetivo

Ter **um único componente de janela de edição/chat**, com o comportamento do AiWorkbenchLayout, registrado como padrão do projeto, e uma **página de teste** para você aprovar antes de qualquer tela real migrar.

## O que muda em relação ao legado

| Legado                                        | GUIDU                                                                                                                                            |
| --------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| `style={{ width: drawerWidth }}`, `w-[350px]` | Tokens novos no `globals.css`: `w-drawer` (350 px) e `w-drawer-wide` (700 px), escolhidos por `panelSize="default" \| "wide"`                    |
| `-m-6` e `h-screen` para fugir do padding     | Utilitário `h-workbench` (altura do painel inset menos o cabeçalho) e margens negativas que batem com o padding do shell                         |
| Grid por `style` com variáveis CSS            | Classes condicionais (`grid-cols-[...]` vira tokens `grid-cols-workbench`)                                                                       |
| Só desktop                                    | Abaixo de `lg`: a coluna da esquerda vira uma gaveta do shadcn (`Sheet`) aberta por um botão e a gaveta direita ocupa a largura toda do conteúdo |
| Gaveta sem cabeçalho padrão                   | `WorkbenchPanel` com título, botão de expandir/recolher (350 ↔ 700), fechar e área de rodapé para os botões Salvar/Cancelar                      |
| Sem acessibilidade explícita                  | `aside` com `aria-label`, Esc fecha, o foco vai para a gaveta ao abrir e volta para quem abriu ao fechar (não é modal, então não prende o foco)  |
| `transition-all duration-500`                 | Mantido, respeitando `prefers-reduced-motion`                                                                                                    |

A regra do legado continua igual: **350 px empurra o conteúdo, 700 px passa por cima dele.**

## Etapas

### U2a — Componente e página de teste (um PR)

1. **Componente** em `src/components/layout/workbench/`:
   - `WorkbenchLayout`, com as props `left`, `main`, `panel`, `panelOpen`/`defaultPanelOpen`, `onPanelOpenChange`, `panelSize` e `panelLabel`. Funciona controlado ou não controlado, como no legado;
   - `WorkbenchPanel`, o cabeçalho e rodapé padrão da gaveta;
   - um hook `useWorkbenchPanel()` para abrir a gaveta a partir de qualquer botão do conteúdo.
2. **Tokens** novos no `globals.css` (`w-drawer`, `w-drawer-wide`, `h-workbench`), sem relaxar a regra P0.
3. **Página de teste** em `/platform/design/workbench`, só para os papéis internos e só no host da plataforma. Ela tem três demonstrações, com dados fictícios marcados como exemplo e sem gravar nada:
   - **Edição:** uma lista à esquerda, uma tabela no centro e um formulário na gaveta de 350 px. O conteúdo é empurrado.
   - **Chat:** um assistente na gaveta, com a troca para 700 px por cima do conteúdo.
   - **Sem coluna da esquerda:** só o conteúdo e a gaveta.

   Cada uma pode ser vista em claro, escuro e celular.

4. **Testes:**
   - e2e da página de teste: abrir, expandir, fechar com Esc, foco, conteúdo empurrado em 350 e coberto em 700, e celular;
   - teste unitário do modo controlado/não controlado.
5. **Capturas de tela** no PR e aqui na thread.

### U2b — Padrão do projeto (depois da sua aprovação visual)

1. Criar a **ADR 0015 — Janela de edição e chat em gaveta interna**:
   - toda edição de registro e todo chat de assistente abre na gaveta do `WorkbenchLayout`;
   - nada de modal flutuante nem de página separada para editar;
   - a gaveta é sempre `absolute` dentro do conteúdo, nunca `fixed`.
2. Acrescentar a seção "Janela de edição" ao guia `docs/architecture/ui-shell.md` e uma linha no `AGENTS.md`.
3. **Migrar as telas de edição que existem:**
   - CRM (contato);
   - Portfólio (item e variantes);
   - Hello World (registro, como referência do contrato de módulos).

   A página `[id]` continua existindo para links diretos e abre já com a gaveta aberta, sem quebrar URLs. A tela de Agentes de IA fica de fora enquanto estiver congelada.

4. **Breadcrumb:** tirar o breadcrumb próprio das páginas, que repete o do shell (o ponto que deixei na U1).

## Fora desta etapa

A F6a (revisão de segurança) continua sendo a próxima depois da U2.

## Preciso de você

1. **Página de teste:** em `/platform/design/workbench` (recomendo, porque fica só para a equipe interna). Depois da aprovação, apagar ou manter como catálogo de padrões? Recomendo manter.
2. **Editar registro:** sempre na gaveta, mantendo a URL `[id]` para link direto (recomendo), ou manter as páginas separadas e usar a gaveta só para criação rápida e chat?
3. Com o "pode começar", faço a U2a e te mando as capturas. A U2b só começa depois da sua aprovação visual.
