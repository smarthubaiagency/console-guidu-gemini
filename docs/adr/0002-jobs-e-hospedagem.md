# ADR 0002 — Jobs persistentes no Postgres com worker separado

- **Status:** Aceito
- **Data:** 07/10/2026
- **Aprovador:** Marcelo
- **Decisão de origem:** D2, documento `decisoes` da [SMA-88](https://paperclip.local/SMA/issues/SMA-88)

## Contexto

A plataforma precisa executar indexações, sincronizações, exportações e tarefas longas com persistência, retries e isolamento por workspace, sem tornar Redis obrigatório.

## Decisão

Jobs persistentes usam **pg-boss 12.37.0** no Postgres, em schema de infraestrutura instalado por migration. O worker roda em processo separado sob o papel técnico dedicado `app_worker`, com `NOSUPERUSER` e `NOBYPASSRLS`; o papel web `app_runtime` não acessa o schema da fila. O worker usa polling pelo Supavisor em modo transação, reavalia a autorização dentro da transação do efeito e não carrega bearer tokens no payload. A idempotência usa chave única no domínio e a concorrência é agrupada por workspace. `LISTEN/NOTIFY` só pode ser habilitado com conexão direta ou sessão fixa.

A hospedagem usa contêineres com processos web e worker separados, compatíveis com streaming MCP e jobs longos.

## Consequências

O schema do pg-boss passa a fazer parte do histórico versionado de migrations. A fila fornece entrega *at least once* e o domínio garante efeito *at most once*. As telas de execução usam projeção de domínio protegida por RLS, sem expor diretamente o schema interno da fila. Antes do primeiro scale-out, um teste de integração deve certificar `groupConcurrency` entre múltiplos processos.

## Validação técnica

**Concluída no spike [SMA-94 / F0.6](https://paperclip.local/SMA/issues/SMA-94).** A prova cobriu pg-boss 12.37.0 nas conexões direta e Supavisor 6543, incluindo reinício, retry/backoff, DLQ, idempotência, concorrência por workspace, cron, reautorização e observabilidade. A implementação de produto deve criar o papel dedicado `app_worker`; o uso de `app_runtime` ficou restrito à prova do spike.

