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

| Etapa                                    | Migration (reservada)           | Entrega                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  | Quando          |
| ---------------------------------------- | ------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------- |
| **H1** Núcleo e notificações             | `20261125090000_h1_event_hub`   | Catálogo; `emitEvent` com a tabela `events` e o job `events.dispatch`; selo e corrente (`content_hash`, `prev_hash`, `key_version`) e a rotina de verificação; encaixe de notificação com rota por modo, sino, e-mail e WhatsApp pelo webhook do parceiro; encaixe de auditoria; `event_id` nas entregas; capacidade `keychain` com MFA, motivo e auditoria; leitura da situação de todos os eventos e entregas pela plataforma; os 6 avisos atuais, as análises da GB1a, o lead quente e a indicação pelo hub, mantendo o comportamento | Agora           |
| **H2** Regras, telas e acesso por evento | `20261127090000_h2_event_rules` | Regras na cascata; telas Eventos e Configurações › Notificações nos 3 níveis; WhatsApp por pessoa; resumo e janela de silêncio; escalonamento de aprovação sem resposta; versões dos textos de WhatsApp; eventos de segurança na central; acesso por evento (`event_access_grants`, 72 h, aviso ao cliente)                                                                                                                                                                                                                              | Antes da GB2    |
| **H3** Analytics                         | com o DP2                       | Encaixe de analytics, `analytics_events` com agregados diários, métricas do perfil, painel agregado da plataforma; lead do formulário → CRM e aviso por e-mail ao dono do perfil                                                                                                                                                                                                                                                                                                                                                         | DP2             |
| **H4** Módulos e passagem de trabalho    | com a GB2                       | Encaixe `subscribers` (evento → job de outro agente); ciclo de aprovação ligado às propostas da F4d                                                                                                                                                                                                                                                                                                                                                                                                                                      | GB2             |
| **H5** Saídas externas                   | depois                          | Webhook do cliente; mensagens ao lead (proativo e reativo, consentimento e fadiga); templates da Meta pela camada de canais (ADR 0011)                                                                                                                                                                                                                                                                                                                                                                                                   | CRM e mensagens |

## 5. Lacunas registradas

| Lacuna                                    | Hoje                                                                                          | Onde resolve                                                                           |
| ----------------------------------------- | --------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| Tela de auditoria completa na plataforma  | O `audit_events` não tem leitura geral; só o recorte de segurança (CF5a) e o do gateway (CF7) | **AUD1** (proposta para rodar em paralelo à H1)                                        |
| Entregas dos avisos visíveis à plataforma | `notification_deliveries` só para os papéis de cobrança (nasceu na F3c)                       | H1 (owner, operations e support veem a situação)                                       |
| Rastro completo de um evento              | Não existe                                                                                    | H2 (tela do evento: o que houve, quem foi avisado, por qual canal, o que foi auditado) |
| Analytics de negócio                      | Não existe (o da CF7 é analytics de produto)                                                  | H3, com painel agregado da plataforma                                                  |
| Papéis múltiplos na plataforma            | `platform_admin_members` tem um papel por pessoa                                              | H1 (`platform_admin_capabilities` para o `keychain`)                                   |
| Avisos fora do `notify`                   | Lead quente e indicação (webhook A6), análises da GB1a (função própria)                       | H1                                                                                     |
| Canal WhatsApp e rota por modo            | Não existem no `notify`                                                                       | H1                                                                                     |
| Flakiness dos e2e `privacy` e `proposals` | Falham sob carga e passam sozinhos                                                            | Corrigir na primeira etapa que mexer neles (seção 7)                                   |

## 6. Duas etapas por vez

Com subagentes de teste no modelo Haiku 5.5 (só rodam e relatam; diagnóstico e correção com o agente principal), cada etapa num worktree com branch própria, banco, portas e Redis isolados (handoff de 15/10, seção 2).

- **Par 1: H1 + AUD1.** A H1 é a central; a AUD1 é a tela de auditoria completa no `/platform` (filtros por parceiro, cliente, ação, resultado e período; separação por papel: owner, operations e support veem tudo sem segredos, billing só cobrança) e o ajuste de leitura das entregas. Tocam tabelas diferentes (`events` × `audit_events`); conflitos esperados só no menu da plataforma, na matriz de permissões e no `ci.yml`. Migrations: H1 `20261125090000`, AUD1 `20261126090000_aud1_platform_audit`.
- **Par 2: H2 + GB1c.** Depois do merge do par 1. A GB1c (modos de serviço completos: pedido por link seguro, volta ao padrão, cláusula nos termos) já emite seus avisos pelo hub. Migrations: H2 `20261127090000`, GB1c `20261128090000_gb1c_service_modes`.
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

6. **PR só de documentação** não precisa de `db` nem de `e2e`: um job `changes` (filtro de caminhos) decide, e os jobs pulados respondem como concluídos, para não travar a proteção da branch. Qualquer arquivo fora de `docs/` e `*.md` roda tudo.
7. **Cache** do Chromium do Playwright e do `.next/cache` entre execuções.
8. **E2E instáveis** (`privacy`, `proposals`): corrigir a causa em vez de depender das 2 repetições automáticas do CI.
9. **Não fazer:** pular jobs com base no diff de código, rodar no CI só o teste que falhou, ou aceitar merge com rodada parcial. Paralelizar o e2e (hoje `workers: 1`) exige dados isolados por teste; fica para uma etapa própria.
