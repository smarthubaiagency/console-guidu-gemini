# Backup e restore

Etapa F3e do [plano da F3](plano-f3.md), para o critério AC13 ("restore recupera banco e Storage no objetivo declarado e reaplica exclusões/revogações"). Este é o procedimento. A prova real de restore depende da hospedagem de produção e fica para a F6/P7.

## Objetivos propostos

Pela Especificação §21: RPO de até 24 horas e RTO de até 8 horas. Os números são propostos e precisam de um teste antes de entrar em contrato. Para perder menos dados é preciso PITR e uma operação compatível com ele.

## O que precisa de backup

| Item                      | Onde fica                                                    | Cobertura                                                                  |
| ------------------------- | ------------------------------------------------------------ | -------------------------------------------------------------------------- |
| Banco (todas as tabelas)  | Postgres do Supabase                                         | Backup diário do Supabase (plano Pro ou superior); PITR quando contratado. |
| Arquivos de exportação    | Tabela `workspace_exports` (bytea), expiram em 24 h          | Vão junto com o banco. Não precisam ser restaurados: expiram sozinhos.     |
| Logos dos parceiros       | Tabela `partner_brands` (bytea)                              | Vão junto com o banco.                                                     |
| Comprovantes de pagamento | Tabela `payments` (bytea)                                    | Vão junto com o banco.                                                     |
| Supabase Storage          | Não usado hoje                                               | Quando entrar (F6), o backup do banco não cobre objetos: incluir no plano. |
| Fila do pg-boss           | Schema `pgboss`                                              | Vai junto com o banco; `job_runs` é a fonte de verdade.                    |
| Segredos                  | Variáveis do ambiente (`ENCRYPTION_KEY`, chaves do Supabase) | Cofre do provedor; sem a `ENCRYPTION_KEY` as credenciais BYOK não abrem.   |

## Restore

1. **Isolar.** Restaurar num projeto novo, nunca por cima do de produção. Anotar a hora do backup usado (T).
2. **Restaurar o banco** no projeto isolado, a partir do backup diário ou do PITR até T.
3. **Conferir o schema.** Comparar `supabase_migrations.schema_migrations` com `supabase/migrations` do repositório. Aplicar as migrations que faltarem, cada uma com o papel indicado no cabeçalho.
4. **Reaplicar exclusões.** Veja o roteiro abaixo. Workspaces excluídos depois de T voltariam com o backup e precisam ser apagados de novo antes de qualquer acesso.
5. **Reaplicar revogações.** Não reativar o que foi revogado depois de T:
   - Chaves de API (`api_keys`) e acessos de suporte (`partner_support_grants`) revogados depois de T: revogar de novo a partir da auditoria (`audit_events`), que tem cópia fora do banco quando a F6 ligar a exportação de logs.
   - Membros removidos ou bloqueados depois de T: repetir a partir da auditoria.
   - Credenciais BYOK trocadas depois de T: pedir ao cliente que confirme as chaves.
6. **Conferir permissões.** Rodar as suítes SQL de RLS (`tests/core/*.sql`) contra o banco restaurado. Conferir que `anon` e `authenticated` continuam sem acesso às tabelas.
7. **Ligar.** Apontar o web e o worker para o banco restaurado e conferir `/api/health/ready`, o `/health/ready` do worker e `/platform/operations`.
8. **Registrar.** Anotar T, a duração (RTO medido), a perda (RPO medido) e o que foi reaplicado.

## Roteiro: reaplicar exclusões de workspace

`workspace_deletions` registra cada pedido. Se o backup for anterior a uma exclusão concluída, o workspace volta como `active` ou `deletion_scheduled`. A lista correta de exclusões concluídas está na auditoria (`workspace.deletion.purge`) e nos logs do worker, que ficam fora do backup restaurado.

Para cada workspace excluído depois de T, rodar como `postgres`:

```sql
-- 1. Agenda a exclusão com a carência já vencida (o registro original fica no backup).
update public.workspaces
set status = 'deletion_scheduled',
    deletion_requested_at = coalesce(deletion_requested_at, now()),
    purge_after = now() - interval '1 minute'
where id = '<workspace_id>' and status in ('active', 'deletion_scheduled');

insert into public.workspace_deletions
  (workspace_id, organization_id, workspace_slug, workspace_name, requested_by, purge_after)
select id, organization_id, slug, name, null, now() - interval '1 minute'
from public.workspaces w
where w.id = '<workspace_id>'
  and not exists (
    select 1 from public.workspace_deletions d
    where d.workspace_id = w.id and d.canceled_at is null and d.purged_at is null
  );
```

Depois disso, iniciar o worker: a rotina diária `privacy.daily-maintenance` conclui a limpeza. Para não esperar o horário, inserir a execução manualmente:

```sql
insert into public.job_runs (kind, scope, payload, idempotency_key)
values ('privacy.daily-maintenance', 'platform', jsonb_build_object('date', current_date::text),
        'restore-' || now()::text);
```

Antes de liberar o acesso, conferir que o workspace ficou `deleted` e que `workspace_deletions.purged_at` foi preenchido.

## Backups e exclusão

Pela §20, backups seguem prazo próprio e ficam fora do uso normal. A plataforma não promete apagar cada cópia de backup na hora; a tela de exclusão diz isso ao cliente. Os dados de um workspace excluído só reaparecem num restore, e o roteiro acima os apaga de novo antes de qualquer acesso.
