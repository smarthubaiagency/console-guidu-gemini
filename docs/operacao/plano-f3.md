# Plano da F3 — Operação

Plano aprovado por Marcelo em 13/10/2026. A F3 vem depois da F2 e antes da F4, pela [ADR 0003](../adr/0003-ordem-das-fases.md). Cobre o que a especificação §23 chama de Operação: jobs, cotas, recuperação, privacidade e observabilidade. O cofre BYOK e a auditoria já existem.

Critérios de saída: AC08, AC15 e AC16 completos; AC12 para os dados do núcleo; AC13 como procedimento documentado (a prova de restore depende da hospedagem de produção, F6/P7).

## Decisões de 13/10/2026

1. **Papel do worker (opção a).** O worker conecta como `app_worker` (NOSUPERUSER, NOBYPASSRLS, NOINHERIT). Na transação de cada efeito ele define o contexto de quem pediu e faz `SET LOCAL ROLE app_runtime`, reusando todas as políticas de RLS. Só o `app_worker` acessa a fila.
2. **Enfileiramento por tabela.** O web grava em `job_runs` na mesma transação da ação (fila de saída). O worker leva as linhas pendentes ao pg-boss. A mesma tabela é a projeção da tela de Execuções.
3. **Acesso aos módulos por situação da assinatura (F3b).** Sem assinatura: comportamento atual, marcado como "legado". Aguardando pagamento, ativa e em atraso: liberado. Suspensa: só leitura e exportação. Cancelada: bloqueado, com dados preservados.
4. **Prazos da F3c**, cadastrados como provisórios: tolerância de 3 dias depois do vencimento para "em atraso" e carência de 7 dias em atraso antes de suspender (D-PA-13). Só o parceiro é avisado; o aviso ao cliente final espera o resto da D-PA-13.
5. Este plano fica registrado aqui.

## Etapas

Ordem: F3a → F3b → F3c → F3d → F3e. Um PR por etapa, com o "pode começar" do Marcelo.

### F3a — Fila e worker

**Estado:** pronta para revisão.

- Migration `20261013090000_f3a_worker_role_and_queue.sql` (**aplicar como `postgres`**): papel `app_worker`, direito de assumir `app_runtime` sem herdar, schema `pgboss` de propriedade do `app_worker` com o plano de instalação do pg-boss 12.37.0 gerado pela biblioteca. O `app_runtime` não tem acesso à fila.
- Migration `20261013091000_f3a_job_runs.sql` (como `app_migrations`): `job_runs` com RLS (membros leem; owner/admin reprocessam só falhas; o worker cuida do resto pelas próprias políticas).
- `src/core/jobs/`: `defineJob`, registro, `enqueueJob`, listagem e reprocessamento.
- `src/worker/` e `pnpm worker`: despacho atômico para o pg-boss, execução com reautorização, efeito no máximo uma vez, novas tentativas com espera crescente, fila de falhas, um job por workspace por vez entre processos.
- Tela `/app/[slug]/executions` com dados reais e job de referência no hello-world ("Em segundo plano").
- Testes: suíte SQL `jobs-rls.sql`, integração `jobs.test.ts` com o worker real (inclusive dois workers) e e2e `jobs.spec.ts` com o processo `pnpm worker`.

Aprendizados:

- **O `groupConcurrency` do pg-boss não garante o limite entre processos.** Duas buscas simultâneas pegaram dois jobs do mesmo workspace no teste com dois workers. O worker mantém o `groupConcurrency` e acrescenta uma trava por workspace (`pg_advisory_xact_lock`) na transação do efeito; o teste passa a provar um job por workspace por vez. Isso fecha a pendência "Escala horizontal de jobs".
- **Postgres 16+:** o `app_migrations` cria papéis, mas não concede o `app_runtime` (falta ADMIN OPTION). Por isso a migration do papel do worker roda como `postgres`; ela para com mensagem clara se rodar com outro papel.
- **E2E:** o PGlite tem uma sessão só. Web e worker passaram a usar `pgbouncer=true` (sem prepared statements com nome); isso também acabou com os erros "portal does not exist" que deixavam o e2e instável.

### F3b — Contratação e cotas (primeira metade da P5b)

- Estado do módulo considera o plano: "não contratado" fora de `plan_versions.module_keys`; regras da decisão 3; bloqueio em UI, API, MCP e worker (AC08).
- Serviço de cotas na transação que cria o recurso, com contadores por workspace e período; limites cadastrados por versão de plano, provisórios até o Comercial; o limite do hello-world vira cota cadastrada.
- "Consumo & Limites" com números reais e "Sem dados".
- Testes: cada estado × cada caminho, cota sob concorrência, mudança de plano sem apagar recursos.

### F3c — Cobrança em job (segunda metade da P5b)

- Rotina diária no pg-boss: ativa → em atraso → suspensa, com os prazos da decisão 4.
- Avisos pela porta de notificação, com envio desligado até o provedor de e-mail (D-PA-08); entregas gravadas como "não enviadas", com idempotência.
- Relatório de repasse por período, em job.
- Testes com relógio controlado e rotina repetida sem efeito duplicado.

### F3d — Observabilidade

- `/api/health/live` e `/api/health/ready` no web; equivalente no worker.
- Métricas da fila publicadas pelo worker numa tabela que só a plataforma lê.
- Tela `/platform/operations` com saúde, filas, falhas e consumo, com tamanho da amostra e "Sem dados".
- Convenção de logs estruturados (requestId, jobId, sem segredos) com teste; documento de alertas.

### F3e — Privacidade e recuperação

- Exportação do workspace em job (AC12), por contrato de exportação no manifesto, em bucket privado com URL assinada curta.
- Exclusão de workspace em job, com propagação e registro mantido.
- Mecanismo de retenção por categoria, desligado até as regras do jurídico.
- Auditoria de MFA por gatilho em `auth.mfa_factors` (pendência C11).
- Procedimento de backup e restore (banco e Storage); prova real na F6.

## Como rodar o worker

```bash
WORKER_DATABASE_URL="postgresql://app_worker:<senha>@<host>:5432/postgres" pnpm worker
```

O `app_worker` nasce sem senha. Em cada ambiente, defina com um papel que tenha ADMIN sobre ele (no dev, `postgres`): `alter role app_worker with password '<senha>';`.
