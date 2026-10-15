# Handoff — 15/10/2026 — Planejamento do perfil digital

Ponto de partida para continuar, numa sessão do Claude Code sem contexto anterior, o planejamento do módulo Perfil digital e do ajuste de plataforma CF2c (domínios padrão e endereços públicos). Escrito no fim de uma conversa no Claude.ai. As regras gerais do projeto continuam no [handoff de 12/10/2026](2026-10-12-handoff.md); este só cobre o planejamento do perfil digital.

## 1. Como começar

Cole algo como:

> Leia `docs/handoff/2026-10-15-handoff-perfil-digital.md` e as fontes que ele lista. Confira o estado do PR #86. Não codifique nada: a próxima entrega é documentação (DP0). Antes, me mostre as decisões que ainda faltam e espere meu "pode começar".

Fontes, nesta ordem:

1. `AGENTS.md`, `CLAUDE.md`, `docs/context.md`, `docs/pendencias.md` e o handoff de 12/10/2026 (combinados e regras que não mudam).
2. `docs/modules/perfil-digital/plano-perfil-digital.md` (v0.2): plano do módulo.
3. `docs/operacao/plano-cf2c-dominios-publicos.md` (v0.1): ajuste de plataforma.
4. `docs/modules/perfil-digital/comparativo-relatorios.md` e o relatório que ele indica como base (`analise-opus-legado.md`), para detalhes do legado com `arquivo:linha`.
5. `docs/modules/README.md` (contrato de módulos) e `docs/operacao/dominios.md` (CF2b).

## 2. Estado

- PR #86 (`claude/perfil-digital-plano`), aberto a pedido do Marcelo e aguardando revisão. Só documentação: cria o plano da CF2c, atualiza o plano do módulo para v0.2 e acrescenta um link em `dominios.md`. Este handoff entra no mesmo PR.
- Repositório: `smarthubaiagency/console-guidu-gemini`, base `main`. Banco dev deste repositório: `console-guidu`, conforme ADR 0010 (o projeto `guidu` é proibido aqui).
- Nada foi implementado. Nenhuma migration foi escrita.

## 3. Decisões do Marcelo nesta conversa (15/10/2026)

1. Separar plataforma de módulo. Regras de domínio ficam em documento de plataforma (CF2c), para o realinhamento do núcleo. O plano do módulo só diz o que o módulo usa.
2. Endereço público de perfil, quiz e páginas: `{host}/{slug}`, com cascata de host: domínio próprio do workspace para o tipo → domínio padrão do parceiro para o tipo → domínio padrão da plataforma para o tipo (exemplos: `mobio.pro`, `quiz.mobio.pro`, `page.mobio.pro`). O cliente publica sem cadastrar domínio.
3. O parceiro pode trocar os domínios padrão; o admin do workspace cadastra domínio próprio por tipo (`cards.empresa.com`, `quiz.empresa.com`, `page.empresa.com`).
4. Subdomínio por workspace (`rodobens.mobio.pro`) fica fora do MVP. Só padrão e próprio nesta leva.
5. Nomes reservados por host, para evitar problema futuro.

Consequência registrada no plano da CF2c: o slug é único por host. No domínio padrão, ele é disputado entre todos os workspaces daquele host. O núcleo ganha uma tabela de endereços públicos `(host, slug)` comum aos módulos, com histórico, reservados e 308. Os módulos não guardam slug próprio.

## 4. Pendente para a DP0

O plano (seção 5) depende de:

- Decisão 5 (links e redes): recomendação é empresa no template, pessoais no cartão, com política por campo no template (travado, editável pelo membro ou oculto).
- Decisão 6 (rota pública no manifesto): recomendação é sim, por ADR nova. Hoje o manifesto só aceita `destination: "app" | "admin"` (`src/core/module-contracts/manifest.ts`). Regras sugeridas para a ADR: rota pública resolvida por host e tipo, nunca por slug de workspace na URL; wrapper sem sessão; leitura só por funções `security definer` que devolvem campos públicos; cache invalidado na publicação.
- Confirmação dos defaults da decisão 3 (unidade como `workspace_locations`).

Com isso, a entrega seguinte é a `MODULE_SPEC.md` do módulo e o rascunho da ADR da rota pública, num PR só de documentação.

## 5. Pontos levantados na conversa e ainda fora dos documentos

Apresentados ao Marcelo, sem decisão. Levar para a DP0 como perguntas ou defaults explícitos:

1. Unidade e outros módulos. O comparativo (§6) recomendava "grupo com local opcional"; o plano adotou a unidade como linha de `workspace_locations`. A troca é coerente com a hierarquia decidida, mas não está registrada no comparativo. Como o local também serve a Portfólio e Google Business, proposta: tabela de vínculo do módulo (`digital_profile_units`, `location_id` único), para que nem todo local vire unidade e para nada ser sincronizado com o Google por acidente. Definir o que acontece com os cartões quando o local é arquivado.
2. CRM para a DP2. `crm_contacts.created_by` é obrigatório. Proposta: colunas `source` e de consentimento, e CHECK exigindo `created_by` quando `source = 'manual'`, em vez de só tornar o campo opcional.
3. Saída do membro. Proposta: cartão despublicado, endereço reservado, leads mantidos no workspace.
4. LGPD do colaborador. O cartão publica nome, foto e telefone de funcionários. Falta definir controlador e pedido de despublicação.
5. Cotas do módulo. Cartões e templates por workspace.
6. Cartão sem conta (decisão 12). Precisa de e-mail próprio para o aviso de lead; definir se ocupa vaga.
7. Um template por unidade. Mudar a marca de uma empresa com 27 unidades exige editar 27 templates. Avaliar a cascata da ADR 0018 (configurações em cascata) para uma camada de design no workspace com sobrescrita por template. A ADR ainda não foi lida nesta conversa.
8. Mover unidade entre workspaces (decisão 15). Com a tabela de endereços do núcleo, os endereços antigos ficam reservados e com 308; conferir isso na especificação da DP5.

## 6. Achados no código que embasam a CF2c

- `private.resolve_public_domain` devolve o workspace a partir do host e só conhece `workspace_domains`. No host compartilhado, o workspace tem de sair do endereço.
- `private.domain_host_active` (ForwardAuth) só conhece `partner_domains` e `workspace_domains`; precisa aceitar os domínios padrão.
- `partner_domains` hoje serve só o domínio do painel (`kind` subdomain/custom); `workspace_domains` não tem tipo. Os dois precisam de finalidade.
- `workspaces.slug` não tem CHECK no banco; só a criação pelo parceiro valida 3 a 48 caracteres no app (`src/core/partners/customers.ts`). Só volta a importar se o subdomínio por workspace entrar.
- A cota `core.public_domains` vale 0 sem número no plano; o plano da CF2c propõe que domínios padrão não contem.

## 7. Cuidados

- Documentos seguem o padrão do projeto: frases curtas, sem adjetivo de venda, "inferido" quando for dedução, citação de arquivo quando afirmar algo do código.
- Rodar `pnpm prettier --check` nos `.md` antes do commit; a CI roda `format:check` no repositório todo.
- Nenhum identificador de modelo em commit, PR ou documento novo.
- Cada documento de planejamento tem versão no topo e seção de histórico.

## 8. Atualização — sessão do Claude Code de 15/10/2026

Continuação deste handoff. As seções 4 e 5 acima ficam como registro; o que vale agora está no [plano do perfil digital v0.3](../modules/perfil-digital/plano-perfil-digital.md), no [plano da CF2c v0.2](../operacao/plano-cf2c-dominios-publicos.md) e no novo [plano da CF2d v0.1](../operacao/plano-cf2d-enderecos.md).

Decidido pelo Marcelo nesta sessão:

- Links e redes: só o admin do workspace cria e edita templates. A pessoa edita foto, nome, cargo, telefone, e-mail (livre) e LinkedIn pessoal. Campo vazio não aparece; o admin não oculta campo. O admin pode editar os dados pessoais de qualquer perfil.
- Rota pública no manifesto: sim, com ADR nova.
- Unidade: linha de `workspace_locations` com finalidade "perfil digital"; template ligado à unidade, um por unidade. A tela "Lojas" vira "Unidades". O endereço fiscal vai para o cadastro da empresa (CF2d).
- Unidade desativada mantém os endereços reservados; excluir só sem nada ligado.
- Perfil excluído: endereço reservado por 30 dias, depois livre para qualquer workspace; até ser ocupado, 307 para o perfil master da unidade. Troca de slug com o perfil ativo: 308.
- Perfil master: um por unidade, obrigatório, criado com o template; só dados da empresa e da unidade; formulário sem dono no CRM.
- Modelos base (o "template mestre" do legado): criados pela plataforma ou pelo parceiro; visibilidade geral ou restrita a uma empresa; o template nasce como cópia.
- Modo de design pelo plano: smart (individual, 3 cores) ou gerenciado (corporativo, sem controle de cor no workspace).
- Reaproveitar o código do legado (registrar na DP0 por causa da ADR 0007). Ordem das telas: `/admin` e `/app` primeiro, `/platform` por último.
- Onboarding automático fica para depois. Prioridade: criar unidade, vincular template, adicionar usuário, editar dados e ver o perfil na rota pública.

Achados desta sessão:

- O repositório `smarthubaiagency/cartaopro-linkko` (commit `d739429`) foi lido. As 24 regras de `smart_design_system` e as 5 paletas prontas estão em `scripts/create-smart-design-system.mjs:385-432`; a escala e o contraste, em `lib/theme/color-utils.ts`.
- Os bancos do legado se perderam. A estrutura pode ser refeita pelos dumps; os dados não.
- A ADR 0018 (configurações em cascata) está como "Proposto" e só tem os níveis plataforma, parceiro e workspace.

Próximo passo: DP0 (só documentação) com o "pode começar" do Marcelo. Propostas ainda abertas estão nos itens 12 a 18 do plano v0.3.
