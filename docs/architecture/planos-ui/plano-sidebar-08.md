# Plano da etapa U1 — Sidebar padrão (shadcn sidebar-08)

Proposta para aprovação do Marcelo, 12/10/2026. Nada foi codado ainda.

## Contexto

- Hoje há duas sidebars feitas à mão (`src/components/layout/app-sidebar.tsx` e `platform-sidebar.tsx`) e dois cabeçalhos (`app-header.tsx` e `platform-header.tsx`). Elas são usadas pelos layouts de `/app/[workspaceSlug]`, `/admin` e `/platform`.
- O `components.json` do shadcn existe (estilo `new-york`), mas `src/components/ui/` está vazio. Nenhum componente do shadcn foi instalado até hoje, e as telas usam os tokens próprios do `globals.css` (`surface-sidebar`, `text-12` etc.).
- O menu já sai do servidor como `NavSection[]` (núcleo + registro de módulos) e é traduzido por `translateNavigation`. A sidebar só desenha, e isso não muda.
- O bloco sidebar-08 é a variante **inset**. Ele tem:
  - no topo, a marca com um seletor;
  - grupos de menu com subitens recolhíveis;
  - um grupo secundário embaixo (Suporte, Feedback);
  - no rodapé, o usuário com um menu suspenso;
  - o conteúdo num painel arredondado ao lado, com um cabeçalho que tem o botão de recolher e o breadcrumb.

## Objetivo

As três áreas usam exatamente a sidebar-08, por meio de um **shell único** do projeto. Esse shell vira o padrão registrado em ADR para qualquer área ou módulo novo.

## Etapas (um PR)

1. **Instalar o bloco.**
   - Instalar `sidebar-08` e as dependências dele: `sidebar`, `button`, `separator`, `sheet`, `tooltip`, `input`, `skeleton`, `collapsible`, `dropdown-menu`, `avatar` e `breadcrumb`, mais o hook `use-mobile`.
   - O pacote `radix-ui` entra com versão exata e pelo menos duas semanas de publicação.
   - Observação: o `npx shadcn add` não funciona deste ambiente, porque a rede bloqueia `ui.shadcn.com`. Os mesmos arquivos estão no repositório oficial do shadcn no GitHub, que eu consigo ler. Instalo a partir dali e registro a origem e o commit no PR.
2. **Tema.** Mapear as variáveis `--sidebar-*` e as do shadcn (`--background`, `--muted` etc.) para os tokens que já existem, no claro e no escuro, sem mudar as cores atuais das telas.
3. **Shell único** em `src/components/layout/shell/`. Ele recebe as seções do servidor e os dados de cada área:

   | Parte da sidebar-08    | `/app`                                                              | `/admin`                                        | `/platform`                           |
   | ---------------------- | ------------------------------------------------------------------- | ----------------------------------------------- | ------------------------------------- |
   | Topo (marca + seletor) | Marca e **seletor de workspace** (substitui o `workspace-switcher`) | Marca, "Console do parceiro" e nome do parceiro | Marca, "Admin" e o selo de sessão MFA |
   | Grupos de menu         | As seções do servidor, com subitens recolhíveis, item ativo e selo  | idem                                            | idem                                  |
   | Grupo secundário       | Documentação (v1.0)                                                 | idem                                            | idem                                  |
   | Rodapé (usuário)       | E-mail e menu com Idioma, Tema, Plataforma (para admins) e Sair     | E-mail, papel e o mesmo menu                    | E-mail, papel e o mesmo menu          |
   | Cabeçalho do conteúdo  | Botão de recolher e breadcrumb gerado do menu                       | idem                                            | idem                                  |
   - O cabeçalho de topo atual sai, porque o que ele tinha vai para o topo e o rodapé da sidebar, como no modelo.
   - O "Sair" continua sendo um POST com a mesma checagem de origem.
   - O grupo "Projects" do modelo não é usado: os módulos já entram como seção do menu.

4. **Estado e celular.**
   - Recolhida ou aberta, lida no servidor pelo cookie `sidebar_state`, sem piscar.
   - Atalho Ctrl/⌘+B.
   - No celular vira gaveta (`Sheet`), como o shadcn já faz.
5. **Limpeza.** Apagar `app-sidebar.tsx`, `platform-sidebar.tsx`, `app-header.tsx`, `platform-header.tsx` e `workspace-switcher.tsx`. Os três layouts passam a ter poucas linhas cada.
6. **Idiomas.** Os textos novos em pt-BR, en e es (namespace `shell`, que já está em `CLIENT_NAMESPACES`).
7. **Padrão do projeto.**
   - Criar a **ADR 0014 — Shell padrão com a sidebar-08 do shadcn**. Ela diz que:
     - toda área com menu lateral usa esse shell;
     - não se cria sidebar própria;
     - módulos contribuem só com entradas de menu pelo manifesto;
     - mudanças no bloco seguem o shadcn.
   - Criar `docs/architecture/ui-shell.md` com o uso.
   - Acrescentar uma linha no `AGENTS.md` e no contrato de módulos (`docs/modules/README.md`).

## Testes e aceite

- **E2E:** atualizar os 11 specs que navegam pelo menu ou leem o cabeçalho. Os textos em pt-BR ficam iguais.
- **E2E novo:** recolher e abrir a sidebar com o estado mantido no recarregamento, gaveta no celular, item ativo, troca de workspace e Sair, nas três áreas.
- Teste unitário do mapeamento `NavSection[]` → menu do shadcn (subitens, ativo, selo).
- `pnpm typecheck && pnpm lint && pnpm test && pnpm build` e o e2e completo. Capturas de tela das três áreas, claro e escuro, desktop e celular, vão no PR.

## Fora desta etapa

**U2 — Modelo das janelas de edição.** Espera o exemplo que você vai trazer do outro projeto. Quando chegar, faço o plano dela no mesmo formato.

## Preciso de você

1. **Ordem:** fazer a U1 antes da F6a (recomendo, porque a CSP e os testes de cabeçalho da F6a já pegam o shell final) ou depois?
2. **Cabeçalho de topo:** confirma que ele some e que o que ele tinha vai para a sidebar, como no modelo?
3. **Instalação:** pelos arquivos do repositório oficial do shadcn no GitHub (recomendo), ou você roda `npx shadcn@latest add sidebar-08` na sua máquina e eu sigo daí?
