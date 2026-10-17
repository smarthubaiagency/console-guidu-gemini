# Central de Eventos (Event Hub): plano

Decisão em [ADR 0022](../adr/0022-central-de-eventos.md). Substitui a proposta da N1 do [handoff de 16/10/2026](../handoff/2026-10-16-handoff.md#5-próxima-etapa-n1-central-de-eventos-e-notificações). Fontes do legado: `analytics-eventos-notificacoes.md` e `schema-analytics-eventos-notificacoes.sql` (enviados pelo Marcelo em 16/10/2026, recuperados do CartãoPro/Linkko).

## 1. Ideia

```
serviço do módulo ──► emitEvent(tx, "digital_profile.lead.submitted", dados)
                          │  mesma transação: grava o evento e enfileira events.dispatch
                          ▼
                 catálogo diz os destinos do tipo
   ┌────────────┬────────────┬────────────┬──────────────────┬──────────────────┐
 notify       audit       analytics    subscribers        webhook do cliente
 (H1/H2)      (H1)        (H3, DP2)    (H4, GB2)          (H5)
```

O módulo só diz o que aconteceu; o catálogo decide para onde vai. Cada encaixe é construído na etapa que precisa dele.

## 2. Decisões do Marcelo (16/10/2026)

1. A central é um roteador com encaixes; cada destino na sua tabela.
2. Fases H1 a H5 (seção 4).
3. Emissão no serviço, na transação; sem trigger no banco.
4. Os `recordAudit` atuais ficam; os eventos novos passam pelo hub.
5. A plataforma não precisa ver dados de clientes, mas vê a situação de tudo e o `event_id` com um selo (hash) que permite validar a veracidade dos dados.
6. A autorização do cliente para o suporte libera a visualização total do evento: o cliente abre uma solicitação, o suporte localiza o evento e pede autorização para ver os dados. Prazo padrão de 72 horas.
7. Acesso total pelo papel `keychain`, somado ao papel principal (ex.: `operations` + `keychain`), só com permissão de ver os eventos da central. Registro só na auditoria da plataforma (o cliente não é avisado).

**Ainda valem, adotadas por padrão até confirmação:** rotas por papel (owner e admin no padrão; `partner_owner`, `partner_admin` e `partner_support` no gerenciado; parceiro zero = GUIDU); WhatsApp pelo webhook do parceiro dono da empresa, com número por pessoa em Minha conta; janela de silêncio só no WhatsApp, das 20h às 8h e aos domingos, no fuso do workspace (segurança urgente fura); resumo diário às 8h; regras na cascata (`notifications.rules`); eventos de segurança na central com aviso desligado por padrão; só o `owner` da plataforma concede o `keychain`.

## 3. O que aproveitamos do legado

| Legado                                                                                                                                        | Aproveitamento                                                                                                                                             | Etapa                  |
| --------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------- |
| Catálogo do Event Bus (`form.contact_submitted`, `contact.exchange`, `vcard.download`, `handoff.human`, `material.download`, `lead.scanned`…) | Tipos do perfil digital no nosso padrão (`digital_profile.lead.submitted`, `digital_profile.vcard.downloaded`…)                                            | H1 (catálogo), DP2     |
| `event_id` como fio ponta a ponta                                                                                                             | O id do evento em toda entrega, auditoria e envio                                                                                                          | H1                     |
| `wa_message_logs` (situação, provedor, erro, `delivered_at`)                                                                                  | `notification_deliveries` ganha `event_id`, `channel`, `recipient_user_id`, provedor e situações `queued`, `sent`, `delivered`, `failed`, `blocked_policy` | H1                     |
| `notification_mappings` versionado (`parent_id`, `is_current_version`)                                                                        | Versões dos textos de WhatsApp, como os modelos de e-mail da CF3b                                                                                          | H2                     |
| Proativo × reativo e consentimento LGPD na etapa 0                                                                                            | Campo `purpose` (`transactional` ou `marketing`); marketing ao lead exige consentimento                                                                    | H1 (campo), H5         |
| `lead_fatigue`                                                                                                                                | Fadiga por destinatário quando falarmos com o lead; nos avisos internos, resumo e janela de silêncio                                                       | H2, H5                 |
| `analytics_events` (`ip_hash` de 16 hex, 1 visita por IP e perfil a cada 60 s no Redis, `source` nfc/qr/direct)                               | Mesma lógica, índice `(workspace, tipo, data)`, gravando também `cta_click` e `vcard_save` (o legado nunca gravava)                                        | H3                     |
| Métricas (views, únicas, por origem, conversão = contatos / únicas, período anterior)                                                         | Consultas do painel do perfil sobre agregados diários                                                                                                      | H3                     |
| `addon_events` (conectou, caiu, reconectou)                                                                                                   | Eventos de saúde de conexão (Chatwoot, Zernio) no catálogo                                                                                                 | quando o módulo emitir |
| `workspace_events.changes` (diff dos campos críticos)                                                                                         | Diff opcional no encaixe de auditoria, pelo filtro de metadados atual                                                                                      | quando precisar        |
| `workspace_webhooks`                                                                                                                          | Encaixe de webhook do cliente em Integrações                                                                                                               | H5                     |

**Não aproveitamos:** Directus; POST para a própria API sem esperar; erros engolidos; ids de tipos diferentes que nunca se ligavam; endpoints que aceitavam qualquer requisição sem segredo; o RIE (dependia do n8n; volta com a IA). **Aviso:** o legado tem um token fixo do Directus em `test-events.ts` (`api.linkko.cloud`); revogar se ainda existir.

## 4. Etapas

> **Fila atualizada em 17/10/2026** em [fila-de-etapas.md](../fila-de-etapas.md): o perfil digital saiu da fila por enquanto; a H4 vem antes da GB2, a H5 se divide em H5a (webhook do cliente) e H5b (mensagens ao lead), e a H3 espera o perfil digital, salvo o núcleo, se a GB7 precisar.

| Etapa                                    | Migration (reservada)           | Entrega                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  | Quando                                                                                                 |
| ---------------------------------------- | ------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| **H1** Núcleo e notificações             | `20261125090000_h1_event_hub`   | Catálogo; `emitEvent` com a tabela `events` e o job `events.dispatch`; selo e corrente (`content_hash`, `prev_hash`, `key_version`) e a rotina de verificação; encaixe de notificação com rota por modo, sino, e-mail e WhatsApp pelo webhook do parceiro; encaixe de auditoria; `event_id` nas entregas; capacidade `keychain` com MFA, motivo e auditoria; leitura da situação de todos os eventos e entregas pela plataforma; os 6 avisos atuais, as análises da GB1a, o lead quente e a indicação pelo hub, mantendo o comportamento | Agora                                                                                                  |
| **H2** Regras, telas e acesso por evento | `20261210090000_h2_event_rules` | Regras na cascata; telas Eventos e Configurações › Notificações nos 3 níveis; WhatsApp por pessoa; resumo e janela de silêncio; escalonamento de aprovação sem resposta; versões dos textos de WhatsApp; eventos de segurança na central; acesso por evento (`event_access_grants`, 72 h, aviso ao cliente)                                                                                                                                                                                                                              | Antes da GB2                                                                                           |
| **H3** Analytics                         | com o DP2                       | Encaixe de analytics, `analytics_events` com agregados diários, métricas do perfil, painel agregado da plataforma; lead do formulário → CRM e aviso por e-mail ao dono do perfil                                                                                                                                                                                                                                                                                                                                                         | Com o perfil digital (DP2/DP5); núcleo antes, com a GB7, só se precisar ([fila](../fila-de-etapas.md)) |
| **H4** Módulos e passagem de trabalho    | com a GB2                       | Encaixe `subscribers` (evento → job de outro agente); ciclo de aprovação ligado às propostas da F4d                                                                                                                                                                                                                                                                                                                                                                                                                                      | Antes da GB2, em par com a AJ1 ([fila](../fila-de-etapas.md))                                          |
| **H5** Saídas externas                   | depois                          | Webhook do cliente; mensagens ao lead (proativo e reativo, consentimento e fadiga); templates da Meta pela camada de canais (ADR 0011)                                                                                                                                                                                                                                                                                                                                                                                                   | H5a (webhook) com a GB2; H5b (mensagens) com a IN7 ([fila](../fila-de-etapas.md))                      |

## 5. Lacunas registradas

| Lacuna                                    | Hoje                                                                                                                      | Onde resolve                                         |
| ----------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------- |
| Tela de auditoria completa na plataforma  | **Resolvida na AUD1** (seção 8): `/platform/audit` lê toda a trilha por `private.platform_audit_events`                   | AUD1                                                 |
| Entregas dos avisos visíveis à plataforma | `notification_deliveries` só para os papéis de cobrança (nasceu na F3c)                                                   | H1 (owner, operations e support veem a situação)     |
| Rastro completo de um evento              | **Resolvida na H2** (seção 10): gaveta do evento nos 3 níveis com entregas (sino incluído), auditoria e acessos aos dados | H2                                                   |
| Analytics de negócio                      | Não existe (o da CF7 é analytics de produto)                                                                              | H3, com painel agregado da plataforma                |
| Papéis múltiplos na plataforma            | `platform_admin_members` tem um papel por pessoa                                                                          | H1 (`platform_admin_capabilities` para o `keychain`) |
| Avisos fora do `notify`                   | Lead quente e indicação (webhook A6), análises da GB1a (função própria)                                                   | H1                                                   |
| Canal WhatsApp e rota por modo            | Não existem no `notify`                                                                                                   | H1                                                   |
| Flakiness dos e2e `privacy` e `proposals` | Falham sob carga e passam sozinhos                                                                                        | Corrigir na primeira etapa que mexer neles (seção 7) |

## 6. Duas etapas por vez

Com subagentes de teste no modelo Haiku 5.5 (só rodam e relatam; diagnóstico e correção com o agente principal), cada etapa num worktree com branch própria, banco, portas e Redis isolados (handoff de 15/10, seção 2).

- **Par 1: H1 + AUD1.** A H1 é a central; a AUD1 é a tela de auditoria completa no `/platform` (filtros por parceiro, cliente, ação, resultado e período; separação por papel: owner, operations e support veem tudo sem segredos, billing só cobrança) e o ajuste de leitura das entregas. Tocam tabelas diferentes (`events` × `audit_events`); conflitos esperados só no menu da plataforma, na matriz de permissões e no `ci.yml`. Migrations: H1 `20261125090000`, AUD1 `20261126090000_aud1_platform_audit`.
- **Par 2: H2 + GB1c.** Depois do merge do par 1. A GB1c (modos de serviço completos: pedido por link seguro, volta ao padrão, cláusula nos termos) já emite seus avisos pelo hub. Migrations: H2 `20261210090000` (o `20261127…` em diante ficou reservado para o Inbox), GB1c `20261128090000_gb1c_service_modes`.
- A H2 não roda em paralelo à H1 porque depende dela.

## 7. Testes mais baratos, sem perder segurança

**Princípio:** a segurança vem do CI completo no commit final de todo PR (e do merge só com tudo verde). O que dá para cortar é a repetição **local**, que é onde vão o tempo e os tokens dos subagentes.

**No trabalho local (agentes):**

1. **Durante a correção, só o que falhou e o que depende do que mudou:**
   - e2e: `playwright test --last-failed` ou o arquivo do teste que falhou;
   - Vitest: `vitest related <arquivos mudados> --run`;
   - SQL: só a suíte afetada, num banco já montado; o `rebuild-db.sh` completo só quando a migration mudar.
2. **Rodada completa uma vez**, antes do push final da etapa (typecheck, lint, Vitest, build, SQL e e2e), por um subagente Haiku.
3. **Quando volta a rodada completa no meio:** se a correção mexeu em código compartilhado (migration, `src/core/`, `src/lib/prisma/`, layout, `src/proxy.ts`, índice de idiomas, `package.json`), roda tudo de novo; se só mexeu em código de um módulo ou num teste, roda só os afetados.
4. **Relato curto:** o subagente grava a saída em arquivo e devolve só a lista de falhas com as primeiras linhas de cada erro. Isso evita colar logs inteiros no contexto.
5. **Falha no CI do PR:** baixar o log só do job que falhou, reproduzir localmente só aquele teste, corrigir e enviar. O CI roda tudo de novo no commit novo (rede de segurança); localmente, não.

**No CI (tempo, sem mexer na garantia):**

6. **PR só de documentação** não precisa de `db` nem de `e2e`: um job `changes` (filtro de caminhos) decide, e os jobs pulados respondem como concluídos, para não travar a proteção da branch. Qualquer arquivo fora de `docs/` e `*.md` roda tudo. **Implementado na AUD1:** o job `changes` faz `git diff --name-only base...head` num passo de shell (sem action de terceiros) e devolve `docs_only`; `db` e `e2e` têm `needs: changes` e `if: !cancelled() && docs_only != 'true'`. Falha fechada: push na `main`, diff vazio ou ilegível e falha do próprio `changes` rodam tudo. O `quality` não depende dele e roda sempre.
7. **Cache** do Chromium do Playwright e do `.next/cache` entre execuções. **Implementado na AUD1:** no `e2e`, `~/.cache/ms-playwright` com chave pela versão do `@playwright/test` lida do `pnpm-lock.yaml`; com cache, só `playwright install-deps chromium` (pacotes do sistema), sem cache, `install --with-deps`. No `quality` (o job que faz `pnpm build`), `.next/cache` com chave pelo lockfile e pelos arquivos de código (`src/**`, `next.config.ts`, `tsconfig.json`, `postcss.config.*`, `prisma/**`), restaurando o último cache do mesmo lockfile quando só o código muda. O `e2e` roda `pnpm dev`, não `build`, e fica sem cache do `.next`. Nenhuma suíte saiu; a lista das suítes SQL ficou igual, com a `platform-audit-rls.sql` acrescentada.
8. **E2E instáveis** (`privacy`, `proposals`): corrigir a causa em vez de depender das 2 repetições automáticas do CI.
9. **Não fazer:** pular jobs com base no diff de código, rodar no CI só o teste que falhou, ou aceitar merge com rodada parcial. Paralelizar o e2e (hoje `workers: 1`) exige dados isolados por teste; fica para uma etapa própria.

## 8. Implementado na AUD1

Branch `claude/aud1-platform-audit`, migration `20261126090000_aud1_platform_audit`.

- **Banco:** `private.platform_audit_events(parceiro, empresa, workspace, prefixo da ação, resultado, origem, ator, de, até, cursor_em, cursor_id, limite)`, `security definer`, dono `app_rls_helper`, `EXECUTE` só para `app_runtime` (grant antes da troca de dono). Devolve a trilha do mais recente ao mais antigo, com cursor por (`occurred_at`, `id`) e no máximo 200 linhas. O `audit_events` continua sem leitura direta pelo `app_runtime`. A política `audit_events_platform_audit_helper_select` (para `app_rls_helper`) repete a regra de papel, no padrão da CF5a.
- **Papéis:** `owner`, `operations` e `support` veem tudo, com os metadados (já filtrados pela allowlist de `src/core/audit/record.ts` na gravação). `billing` vê só as ações de cobrança, definidas por `private.is_billing_audit_action` pelos prefixos reais do código: `billing.`, `platform.billing.`, `partner.billing.`, `partner.payment.`, `partner.subscription.` e `partner.checkout.`. Parceiro, cliente e membro inativo não veem nada.
- **Parceiro do evento:** o `partnerId` dos metadados ou, sem ele, o parceiro da empresa. A função devolve ids; o serviço (`src/core/audit/platform-read.ts`) resolve os nomes pelo que o papel já lê (parceiros, listas de empresas, workspaces e usuários da plataforma, e-mail do membro de parceiro).
- **Prefixo da ação:** comparado como texto (`left(action, n) = prefixo`), sem curinga; o serviço aceita só `[a-z0-9_.]`.
- **Período:** dias inteiros no fuso de São Paulo (`-03:00`, sem horário de verão desde 2019), fim incluído.
- **Tela:** `/platform/audit` ("Auditoria", no menu da plataforma para os quatro papéis), permissão `platform.audit.read` revalidada na página e no serviço. Filtros acima, lista paginada (`Table` `soft`, `Badge` de situação, `Empty`), detalhe na gaveta (`WorkbenchLayout`) com `KeyValueList` dos campos e dos metadados, botão "Filtrar por este ator" e link para os eventos de segurança quando o evento também é de segurança e quem vê tem `platform.security.read`. Avisos pelo `useStatus()`; erro de formato fica ao lado do campo.
- **Testes:** `tests/core/platform-audit-rls.sql` (cada papel, billing restrito, filtros, cursor com empate, parceiro e cliente sem acesso, `app_runtime` sem `SELECT`, dono e grants reais), `src/core/audit/platform-read.test.ts` (filtros, período, cursor com microssegundos, nomes) e `e2e/platform-audit.spec.ts` (lista, filtro, gaveta; billing só cobrança). O `makePlatformAdmin` do e2e aceita o papel (padrão `owner`).
- **Fora da AUD1:** leitura das entregas (`notification_deliveries`) pela plataforma, que fica com a H1; o cursor da tela de eventos de segurança (CF5a) usa só milissegundos e pode pular eventos do mesmo milissegundo, a corrigir quando ela for mexida.

## 9. Implementado na H1

Migration `20261125090000_h1_event_hub`. Código em `src/core/events/`.

**O que entrou**

- **Catálogo** (`catalog.ts`, puro): por tipo, módulo, gravidade, `essential`, audiências, `purpose`, rota, destinos, canais e nível (`workspace`, `partner`, `platform`). Os canais das preferências (`notifications/channels.ts`) e os modelos de e-mail (`template-catalog.ts`) derivam dele sem mudar a tela de Minha conta (continua com 4 linhas, todas obrigatórias). `analytics` (H3), `subscribers` (H4) e `webhook` (H5) existem no tipo e são recusados pelo `emitEvent` com a etapa no erro; os tipos do perfil digital já estão catalogados e só poderão ser emitidos na H3.
- **Tabela `events`** com FORCE RLS: membros do workspace leem os eventos com audiência cliente, com os dados; parceiro e plataforma não leem a tabela, só as funções `private.partner_events` (dados só no gerenciado e nos eventos endereçados ao parceiro) e `private.platform_events` (sem a coluna `data`; `billing` só eventos de cobrança). Escrita só pelo `emitEvent` (app_runtime no workspace do contexto, por membro ou pelo parceiro que gerencia; app_worker nos jobs), com `occurred_at` de agora; o worker só altera `status`, `dispatched_at`, `verified_at` e `integrity` (grant por coluna). Retenção `events` desligada.
- **Selo** (`seal.ts`): HMAC-SHA256 do JSON canônico de id, tipo, ids, sujeito, autor, `occurred_at`, dados **e `prev_hash`**; `key_version` = `EVENTS_HMAC_KEY_ID`; rotação com `EVENTS_HMAC_KEYS_PREVIOUS`. Corrente por workspace, senão parceiro, senão plataforma (`chain_key` + `seq`), com trava por corrente (`private.event_prepare`, advisory lock na transação). Sem a chave, `emitEvent` lança `EventsKeyMissingError`; a conferência de variáveis da subida (`src/core/config/env.ts`) exige as duas no web e no worker.
- **Verificação** (`verify.ts`): `verifyEventRow`, `verifyPresentedData` (o dado apresentado com a situação que a plataforma vê, sem abrir os dados) e o job diário `events.verify-chains` (04:00 UTC), que grava `integrity` por evento e, para cada quebra nova, audita `platform.events.chain_broken` e emite o evento de mesmo nome (sino de owner e operations da plataforma).
- **`emitEvent`** (`emit.ts`): valida no catálogo e no nível, sela, grava e, na mesma transação, enfileira `events.dispatch` (linha de `job_runs`, chave `event:<id>`) e grava a auditoria quando o destino `audit` está no tipo. Mesma chave = mesmo evento.
- **`events.dispatch`** (`dispatch.ts`, app_worker): destinatários por `private.event_recipients` (security definer, variáveis `app.event_*` definidas e restauradas); preferências por pessoa e essenciais como antes; e-mail por `deliverNotification` (com o sino junto), sino sozinho sem e-mail e **WhatsApp** (`whatsapp.ts`) pelo webhook do parceiro dono da empresa (`private.event_notice_webhook`), formato HMAC da A6 com `event` = tipo e `event_id` no corpo e no cabeçalho `x-guidu-event-id`. Sem webhook, sem número ou motivo do módulo → `skipped` com o motivo; falha → `failed` e nova execução agendada, até 3 tentativas. Toda entrega guarda `event_id`, `channel`, `recipient_user_id`, `provider` e `attempts`.
- **`notification_deliveries`**: novas colunas e situações `queued`, `delivered`, `blocked_policy`; e-mail continua exigindo endereço e assunto; as linhas antigas valem como canal e-mail. A plataforma (owner, operations, support; billing nos eventos de cobrança) lê a situação das entregas de um evento por `private.event_deliveries`, sem endereço nem pessoa. A lista de avisos da Cobrança mostra só o canal e-mail.
- **Avisos atuais pelo hub**: cobrança atrasada/suspensa (rota `partner`), chave em reserva/pausada (rota `service_mode`), análises da GB1a (`subject_person`, quem iniciou) e lead quente e indicação da A6 (`explicit`, WhatsApp ao `owner_phone`; `ai_lead_notices` continua com o estado, atualizado pelo dispatch). Os jobs de cobrança e da chave despacham o evento na hora, na mesma execução, para manter contagens e chaves das entregas (`<chave do evento>:<e-mail>`, `:user:<id>`). Convite e e-mail de teste são `inline` no catálogo (`events/inline.ts`): continuam saindo pela própria requisição, que responde na hora. Os `recordAudit` existentes ficaram como estavam.
- **`keychain`**: tabela `platform_admin_capabilities`; só o owner concede/retira (em Usuários da Plataforma), inclusive a si mesmo, auditado; permissão `platform.events.read_all_data`; `private.read_event_data` confere a capacidade e o motivo e grava `platform.event.view_data` (event_id, tipo, motivo, IP) na mesma chamada, sem empresa nem workspace.
- **Telas**: `/platform/events` (filtros tipo, módulo, parceiro, cliente e período; gaveta com situação, selo, corrente, última verificação, entregas, conferência de dado apresentado e "Ver dados" só com `keychain`) e a seção Equipe da plataforma em `/platform/users`.
- **Testes**: `tests/core/events-rls.sql` (no job `db`), `src/core/events/{catalog,seal}.test.ts`, `tests/core/events-hub.test.ts`, ajustes em `ai-turns` e `google-business` (o aviso sai no dispatch) e `e2e/platform-events.spec.ts`.

**Decisões adotadas por padrão (a confirmar)**

1. `prev_hash` entra no material do selo (além do pedido), para que remover ou reordenar eventos quebre o selo seguinte.
2. Nomes novos no catálogo, `ai.agent.lead_hot` e `ai.agent.referral_recommended`, mas o webhook do parceiro continua recebendo `event` (corpo e cabeçalho `x-guidu-event`) com os nomes da A6, `lead.hot` e `referral.recommended`, para não quebrar os fluxos que já existem; o `event_id` do hub vai junto. O job antigo `ai-agents.lead-notice` ficou só para execuções já enfileiradas.
3. Convite e e-mail de teste não viram linha em `events` na H1 (precisam da resposta imediata); ficam governados pelo catálogo.
4. O sino não vira linha de entrega (o `user_notifications` é o registro); a gaveta mostra e-mail e WhatsApp.
5. A plataforma lê a situação das entregas por função, sem endereço (não abrimos a tabela ao suporte).
6. "MFA recente" = a sessão AAL2 já exigida no `/platform` (o projeto não tem marca de tempo do segundo fator).
7. No gerenciado, o aviso da chave vai a `partner_owner`, `partner_admin` e `partner_support`, com a marca do parceiro e o mesmo link.
8. Verificação diária às 04:00 UTC; resultado por evento em `integrity` (`ok`, `broken`, `unverifiable`).
9. `private.post_google_business_notice` continua no banco, sem uso.

## 10. Implementado na H2

Migration `20261210090000_h2_event_rules` (arquivo único). Código em `src/core/events/` (`rules.ts`, `rule-settings.ts`, `rules-service.ts`, `texts.ts`, `notices.ts`, `access.ts`, `views.ts`, `whatsapp-templates.ts`, `security.ts`, `h2-actions.ts`) e `src/core/notifications/whatsapp-number.ts`.

**O que entrou**

- **Regras na cascata** (ADR 0018, sem tabela): `notifications.rules` (por tipo: `enabled`, `channels`, `recipients` = `"route"` ou papéis, `delivery` = `immediate`/`digest`, `escalate_after_hours`, `escalate_to`, `locked`), `notifications.quiet_hours` (padrão 20h–8h e domingo) e `notifications.digest_time` (padrão 08:00). Os níveis se combinam tipo a tipo (`mergeRules`); um tipo travado pela plataforma ou pelo parceiro fica como está; essencial não desliga e nunca perde os canais do catálogo. O `events.dispatch` lê as regras do evento por `private.event_settings` (só as chaves `notifications.*` e `region.timezone` da plataforma, do parceiro e do workspace do evento). Sem regra, o comportamento é o da H1.
- **Destinatários por papel**: `private.event_audience(evento, papéis)`: sem papéis, a rota da H1; com papéis, os membros do workspace e, quando o parceiro gerencia a empresa (ou o evento é do parceiro), a equipe do parceiro. Cada pessoa vem com o WhatsApp só se aceitou.
- **WhatsApp por pessoa**: `user_whatsapp_numbers` (E.164, `consented_at`), em Minha conta › Notificações ("Meu WhatsApp" com aceite explícito) e coluna WhatsApp na matriz (mais um bloco "Outros avisos" com os avisos do hub sem modelo de e-mail). A entrega vai pelo webhook do parceiro dono da empresa, com `event` = tipo do catálogo, `event_id` e `text` (modelo versionado); sem número ou aceite → `skipped / no_whatsapp_consent`. O contrato da A6 (`lead.hot`, `referral.recommended`) não mudou.
- **Janela de silêncio e resumo**: WhatsApp a pessoas dentro da janela fica `queued` com `hold_reason = quiet_hours` e `deliver_after` (fim da janela no fuso do workspace; domingo inteiro); `security.*` `urgent` fura. Entrega `digest` guarda e-mail e sino (`hold_reason = digest`, `deliver_after` = próximo horário do resumo no fuso). O job `events.notices-tick` (a cada 15 min) libera o WhatsApp, manda um resumo por pessoa, canal e parceiro (textos `notifications.digest.*` nos 3 idiomas), faz o escalonamento e expira os acessos.
- **Escalonamento**: tipos com `approval` e situação `pending`: depois de `escalate_after_hours`, lembrete (sino e e-mail) à audiência; depois do dobro, aviso à audiência de `escalate_to`. Uma vez por etapa e pessoa (chaves). O único tipo com aprovação hoje é `events.access_requested`; os prazos reais vêm com a GB2.
- **Versões dos textos de WhatsApp**: `whatsapp_templates` (plataforma e parceiro, por evento e idioma, `version`, `is_current`, `parent_id`); cada edição cria versão; "Voltar ao padrão" só tira a atual (histórico inteiro). Variáveis por evento (`{{marca}}`, `{{workspace}}`, `{{link}}` e as do tipo), validadas. Envio: atual do parceiro, senão da plataforma, senão `notifications.whatsapp.*`.
- **Eventos de segurança** (nomes reais do código): `security.api_key_created` e `security.api_key_revoked` (de `api_keys.created`/`revoked`) e `security.mfa_requirement_off` (o workspace deixou de exigir o segundo fator; `urgent`). Aviso desligado por padrão (`notifyByDefault: false`); os `recordAudit` continuam.
- **Acesso por evento** (`event_access_grants`): pedido no `/platform` (owner, operations, support) ou no `/admin` (partner_owner, partner_admin, partner_support) com motivo, referência e prazo (24 h a 7 dias, padrão 72 h), para eventos de um workspace; o worker registra `events.access_requested` (`pending`, sino e e-mail para owner e admin); o owner ou admin aprova (até o prazo pedido), recusa ou revoga em Eventos; o pedido sem resposta expira em 7 dias e o aprovado no fim do prazo (job). Só quem pediu lê, só os eventos do pedido, por `private.read_event_data_by_grant`, que grava `event.data.viewed` com empresa e workspace na mesma chamada; o cliente vê "Dados vistos por X, autorizado por Y" no evento. O `keychain` continua só na auditoria da plataforma (o rastro do cliente não mostra `platform.event.view_data`).
- **Telas**: Eventos em `/app/[ws]/events`, `/admin/events` e `/platform/events` (filtros módulo, gravidade, situação e cliente; gaveta com o rastro: entregas com o sino, auditoria e acessos; resolver/ignorar; pedir e usar o acesso). Configurações › Notificações nos 3 níveis (matriz evento × canal × destinatários × entrega × escalonamento × trava, janela de silêncio, resumo e, na plataforma e no parceiro, os modelos de WhatsApp com histórico).
- **Testes**: `tests/core/event-rules-rls.sql` (no job `db`), `src/core/events/rules.test.ts`, `src/core/notifications/whatsapp-number.test.ts`, `tests/core/event-rules.test.ts` e `e2e/event-rules.spec.ts`.

**Decisões adotadas por padrão (a confirmar)**

1. A janela de silêncio vale só para o WhatsApp **a pessoas** (novo na H2); o WhatsApp explícito da A6 (`owner_phone`) continua imediato, para manter o comportamento da H1.
2. "Fura a janela" = módulo `security` com gravidade `urgent` (hoje só `security.mfa_requirement_off`).
3. WhatsApp é escolha da pessoa mesmo em aviso essencial (ela pode desligar a coluna); e-mail e sino dos essenciais seguem travados.
4. Destinatários na tela por predefinições (segue o modo, dono e administradores, só o dono, toda a equipe, equipe do parceiro, dono do parceiro, cliente e parceiro); papéis do parceiro só chegam quando ele gerencia a empresa.
5. O resumo agrupa por pessoa, canal e parceiro, com hora calculada quando o aviso é guardado; o resumo de WhatsApp sai em pt-BR.
6. Escalonamento: lembrete em N horas, encaminhamento em 2N; `escalate_to` vazio = só lembrete.
7. Pedido de acesso sem resposta expira em 7 dias; o cliente pode aprovar por menos tempo que o pedido, nunca mais.
8. O pedido é emitido pelo worker (job `events.access-request`, enfileirado pelo próprio pedido) porque só ele tem a chave do selo para eventos fora do workspace do contexto; o evento segue a situação do pedido (`private.event_access_sync`).
9. O requisitante do parceiro aparece ao cliente pelo e-mail de membro do parceiro (gravado pelo banco); o da plataforma, como "Suporte da plataforma".
10. O sino entra no rastro pela coluna nova `user_notifications.event_id` (sem virar linha de entrega, como decidido na H1).
11. `security.ip_blocked` não existe no código (a porta de IP não audita recusas) e a lista de IPs só vale para `/platform` e `/admin`; ficou de fora. O MFA desligado pela própria pessoa (Minha conta) não é auditado nem tem workspace; o evento ficou como `security.mfa_requirement_off` (exigência da equipe retirada).
