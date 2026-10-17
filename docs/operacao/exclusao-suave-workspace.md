# Exclusão suave do workspace

Etapa WS1. Completa a exclusão com carência da F3e. Regra de aceite: um workspace em exclusão suave não tem nenhum serviço funcionando, principalmente os GUIDS. O owner ainda pode cancelar dentro dos 30 dias.

Para tudo o que segue, um workspace está **fechado** quando o status dele não é `active`: `deletion_scheduled`, `suspended` ou `inactive`.

## Como funciona

1. O owner agenda a exclusão em /app › Configurações › Dados. O workspace passa a `deletion_scheduled` e `purge_after` fica 30 dias à frente. Um job `privacy.workspace-lifecycle` (ação `scheduled`) roda os ganchos `onDeletionScheduled` e manda o aviso "agendada".
2. Durante a carência, nenhum serviço do workspace funciona (veja a auditoria abaixo). /admin › Clientes e /platform › Workspaces mostram o selo "Exclusão agendada para dd/mm".
3. Sete dias antes da limpeza, o job diário de privacidade manda o lembrete uma única vez (marcador `workspace_deletions.reminder_sent_at`).
4. Se o owner cancelar, o workspace volta a `active` e um job `privacy.workspace-lifecycle` (ação `canceled`) roda os ganchos `onDeletionCanceled` e manda o aviso "cancelada". Só o owner cancela.
5. Passada a carência, o job diário enfileira um `privacy.workspace-purge` por workspace. Ele roda primeiro a limpeza externa (`purgeExternal` de cada gancho), fora de transação. A limpeza do banco só acontece quando todos os ganchos externos deram certo; ela manda o aviso "concluída" e apaga os dados na mesma transação.

Os ganchos e os avisos rodam no worker (app_worker), porque o contexto do owner fecha assim que a exclusão é agendada.

## Barreira central

| Camada         | Onde                                                    | O que faz                                                                                                                                                                     |
| -------------- | ------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Banco          | `private.workspace_is_active(uuid)`                     | Diz se o workspace está ativo. É `security definer` como app_rls_helper e libera a leitura de `workspaces` só durante a chamada (flag `app.workspace_status_check`).          |
| Banco          | políticas `channel_connections_ingest_select`/`_update` | Exigem workspace ativo. Fecham o webhook dos canais (`channel_webhook_connection`) e a gravação de eventos (`channel_ingest`).                                                |
| Worker         | `enterContext` em `src/worker/runtime.ts`               | Antes de todo job de workspace, e de cada transação curta de um job destacado, confere o workspace. Fechado: o job termina como `skipped`, sem erro (`workspace_not_active`). |
| Event Hub      | `dispatchEvent`                                         | Evento de workspace fechado é marcado como entregue sem enviar nada. Exceção: os quatro avisos de exclusão.                                                                   |
| IA (key-watch) | `src/core/ai/key-watch.ts`                              | Ignora agentes de workspace fechado.                                                                                                                                          |

## Auditoria dos caminhos

| Caminho                                                                         | Antes                                                                                  | Depois                                |
| ------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- | ------------------------------------- |
| Webhook dos canais (`channel_webhook_connection`, `channel_ingest`)             | aceitava eventos de workspace fechado e disparava os GUIDS                             | fechado                               |
| Envio dos canais (`channels.dispatch`, job destacado)                           | parava com erro só quando o contexto do membro caía; pelo caminho do parceiro, enviava | fechado                               |
| Turno dos GUIDS                                                                 | igual ao anterior                                                                      | fechado                               |
| Avisos de leads e indicações (A6)                                               | igual ao anterior                                                                      | fechado                               |
| Análises em segundo plano (GB)                                                  | igual ao anterior                                                                      | fechado                               |
| Propostas, exportação do workspace, demais jobs de workspace                    | igual ao anterior                                                                      | fechado                               |
| Jobs pedidos pelo parceiro (`partnerStillManages` ignorava o status)            | rodavam                                                                                | fechado                               |
| Entrega do Event Hub (e-mail, sino, WhatsApp)                                   | entregava                                                                              | fechado, exceto os avisos de exclusão |
| IA key-watch (pausa e avisos; o worker lia workspaces `deletion_scheduled`)     | agia sobre agentes do workspace                                                        | fechado                               |
| Chaves de API e MCP do workspace (`authenticateApiKey` + RLS)                   | recusavam                                                                              | já estava                             |
| Contexto web (`resolve_workspace_slug`, `is_workspace_member`)                  | recusava                                                                               | já estava                             |
| Acesso do parceiro em /admin (`resolveAdminAccess`, lista filtra `active`)      | recusava                                                                               | já estava                             |
| Domínios e slugs públicos, ForwardAuth `/api/domains/check`                     | políticas exigem status `active`                                                       | já estava                             |
| Conclusão do OAuth do Google (no contexto do workspace)                         | recusava                                                                               | já estava                             |
| Jobs enfileirados pela web (`job_runs_member_insert` exige membro)              | recusava                                                                               | já estava                             |
| Webhook do Stripe, jobs de cobrança, verificação da cadeia, tradução automática | não são de workspace                                                                   | não se aplica                         |
| API e MCP da plataforma                                                         | só leitura                                                                             | não se aplica                         |

## Ganchos do ciclo de vida

O contrato (`src/core/privacy/contract.ts`) tem três ganchos opcionais:

- `onDeletionScheduled(tx, workspaceId)`: o workspace acabou de fechar; por exemplo, tirar os atendentes das salas.
- `onDeletionCanceled(tx, workspaceId)`: desfaz o que o anterior fez.
- `purgeExternal(workspaceId, io)`: a carência acabou. Roda antes da limpeza do banco e fora de transação, lendo o que precisa por `io.transaction`. Precisa ser idempotente e tratar "já não existe" como sucesso.

Cada gancho roda em ordem; uma falha não impede os seguintes. Na nova tentativa, só roda o que ainda não deu certo. O resultado de cada um fica em `workspace_deletions.lifecycle`, por fase:

```json
{
  "purge": {
    "core.google_connection": {
      "status": "ok",
      "at": "…",
      "attempts": 1,
      "result": { "revoked": "revoked" }
    },
    "core.workspace_domains": {
      "status": "failed",
      "at": "…",
      "attempts": 2,
      "error": "…"
    }
  },
  "notices": { "scheduled": "…" }
}
```

Tentativas: o job de ciclo de vida tenta 5 vezes (30 s entre elas); o de limpeza, 5 vezes (300 s). Se as tentativas acabarem, o job diário enfileira a limpeza de novo no dia seguinte.

### Acrescentar um gancho

É uma linha:

- Módulo: declare os ganchos no contrato de dados do módulo (`src/core/privacy/registry.ts`). A chave fica `module.<moduleKey>`.
- Recurso do núcleo: acrescente a fábrica em `CORE_RESOURCES` de `src/core/privacy/lifecycle-registry.ts` (chave `core.<nome>`). As salas Matrix da IN3 entram assim.

Os módulos rodam antes dos recursos do núcleo.

### Primeiros ganchos

| Chave                    | Fase            | O que faz                                                                                                                                         |
| ------------------------ | --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| `core.google_connection` | `purgeExternal` | Revoga no Google o token da conta conectada (refresh, ou access na falta dele). `invalid_token` conta como já revogado.                           |
| `core.workspace_domains` | `purgeExternal` | Remove os Custom Hostnames no Cloudflare. Um 404 conta como já removido. Sem o Cloudflare configurado, registra `cloudflare: "off"` e não remove. |

## Avisos

Pelo Event Hub, rota `customer` (owners e admins ativos do workspace), por e-mail e sino, essenciais (não dá para desligar). Modelos em pt-BR, en e es no grupo "Conta".

| Evento                         | Quando                                 |
| ------------------------------ | -------------------------------------- |
| `workspace.deletion.scheduled` | ao agendar                             |
| `workspace.deletion.reminder`  | 7 dias antes da limpeza, uma única vez |
| `workspace.deletion.canceled`  | ao cancelar                            |
| `workspace.deletion.completed` | na limpeza, antes de apagar os membros |

A chave de idempotência do evento é `workspace-deletion:<id do registro>:<tipo>`, então reenviar não duplica. O aviso "concluída" é enviado dentro da transação da limpeza; se essa transação falhar depois do envio, a nova tentativa pode mandar o e-mail de novo (entrega pelo menos uma vez).

## Pontos em aberto

- Aceitar um convite já enviado ainda cria a participação no workspace fechado. Não tem efeito, porque o workspace continua fechado.
- As políticas do banco baseadas em `partner_manages_organization` são por organização e não olham o status do workspace; as entradas da aplicação olham.
- Sem o Cloudflare configurado, os hostnames existentes ficam lá.
- Jobs pulados durante a carência não são refeitos depois do cancelamento.
- Os ganchos das salas Matrix chegam com a IN3.

## Testes

- `tests/core/workspace-soft-delete-rls.sql`: barreira no banco, webhook recusado e aceito de novo, fila do ciclo de vida, acesso do worker.
- `tests/core/workspace-soft-delete.test.ts`: jobs pulados, Event Hub, ciclo de vida completo e limpeza que espera o gancho externo.
- `src/core/privacy/lifecycle.test.ts` e `src/core/jobs/errors.test.ts`: ganchos e classificação.
- `e2e/workspace-soft-delete.spec.ts`: agenda, webhook recusado, cancela, webhook aceito.
