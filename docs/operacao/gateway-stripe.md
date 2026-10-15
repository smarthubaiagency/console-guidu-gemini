# Gateway Stripe Connect e analytics de produto

Etapa CF7 do plano das configurações ([plano-cf7.md](../configuracoes/plano-cf7.md)). Telas em `/platform` › Cobrança › **Gateway** (Stripe) e `/platform` › Configurações › **Analytics** (mais `/admin` › Configurações › Analytics para o parceiro).

## Parte 1. Stripe Connect

### O que já funciona e o que não

| Item                                                     | Estado                                                                                                    |
| -------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| Liga/desliga, gateway padrão, modo teste ou produção     | Funciona. Ligar exige as duas credenciais; o padrão exige estar ligado; o modo precisa bater com a chave. |
| Credenciais (chave secreta e segredo do webhook)         | Cifradas no banco (AES-256-GCM, `ENCRYPTION_KEY`); a tela só mostra `sk_test_...1234`.                    |
| Webhook com assinatura, corpo bruto e idempotência       | Funciona. Evento repetido não tem segundo efeito.                                                         |
| Saúde, "Enviar webhook de teste", "Reprocessar falhas"   | Funciona.                                                                                                 |
| Histórico de mudanças                                    | Vem da auditoria (`platform.billing.gateway.*`), sem valor de credencial.                                 |
| **Cobrança real** (checkout, assinatura, split, estorno) | **Desligada até a P6** (D-PA-14). O adaptador Stripe continua respondendo "provedor não configurado".     |
| Processamento dos eventos                                | Só registra e marca como processado. Nenhuma assinatura, pagamento ou parceiro muda.                      |

Quem vê e edita: papéis `owner` e `billing` da plataforma (`operations` não vê a aba).

### O que o Marcelo cadastra no Stripe

1. Criar (ou usar) a conta da plataforma no Stripe com o **Connect** ativado (a plataforma é a conta principal; cada parceiro será uma conta conectada na P6).
2. Começar em **modo de teste**. Em Developers › API keys, gerar uma **chave restrita** (`rk_test_...`) ou usar a secreta (`sk_test_...`). Nesta etapa a chave só é guardada; nenhuma chamada é feita ao Stripe.
3. Em Developers › Webhooks › Add endpoint:
   - URL: a que aparece no card "Webhook" da aba Gateway: `<APP_URL>/api/billing/stripe/webhook` (em produção, `https://console.guidu.co/api/billing/stripe/webhook` ou o domínio definitivo).
   - Eventos: por enquanto qualquer lista serve (todos são só registrados). Para a P6, os previstos são `invoice.paid`, `invoice.payment_failed`, `charge.refunded`, `charge.dispute.created`, `charge.dispute.closed`, `customer.subscription.deleted` e `account.updated`.
   - Marcar "Listen to events on Connected accounts" quando os parceiros tiverem contas conectadas (P6).
4. Copiar o **Signing secret** do endpoint (`whsec_...`).

### O que o Marcelo cadastra no painel

1. `/platform` › Cobrança › Gateway › **Credenciais**: colar a chave (`sk_test_`/`rk_test_`) e o `whsec_`. Salvar. Elas voltam só mascaradas.
2. Card **Stripe Connect**: marcar "Ligar o Stripe Connect" (e, se quiser, "Usar como gateway padrão"), modo **Teste**. Salvar.
3. Card **Webhook**: "Enviar webhook de teste". O painel assina um evento sem dados com o segredo salvo e o envia à própria rota pelo `APP_URL`. Deve aparecer na lista como `guidu.webhook_test` com o selo "teste".
4. No Stripe, "Send test webhook" também deve chegar e aparecer como processado.

Para produção: trocar o modo para **Produção** só depois de cadastrar a chave `sk_live_`/`rk_live_` e um endpoint de produção com o seu `whsec_` (o painel recusa chave de um modo com o gateway no outro).

### Variáveis de ambiente

Nenhuma nova. Valem as que já existem:

- `APP_URL`: origem pública do painel. Define a URL do webhook mostrada na tela e o destino do webhook de teste.
- `ENCRYPTION_KEY` (e `ENCRYPTION_KEY_ID`, `ENCRYPTION_KEYS_PREVIOUS` na rotação): cifra das credenciais, a mesma das outras chaves.

Nenhum segredo vai para o repositório nem para variável de ambiente nova: as credenciais do Stripe ficam só no banco, cifradas.

### Como o webhook decide

1. Gateway desligado ou sem segredo: `404 Webhook not configured.` (nada é lido nem guardado).
2. Corpo acima de 256 KB: `413`.
3. Assinatura (`Stripe-Signature: t=...,v1=...`): HMAC-SHA256 de `t.corpo` com o `whsec_`, comparação em tempo constante, tolerância de 5 minutos para frente ou para trás. Falhou: `400 Invalid signature.` e nada é guardado (só um aviso no log com o motivo).
4. Evento válido: o corpo bruto é guardado uma vez por `id` (`evt_...`). Repetição de um evento já processado: `200` com `duplicate: true`, sem segundo efeito. Repetição de um que falhou: processa de novo.
5. Processamento desta etapa: só marca como processado. Um evento do outro modo (por exemplo `livemode: true` com o gateway em teste) fica **com falha** (`mode_mismatch`) e a resposta é `200`, para o Stripe não insistir por dias; corrija o modo e use "Reprocessar falhas".

Saúde no card: recebidos nos últimos 7 dias, com falha, último recebido e latência de processamento (média e máxima, do recebimento ao primeiro resultado).

### Retenção

Os corpos guardados podem ter dados de clientes do Stripe (nome e e-mail do pagador). Ainda não há limpeza automática; fica como pendência para a P6 junto da revisão de LGPD (D-PA-06).

## Parte 2. Analytics de produto

**Desligado por padrão.** Depende da revisão jurídica de LGPD (D-PA-06): só ligar depois da aprovação.

### O que é enviado

- Só a área da tela (`platform`, `admin`, `app`, `auth`, `public`) e a rota com as partes variáveis trocadas por `:id` (o workspace de `/app/<slug>` vira `:workspace`).
- Nunca: e-mail, id de pessoa ou registro, nome do workspace, token, query string, fragmento, referrer, título ou conteúdo.
- Nenhum script de terceiro é carregado: o próprio painel envia o evento por `fetch`. A CSP abre só o domínio do provedor escolhido em `connect-src`, e só com o analytics ligado; os scripts continuam só com nonce.
- Fora de produção, cada evento também aparece no console do navegador (`[analytics]`).
- Eventos de produto previstos (só o nome, sem propriedades): `login`, `agent_created`, `channel_connected`, `guids_activated`. Estão definidos (`trackProductEvent`), mas ainda não são disparados por nenhuma tela.

### Provedores

| Provedor           | O que cadastrar em "Identificador do site"                                           | Consentimento                                                                                                   | Domínio liberado na CSP                                  |
| ------------------ | ------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------- |
| Plausible (padrão) | O domínio do site criado no Plausible (por exemplo `console.guidu.co`)               | Dispensado: sem cookie e sem identificador                                                                      | `https://plausible.io`                                   |
| PostHog            | A chave pública do projeto (`phc_...`) e a região (Estados Unidos ou União Europeia) | Nada é enviado antes de a pessoa aceitar o aviso; guarda um id anônimo no navegador e não cria perfil de pessoa | `https://us.i.posthog.com` ou `https://eu.i.posthog.com` |

A chave `phc_` do PostHog é pública (vai para o navegador) e fica nas configurações, não no cofre.

### Parceiro

Em `/admin` › Configurações › Analytics o parceiro (owner e admin) pode ligar um identificador próprio, no mesmo provedor da plataforma. Ele mede o login e o `/app` dos clientes dele, nos domínios dele. Com o analytics da plataforma desligado, nada é enviado, nem para o parceiro.

### Ordem para ligar

1. Revisão de LGPD aprovada (D-PA-06), com o aviso de privacidade atualizado.
2. Criar o site no Plausible (ou o projeto no PostHog).
3. `/platform` › Configurações › Analytics: escolher o provedor, colar o identificador, marcar "Ligar o analytics de produto" e salvar. A mudança vale na hora (a CSP e a configuração são relidas a cada 30 s e limpas ao salvar).
