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
| I2    | Núcleo: login, convites, conta, visão geral, configurações do workspace, mensagens de erro dos serviços e formatação por idioma | Pronta para revisão |
| I3    | Plataforma (`/platform`) e console do parceiro (`/admin`)                                                                       | Pronta para revisão |
| I4    | Módulos: CRM, Portfólio (com os campos das verticais), propostas e os módulos seguintes já nascendo com chaves                  | Pronta para revisão |
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

## I2 — Telas do núcleo

**Estado:** pronta para revisão. Sem migration.

Entregue:

- Mensagens em arquivos por grupo (`src/i18n/messages/<idioma>/<grupo>.json`), com índice gerado por `node scripts/i18n-index.mjs`. Um teste falha se o índice e os arquivos divergirem.
- Erros traduzíveis: o `AppError` aceita `messageKey` (chave completa, como `team.errors.invalidMemberId`) e `messageValues`. As ações usam `actionFailure`, que traduz no idioma da pessoa; sem chave, vale o texto em português.
- Telas traduzidas:
  - acesso: login, recuperação e troca de senha, MFA, convites de equipe e de parceiro, termos e aceite, segurança da conta;
  - workspace: escolha de workspace, visão geral, equipe, geral, lojas, módulos e consumo;
  - integrações e dados: credenciais BYOK, chaves MCP (com os escopos), API, cobrança e checkout, dados e privacidade, acesso de suporte;
  - operação: execuções e propostas (com as operações e os campos de cada uma).
- Datas e valores pelo idioma da pessoa, com o fuso de São Paulo.
- O navegador dos testes e2e passou a ser pt-BR, porque visitantes sem sessão recebem o idioma do navegador.

Fica em português até as próximas etapas:

- **Nomes e descrições dos módulos** (manifestos): I4.
- **Plataforma e console do parceiro**, incluindo o papel e o aceite do convite de parceiro: I3.
- **Textos que são dados:** mensagens gravadas pelo worker, validações do zod e o nome da comodidade guardado na loja.

## I3 — Plataforma e console do parceiro

**Estado:** pronta para revisão. Sem migration.

Entregue:

- **Plataforma:** visão geral, clientes, workspaces, usuários, módulos e as configurações globais, operações, chaves de API (com os escopos), termos e marca.
- **Parceiros e cobrança na plataforma:** lista e detalhe dos parceiros (domínios, membros, convites), planos, pisos, repasse, assinaturas, pagamentos manuais e avisos.
- **Console do parceiro (`/admin`):** visão geral, clientes, membros, módulos oferecidos, modelos de workspace, marca, termos, acesso de suporte e cobrança (preços, perfil, assinaturas, pagamentos e o interruptor do checkout).
- **Aceite do convite de parceiro.**
- **Erros e mensagens de sucesso** desses serviços com chave de tradução, inclusive as validações de cobrança, parceiros, marca, termos e chaves de plataforma.
- **Datas, valores (BRL) e percentuais** pelo idioma da pessoa.

Fica em português até as próximas etapas ou por ser dado:

- **Nomes, descrições e campos de configuração dos módulos** (manifestos): I4.
- **Dados mostrados como estão gravados:** descrições de retenção, situações brutas de empresa, workspace e usuário, e mensagens padrão do zod sem texto próprio.

## I4 — Módulos

**Estado:** pronta para revisão. Sem migration.

Entregue:

- **Portfólio:** lista e detalhe dos itens, filtros, criação, campos, variantes, hospedagem (propriedade, acomodações e tarifas), seção de IA e prévia UCP. Os rótulos das verticais (campos, opções, tipos de item e verticais) vêm do namespace `portfolio`, com o rótulo em português do código como reserva. Preços pela moeda do item e no formato do idioma.
- **CRM, Hello World, Agentes de IA e Google Business:** páginas, formulários, mensagens de sucesso e erros dos serviços com chave de tradução.
- **Catálogo de módulos** (namespace `moduleCatalog`): nome, descrição, itens de menu, telas de configuração, permissões e cotas de cada módulo, aplicados no menu lateral, na visão geral, em Configurações › Módulos, em Consumo & Limites, nos módulos e na cobrança da plataforma e no console do parceiro. O manifesto continua sendo a fonte em português.
- **Novos módulos:** nascem com as chaves no `moduleCatalog` e um namespace próprio; o texto do manifesto é usado enquanto a chave não existir.

Fica em português até as próximas etapas ou por ser dado:

- **Saídas da API e do MCP** (nomes de módulos, UCP, mensagens): I5.
- **Dados gravados ou do formato UCP:** título padrão da variante ("Padrão"), unidades de venda, resumo de cancelamento e nomes de opções de hospedagem.
- **Mensagem de cota excedida** (`QuotaExceededError`) e erros internos do motor de agentes: entram com a revisão de erros da I5.
- **Concordância já existente** em "Variante/Acomodação/Tarifa não encontrado." foi mantida para não mudar o texto em português; en e es estão corretos. Pode ser corrigida na tela de Idiomas.
- **Contagens do Hello World** passaram a usar plural: com exatamente 1 registro a frase fica no singular.

## Pendências do Marcelo

- Provedor da tradução automática (I6).
