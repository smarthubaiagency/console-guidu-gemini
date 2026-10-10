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

**Estado:** concluída (PR #31), migration `20261015090000_f3c_billing_automation.sql` aplicada no dev.

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

**Estado:** concluída (PR #32), migration `20261016090000_f3d_operations.sql` aplicada no dev. Detalhes em [observabilidade.md](observabilidade.md).

Entregue:

- **Logs estruturados:** `src/lib/telemetry/log.ts`, uma linha JSON por evento com `ts`, `level`, `source`, `event` e `requestId` (web) ou `jobId` (worker). Valores redigidos e campos com nome de segredo cortados. Erros do web (`toSafeError`), marca, auditoria e todo o worker passaram a usá-lo; um teste recusa `console.*` fora dele.
- **Probes:** `/api/health/live` e `/api/health/ready` no web (banco em até 2 s, sem detalhes, sem cache). No worker, `/health/live` e `/health/ready` em `WORKER_HEALTH_PORT` (pronto quando iniciou e o banco respondeu nos últimos 90 s).
- **Métricas:** o worker grava heartbeat por instância (30 s) e um retrato por tipo de job (60 s) em `worker_heartbeats` e `queue_metrics`. O retrato traz contagens de `job_runs` e do pg-boss, idade do pendente mais antigo e durações das últimas 24 h; fica 7 dias. Só o worker escreve; só owner, operations e support leem (permissão nova `platform.operations.read`, fora do papel billing).
- **Tela `/platform/operations`** (menu "Operações"): saúde do banco e dos workers (em funcionamento, parado, sem sinal), filas com a idade do retrato, execuções de 24 h com a amostra, falhas de 7 dias com a mensagem segura. "Sem dados" quando o worker não publicou.
- **Alertas:** tabela de alertas recomendados em [observabilidade.md](observabilidade.md), para configurar no provedor na F6/P7.
- Testes: suíte SQL `operations-rls.sql`; unitários do logger (redação, campos fixos, correlação), da convenção de logs, das probes do web e do worker e dos rótulos da tela; integração `operations.test.ts` (heartbeat, retrato, falhas, worker parado, papéis); e2e das probes do web e da tela.

Decisões desta etapa:

- "Consumo" na tela é o volume de execuções de 24 h por tipo de job, com a amostra. O consumo por workspace (cotas) já está em "Consumo & Limites" da F3b.
- O readiness do web não depende do worker: sem worker o web segue servindo e os jobs esperam em `job_runs`.

### F3e — Privacidade e recuperação

**Estado:** pronta para revisão. Duas migrations:

- `20261017090000_f3e_privacy.sql`, aplicar como `app_migrations`.
- `20261017091000_f3e_mfa_audit.sql`, **aplicar como `postgres`**. No dev, `postgres` tem BYPASSRLS e o privilégio de gatilho em `auth.mfa_factors` (conferido em 17/10/2026). A migration para com mensagem clara se rodar com outro papel.

Decisões de 17/10/2026:

1. **Arquivo da exportação no banco.** Fica em `workspace_exports` (bytea, até 25 MB) e é servido por rota do app que revalida sessão, permissão e MFA. O link vale 15 min e é assinado com chave derivada da `ENCRYPTION_KEY`, sem segredo novo. O arquivo expira em 24 h. O Supabase Storage fica para a F6, atrás do mesmo serviço.
2. **Exclusão lógica com carência de 30 dias.** Ao agendar, o workspace fecha para todos. Durante a carência o owner pode cancelar em `/app`. Depois, a rotina diária apaga os dados e deixa uma lápide.
3. **Permissões.** `workspace.data.export` vale para owner e admin; `workspace.delete` só para owner. As duas pedem MFA verificado e são auditadas.
4. **Auditoria de MFA** por gatilho em `auth.mfa_factors`, numa migration separada aplicada como `postgres`.

Entregue:

- **Banco:**
  - `private.is_workspace_member` e `private.current_workspace_role` passam a exigir workspace ativo. Assim, um workspace agendado ou excluído fecha em todas as políticas de uma vez: web, chaves de API, MCP e worker.
  - Agendar, cancelar e listar exclusões passam por funções `security definer`, que exigem owner ativo e nunca acesso de suporte. A carência é fixa em 30 dias no banco.
  - O worker só apaga linhas de workspace com a carência vencida (`private.workspace_purgeable`). O gatilho de invariantes de membros (AC04) deixa o worker apagar só nesse caso.
- **Contrato de dados dos módulos:**
  - `ModuleDataContract` (`export` e `purge`) fica em `src/core/privacy`. Hello World e Agentes de IA têm contrato.
  - Um teste exige contrato para todo módulo com a capacidade `export` no manifesto.
- **Exportação:**
  - Job de workspace `core.workspace-export`, que roda no contexto de quem pediu. Gera um JSON com:
    - workspace, membros, convites;
    - chaves de API sem hash e credenciais só mascaradas;
    - módulos, execuções e os dados de cada módulo.
  - A auditoria fica fora do arquivo: é pedida ao suporte.
- **Rotina diária** `privacy.daily-maintenance` (job de plataforma, a partir das 03:00 de Brasília):
  - conclui as exclusões vencidas: módulos, depois o núcleo, depois a lápide anonimizada; o registro da exclusão e a auditoria ficam;
  - expira as exportações;
  - aplica a retenção das categorias ligadas.
- **Retenção:** `retention_policies` tem quatro categorias, todas desligadas. O banco recusa a remoção enquanto a categoria estiver desligada. Auditoria e registros de exclusão são marcados como processo restrito, sem remoção automática.
- **Telas:**
  - `/app/[slug]/settings/data` ("Dados e privacidade"): exportações com link curto e exclusão com confirmação do slug.
  - `/app`: exclusões agendadas, com o botão de cancelar.
  - `/platform/operations`: bloco "Privacidade", com a retenção e os registros de exclusão.
- **Backup e restore:** [backup-restore.md](backup-restore.md), com a reaplicação de exclusões e revogações (AC13 como procedimento).
- **Testes:**
  - suíte SQL `privacy-rls.sql` (agendar, cancelar, limpar, exportações, retenção e gatilho de MFA);
  - unitários do link curto, da agenda e do registro de contratos;
  - integração `privacy.test.ts` (exportação pelo worker sem segredos, permissões, cancelamento, limpeza com lápide e repetição sem efeito);
  - e2e `privacy.spec.ts` (exportar e baixar com MFA, agendar, workspace fechado, cancelar).

Aprendizados:

- **DELETE com RLS também exige política de SELECT.** O worker ganhou leitura restrita aos workspaces que já podem ser limpos.
- **A auditoria tem chave estrangeira para `workspaces`** e não pode ser apagada. Por isso a exclusão termina numa lápide (`deleted`, nome e slug anonimizados), não na remoção da linha.
- **`postgres` não é superusuário no Supabase hospedado,** mas tem BYPASSRLS e privilégio de gatilho nas tabelas do Auth. A trava da migration confere exatamente isso.

## Como rodar o worker

```bash
WORKER_DATABASE_URL="postgresql://app_worker:<senha>@<host>:5432/postgres" pnpm worker
```

Com `WORKER_HEALTH_PORT=8081`, as probes do worker respondem em `http://<host>:8081/health/live` e `/health/ready`. `WORKER_INSTANCE_NAME` dá o nome mostrado em `/platform/operations` (padrão: nome do host).

O `app_worker` nasce sem senha. Em cada ambiente, defina com um papel que tenha ADMIN sobre ele (no dev, `postgres`): `alter role app_worker with password '<senha>';`.
