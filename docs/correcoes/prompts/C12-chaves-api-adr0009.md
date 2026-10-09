# C12 — Chaves de API conforme a ADR 0009

> Copie todo o conteúdo abaixo da linha para o Antigravity.

---

Você vai trabalhar no repositório **console-guidu-gemini** (Next.js 16, React 19, Prisma 6, Supabase, pnpm).

**Antes de qualquer alteração, leia:** `AGENTS.md`, `docs/adr/0009-autenticacao-mcp-chaves-api.md` (integral), a Especificação §11 (`settings/api` × `settings/mcp`), §15 (chaves por hash) e §17.3 (catálogo de escopos), `docs/architecture/permissoes.md`, `src/core/credentials/api-keys*.ts`, `src/app/app/[workspaceSlug]/settings/api/` e `docs/correcoes/README.md` (regras comuns, que valem integralmente, inclusive as de banco). Leia também o guia de rotas em `node_modules/next/dist/docs/`.

**Branch:** `fix/C12-chaves-api-adr0009`, a partir da `main` com C07, C08, C10 e C11 integradas. Entregue via PR.

## Contexto

O que já está conforme: formato `gdu_live_` com 256 bits de CSPRNG, hash SHA-256, exibição única, expiração obrigatória e revogação.

Desvios da ADR 0009:
1. A tela está em `/settings/api`. A ADR diz que a chave de MCP é criada em **`/app/[workspaceSlug]/settings/mcp`**. A §11 reserva `/settings/api` para "chaves da plataforma e webhooks" (REST, F4).
2. Os escopos são texto livre (`["read"]`), fora do catálogo da §17.3. "Somente leitura por padrão; `proposals:write` exige escolha explícita" não é aplicado.
3. `validateApiKey(tx, rawKey)` depende de um contexto RLS de workspace que **não existe antes de identificar a chave**. Não há caminho seguro de lookup por hash.
4. Não há revalidação de vínculo, status da identidade e permissão a cada uso (a ADR exige reavaliar "vínculo, permissão, módulo e plano").

## Objetivo

Deixar a emissão, o armazenamento e a validação das chaves prontos para o MCP da F4, sem implementar o servidor MCP agora.

## Requisitos

1. **Rota:** mover a UI para `src/app/app/[workspaceSlug]/settings/mcp/` ("Assistentes conectados (MCP)": chaves, escopos, expiração, último uso e revogação). `/settings/api` passa a mostrar o estado "Em breve — chaves REST e webhooks (Fase 4)", sem métrica fictícia. Atualizar a sidebar e os links.
2. **Catálogo de escopos** `src/core/mcp/scopes.ts`, com Zod enum de workspace: `workspace:read`, `modules:read`, `usage:read`, `executions:read`, `members:read`, `proposals:write`.
   - Leitura: todos menos `proposals:write`. `operations:execute` **não** é emitível nesta etapa (§17.4, contrato de execução inexistente).
   - Escopos `admin:*` **não** são emitíveis em chaves de workspace (a ADR separa as superfícies; chaves administrativas exigem papel interno e MFA e ficam para a F4).
   - A UI e a action: padrão `workspace:read` + `modules:read`. `proposals:write` só com checkbox explícito e aviso. Validação no servidor com Zod. Viewer não emite chave com `proposals:write` (C06).
3. **Migration nova** `<timestamp>_api_keys_adr0009.sql`:
   - `check` em `api_keys.scopes` restringindo os valores ao catálogo (por exemplo `scopes <@ array[...]::text[]` e `cardinality(scopes) > 0`). Converter os dados sintéticos existentes (`'read'` → `'workspace:read'`) com `update` explícito na própria migration, comentado;
   - `check (expires_at > created_at and expires_at <= created_at + interval '365 days')`;
   - `revoked_at timestamptz null` (a revogação registra quando);
   - função `private.resolve_api_key(p_key_hash text)`, `security definer`, dono `app_rls_helper`, `search_path = ''`. Retorna **só** `id, user_id, workspace_id, organization_id, scopes, status, expires_at` da chave com aquele hash, sem exigir contexto. Policy mínima para o `app_rls_helper` ler `api_keys` **apenas** por igualdade de hash: use um setting `app.api_key_hash` ou o parâmetro dentro da função, seguindo o padrão sem recursão. `grant execute` só ao `app_runtime`.
4. **Validação** `src/core/mcp/authenticate.ts` (`server-only`): `authenticateApiKey(prisma, rawKey, { requestId })`:
   - formato → hash → `private.resolve_api_key` → rejeita revogada, expirada ou inexistente com **a mesma resposta** (sem oráculo);
   - monta `RequestContext { userId, workspaceId, organizationId, principalType: "api_key", grantId: key.id }` e, **dentro de `withContext`**, revalida: `profiles.status = 'active'`, vínculo ativo no workspace, `workspace.status = 'active'` e a permissão da matriz compatível com os escopos (por exemplo, `members:read` exige `workspace.members.read`);
   - atualiza `last_used_at` e grava `api_keys.used` na auditoria (C11) **no máximo uma vez por minuto por chave**, para não amplificar escrita;
   - nunca loga a chave. Resposta de erro segura (C10).
   - **Não** criar as rotas `/mcp/workspace` e `/mcp/admin`, nem rate limit: isso é F4. Registre no PR.
5. Ajustar `withContext` para aceitar `principalType: "api_key"` e confirmar que as policies continuam funcionando, porque elas leem `app.user_id`.

## Testes

- **SQL:** `check` de escopo rejeita `"read"` e `"admin:customers:read"`; `resolve_api_key` não lista outras chaves; `app_runtime` não lê `api_keys` sem contexto.
- **Integração:** chave válida autentica e gera contexto; revogada, expirada ou inexistente devolvem o mesmo erro; vínculo removido depois da emissão bloqueia o próximo uso (AC03); perfil bloqueado bloqueia; viewer não emite `proposals:write`; `last_used_at` é atualizado com throttle.
- **E2E:** emitir chave em `/settings/mcp`, ver exibição única, revogar; `/settings/api` mostra "Em breve".

## Aplicação no remoto

Depois do PR aprovado: conferir `schema_migrations`, aplicar com `scripts/migrate.ts`, conferir de novo e rodar os testes SQL. Anexar a saída.

## Aceite

- `pnpm generate && pnpm typecheck && pnpm lint && pnpm test && pnpm build` sem erros, e CI verde.
- A checklist da ADR 0009 no PR, item por item, marcando o que esta tarefa cumpre e o que fica para a F4 (servidor MCP, rate limit, chaves admin).
