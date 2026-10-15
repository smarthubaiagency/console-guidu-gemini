# Plano CF7 — Gateway e analytics

Branch `claude/cf7-gateway-analytics` (worktree `/home/user/wt-cf7`). Migration `20261122090000_cf7_gateway_analytics.sql`. Guia de operação: [gateway-stripe.md](../operacao/gateway-stripe.md).

## Contexto

Cobrança manual e simulada (P5m, D-PA-14), com a porta `PaymentProvider` (`src/core/billing/provider.ts`) e Iugu e Stripe "previstos e desligados" (`providers/planned.ts`). Nenhum rastreio de uso no painel; a CSP com nonce (`src/core/security/headers.ts`, montada no `src/proxy.ts`) bloqueia qualquer terceiro. Levantamento, itens 8, 9 e 16.

## Objetivo

Aba **Gateway** em `/platform` › Cobrança só com o **Stripe Connect** (Iugu, Asaas, Pagar.me e gateway próprio do parceiro ficam para depois), credenciais cifradas, webhook assinado com saúde, teste e reprocessamento; **analytics de produto** (Plausible ou PostHog), desligado por padrão, com identificador opcional do parceiro.

## Lógica (decisões)

1. **Gateway em tabela própria** (`payment_gateways`, uma linha por provedor, só `stripe` no `check`): liga/desliga, padrão (no máximo um, só ligado), modo `test`/`live`, chave secreta e segredo do webhook cifrados (`encryptSecret`, o mesmo cofre das outras chaves) com cópia mascarada (`sk_test_...1234`). Ligar exige as duas credenciais; o modo precisa bater com o prefixo da chave. Lê e escreve só `owner` e `billing` da plataforma (`private.can_manage_platform_billing()`); `operations` não vê a aba.
2. **Cobrança real continua desligada até a P6.** O registro de provedores não muda (`ENABLED` só com `manual`); ligar o Stripe aqui só abre o webhook.
3. **Webhook** `POST /api/billing/stripe/webhook`, sem SDK: segredo por `private.payment_webhook_secret` (só gateway ligado), assinatura `t=`/`v1=` HMAC-SHA256 com tolerância de 5 minutos e comparação em tempo constante (`stripe-signature.ts`), corpo bruto guardado uma vez por id do evento (`payment_webhook_events`, `unique (provider, event_id)`) por `private.payment_webhook_receive`, resultado por `private.payment_webhook_finish`. As três funções são `security definer` do `app_rls_helper`, com a bandeira `app.payment_webhook` ligada e restaurada dentro delas.
4. **Processamento só registra** e marca como processado. Evento do outro modo fica com falha (`mode_mismatch`) e responde 200 (o Stripe não insiste); "Reprocessar falhas" tenta de novo os que falharam, idempotente (só linha `failed` muda). Assinatura inválida não é guardada (400).
5. **Webhook de teste:** evento sem dados (`guidu.webhook_test`), assinado com o segredo salvo e enviado à própria rota pelo `APP_URL` (confere endereço, assinatura e gravação). URL do webhook só leitura, derivada do `APP_URL`.
6. **Histórico** pela auditoria (`platform.billing.gateway.settings|credentials|test_webhook|reprocess`), lido por `private.payment_gateway_history(limit)` só por `owner`/`billing`; nunca guarda valor de credencial.
7. **Analytics na cascata** (ADR 0018, sem tabela): `analytics.enabled` (padrão `false`), `analytics.provider` (`plausible` padrão, `posthog`), `analytics.site_id`, `analytics.posthog_region` (só plataforma); `analytics.partner_enabled` e `analytics.partner_site_id` (só parceiro). O layout raiz e o proxy leem antes do login por `private.analytics_settings(partner)` (só linhas `analytics.*`), com cache de 30 s por parceiro limpo a cada salvamento.
8. **Sem script de terceiro:** o próprio painel envia o evento por `fetch` à API pública do provedor. A CSP só ganha o domínio do provedor em `connect-src` (`https://plausible.io` ou `https://<us|eu>.i.posthog.com`), só com o analytics ligado; o nonce e o `strict-dynamic` continuam.
9. **Sem dado pessoal:** só área (`platform`, `admin`, `app`, `auth`, `public`) e rota com partes variáveis trocadas por `:id` (`/app/<slug>` vira `:workspace`; segmento com dígito, maiúscula, `@` ou mais de 40 caracteres vira `:id`); sem query string, fragmento, referrer, título ou conteúdo. Eventos de produto (`login`, `agent_created`, `channel_connected`, `guids_activated`) definidos só com o nome, ainda não disparados.
10. **Consentimento:** PostHog guarda id anônimo no navegador, então nada sai antes do "Aceitar" (escolha guardada no `localStorage`) e o evento pede `$process_person_profile: false`; Plausible dispensa aviso. Fora de produção cada evento aparece no console.
11. **Parceiro:** identificador próprio no mesmo provedor da plataforma, medindo `auth` e `app` nos domínios dele; com a plataforma desligada, nada sai.

## Plano

Migration → serviço e webhook do gateway → página Gateway com abas de Cobrança → chaves `analytics.*` no catálogo → leitura antes do login, CSP no proxy e componente do navegador → telas de Analytics na plataforma e no parceiro → i18n nos 3 idiomas → testes → docs.

## Testes

SQL `tests/core/payment-gateway-rls.sql` (papéis, reprocessamento, funções do webhook, restrições, dono e execução, histórico, analytics antes do login); unidade `src/core/billing/gateway/*.test.ts` (assinatura válida, inválida, expirada, repetida e com rotação; credenciais e eventos) e `src/core/analytics/*.test.ts` (filtro de dado pessoal, configuração, CSP com e sem analytics); integração `tests/core/payment-gateway.test.ts` e `tests/core/analytics-settings.test.ts`; e2e `e2e/billing-gateway.spec.ts` e `e2e/analytics.spec.ts`.

## Decisões para o Marcelo confirmar

- A aba Gateway é só de `owner` e `billing`; `operations` (que lê Cobrança) não vê.
- Ligar o Stripe abre o webhook mesmo sem cobrança real; desligado, o webhook responde 404. O webhook de teste exige o gateway ligado.
- Evento do outro modo é guardado como falha e respondido com 200 (para o Stripe não repetir); assinatura inválida nunca é guardada.
- Latência mostrada = tempo de processamento (do recebimento ao primeiro resultado), não o atraso de entrega do Stripe.
- Credenciais só podem ser trocadas, não apagadas pela tela; os corpos dos eventos ficam guardados sem limpeza automática (pendência junto da LGPD, D-PA-06).
- Mudança de credencial do gateway não entra em Segurança › Eventos (evita reescrever `private.is_security_event`, que a CF6b também pode mexer).
- Analytics: ligar exige o identificador; o parceiro usa o mesmo provedor da plataforma; o analytics da plataforma mede todas as áreas, inclusive nos domínios dos parceiros; o do parceiro só login e `/app`.
- Envio direto à API do provedor em vez do script oficial (Plausible e PostHog), para controlar o que sai e não abrir `script-src`.
- Consentimento guardado no navegador, sem tela para mudar a escolha depois (só limpando os dados do site).
- Eventos de produto definidos, ainda não disparados por nenhuma tela.

## Estado (15/10/2026)

Implementado no worktree `wt-cf7` (branch `claude/cf7-gateway-analytics`), migration `20261122090000_cf7_gateway_analytics.sql`.
