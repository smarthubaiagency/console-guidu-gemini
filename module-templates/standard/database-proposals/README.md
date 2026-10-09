# Propostas de banco do módulo

Rascunhos de SQL revisados com o módulo. Depois de aprovados, viram arquivo novo em `supabase/migrations/` com timestamp maior que o último aplicado; não existe execução automática na ativação do módulo (Adendo §4 e §12).

Checklist mínimo de cada tabela operacional:

- `workspace_id uuid not null` e `organization_id uuid not null`, com FK composta para `public.workspaces(id, organization_id)`;
- dono `app_migrations`; `enable` e `force row level security`;
- políticas só para `app_runtime`, lendo apenas `app.*` (`private.context_uuid`, `private.is_workspace_member`, `private.current_workspace_role`);
- nenhum grant para `anon` ou `authenticated`;
- índice justificado pelo padrão de acesso;
- teste SQL em `tests/core/` executado no job `db` do CI.
