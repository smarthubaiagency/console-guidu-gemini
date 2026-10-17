# Perfil digital: planejamento do módulo

- **Versão:** 0.4, 15/10/2026.
- **Estado (17/10/2026):** fora da fila por enquanto, por decisão do Marcelo; volta depois. As previsões deixadas nas outras etapas (Central de Eventos, CF2d, CF2e-1 e a ADR da rota pública) estão em [fila-de-etapas.md](../../fila-de-etapas.md#3-previsão-para-o-perfil-digital).

Início do planejamento em 14/10/2026, a partir da [comparação dos relatórios](comparativo-relatorios.md). Base técnica: [relatório do Opus](analise-opus-legado.md), com os complementos indicados na comparação. Nada aqui foi implementado.

Citações do legado se referem ao repositório `smarthubaiagency/cartaopro-linkko`, commit `d739429`.

## 1. O que o módulo entrega

Cartão de visita digital por pessoa do workspace: página pública, vCard, QR, métricas de visita e, logo depois, captura de leads para o CRM. O template é o design system da marca da unidade: é feito uma vez e copiado para outras unidades. A pessoa edita só os próprios dados pessoais.

Prioridade do MVP, nesta ordem: criar unidade → vincular template → adicionar usuário → editar os dados → ver o perfil na rota pública.

Fica de fora do começo: cartão físico NFC, Google e Apple Wallet, PWA, chat Chatwoot no cartão, WhatsApp Conecte, loja de cartões, onboarding automático e importação do CartãoPRO.

## 2. Decisões

**Decididas pelo Marcelo em 15/10/2026:**

1. **Nome e chave.** "Perfil digital", chave `digital-profile`, tabelas `digital_profile_*`.
2. **Hierarquia.** Empresa → workspace (em geral um por empresa) → uma ou várias unidades → um template por unidade → perfis das pessoas. Uma empresa pode ter vários workspaces quando precisa separar filiais.
3. **Unidade.**
   - A unidade é uma linha de `workspace_locations` com a finalidade "perfil digital". O módulo não tem tabela de unidades. A tela "Lojas" passa a se chamar "Unidades". As finalidades são um ajuste de plataforma ([plano da CF2d](../../operacao/plano-cf2d-enderecos.md)).
   - Cada template fica ligado a uma unidade; cada unidade tem no máximo um template.
   - Todo perfil pertence a uma unidade e usa o template dela; trocar a unidade troca o template.
   - O perfil só é publicado se a unidade tiver template publicado.
   - Unidade desativada: os perfis saem do ar e os endereços públicos continuam reservados. A exclusão é o caso extremo e só é aceita quando nada aponta para a unidade (itens do Portfólio, perfis, template).
   - O endereço fiscal não é da unidade nem do módulo: fica no cadastro da empresa (CF2d), para cobrança e notas fiscais.
4. **Endereço público.** O host é da plataforma ([CF2c](../../configuracoes/plano-cf2c.md), já construída) e o caminho também ([plano da CF2e](../../operacao/plano-cf2e-enderecos-publicos.md)). O que vale para o módulo:
   - O perfil publica em `{host}/{slug}`. Por padrão, o host é o subdomínio do workspace no domínio padrão do perfil (ex.: `rodobens.mobio.pro/joao-silva`), ou o do parceiro quando ele tiver. O workspace pode escolher um domínio próprio pelo seletor da CF2c.
   - O slug é único dentro do workspace. O módulo não guarda slug nem histórico em tabela própria: usa o serviço de endereços públicos do núcleo (CF2e).
   - Troca de slug com o perfil ativo: o endereço antigo responde 308 para o novo enquanto o perfil existir.
   - Perfil excluído: o endereço fica reservado por 30 dias e depois fica livre para outro perfil do mesmo workspace. Até alguém ocupá-lo, quem acessa vai para o perfil master da unidade por 307 (nunca 308, que o navegador guardaria). Os endereços antigos do perfil entram na mesma carência.
5. **Campos pessoais.**
   - A pessoa edita só: foto, nome, cargo, telefone, e-mail e LinkedIn pessoal. Nenhuma outra rede pessoal.
   - O e-mail é livre, sem vínculo com o e-mail da conta.
   - Campo preenchido aparece no perfil; campo vazio não aparece. O admin não oculta campo pessoal.
   - O resto do perfil vem do template. A pessoa vê, mas não edita.
   - O admin do workspace pode editar os campos pessoais de qualquer perfil, com auditoria.
   - Todos os papéis, inclusive `viewer`, editam o próprio perfil.
6. **Rota pública no contrato de módulos.** Sim: o manifesto ganha destino público, registrado em ADR nova na DP0. Hoje ele só aceita `destination: "app" | "admin"` (`src/core/module-contracts/manifest.ts:81`). Regras propostas para a ADR: rota resolvida por host e endereço, nunca por slug de workspace na URL; wrapper sem sessão; leitura só por funções `security definer` que devolvem campos públicos; cache invalidado na publicação.
7. **Perfil master.**
   - Um por unidade, obrigatório. Criar o template da unidade cria o master na mesma operação.
   - Mostra só dados da empresa e da unidade, nenhum dado de funcionário. Só o admin edita.
   - O slug parte dos dados da unidade (ex.: `rodobens.mobio.pro/sao-paulo`).
   - O formulário de contato do master cria o lead sem dono no CRM, como um formulário de site.
   - Enquanto a unidade existir, o master não é excluído nem despublicado.
   - A marcação fica no perfil (`kind` ou `is_master`), não no template.
8. **Modelos base** (o "template mestre" do legado).
   - São criados pela plataforma ou pelo parceiro. O workspace só lê; o banco garante isso.
   - Visibilidade geral (todos os workspaces de quem criou: da plataforma, todos; do parceiro, só os clientes dele) ou restrita a uma empresa (todos os workspaces dela).
   - O template da unidade nasce como cópia do modelo. Mudar o modelo depois não altera os templates já criados.
   - Não se traz do legado a marcação de mestre pelo próprio workspace (`app/api/workspace/templates/[id]/route.ts:52`), que publicava o template para todos os clientes.
9. **Modo de design, definido pelo plano.**
   - **Smart** (plano individual): o admin do workspace edita só as 3 cores-semente, a fonte, o logo e a capa; o motor gera a paleta.
   - **Gerenciado** (plano corporativo): a paleta completa é ajustada pela nossa equipe ou pelo parceiro. O workspace não vê nenhum controle de cor. Se o plano mudar para gerenciado, o controle some do workspace.
   - O legado já gravava `design_mode` (`smart` ou `managed`) em `lib/clone-engine/helpers.ts:221`, mas o `buildTheme` não o lia.
10. **Reaproveitamento do legado.** Autorizado pelo Marcelo. A DP0 registra a decisão, como pede a ADR 0007. Pode vir: blocos da página pública, motor de cores, editor de design (`components/client/TemplateDesignEditorClient.tsx`), adaptados ao shadcn, à gaveta, ao `useStatus` e ao i18n. Não vem: acesso a dados pelo Directus, autenticação, credenciais e os itens da seção 5. Cada arquivo trazido cita a origem.
11. **Ordem das telas.** Primeiro `/admin` (parceiro) e `/app` (workspace). O `/platform` fica por último; até lá, só as configurações do módulo.

**Propostas a confirmar na DP0:**

12. **Claro e escuro.** No legado o modo era do perfil (`app/api/profile/design/route.ts:100-103`). Como a pessoa só edita dados pessoais, o template define as duas paletas e o modo padrão; o visitante pode alternar.
13. **Fontes.** Lista fixa servida pelo próprio GUIDU, sem Google Fonts na página pública, porque o carregamento externo envia o IP do visitante ao Google.
14. **Template corporativo no primeiro fluxo.** O editor completo do parceiro chega depois da DP2. Até lá, o template corporativo nasce de um modelo base pronto, montado a partir das 5 paletas do legado. Alternativa: antecipar o editor do parceiro para a DP2.
15. **Cotas.** Perfis e templates por workspace, com números do Comercial. O perfil master não conta.
16. **Saída do membro.** O admin exclui o perfil; os leads ficam no workspace; o endereço segue a carência da decisão 4.
17. **LGPD do colaborador.** O perfil publica nome, foto e telefone de funcionários. Proposta: o workspace é o controlador e a pessoa pede a retirada ao admin. Depende do jurídico.
18. **Cartão sem conta no painel** (ex.: vendedor externo): sim, com e-mail próprio para o aviso de lead; se ocupa vaga é decisão comercial. Vários perfis por pessoa: não no MVP.

**Travam a etapa de leads:**

19. **Leads no CRM.** Pelo serviço público do CRM, que passa a guardar origem e consentimento. Hoje `crm_contacts.created_by` é obrigatório; proposta: coluna `source` e CHECK exigindo `created_by` quando `source = 'manual'`. O envio fica também em `digital_profile_submissions`.
20. **Aviso de lead.** Por e-mail (Resend, CF3a) ao dono do perfil. O webhook do A6 e o WhatsApp ficam para depois.

**Podem ser decididas durante a implementação:**

21. **Fotos.** Enquanto o storage (F5e) não é escolhido: foto e logo pequenas guardadas na linha, como na Marca (CF2), com recorte no navegador. Capa e imagem de compartilhamento esperam o storage.
22. **Idiomas da página pública.** pt-BR, en e es, escolhidos por perfil.
23. **Mover unidade entre workspaces** (ex.: a empresa separa as filiais e a cobrança). Ação do admin (plataforma ou parceiro) que move unidade, template, perfis e endereços, com auditoria e 308 dos endereços antigos. A cobrança é por empresa (`subscriptions.organization_id`): separar a cobrança de uma filial é criar outra empresa. Etapa própria, depois do MVP.
24. **Onboarding automático** do cliente individual (unidade "Matriz", template a partir de um modelo base e o primeiro perfil). Depende do checkout de autoatendimento (P6). Até lá, o parceiro faz pelo `/admin`.
25. **Importação do CartãoPRO.** Os bancos do legado (Supabase e Directus) se perderam. A estrutura pode ser refeita a partir de `schema-dump.sql` e `directus-schema-snapshot.json`, mas os dados, as permissões do Directus, as contas e os arquivos não. A importação só existe se aparecer uma cópia dos dados.

## 3. Motor de design

O JSON do template substitui as 96 colunas do legado. Formato, a detalhar na DP0:

- `schemaVersion` e `rulesVersion` (versão do catálogo de regras usado).
- `designMode`: `smart` ou `managed`.
- Tema: 3 sementes (primária, secundária, destaque), tokens de cor em claro e escuro, modo padrão, fonte, logo e capa.
- Blocos: Hero, CTA, Links, Redes, Mapa, QR e Rodapé, com ordem e visibilidade por template.
- SEO do template.

O motor smart é recuperado do legado:

- **Regras.** As 24 regras de `smart_design_system` estão no script que preenchia a tabela (`scripts/create-smart-design-system.mjs:385-413`) e repetem a lógica fixa de `lib/theme/buildTheme.ts:198` em diante. Cada regra liga um token (`token_key`, `target_group`) a uma semente (`source_seed`), a um ponto da escala de 50 a 950 no claro e no escuro (`stop_light`, `stop_dark`) e a um tipo (`color` ou `contrast`). Mudanças feitas pelo Directus depois do script, se houve, se perderam.
- **Paletas prontas.** 5 em `scripts/create-smart-design-system.mjs:426-432`.
- **Escala e contraste.** `generateScale` e `getContrastColor` em `lib/theme/color-utils.ts:77` e `:107`.
- No GUIDU, regras e paletas viram catálogo versionado no código, com testes. O template guarda a versão das regras que usou, para que mudar o motor não altere sem aviso um template já publicado.
- `text_on_dark`, `text_muted` e `divider_color` não têm regra; vinham das paletas fixas (`lib/theme/presets.ts`). Proposta: regra própria a partir da secundária.
- Correções em relação ao legado: o ajuste manual de um token vence a derivação (no legado a derivação apagava o ajuste, `lib/theme/buildTheme.ts:113-121`), e o contraste de texto é conferido pelo nível AA da WCAG.

O renderizador dos blocos é um só para a prévia do editor e para a página pública, e não sabe qual modo gerou o tema.

## 4. Etapas propostas

Cada etapa só começa com o seu "pode começar". Uma etapa pode virar mais de um PR.

| Ordem | Etapa     | Entrega                                                                                                                                                                                            | Migration |
| ----- | --------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------- |
| 1     | DP0       | `MODULE_SPEC.md` com as decisões acima, formato do JSON e motor; ADR da rota pública; registro do reaproveitamento do legado (ADR 0007)                                                            | Não       |
| 2     | CF2e-1    | Plataforma: tabela e serviço de endereços públicos (slug, histórico, reservados e carência) sobre os hosts da CF2c ([plano da CF2e](../../operacao/plano-cf2e-enderecos-publicos.md))              | Sim       |
| 3     | CF2d      | Plataforma: finalidades em `workspace_locations`, tela "Unidades", endereço fiscal da empresa ([plano da CF2d](../../operacao/plano-cf2d-enderecos.md))                                            | Sim       |
| 4     | DP1 Motor | Formato do JSON, catálogo de regras e paletas, escala e contraste, renderizador dos blocos e prévia com dados de exemplo. Atrás de trava técnica, sem gravar                                       | Não       |
| 5     | DP2 Fluxo | Manifesto, permissões e cotas; modelos base; template por unidade; perfil master; perfis com os campos pessoais; editor das 3 cores no modo smart; página pública com vCard, QR e evento de visita | Sim       |
| 6     | DP3       | Editor completo do parceiro (modo gerenciado) e modelos base do parceiro no `/admin`                                                                                                               | Sim       |
| 7     | DP4       | Troca de contato e formulário, no CRM, com consentimento, limite de taxa e aviso por e-mail                                                                                                        | Sim       |
| 8     | DP5       | Cliques por bloco e por link, agregação diária no worker, tela de métricas                                                                                                                         | Sim       |
| 9     | Depois    | Redirecionamentos de troca de host (CF2e-2); `/platform`; mover unidade; onboarding; formulários personalizados, anexos, pixels, webhooks, PWA, Wallet, NFC; importação                            | Sim       |

## 5. O que não trazer do legado

Conteúdo pessoal no template; `templateId` vindo do cliente; template mestre marcado pelo workspace; busca de perfil só por slug; slug trocado sem histórico (agora resolvido no núcleo); HTML do admin sem sanitização; upload por MIME do cliente (SVG); vCard sem escape; webhook sem bloqueio de rede interna; hash de IP sem sal; 96 colunas de cor; derivação que apaga o ajuste manual; Directus.

## 6. Próximo passo

A DP0, só documentação, com o "pode começar" do Marcelo: `MODULE_SPEC.md` do módulo (decisões, formato do JSON e motor) e o rascunho da ADR da rota pública. As propostas 12 a 18 entram como defaults explícitos.

## 7. Histórico

| Versão | Data       | Mudança                                                                                                                                                                                                                                                                                |
| ------ | ---------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 0.1    | 14/10/2026 | Primeira versão, a partir da comparação dos relatórios                                                                                                                                                                                                                                 |
| 0.2    | 15/10/2026 | Decisão 4 refeita: endereço `{host}/{slug}` com cascata de domínios; subdomínio por workspace fora do MVP; regras de domínio movidas para o plano da CF2c (plataforma)                                                                                                                 |
| 0.3    | 15/10/2026 | Unidade com finalidade em `workspace_locations`; campos pessoais; carência de 30 dias e 307 para o master; perfil master; modelos base; modos smart e gerenciado pelo plano; motor recuperado do legado; reaproveitamento autorizado; etapas reordenadas para o fluxo de ponta a ponta |
| 0.4    | 15/10/2026 | Decisão 4 alinhada à CF2c construída (PR #89): host com subdomínio por workspace (`rodobens.mobio.pro`), slug único por workspace e carência dentro do workspace; o serviço de endereços passa a ser a CF2e; etapa 2 vira CF2e-1                                                       |
