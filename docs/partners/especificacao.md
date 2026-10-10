# Especificação da plataforma de parceiros — marca, pagamento e comunicação

- **Versão:** 0.1 (rascunho)
- **Data:** 10/10/2026
- **Estado:** proposta, aguarda aprovação do Marcelo. Base: [ADR 0012](../adr/0012-plataforma-de-parceiros.md).
- **Objetivo desta versão:** deixar a estrutura de parceria prevista para uso futuro, com contratos e pontos de extensão definidos, sem preencher regras comerciais por suposição.

Legenda: **[Decidido]** foi definido por Marcelo; **[Proposta]** é recomendação técnica a aprovar; **[Em aberto]** depende de decisão de produto, comercial, contábil ou jurídica; **[Verificar]** é fato de fornecedor ainda não confirmado na documentação oficial.

## 1. Níveis e superfícies

| Nível               | Quem                                      | Superfície  | Onde responde                                                    |
| ------------------- | ----------------------------------------- | ----------- | ---------------------------------------------------------------- |
| Plataforma          | Equipe interna (`platform_admin_members`) | `/platform` | Só nos domínios da plataforma                                    |
| Parceiro            | Membros do parceiro                       | `/admin`    | Domínio do parceiro; o parceiro zero usa o domínio da plataforma |
| Empresa e workspace | Clientes do parceiro                      | `/app`      | Domínio do parceiro                                              |

**[Decidido]** O GUIDU opera como **parceiro zero** para os clientes diretos. Toda empresa tem `partner_id`.

### 1.1 Resolução do parceiro

**[Proposta]** O `proxy.ts` resolve o parceiro pelo host (`partner_domains`) e passa a referência para o servidor. Páginas, actions e Route Handlers **revalidam** o parceiro no servidor, sem confiar só no proxy:

- host desconhecido: página neutra, sem marca, sem login;
- `/platform` fora dos domínios da plataforma: 404;
- usuário autenticado no domínio do parceiro A só lista empresas do parceiro A;
- a sessão (cookie) vale só no domínio em que foi criada.

### 1.2 Papéis do parceiro

**[Proposta]** Os nomes dos papéis são proposta; o produto confirma.

| Papel             | Pode                                                                                   |
| ----------------- | -------------------------------------------------------------------------------------- |
| `partner_owner`   | Tudo do parceiro, inclusive membros, domínio e conta de recebimento                    |
| `partner_admin`   | Clientes, marca, modelos de workspace, catálogo de módulos oferecidos, planos e preços |
| `partner_finance` | Planos e preços, faturas, repasses e relatórios financeiros                            |
| `partner_support` | Ver a lista de clientes; entrar num workspace só com concessão temporária              |

Nenhum papel de parceiro lê dados de workspace por padrão (pendência "Herança de acesso empresarial").

## 2. Marca

### 2.1 O que o parceiro configura

| Item                                    | Regra                                                                                                                                                                    |
| --------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Nome exibido                            | Substitui o `APP_NAME` no domínio do parceiro                                                                                                                            |
| Logos (claro e escuro), ícone e favicon | Arquivos em bucket público de marca, com tipo e tamanho validados                                                                                                        |
| Cores                                   | Mapeadas para os **tokens do design system** (primária, texto sobre primária e destaques), nunca CSS livre. O contraste mínimo é validado no salvamento (acessibilidade) |
| Contatos de suporte                     | E-mail, WhatsApp e URL de ajuda mostrados ao cliente                                                                                                                     |
| Documentos legais                       | Termos e privacidade (seção 5)                                                                                                                                           |

**[Proposta]** A marca é versionada. Publicar uma versão nova não altera e-mails já enviados, e o histórico fica auditado.

### 2.2 Domínios

| Etapa           | Como funciona                                                                                                   | Depende de                             |
| --------------- | --------------------------------------------------------------------------------------------------------------- | -------------------------------------- |
| Subdomínio      | `<slug>.<domínio-da-plataforma>`, com DNS e certificado curinga                                                 | Domínio de produção (ADR 0004)         |
| Domínio próprio | O parceiro aponta o CNAME, a plataforma confirma a posse por registro TXT e emite o certificado automaticamente | Decisão de hospedagem de produção (F6) |

Cada domínio ativo entra na lista de URLs de redirecionamento do Supabase Auth, e os links de convite, recuperação e confirmação apontam para o domínio do parceiro. **[Verificar]** Como manter essa lista por API sem edição manual.

### 2.3 Ponto único no código

**[Proposta]** `src/core/config/app.ts` (C05) evolui para `resolveBrand(host)` no servidor:

- hoje devolve a marca do ambiente, que vira a marca do parceiro zero;
- depois, a do parceiro do host.

Layouts, telas de autenticação, e-mails e metadados leem só dessa função. Isso já pode ser feito sem banco novo (seção 9).

## 3. Pagamento

### 3.1 Fluxo

1. A plataforma mantém os **planos base** (o que cada um inclui) e os **pisos** (preço mínimo e repasse mínimo) por versão.
2. O parceiro cria **planos de parceiro** sobre uma versão de plano base, com preço ≥ piso e periodicidade.
3. O cliente contrata no **checkout da plataforma**, servido no domínio e com a marca do parceiro.
4. O provedor cobra e **divide na origem**: parte do parceiro para a conta de recebimento dele, parte da plataforma para a conta da plataforma.
5. O webhook do provedor chega assinado, é gravado com chave única e processado em job. A assinatura muda de estado conforme a §18: ativa, em atraso, suspensa, cancelada.

### 3.2 Cálculo da divisão

**[Decidido]** O padrão é 70% para o parceiro e 30% para a plataforma, com valores mínimos.

**[Proposta]** Valores em centavos inteiros:

```text
repasse_plataforma = max(arredondar(preço × percentual_plataforma), repasse_mínimo_do_plano)
repasse_parceiro   = preço − repasse_plataforma
regra: preço ≥ preço_mínimo_do_plano e repasse_parceiro ≥ 0
```

| Preço do parceiro | Piso      | Repasse mínimo | Plataforma | Parceiro  |
| ----------------- | --------- | -------------- | ---------- | --------- |
| R$ 100,00         | R$ 100,00 | R$ 30,00       | R$ 30,00   | R$ 70,00  |
| R$ 200,00         | R$ 100,00 | R$ 30,00       | R$ 60,00   | R$ 140,00 |

Os números da tabela são ilustrativos. **[Em aberto]** Os valores reais de piso e repasse mínimo por plano (Comercial).

**[Em aberto]**

- Base do percentual: valor bruto ou líquido das taxas do provedor, e quem arca com as taxas.
- Estorno e chargeback: reversão proporcional e responsabilidade por disputa.
- Percentual diferente por parceiro: a regra é versionada por parceiro e o padrão é 70/30.
- Emissão de nota fiscal e enquadramento tributário de cada parte (contador).

### 3.3 Porta de provedor

**[Decidido]** Os provedores previstos são Iugu, Stripe e manual.

**[Proposta]** Contrato único no núcleo (`src/core/billing/`). Assinatura ilustrativa:

```ts
interface PaymentProvider {
  key: "iugu" | "stripe" | "manual";
  capabilities: {
    split: boolean;
    recurring: boolean;
    methods: Array<"card" | "pix" | "boleto">;
    hostedCheckout: boolean;
    recipientOnboarding: boolean; // KYC da conta do parceiro no provedor
  };
  createRecipient(partner: PartnerRef): Promise<RecipientRef>;
  getRecipientStatus(ref: RecipientRef): Promise<RecipientStatus>;
  upsertCustomer(org: OrganizationRef): Promise<CustomerRef>;
  createCheckout(
    input: CheckoutInput,
  ): Promise<{ url: string; externalId: string }>;
  cancelSubscription(ref: SubscriptionRef): Promise<void>;
  refund(ref: PaymentRef, amountCents: number): Promise<void>;
  verifyWebhook(raw: Buffer, headers: Headers): Promise<ProviderEvent[]>;
}
```

Os eventos normalizados (`ProviderEvent`) são: `recipient.verified`, `recipient.rejected`, `payment.paid`, `payment.failed`, `payment.refunded`, `chargeback.opened`, `chargeback.closed`, `subscription.canceled`. O domínio de cobrança só conhece esses eventos.

**Regras comuns a todo adaptador:**

- credenciais do provedor no cofre (§16);
- dados de cartão nunca passam pelos servidores da plataforma (checkout hospedado ou campos tokenizados);
- webhook verificado e gravado antes do processamento;
- chave de idempotência em toda chamada que cria cobrança;
- suíte de conformidade comum, no mesmo espírito da dos canais.

### 3.4 Adaptadores previstos

| Adaptador  | O que já se sabe                                                                                                                                                                                                                                                                                                                                                                                    | [Verificar] antes de implementar                                                                                                                                                   |
| ---------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Iugu**   | Subcontas criadas por API, que funcionam só em produção, com tokens a guardar. Split por fatura, por percentual ou valor fixo em centavos, entre subcontas e conta mestre. A conta que cria a transação paga as taxas e vê a transação; a conta que só participa recebe na liquidação.                                                                                                              | Assinatura recorrente com split; eventos e autenticação do webhook; Pix e boleto na assinatura; prazos de repasse; ambiente de teste para subcontas                                |
| **Stripe** | Connect com destination charges (a plataforma é o merchant of record) ou cobranças com `on_behalf_of` (o parceiro é o merchant of record). Plataformas fora do Brasil não cobram application fee de contas conectadas brasileiras, então a conta da plataforma precisa ser brasileira. Pix recorrente via Pix Automático aparece no changelog de 22/04/2026, com mandato e valor máximo autorizado. | Disponibilidade do Connect e do Pix Automático para conta brasileira (há artigo de suporte divergente); boleto em assinatura; quem é o merchant of record em cada tipo de cobrança |
| **Manual** | Sem gateway. O parceiro ou a plataforma registra o pagamento recebido fora (transferência, boleto próprio) com evidência anexada. O sistema calcula a divisão e gera o relatório de repasse a pagar.                                                                                                                                                                                                | —                                                                                                                                                                                  |

**[Proposta]** O provedor é escolhido **por parceiro** (o parceiro zero pode usar outro), com um único provedor ativo por parceiro de cada vez.

### 3.5 Telas

| Onde                | O quê                                                                                               |
| ------------------- | --------------------------------------------------------------------------------------------------- |
| `/platform`         | Planos base, pisos, regra padrão de divisão, provedores habilitados, visão de repasses por parceiro |
| `/admin` (parceiro) | Conta de recebimento e KYC, planos e preços do parceiro, faturas e repasses                         |
| `/app` (cliente)    | Checkout, plano atual, faturas, forma de pagamento e cancelamento, tudo com a marca do parceiro     |

## 4. Comunicação

| Tipo         | Exemplos                                                         | Canal                                                    |
| ------------ | ---------------------------------------------------------------- | -------------------------------------------------------- |
| Autenticação | Confirmação, recuperação de senha, MFA                           | E-mail                                                   |
| Conta        | Convite, mudança de papel, bloqueio                              | E-mail                                                   |
| Cobrança     | Fatura emitida, pagamento confirmado ou falho, atraso, suspensão | E-mail; depois WhatsApp pela camada de canais (ADR 0011) |
| Operacional  | Manutenção de módulo, incidente                                  | E-mail e aviso no app                                    |

**[Proposta]** Porta única de notificação (`src/core/notifications/`):

- **modelos por evento**, com variáveis da marca do parceiro (nome, logo, cores, contato);
- **remetente por parceiro**: domínio próprio com SPF, DKIM e DMARC validados, ou remetente da plataforma "em nome de" com resposta para o suporte do parceiro;
- **e-mails de autenticação** enviados pela plataforma pelo hook de envio do Supabase Auth, para que cada parceiro tenha a sua marca;
- envio em job, com idempotência e registro de entrega;
- texto legal e link de descadastro onde a lei pedir.

**[Em aberto]** Provedor de e-mail transacional. Mensagens de cobrança por WhatsApp entram quando a camada de canais existir.

## 5. Termos e privacidade

- Documentos por parceiro, **versionados**, com data de vigência.
- Aceite registrado por usuário e versão, com data, IP e user-agent só se a base legal justificar (§20).
- Uma versão nova exige novo aceite quando o documento declarar mudança relevante.
- **[Em aberto]** Papéis na LGPD: o parceiro tende a ser controlador dos dados dos clientes dele e a plataforma, operadora ou suboperadora. Isso exige contrato de parceria e acordo de tratamento (jurídico).

## 6. Modelos de workspace

**[Proposta]** O parceiro monta modelos com módulos habilitados e configurações padrão (o contrato de módulos da F2 já suporta isso) e gera um **link de cadastro**. O cadastro cria empresa e workspace a partir do modelo, já ligados ao parceiro. O modelo só usa módulos que o parceiro oferece e que a plataforma disponibiliza.

## 7. Dados (proposta)

Toda tabela com `partner_id` usa RLS por `app.partner_id`. As tabelas operacionais dos clientes continuam por workspace (ADR 0001). Nomes ilustrativos; o SQL nasce em migration aprovada.

| Tabela                                              | Conteúdo                                                                            |
| --------------------------------------------------- | ----------------------------------------------------------------------------------- |
| `partners`                                          | Nome, slug, status; inclui o parceiro zero                                          |
| `partner_members`                                   | Usuário, papel e status                                                             |
| `partner_domains`                                   | Host, tipo (subdomínio ou próprio), verificação, status do certificado              |
| `partner_brands`                                    | Versão da marca: nome, referências aos arquivos, tokens de cor, contatos            |
| `partner_legal_documents`, `legal_acceptances`      | Documentos versionados e aceites                                                    |
| `organizations.partner_id`                          | Coluna nova, `NOT NULL`, padrão o parceiro zero                                     |
| `payment_provider_accounts`                         | Provedor por parceiro, referência de credencial no cofre, estado                    |
| `partner_payment_accounts`                          | Conta de recebimento do parceiro no provedor e estado do KYC                        |
| `plans`, `plan_versions`, `pricing_floors`          | Planos base, versões e pisos (F3)                                                   |
| `partner_plans`                                     | Plano do parceiro sobre uma versão: preço, moeda, periodicidade, status             |
| `split_rules`                                       | Percentual e repasse mínimo, versionados, padrão e por parceiro                     |
| `subscriptions`                                     | Empresa, plano do parceiro, provedor, estado, período                               |
| `payments`                                          | Somente inclusão: valor bruto, taxas, repasses, ids do provedor, evidência (manual) |
| `payment_provider_events`                           | Webhooks recebidos, com id externo único e estado de processamento                  |
| `notification_templates`, `notification_deliveries` | Modelos por parceiro e evento; entregas com idempotência                            |

## 8. Segurança

- `/platform` nunca responde em domínio de parceiro, e as sessões não cruzam domínios.
- Contexto de parceiro montado no servidor a partir do host e do vínculo do usuário, nunca de campo de formulário.
- Arquivos de marca validados por tipo real e tamanho, sem SVG com script.
- Cores só como valores para tokens, com validação de formato e contraste; nada de CSS arbitrário.
- Credenciais de provedores, de e-mail e de domínio só no cofre.
- Acesso de suporte do parceiro por concessão temporária e auditada.

## 9. O que dá para preparar agora

Sem regra comercial nova e sem quebrar a ordem das fases (ADR 0003):

| Item                                                                                  | Esforço | Por que agora                                                               |
| ------------------------------------------------------------------------------------- | ------- | --------------------------------------------------------------------------- |
| Mover `/admin` para `/platform` (rotas, navegação gerada, testes e e2e)               | Baixo   | Fica mais caro a cada página administrativa nova                            |
| Parceiro zero: tabela `partners` mínima e `organizations.partner_id` com padrão       | Baixo   | Todo dado novo já nasce ligado a um parceiro                                |
| `resolveBrand(host)` no lugar do `appConfig`, devolvendo a marca do ambiente          | Baixo   | Toda tela passa a ler de um ponto que depois vira por parceiro              |
| Contratos `PaymentProvider` e `ProviderEvent`, mais o adaptador **manual** com testes | Médio   | Fixa a interface para Iugu e Stripe sem depender de conta no provedor       |
| Porta de notificação com modelos por evento, usando hoje a marca do ambiente          | Médio   | Centraliza os e-mails antes de existirem muitos                             |
| Tabelas de planos, divisão, assinaturas e pagamentos                                  | Alto    | **Esperar a F3**: depende dos números do Comercial e da escolha de provedor |
| Subdomínios, domínio próprio e hook de e-mail do Supabase                             | Alto    | **Esperar** a decisão de hospedagem de produção                             |

## 10. Decisões necessárias

| ID      | Decisão                                           | Recomendação                                                         |
| ------- | ------------------------------------------------- | -------------------------------------------------------------------- |
| D-PA-01 | Aprovar a ADR 0012                                | —                                                                    |
| D-PA-02 | Papéis do parceiro (seção 1.2)                    | Aprovar como proposto                                                |
| D-PA-03 | Base do percentual e quem paga a taxa do provedor | Comercial e contador                                                 |
| D-PA-04 | Estorno e chargeback                              | Reversão proporcional; responsabilidade a definir                    |
| D-PA-05 | Nota fiscal na divisão                            | Contador                                                             |
| D-PA-06 | Papéis na LGPD e contrato de parceria             | Jurídico                                                             |
| D-PA-07 | Provedor inicial                                  | Iugu, depois de verificar os itens da seção 3.4; manual para pilotos |
| D-PA-08 | Provedor de e-mail transacional                   | Em aberto                                                            |
| D-PA-09 | Ordem de execução                                 | Itens de esforço baixo da seção 9 primeiro                           |

## 11. Critérios de aceite (quando implementado)

1. Um usuário no domínio do parceiro A não vê empresas, marca nem termos do parceiro B.
2. `/platform` responde 404 em qualquer domínio de parceiro.
3. Membro de parceiro sem concessão não lê dados de workspace de cliente.
4. Preço abaixo do piso é recusado no servidor; o cálculo da divisão respeita o repasse mínimo e soma exatamente o preço.
5. Webhook duplicado de qualquer provedor não gera segundo efeito.
6. Trocar a versão da regra de divisão não altera assinaturas existentes sem processo explícito.
7. E-mails de autenticação e de cobrança saem com a marca e o remetente do parceiro do domínio.
8. Nenhuma credencial de provedor ou de e-mail aparece em log, erro ou DTO.
