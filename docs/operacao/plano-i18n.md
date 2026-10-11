# Plano de idiomas do painel

Pedido do Marcelo (11/10/2026): painel em vários idiomas, começando por português, inglês e espanhol. Decisão técnica na [ADR 0013](../adr/0013-idiomas-do-painel.md).

## Decisões do Marcelo

1. **Idiomas na plataforma.** Plataforma › Configurações › Idiomas nasce com os três idiomas. Nela se adiciona um idioma novo, se edita cada texto do painel e, no futuro, se gera uma tradução automática.
2. **Quem traduz.** Claude traduz e Marcelo revisa. A revisão pode ser feita na própria tela de Idiomas.
3. **Escolha do idioma.** O idioma é fixado por workspace (o padrão do painel) e por pessoa. A pessoa vale mais: numa empresa em português, um funcionário pode usar o painel em espanhol.
4. **API e MCP em inglês.** As descrições das ferramentas MCP e as mensagens da API passam para o inglês.
5. **Documentos legais.** Termos e privacidade são traduzidos automaticamente, e as versões podem ser atualizadas nas configurações.

## Etapas

| Etapa | Entrega                                                                                                                         | Estado              |
| ----- | ------------------------------------------------------------------------------------------------------------------------------- | ------------------- |
| I1    | Base: next-intl, idiomas e edições no banco, tela de Idiomas, idioma da pessoa e do workspace, shell e menus traduzidos         | Pronta para revisão |
| I2    | Núcleo: login, convites, conta, visão geral, configurações do workspace, mensagens de erro dos serviços e formatação por idioma | Planejada           |
| I3    | Plataforma (`/platform`) e console do parceiro (`/admin`)                                                                       | Planejada           |
| I4    | Módulos: CRM, Portfólio (com os campos das verticais), propostas e os módulos seguintes já nascendo com chaves                  | Planejada           |
| I5    | Notificações e e-mails por idioma de quem recebe; termos e privacidade por idioma; API e MCP em inglês                          | Planejada           |
| I6    | Tradução automática na tela de Idiomas (edições `machine`, marcadas para revisão)                                               | Espera o provedor   |

## I1 — Base

**Estado:** pronta para revisão. A migration `20261025090000_i1_languages.sql` é aplicada como `app_migrations`.

Entregue:

- **Banco:**
  - `platform_languages`: pt-BR (origem e padrão), en e es ativos; idiomas novos nascem como rascunho;
  - `platform_translations`: edições por idioma e chave, de origem manual ou automática;
  - `profiles.locale` e `workspaces.default_locale`;
  - RLS FORCE em tudo: papéis internos leem, owner e operations editam; owner e admin mudam só o idioma do próprio workspace;
  - funções de leitura para as páginas sem contexto;
  - suíte SQL `languages-rls.sql`.
- **Escolha do idioma:** pessoa, depois workspace, depois navegador (só sem sessão), depois padrão da plataforma. O proxy passa o caminho da navegação num cabeçalho, para saber o workspace.
- **Plataforma › Configurações › Idiomas:**
  - lista com o percentual traduzido e o número de edições;
  - adicionar idioma; ativar e desativar; tornar padrão;
  - tela de textos com busca, filtro (todos, editados, sem tradução), paginação, edição por texto e volta ao texto do sistema;
  - o texto salvo precisa manter as variáveis do original, como `{count}`.
- **Conta › Idioma** (ícone no topo): o idioma da pessoa, ou "seguir o idioma do workspace".
- **Configurações › Geral do workspace:** idioma padrão (owner e admin).
- **Traduzido nesta etapa:** o shell (topo e menus laterais do app, da plataforma e do parceiro) e as telas novas. O resto do painel continua em português até as próximas etapas.
- **Testes:**
  - unitário `i18n.test.ts`: en e es têm todas as chaves e variáveis do pt-BR; escolha e negociação do idioma; mesclagem;
  - integração `languages.test.ts`;
  - e2e `languages.spec.ts`: adiciona e traduz um idioma, escolhe por pessoa e por workspace.

Como adicionar texto daqui em diante:

1. Criar a chave em `src/i18n/messages/pt-BR.json`.
2. Traduzir em `en.json` e `es.json`. O teste falha se faltar alguma.
3. Usar `getTranslations` nos componentes de servidor e `useTranslations` nos de navegador.
4. Se for um componente de navegador, incluir o grupo da chave em `CLIENT_NAMESPACES`.

## Pendências do Marcelo

- Provedor da tradução automática (I6).
