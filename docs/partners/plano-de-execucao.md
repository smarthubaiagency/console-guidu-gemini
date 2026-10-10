# Plano de reestruturação do GUIDU para parceiros

- **Data:** 10/10/2026
- **Base:** [ADR 0012](../adr/0012-plataforma-de-parceiros.md) (aceita no PR #18) e [especificação de parceiros](especificacao.md) v0.3.
- **Regra geral:** cada etapa é um PR próprio, com testes e aceite do Marcelo. Etapas com SQL trazem migration versionada em `supabase/migrations`, aplicada no projeto dev `console-guidu` só depois do PR aprovado (ADR 0010). A ordem das fases da ADR 0003 continua valendo: o que é cobrança entra na F3, e domínios e e-mail entram na F6.

## Visão geral

| Etapa | Entrega                                         | Fase | Migration | Tamanho | Depende de       |
| ----- | ----------------------------------------------- | ---- | --------- | ------- | ---------------- |
| P1    | `/admin` vira `/platform`                       | F2   | Não       | Pequeno | —                |
| P2    | Parceiro zero e contexto de parceiro            | F2   | Sim       | Médio   | P1               |
| P3    | Marca por host e porta de notificação           | F2   | Sim       | Médio   | P2               |
| P4    | Console do parceiro em `/admin`                 | F2   | Sim       | Grande  | P3               |
| P5    | Planos, assinaturas e adaptador manual          | F3   | Sim       | Grande  | P4, worker da F3 |
| P6    | Provedor real (Iugu) e checkout do cliente      | F3   | Sim       | Grande  | P5, D-PA-07      |
| P7    | Subdomínios, domínio próprio e e-mail por marca | F6   | Sim       | Grande  | P6, hospedagem   |

São **sete etapas**. P1 a P4 não dependem de nenhuma decisão comercial e podem começar já. P5 a P7 dependem das decisões e dos fornecedores listados em cada uma.

## P1 — `/admin` vira `/platform`

**Estado:** concluída no PR #19.

**Objetivo:** liberar `/admin` para o console do parceiro sem mudar comportamento.

- Mover as rotas de `src/app/admin` para `src/app/platform` (painel, clientes, usuários, workspaces, módulos e configurações de módulos).
- Atualizar `src/proxy.ts`, o guard de página, a navegação gerada (`buildAdminNavigation` → `buildPlatformNavigation`), os links do cabeçalho, as ações de módulos e os comentários que citam `/admin`.
- `/admin` responde 404 até a P4.
- **[Proposta]** A superfície MCP administrativa da ADR 0009, ainda não construída (F4), nasce como `/mcp/platform` em vez de `/mcp/admin`.
- O valor `"admin"` do campo `destination` do manifesto de módulos continua significando o console da plataforma, para não mudar o contrato 1.0.0; a revisão fica para a P4.
- Atualizar ADR 0005 (rotas) com nota de alteração pela ADR 0012.
- Testes: unitários de navegação, `navigation-and-admin.test.ts`, e2e `platform-admin`, `auth-mfa` e `modules-hello-world` nas rotas novas.

**Aceite:** todos os testes verdes; nenhuma referência a `/admin` sobra fora do que a P4 vai reutilizar.

## P2 — Parceiro zero e contexto de parceiro

**Estado:** implementada no PR da P2; migration `20261010120000_p2_partners_and_partner_context.sql` a aplicar no dev após aprovação.

**Objetivo:** todo dado novo já nasce ligado a um parceiro.

- Migration:
  - `partners` (nome, slug, status, chave Ativar checkout, bloqueio da plataforma) com o **parceiro zero** semeado;
  - `partner_domains` mínima (host, tipo, status), com os hosts da plataforma ligados ao parceiro zero;
  - `organizations.partner_id NOT NULL`, preenchido com o parceiro zero nas empresas existentes;
  - helper `private.current_partner_id()` lendo `app.partner_id`, e políticas RLS com `FORCE` no padrão da ADR 0001.
- `resolvePartner(host)` no servidor; `withContext` e `withIdentityContext` passam a definir `app.partner_id`.
- No login e na lista de empresas, só aparecem empresas do parceiro do host.
- `/platform` responde 404 quando o host não é da plataforma.
- Testes: SQL de RLS (parceiro A não vê empresa do parceiro B), integração em PGlite e unitários da resolução por host.

**Como ficou:**

- Hosts da plataforma vêm do ambiente (host de `APP_URL`, `PLATFORM_HOSTS` e, fora de produção, `localhost` e `127.0.0.1`) e sempre resolvem para o parceiro zero. `partner_domains` guarda só hosts de parceiros; sem linhas até a P4/P7.
- O parceiro vem do host da requisição (primeiro valor de `X-Forwarded-Host`, senão `Host`), nunca de campo de formulário. O host só escolhe a fatia de parceiro; vínculo e RLS continuam decidindo o acesso. **Correção na P4b:** a versão inicial lia só `Host`. Depois de um redirect em Server Action, o Next monta a página de destino por uma requisição interna à própria origem, em que `Host` é o endereço do servidor e o host original segue em `X-Forwarded-Host`. Por isso o login e o aceite de convite num domínio de parceiro caíam no parceiro da casa.
- Host desconhecido não resolve nenhum workspace; `/platform` e `/api/v1/platform/*` respondem 404 fora dos hosts da plataforma (proxy, guard de página e rota).
- `resolve_workspace_slug` e `list_user_workspaces` passaram a exigir o parceiro do contexto. Páginas e ações usam `resolveRequestWorkspaceContext` e `listRequestUserWorkspaces` (`src/core/partners/request-context.ts`).
- `organizations.partner_id` não pode ser alterado pela aplicação (gatilho); mover empresa de parceiro será operação da plataforma.

**Ficou para depois, de propósito:**

- Chaves de API e MCP (`private.resolve_api_key`) ainda não conferem o parceiro: entra com o servidor MCP na F4.
- O link de convite ainda usa `APP_URL`; passa a usar o host do parceiro na P3, junto com a marca.

**Aceite:** critérios 1 e 2 da especificação §11.

## P3 — Marca por host e porta de notificação

**Estado:** implementada no PR da P3; migration `20261010150000_p3_partner_brands.sql` a aplicar no dev após aprovação.

**Objetivo:** toda tela e todo e-mail leem a marca de um único ponto.

- Migration: `partner_brands` versionada (nome, logo, cores em tokens, contatos de suporte), com a marca do parceiro zero vinda do ambiente (ADR 0004).
- `resolveBrand(host)` substitui o `appConfig` nas cerca de 13 telas e serviços que o usam hoje (login, convites, layouts, páginas de autenticação).
- Cores aplicadas como variáveis CSS a partir dos tokens, com validação de formato e de contraste; logo com verificação de tipo real e tamanho, sem SVG com script.
- Tela em `/platform` para editar a marca do parceiro zero.
- `src/core/notifications/`: porta única, modelos por evento com variáveis de marca, envio em job com idempotência. Até a P7, os e-mails de autenticação continuam saindo pelo Supabase Auth.
- Testes: contraste e validação de marca, resolução por host e modelos de notificação.

**Como ficou:**

- `partner_brands` só aceita inclusão: cada gravação cria a próxima versão e a maior é a ativa. Sem versão, vale a marca do ambiente (`APP_NAME`).
- O parceiro escolhe uma cor primária; as demais (texto sobre a cor, texto em destaque nos temas claro e escuro, hover e fundo suave) são calculadas para manter contraste mínimo de 4,5:1. Só valores `#rrggbb` chegam ao CSS, injetado em `<style id="brand-tokens">`.
- O logo fica na própria linha (PNG, JPEG ou WebP, até 256 KB, tipo conferido pela assinatura do arquivo) e é servido por `/brand/logo/[versão]` com `nosniff` e CSP restritiva. SVG é recusado. Não depende de serviço de armazenamento.
- `getRequestBrand()` substitui o `appConfig` em todas as telas e no título. Se a marca não puder ser lida (banco fora), a página usa a marca do ambiente em vez de falhar.
- Tela `/platform/brand` para owner e operations (permissão `platform.brand.manage`), com auditoria `partner.brand.update`.
- O link de convite usa o host da requisição: `APP_URL` nos hosts da plataforma e `https://` + domínio ativo do parceiro nos demais.
- `src/core/notifications/`: porta `notify()`, modelo de convite com a marca e escape de HTML, e transporte desligado até a escolha do provedor (D-PA-08).

**Ficou para depois, de propósito:**

- O envio de e-mails, o registro de entregas e a idempotência em job dependem do worker (F3) e do provedor de e-mail (D-PA-08). Hoje o convite continua sendo copiado na tela.
- A edição de marca pelo próprio parceiro entra na P4, ampliando a política de inclusão.

**Aceite:** trocar a marca do parceiro zero muda nome, logo e cores no login, no app e no convite, sem novo deploy.

## P4 — Console do parceiro em `/admin`

**Objetivo:** o parceiro opera os próprios clientes, ainda sem cobrança automática.

Dividida em dois PRs, aprovados por Marcelo em 10/10/2026, junto com os papéis da §1.2 (D-PA-02):

- **P4a**, implementada no PR da P4a, com a migration `20261010180000_p4a_partner_console.sql`, a aplicar no dev após aprovação. Entrega:
  - gestão de parceiros em `/platform/partners`: criar, suspender, cadastrar e ativar domínios, convidar e revogar;
  - membros e convites do parceiro;
  - console `/admin` com visão geral, clientes (só metadados), membros e marca;
  - aceite de convite em `/partner-invite/[token]`.
- **P4b**, em dois PRs:
  - **P4b1**, implementada no PR da P4b1, com a migration `20261011090000_p4b_partner_customers.sql`, a aplicar no dev após aprovação. Entrega:
    - cadastro de cliente pelo parceiro: empresa, primeiro workspace, módulos do modelo e convite de proprietário válido por 7 dias;
    - catálogo de módulos oferecidos;
    - modelos de workspace.

    O parceiro grava esses dados, mas continua sem ler o workspace ou o conteúdo dele. Até a P5, o cliente fica ativo assim que é cadastrado, e a suspensão de cliente entra com os estados de assinatura.

  - **P4b2**, implementada no PR da P4b2, com a migration `20261011120000_p4b2_legal_and_support.sql`, a aplicar no dev após aprovação. Entrega:
    - **termos e privacidade por parceiro**, versionados e só de inclusão, publicados em `/admin/legal` e, para o parceiro da casa, em `/platform/legal`;
    - **aceite:** o `/app` exige o aceite antes de entrar, e uma versão nova só pede novo aceite quando marcada como mudança relevante (a primeira sempre pede). O aceite guarda usuário, versão e data, sem IP nem navegador, até haver base legal (§20). As páginas públicas ficam em `/legal/terms` e `/legal/privacy`;
    - **acesso de suporte temporário:** o membro do parceiro (owner, admin ou suporte; nunca financeiro) pede acesso com motivo e prazo de 1 a 72 horas. O owner ou admin do workspace aprova, nega ou revoga em Configurações → Acesso de suporte. A aprovação cria um vínculo de visualizador ligado à concessão, e os helpers de vínculo do RLS e o guard só o aceitam enquanto a concessão estiver aprovada e no prazo; vencimento e revogação valem na próxima requisição, sem tarefa agendada. O cliente vê o histórico, e cada passo é auditado.

    Detalhe de segurança: políticas de `UPDATE` permissivas se combinam (o `USING` de uma com o `WITH CHECK` de outra). Por isso, cada `WITH CHECK` das concessões repete quem pode escrever. O teste SQL pegou o caso em que quem pediu aprovaria o próprio pedido.

**Como ficou a P4a:**

- **Convites:** o único caminho para entrar num parceiro.
  - O token fica guardado só como hash e vale por 72 horas.
  - O aceite exige o e-mail convidado e confirmado.
  - O RLS confere token, parceiro, papel e e-mail.
  - O e-mail do membro é copiado do convite, para o console listar a equipe sem ler perfis alheios.
- **`/admin`:** exige AAL2 e um papel ativo no parceiro do host. Parceiro suspenso perde o console e a resolução dos domínios.
- **O que os papéis não acessam:** nenhum papel de parceiro lê workspaces. O console mostra só nome, situação e data das empresas.
- **Quem gerencia:**
  - só o `partner_owner` gerencia membros, e nunca a própria linha;
  - `partner_owner` e `partner_admin` editam a marca do parceiro.
- **Domínios:** a ativação é manual e auditada até a verificação de DNS da P7.
- **Em desenvolvimento:** use domínios `*.localhost`, como `agencia.localhost`. O navegador os resolve para a máquina local, e os links usam o esquema e a porta de `APP_URL`.

- Migration:
  - `partner_members` com os papéis da §1.2 (`partner_owner`, `partner_admin`, `partner_finance`, `partner_support`);
  - `partner_legal_documents` e `legal_acceptances`;
  - modelos de workspace do parceiro;
  - concessão temporária de acesso de suporte (justificativa, validade, auditoria, visível ao cliente).
- Papéis de parceiro na matriz de permissões, separados dos papéis internos e dos de empresa.
- Telas em `/admin`: membros, clientes, **cadastro de cliente** (empresa, workspace a partir de modelo e convite ao responsável), modelos de workspace, catálogo de módulos oferecidos, marca e documentos legais.
- Aceite dos termos do parceiro no primeiro acesso do cliente.
- Gestão de parceiros em `/platform`: criar parceiro, convidar o `partner_owner`, bloquear.
- Nesta etapa a ativação do cliente é **manual**, registrada pela plataforma ou pelo parceiro com auditoria, porque ainda não há planos.

**Aceite:** critério 3 da §11; parceiro cadastra cliente e o cliente entra com a marca e os termos do parceiro.

## P5 — Planos, assinaturas e adaptador manual (F3)

**Pré-requisitos:** worker `app_worker` com pg-boss (F3, ADR 0002); números do Comercial para pisos, repasse mínimo e valor base (D-PA-11).

- Migration: `plans`, `plan_versions`, `pricing_floors`, `partner_plans`, `split_rules`, `partner_billing_profiles`, `subscriptions` (modo e pagador), `payments` (só inclusão) e `payment_provider_events`.
- Entitlements: o estado de módulo passa a considerar o plano contratado (pendência "Contratação no acesso a módulos").
- `src/core/billing/`: contratos `PaymentProvider` e `ProviderEvent`, cálculo da divisão em centavos, transições de assinatura da §18 e **adaptador manual** (registro com evidência e relatório de repasse).
- Modo **parceiro paga** completo com o adaptador manual: o parceiro ativa o cliente e registra as mensalidades.
- Chave **Ativar checkout** gravada com auditoria e pré-requisitos, mas o modo cliente paga só abre na P6.
- Testes: divisão (piso, repasse mínimo, soma exata), transições, idempotência de eventos e suíte de conformidade de provedor.

**Aceite:** critérios 4, 5, 6, 9 e 10 da §11 com o adaptador manual.

## P6 — Provedor real e checkout do cliente (F3)

**Pré-requisitos:** escolha do provedor (D-PA-07, recomendação Iugu); itens **[Verificar]** da §3.4 confirmados com o fornecedor; conta e credenciais no cofre; D-PA-03, D-PA-04 e D-PA-05 respondidos por Comercial e contador.

- Adaptador Iugu: subconta do parceiro e KYC, cliente, checkout, assinatura, divisão, estorno e webhook verificado e gravado antes do processamento.
- Checkout no `/app` quando a chave estiver ligada; modo parceiro paga também pelo checkout, para quem preferir cartão ou Pix.
- Regras de transição ao ligar e desligar a chave (§3.1) e inadimplência do parceiro (D-PA-13).
- Stripe fica como segundo adaptador, sob demanda, passando pela mesma suíte de conformidade.

**Aceite:** critérios 8, 11 e 12 da §11; fluxo completo em ambiente de teste do provedor.

## P7 — Domínios e e-mail por marca (F6)

**Pré-requisitos:** decisão de hospedagem de produção; provedor de e-mail transacional (D-PA-08).

- Subdomínio `<parceiro>.<domínio-da-plataforma>` com certificado curinga; domínio próprio com verificação por DNS e certificado automático.
- URLs de redirecionamento do Supabase Auth e cookies por host.
- Hook de envio de e-mail do Supabase Auth, com remetente por parceiro (SPF, DKIM e DMARC) ou "em nome de".

**Aceite:** critério 7 da §11; um parceiro com domínio próprio opera de ponta a ponta.

## O que dá para fazer por aqui e o que não dá

| Pode ser feito nesta sessão                                        | Precisa de você ou de fora                                                     |
| ------------------------------------------------------------------ | ------------------------------------------------------------------------------ |
| Código, migrations versionadas, testes unitários, de RLS e e2e     | Aprovar cada PR e aplicar a migration no dev, como foi feito na F2             |
| PRs com CI, revisão de diffs e correções                           | Números comerciais (pisos, repasse mínimo, valor base) antes da P5             |
| Adaptador manual e suíte de conformidade de provedor               | Conta, contrato e credenciais da Iugu (e da Stripe, se usar) antes da P6       |
| Documentação e atualização das ADRs                                | Contador (nota fiscal, D-PA-05) e jurídico (LGPD e contrato, D-PA-06)          |
| Adaptador Iugu escrito contra a documentação, com testes simulados | Teste real no provedor; a documentação da Iugu está bloqueada neste ambiente   |
|                                                                    | DNS, hospedagem, provedor de e-mail e configurações do painel do Supabase (P7) |
