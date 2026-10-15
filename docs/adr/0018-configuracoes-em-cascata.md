# ADR 0018 — Configurações em cascata e tela de dois cards

- **Status:** Proposto (CF1); vira aceito com a revisão do Marcelo
- **Data:** 14/10/2026
- **Aprovador:** Marcelo
- **Levantamento:** `/mnt/project-files/configuracoes/levantamento.md` e `menus-admin-app.md`

## Contexto

Marcelo pediu para definir as configurações de cima para baixo (plataforma, parceiro, workspace) antes de seguir, para que todo limite e padrão tenha um campo próprio. As páginas de configurações também ganharam uma estrutura nova: o submenu num card dentro da área principal e o conteúdo em outro card, usando a largura toda.

## Decisão

1. **Catálogo no código** (`src/core/settings/catalog.ts`): cada chave tem esquema (zod), padrão e os níveis onde pode ser definida. Chave fora do catálogo é ignorada na leitura e recusada na escrita. Nenhuma chave guarda segredo, porque os valores de cima são lidos por quem lê a cascata.
2. **Tabela única `public.settings`** com `scope` `platform`, `partner` ou `workspace`, só com o que cada nível sobrescreve. A plataforma e o parceiro podem **travar** um valor para os níveis de baixo; o workspace nunca trava.
3. **Leitura** por `private.settings_cascade()` (security definer, dono `app_rls_helper`): devolve a plataforma, o parceiro do contexto e o workspace do contexto. O resolvedor puro (`resolve.ts`) aplica padrão, níveis e travas; a moeda fica sempre entre as moedas oferecidas pela plataforma.
4. **Escrita** pela tabela, nível a nível, pelos gestores de cada um, com RLS repetindo a regra: plataforma (`owner`, `operations`, permissão `platform.settings.manage`), parceiro (`partner_owner`, `partner_admin`, `partner.settings.manage`) e workspace (`owner`, `admin`, `workspace.settings.update`). Cada salvamento é auditado (`<nível>.settings.save`).
5. **Tela de dois cards** (`SettingsShell`): à esquerda o submenu agrupado por seção; à direita o conteúdo em cards (`SettingsCard`). No celular o submenu vem antes. A sidebar fica com uma entrada só, "Configurações" (`NavItem.hideChildren`); as páginas continuam na árvore para o breadcrumb e a busca.
6. **Largura toda** para o conteúdo das telas novas. As telas já prontas mantêm a largura atual até os ajustes finos.

## Consequências

- CF1 entrega a base, a tela de dois cards nos 3 níveis e a página **Geral e região** (moedas oferecidas, moeda e fuso). Moeda e fuso já valem para os preços do Portfólio, o fuso padrão das Lojas e o fuso dos agentes sem fuso próprio.
- As próximas etapas (CF2 a CF7) acrescentam chaves ao catálogo, sem nova tabela.
- Exceção da CF2 (Marca): a marca continua na tabela versionada `partner_brands` (ADR 0012), que ganhou logo do tema escuro, favicon, imagem de compartilhamento, frase, rodapé em texto simples e WhatsApp de vendas. As imagens ficam no próprio registro, como o logo, até a escolha do serviço de arquivos. A tela saiu de `/platform/brand` e `/admin/brand` (que agora redirecionam) para `/platform/settings/brand` e `/admin/settings/brand`.
- Os dados do workspace entram na exportação e na exclusão (F3e).
- CF5b (Autenticação): as chaves `auth.google` e `auth.magic_link` são do tipo "só desliga" (`turnOffOnly` no catálogo): o primeiro nível (plataforma) liga, os de baixo só podem desligar; com o primeiro nível desligado (o padrão incluído), os de baixo ficam travados. A tela de login lê as chaves antes do login por `private.auth_login_settings(parceiro)`, só com as linhas `auth.*` da plataforma e do parceiro do host.
