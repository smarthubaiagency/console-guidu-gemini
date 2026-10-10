# Observabilidade

Etapa F3d do [plano da F3](plano-f3.md). Cobre logs, probes de saúde, métricas da fila, a tela `/platform/operations` e os alertas recomendados.

## Logs estruturados

Todo log da aplicação passa por `src/lib/telemetry/log.ts`. Um teste (`log-convention.test.ts`) recusa `console.*` em qualquer outro arquivo de `src/`.

Cada linha é um objeto JSON:

| Campo       | Conteúdo                                                                      |
| ----------- | ----------------------------------------------------------------------------- |
| `ts`        | Data e hora UTC (ISO 8601).                                                   |
| `level`     | `debug`, `info`, `warn` ou `error`. `warn` e `error` vão para o stderr.       |
| `source`    | `web` ou `worker`.                                                            |
| `event`     | `<área>.<evento>` em minúsculas, como `job.succeeded` ou `health.not_ready`.  |
| `requestId` | No web: o mesmo id devolvido ao usuário na mensagem de erro (§15).            |
| `jobId`     | No worker: o id da execução em `job_runs`, o mesmo da tela de Execuções.      |
| demais      | Campos do evento: `kind`, `attempt`, `code`, `errorName`, `instanceName` etc. |

Regras:

- **Sem segredos.** Valores passam pela redação do §15: chaves de API, JWT, senhas em URL e e-mails são mascarados. Campos cujo nome indica segredo (`token`, `secret`, `password`, `authorization`, `cookie`, `apiKey`, `credential`, `session`, `signature`) saem como `[REDACTED]`.
- **Erros** entram pelo nome e pela mensagem redigida, sem stack.
- **Sem conteúdo de cliente.** Nada de payload de job, corpo de requisição ou dados de módulo; só ids e contagens.
- Textos são cortados em 2.000 caracteres; objetos, em 4 níveis.

## Probes

| Processo | Liveness           | Readiness           | Pronto quando                                                         |
| -------- | ------------------ | ------------------- | --------------------------------------------------------------------- |
| Web      | `/api/health/live` | `/api/health/ready` | O banco responde a `select 1` em até 2 s.                             |
| Worker   | `GET /health/live` | `GET /health/ready` | O worker iniciou e o banco respondeu nos últimos 90 s (3 heartbeats). |

As probes do worker escutam em `WORKER_HEALTH_PORT`; sem a variável, ficam desligadas. As respostas trazem só `status` (e `checks` no web). Nunca trazem detalhes de erro e nunca ficam em cache.

O readiness do web não depende do worker: sem worker, o web continua servindo, e os jobs esperam em `job_runs`.

## Métricas da fila

O worker publica em tabelas que só a plataforma lê (papéis owner, operations e support; permissão `platform.operations.read`):

- `worker_heartbeats`: uma linha por instância, renovada a cada 30 s. Ao parar com sinal, a instância fica como "parada".
- `queue_metrics`: um retrato por tipo de job a cada 60 s, guardado por 7 dias. Cada retrato traz:
  - pendentes, na fila e em execução;
  - concluídas com sucesso, com falha e ignoradas nas últimas 24 h;
  - idade do pendente mais antigo;
  - duração média e p95 das execuções com sucesso nas últimas 24 h, com a amostra;
  - contagens do próprio pg-boss (aguardando e ativos), que o web não lê.

## Tela `/platform/operations`

Mostra quatro blocos:

- **Saúde:** o banco, com o tempo da consulta, e os workers. Um worker fica "em funcionamento" com sinal de até 2 min, "parado" quando avisou que parou e "sem sinal" quando o heartbeat atrasou.
- **Filas:** o último retrato por tipo de job, com a idade. Passa a "desatualizado" depois de 5 min sem publicação.
- **Execuções nas últimas 24 h:** contagens e durações, com a amostra.
- **Falhas dos últimos 7 dias:** só a mensagem segura de cada falha.

Sem publicação, cada bloco diz "Sem dados" em vez de mostrar zero.

## Alertas recomendados

Para configurar no provedor de hospedagem (F6/P7). Até lá, a tela mostra os mesmos sinais.

| Alerta                  | Condição                                                                                   | Severidade |
| ----------------------- | ------------------------------------------------------------------------------------------ | ---------- |
| Web fora                | `/api/health/ready` diferente de 200 por 2 min.                                            | Crítica    |
| Worker fora             | Nenhum worker "em funcionamento" por 5 min, ou `/health/ready` diferente de 200 por 5 min. | Crítica    |
| Fila parada             | Pendente mais antigo acima de 15 min em qualquer tipo de job.                              | Alta       |
| Falhas em série         | Mais de 5 falhas de um tipo de job em 1 h.                                                 | Alta       |
| Rotina de cobrança      | `billing.daily-transitions` sem sucesso no dia até 12:00 de Brasília.                      | Alta       |
| Relatório de repasse    | `billing.payout-report` do mês anterior sem sucesso até o dia 2.                           | Média      |
| Métricas desatualizadas | Último retrato com mais de 10 min.                                                         | Média      |
| Erros no web            | Mais de 20 linhas `level=error` com `source=web` em 5 min.                                 | Média      |

Cada alerta leva o `jobId` ou o `requestId` da ocorrência, para cruzar com os logs.
