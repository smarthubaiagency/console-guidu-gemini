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

**Estado:** concluída (PR #29), migrations aplicadas no dev.

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

**Estado:** concluída (PR #30), migration `20261014090000_f3b_contract_and_limits.sql` aplicada no dev.

Entregue:

- `private.organization_contract(org)`: o contrato da empresa para qualquer membro dela (viewer e editor não leem `subscriptions`). Sem assinatura: legado. Com assinatura aberta: ela; só canceladas: a mais recente.
- Estados de módulo novos: `not_contracted` (fora do plano ou assinatura cancelada) e `suspended` (só leitura). `assertModuleOperational(tx, ctx, módulo, "read" | "write")` separa consulta de escrita; telas, navegação, configurações do módulo e worker usam a mesma decisão. Habilitar um módulo fora do plano é recusado.
- **Plano provisório sem módulos listados não restringe** ("módulos a definir"), para não cortar os clientes do Essencial v1 semeado na P5m. Uma versão definitiva sem módulos restringe todos.
- Cotas: `plan_versions.limits` por versão (`core.seats`, `hello-world.records`), cadastradas em `/platform/billing`; sem limite no plano vale o padrão (manifesto do módulo; `max_seats` da empresa para assentos). Checagem na transação de criação, sob a trava de cada recurso; limite menor não apaga nada, só bloqueia novos.
- Assentos: convite e aceite usam o limite resolvido; dashboard, Equipe e Consumo mostram o mesmo número.
- "Consumo & Limites" com uso medido e fonte do limite (plano, padrão ou sem limite); `/platform/customers` mostra o plano ou "Legado"; `/admin/billing` marca "legado" quem não tem assinatura.
- Worker: job de módulo não contratado, suspenso ou desabilitado é ignorado na hora; só manutenção volta para a fila.
- Testes: suíte SQL `contract-rls.sql`, integração `entitlements.test.ts` (cada estado × leitura, escrita, configuração e worker; cota sob concorrência; plano menor sem apagar; assentos) e e2e `usage.spec.ts`.

Fora desta etapa: não há criação de workspace pelo cliente, então a cota `core.workspaces` fica para quando esse fluxo existir. API REST e MCP de módulos nascem na F4 e devem chamar os mesmos serviços, que já fazem a checagem.

- Estado do módulo considera o plano: "não contratado" fora de `plan_versions.module_keys`; regras da decisão 3; bloqueio em UI, API, MCP e worker (AC08).
- Serviço de cotas na transação que cria o recurso, com contadores por workspace e período; limites cadastrados por versão de plano, provisórios até o Comercial; o limite do hello-world vira cota cadastrada.
- "Consumo & Limites" com números reais e "Sem dados".
- Testes: cada estado × cada caminho, cota sob concorrência, mudança de plano sem apagar recursos.

### F3c — Cobrança em job (segunda metade da P5b)

**Estado:** pronta para revisão. Migration `20261015090000_f3c_billing_automation.sql` (como `app_migrations`).

Entregue:

- **Jobs de plataforma.** Além dos jobs pedidos por usuários (escopo `workspace`, F3a), o worker roda jobs sem usuário (escopo `platform`) como `app_worker`, por políticas estreitas da migration: lê assinaturas e só as colunas de que os avisos e relatórios precisam (grants por coluna; nada de CNPJ, comprovantes ou ids de membros), muda assinatura só de ativa para em atraso e de em atraso para suspensa (o gatilho da P5m continua validando a transição e os termos), grava avisos e relatórios e audita como serviço do worker (sem usuário nem workspace). Uma execução por tipo de job por vez, por trava.
- **Agendador no worker.** A cada minuto insere a execução devida com chave por período (`on conflict do nothing`): a rotina diária a partir das 06:00 de Brasília, chave = data; o relatório mensal do mês fechado, chave = mês. Vários workers e vários ticks criam uma execução por período; as execuções aparecem em `job_runs` como as demais.
- **Rotina diária** (`billing.daily-transitions`): ativa → em atraso quando `hoje ≥ vencimento + tolerância`; em atraso → suspensa quando `hoje ≥ vencimento + tolerância + carência`. Prazos em `billing_settings` (3 e 7, provisórios), editáveis por quem gerencia a cobrança da plataforma em `/platform/billing`, valendo a partir da próxima execução. Cada execução avança no máximo um passo por assinatura, então o parceiro sempre recebe o aviso de atraso antes da suspensão. Um pagamento registrado no meio do caminho vence: a mudança só acontece a partir da situação lida.
- **Avisos ao parceiro** (decisão 4): e-mail de cobrança do perfil de faturamento; sem perfil, os donos do parceiro. Pela porta de notificação, com a marca da plataforma e link para `/admin/billing` no domínio do parceiro. Cada aviso é gravado uma vez por chave (assinatura, situação, vencimento, destinatário) em `notification_deliveries`, com o resultado: hoje "não enviado (envio desligado)", D-PA-08. Parceiro e plataforma veem os avisos em `/admin/billing` e `/platform/billing`.
- **Relatório de repasse** (`billing.payout-report`): por parceiro e mês, com pagamentos e estornos datados no mês (recebido, estornado, líquido da plataforma e do parceiro). Um relatório gerado não muda; aparece em `/platform/billing` (todos) e `/admin/billing` (o do parceiro).
- Testes: suíte SQL `billing-automation-rls.sql`; unitários das regras de prazo, agendas e modelos de aviso; integração `billing-automation.test.ts` com o worker real e relógio controlado (antes do horário nada roda, uma execução por data, mesma data repetida sem efeito, suspensão depois da carência com aviso único, pagamento não desfeito, relatório gerado uma vez com estornos, prazos só pela cobrança da plataforma); e2e confere prazos, avisos e relatórios em `/admin/billing`.

Aprendizados:

- O Prisma não consegue ler `partner_members` como `app_worker` (com grant só de algumas colunas) por `findMany`; a consulta dos donos é SQL direto com as colunas permitidas.
- Uma execução de plataforma que esgota as tentativas fica como falha em `job_runs`, sem botão de reprocessar (o reprocessamento da tela de Execuções é do workspace). A rotina diária se recupera sozinha no dia seguinte, porque decide pelas datas; um relatório mensal com falha precisa de nova execução manual até a tela de operações da F3d.
- A carência conta a partir do vencimento, não da data em que a rotina marcou o atraso; com a rotina diária as duas coincidem, e um passo por execução evita suspender sem aviso depois de uma parada do worker.

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
