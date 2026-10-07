# Spike de motor de jobs — pg-boss vs pgmq (SMA-94)

## Decisão

**Recomendação única: pg-boss 12.37.0**, executado por processo de worker
separado, com polling quando conectado ao Supavisor em modo transação. O schema
é instalado somente por migration versionada e o worker opera como
`app_runtime` (`NOSUPERUSER`, `NOBYPASSRLS`).

O pgmq 1.5.1 é um núcleo de fila sólido e a prova confirmou visibility timeout,
redelivery e archive. Porém, para cumprir o contrato do produto, seria preciso
construir e manter por fora retries com backoff, dead-letter, idempotência,
agendamento e supervisão do worker. O pg-boss já entrega esses mecanismos e uma
API operacional coerente, reduzindo código crítico próprio.

## Ambiente e método

- Supabase dev `guidu`, ref `mmwmhlafzewdyqsgfkzk`, PostgreSQL 17.6.
- Supavisor transaction pooler: porta 6543 (`DATABASE_URL`).
- Conexão direta: porta 5432 (`DIRECT_DATABASE_URL`).
- Prefixos exclusivos: schema `sma94_jobs`, tabela
  `public.sma94_job_effects`, filas `sma94-*`.
- Antes de cada aplicação foi consultada
  `supabase_migrations.schema_migrations`. Foram encontradas as três migrations
  de SMA-92 antes das migrations `20261007230000` a `20261007230002`.
- A URL disponível autentica como `postgres`; o adaptador da prova abre uma
  transação, executa `SET LOCAL ROLE app_runtime` e só então executa cada
  comando. A prova também afirma `current_user = 'app_runtime'` dentro da
  transação do efeito.
- Payload contém apenas IDs estáveis (`userId`, `workspaceId`,
  `organizationId`, `idempotencyKey`); não contém bearer token.

## Comparação pelos oito critérios

| Critério | pg-boss (medido) | pgmq (medido/inspecionado) | Veredito |
|---|---|---|---|
| 1. Persistência e restart | Job enviado pelo produtor foi executado por nova instância após `stop()`/`start()`: 737 ms direto e 363 ms pooler | Mensagem persistiu e reapareceu após visibility timeout | Ambos passam; pg-boss cobre o ciclo completo do worker |
| 2. Retry, backoff, timeout, DLQ | Retry real terminou na 2ª tentativa (`retryCount=1`), em 2,407 s direto e 1,810 s pooler; falha terminal chegou à `sma94-dead`; `expireInSeconds=10` | `read_ct` avançou para 2 após VT; backoff, timeout de execução e DLQ exigem implementação própria | **pg-boss** |
| 3. Idempotência | Dois jobs com mesma chave produziram exatamente um efeito; `UNIQUE(idempotency_key)` é a última barreira transacional | Exige chave/índice/tabela de efeitos próprios | **pg-boss**, mantendo idempotência de domínio no banco |
| 4. Concorrência por workspace | Quatro jobs do mesmo `group.id=workspaceId`, `localConcurrency=4` e `localGroupConcurrency=1` tiveram máximo observado 1 | Exige coordenação própria (advisory lock ou tabela de leases) | **pg-boss**. A prova não certifica limite global multi-processo; habilitar/testar `groupConcurrency` antes de escalar horizontalmente |
| 5. Agendamento | Cron `*/5 * * * *` foi criado e lido pela API | Requer pg_cron ou scheduler externo; `pg_cron` estava disponível mas não instalado | **pg-boss** |
| 6. Privilégios/RLS | Worker operou como `app_runtime`, reavaliou vínculo atual via `spike_private.is_current_member` imediatamente antes do efeito, e negou usuário do tenant B | Funções são security-invoker e exigiram grants nas tabelas da fila; autorização de domínio continuaria sendo código próprio | **pg-boss**, com separação entre fila de infraestrutura e tabela de efeito com RLS |
| 7. Pooler transacional | Prova completa passou na porta 6543. `LISTEN/NOTIFY` não é compatível com transaction pooling; usar polling. Conexão direta também passou | Operações SQL passaram; não depende de sessão longa | Ambos passam; pg-boss em polling |
| 8. Observabilidade | `findJobs`, `getQueue`, `getQueueStats`, estados, `retryCount`, output, dead-letter e registry de instâncias | `metrics`, `metrics_all`, `read_ct` e tabelas archive; tentativas/erros de handler precisam de modelo próprio | **pg-boss** |

## Evidência da execução

Execução final de `npm run spike:test`:

```json
{
  "direct": {
    "schemaVersion": 45,
    "currentUser": "app_runtime",
    "restartMs": 737,
    "retryAttempts": 2,
    "retryMs": 2407,
    "deadLetterMs": 2682,
    "groupMax": 1,
    "crossTenantDenied": true,
    "schedule": "*/5 * * * *",
    "retryJob": { "state": "completed", "retryCount": 1 },
    "statsRows": 1
  },
  "pooler": {
    "schemaVersion": 45,
    "currentUser": "app_runtime",
    "restartMs": 363,
    "retryAttempts": 2,
    "retryMs": 1810,
    "deadLetterMs": 2672,
    "groupMax": 1,
    "crossTenantDenied": true,
    "schedule": "*/5 * * * *",
    "retryJob": { "state": "completed", "retryCount": 1 },
    "statsRows": 1
  }
}
```

Execução final do probe pgmq:

```json
{
  "visibilityTimeoutRedelivery": true,
  "readCount": 2,
  "archive": true
}
```

## Desenho proposto

1. API grava o job no Postgres antes de responder ao chamador.
2. Worker separado consome com polling e identidade técnica sem BYPASSRLS.
3. Payload carrega referências e chave de idempotência, nunca credenciais.
4. Antes do efeito, o worker abre transação, define contexto local e consulta
   vínculo/autorização atual. Revogação ocorrida após o enqueue impede o efeito.
5. O efeito e sua chave idempotente são gravados na mesma transação. A fila
   fornece entrega *at least once*; o domínio fornece efeito *at most once*.
6. `group.id = workspaceId` limita concorrência por cliente. A configuração
   multi-processo deve usar e testar `groupConcurrency`; a prova atual certifica
   um processo de worker com `localGroupConcurrency`.
7. Telas de Execuções leem uma projeção de domínio/RLS. Não devem expor o schema
   interno do pg-boss diretamente ao navegador.

## Código e reprodução

- `supabase/migrations/20261007230000_sma94_jobs_spike.sql`: schema pg-boss,
  filas, grants e tabela de efeitos com RLS.
- `scripts/jobs/run-spike.ts`: restart, retry, DLQ, idempotência, concorrência,
  cron, autorização e teste direto/pooler.
- `supabase/migrations/20261007230001_sma94_pgmq_probe.sql` e
  `scripts/jobs/run-pgmq-probe.ts`: prova do concorrente.

```bash
npm install
npm run spike:preflight
npm run spike:migrate
npm run spike:test
npx tsx scripts/jobs/run-pgmq-probe.ts
```

## Atualização proposta do ADR D2

Substituir “motor a decidir entre pg-boss e pgmq” por:

> Jobs persistentes usam pg-boss no Postgres, em schema de infraestrutura
> instalado por migration. O worker roda em processo separado sob papel técnico
> NOSUPERUSER/NOBYPASSRLS, usa polling através do Supavisor transaction pooler e
> reavalia autorização dentro da transação do efeito. Payloads não carregam
> bearer tokens. Idempotência é garantida por chave única no domínio, e
> concorrência é agrupada por workspace. LISTEN/NOTIFY só pode ser habilitado
> quando o worker usar conexão direta/sessão fixa.

## Limitações e limpeza

- O limite global entre múltiplos processos não foi certificado; apenas o limite
  por workspace em uma instância do worker. Isso deve virar teste de integração
  antes do primeiro scale-out.
- O ambiente não forneceu senha própria de `app_runtime`. `SET LOCAL ROLE` prova
  privilégios e RLS, mas produção deve autenticar diretamente como o papel
  técnico, sem iniciar sessão como `postgres`.
- `20261007235959_remove_sma94_jobs_spike.sql` está pronto e não foi aplicado.
  A extensão pgmq não é removida porque é um recurso compartilhável do projeto.
