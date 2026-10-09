# C08 — Endurecer o RLS de vínculos, credenciais e chaves, e proteger o último owner do workspace

> Copie todo o conteúdo abaixo da linha para o Antigravity.

---

Você vai trabalhar no repositório **console-guidu-gemini** (Next.js 16, Prisma 6, Supabase, pnpm).

**Antes de qualquer alteração, leia:** `AGENTS.md`, `docs/adr/0001-*.md`, `docs/adr/0010-*.md`, a Especificação §7, §9 e §24 (AC04), `docs/architecture/permissoes.md`, todas as migrations `supabase/migrations/2026100814*` a `2026100817*`, e `docs/correcoes/README.md` (regras comuns, que valem integralmente, inclusive as de banco).

**Branch:** `fix/C08-rls-membership`, a partir da `main` com C02, C06 e C07 integradas. Entregue via PR.

## Contexto

As policies **atuais** no banco (conferidas com `pg_policies`) deixam a defesa do AC04 só no código:
- `workspace_members_update`: qualquer membro ativo do workspace (inclusive `viewer`) pode fazer `UPDATE`. O `with check` só confere o contexto, então um viewer pode, no nível SQL, mudar o **próprio** papel para `owner`;
- `workspace_members_insert`: aceita `user_id = app.user_id` com **qualquer papel**, ou qualquer membro inserindo qualquer pessoa;
- `workspace_members_delete`: qualquer membro remove qualquer membro;
- `organization_members_insert`: aceita `user_id = app.user_id` com qualquer papel, inclusive `owner`;
- `credentials_*` e `api_keys_*`: qualquer membro faz tudo;
- não existe trigger de "último owner" para **workspace**, só para organização (`trg_organization_members_last_owner`).

A Especificação §9 pede que as policies "leiam esse contexto e verifiquem vínculos atuais", e o AC04 pede que o usuário não eleve o próprio papel nem remova o último proprietário.

## Objetivo

Uma migration nova que coloca no banco as mesmas fronteiras da matriz de permissões (C06), como defesa em profundidade, sem recursão de policies.

## Requisitos

1. **Helpers** em `private`, `security definer`, com dono `app_rls_helper`, `search_path = ''`, `stable`, sem ler a própria tabela sob as policies de `app_runtime` (siga o padrão de `is_workspace_member` e `is_organization_admin`):
   - `private.current_workspace_role()`: retorna o papel ativo do `app.user_id` no workspace do contexto, ou `null`;
   - `private.current_organization_role()`: equivalente para a organização;
   - `grant execute` só para `app_runtime`, e `revoke` de `public`, `anon` e `authenticated`.
2. **Policies novas**, substituindo as atuais com `drop policy if exists` seguido de `create policy` na **mesma migration nova**, sem editar migrations antigas:
   - `workspace_members`:
     - `INSERT`: papel atual `owner`/`admin` no workspace **ou** owner/admin da organização (comportamento atual de `roles.ts`); **ou** o caminho de aceite de convite: `user_id = app.user_id` **e** existe convite `pending`, não expirado, com `token_hash = app.invitation_token_hash`, mesmo `workspace_id` e **mesmo `role`**;
     - `UPDATE`/`DELETE`: papel atual `owner`/`admin` (ou owner/admin da organização); `DELETE` também é permitido para `user_id = app.user_id` (sair do workspace).
   - `organization_members`: `INSERT` por admin, ou pelo caminho de convite com o mesmo papel do convite; nada de auto-inserção livre.
   - `credentials`: `SELECT` para qualquer membro (metadados); `INSERT`/`UPDATE`/`DELETE` só `owner`/`admin`.
   - `api_keys`: `INSERT` exige `user_id = app.user_id`; `UPDATE`/`DELETE` para o dono da chave ou `owner`/`admin`; `SELECT` para o dono ou `owner`/`admin`.
3. **Triggers de invariante** (`before update or delete`, `security invoker`, `search_path = ''`):
   - `workspace_members`: um ator com papel atual diferente de `owner` não pode gravar `role = 'owner'` nem alterar ou remover um owner. Para isso o trigger precisa conhecer o papel do ator: use o helper. Usuário nenhum altera o **próprio** papel para cima;
   - `workspace_members`: impedir que o último `owner` ativo do workspace seja removido, desativado ou rebaixado. Use a mesma exceção de manutenção do trigger da organização, só quando `current_user = 'app_migrations'` sem contexto;
   - `organization_members`: um ator não owner não grava `role = 'owner'`.
4. **Serviço:** `removeWorkspaceMember` com `isSelf` passa a respeitar a regra do último owner (o banco rejeita; traduza o erro para uma mensagem segura).
5. **Não** altere o comportamento de herança empresarial além do que já existe (pendência aberta).

## Testes

- **SQL** (`tests/core/rls.sql` ou novo `tests/core/membership-rls.sql`, ligado ao CI), como `app_runtime` com `set local` de contexto:
  - viewer não faz `UPDATE` do próprio papel para `owner` (exceção esperada);
  - viewer não insere outro membro;
  - editor não remove outro membro; pode remover a si mesmo, se não for o último owner;
  - último owner do workspace não é removido nem rebaixado;
  - auto-inserção sem convite é negada; com convite válido e papel diferente do convite, negada; com convite válido e mesmo papel, aceita;
  - viewer não insere credencial; admin insere;
  - membro não revoga a chave de outro; admin revoga.
- Integração: `membership.test.ts` e `credentials-and-api-keys.test.ts` continuam verdes.

## Aplicação no remoto

Depois do PR aprovado por Marcelo: conferir `schema_migrations`, aplicar com `scripts/migrate.ts`, repetir a conferência e rodar os testes SQL de invariantes da C02. Anexar a saída ao PR.

## Aceite

- `pnpm generate && pnpm typecheck && pnpm lint && pnpm test && pnpm build` sem erros, e CI job `db` verde.
- `pg_policies` no remoto, após aplicar, coerente com os requisitos. Cole a consulta resumida no PR.
