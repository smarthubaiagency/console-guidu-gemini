# C11 — Auditoria append-only (`audit_events`) para as ações críticas existentes

> Copie todo o conteúdo abaixo da linha para o Antigravity.

---

Você vai trabalhar no repositório **console-guidu-gemini** (Next.js 16, Prisma 6, Supabase, pnpm).

**Antes de qualquer alteração, leia:** `AGENTS.md`, a Especificação §6 (`audit_events`), §16 ("auditoria registra a ação sem o valor"), §20 (campos e append-only) e §24 (AC14), `docs/adr/0001-*.md`, `docs/adr/0009-*.md` (auditoria de criação, uso e revogação de chaves), `docs/architecture/permissoes.md` e `docs/correcoes/README.md` (regras comuns, que valem integralmente, inclusive as de banco).

**Branch:** `fix/C11-auditoria`, a partir da `main` com C02, C07 e C10 integradas. Entregue via PR.

## Contexto

Não existe trilha de auditoria. Credenciais BYOK, chaves de API, convites e vínculos já existem e mudam sem registro, o que contraria a §16, a §20, a ADR 0009 e o AC14. A auditoria completa (UI, retenção, cópia externa) é parte da F3. Esta correção entrega **a tabela, o serviço e o registro das ações que já existem**.

## Objetivo

Uma tabela append-only protegida por RLS e um serviço único, chamado **na mesma transação** da mudança, para cada ação crítica atual.

## Requisitos

1. **Migration nova** `<timestamp>_audit_events.sql`:
   - colunas (§20): `id uuid pk default gen_random_uuid()`, `occurred_at timestamptz not null default now()`, `organization_id uuid null`, `workspace_id uuid null`, `actor_user_id uuid null`, `actor_principal_type text not null` (`user` | `service` | `api_key`), `represented_user_id uuid null`, `origin text not null` (`app` | `api` | `mcp` | `worker` | `admin`), `client_id text null`, `grant_id uuid null`, `action text not null` (nome estável, por exemplo `credentials.created`), `resource_type text not null`, `resource_id text null`, `result text not null` (`success` | `denied` | `error`), `request_id text null`, `metadata jsonb not null default '{}'` (**sem segredos**);
   - FK composta `(workspace_id, organization_id)` para `workspaces`, quando houver workspace (AC05). Índices `(workspace_id, occurred_at desc)` e `(organization_id, occurred_at desc)`, justificados num comentário;
   - dono `app_migrations`; `ENABLE` + `FORCE ROW LEVEL SECURITY`; `revoke all` de `public`, `anon` e `authenticated`;
   - `app_runtime`: **somente `INSERT`**, com policy `with check` exigindo `actor_user_id = app.user_id` (ou `actor_principal_type <> 'user'` quando houver contexto de serviço), `workspace_id`/`organization_id` iguais ao contexto quando preenchidos, e `occurred_at` próximo de `now()`. **Sem** `SELECT`, `UPDATE` e `DELETE` para o `app_runtime` nesta etapa. A leitura pelo cliente (`settings/audit`) é F3;
   - trigger `before update or delete` que **sempre** lança exceção, inclusive para o dono da tabela, porque é append-only (§20). A retenção virá por processo restrito, a definir;
   - nenhum `grant` de `SELECT` agora. Se o admin precisar ler, será por função `security definer` em tarefa futura.
2. **Prisma:** model `AuditEvent` em `prisma/schema.prisma` (camelCase com `@map`); rodar `pnpm generate`.
3. **Serviço** `src/core/audit/record.ts` (`server-only`): `recordAudit(tx, ctx, { action, resourceType, resourceId?, result, origin, requestId?, metadata? })`.
   - `metadata` passa por um filtro de lista permitida: nunca grava `secret`, `token`, `key`, `password`, `encryptedPayload`, `rawKey` ou e-mail completo (pode gravar o domínio ou um hash).
4. **Registrar**, na mesma transação da mudança:
   - credenciais: `credentials.created`, `credentials.revoked`, com `metadata { provider, purpose, maskedValue }`;
   - chaves de API: `api_keys.created` (`scopes`, `expiresAt`, `prefix`), `api_keys.revoked`, `api_keys.used` (quando houver validação, por exemplo na C12);
   - convites: `invitations.created`, `invitations.revoked`, `invitations.accepted`;
   - vínculos: `workspace_members.role_changed` (de → para), `workspace_members.removed`, `organization_members.role_changed` e `organization_members.removed`;
   - autenticação: `auth.mfa_enrolled` e `auth.mfa_unenrolled`, se houver contexto transacional disponível; caso contrário, documente como pendência;
   - **negações relevantes**: `result = 'denied'` quando o guard da C06 negar uma ação de `credentials.manage`, `api_keys.revoke_any` ou `workspace.members.manage`. A negação é gravada numa transação própria curta, porque a transação principal falhou.
5. **Não** registrar IP ou user-agent agora: a §20 pede justificativa. Deixe o campo fora.

## Testes

- **SQL:** `app_runtime` faz `INSERT` válido; `SELECT`, `UPDATE` e `DELETE` falham; `UPDATE` como `app_migrations` também falha (trigger); `INSERT` com `actor_user_id` diferente do contexto falha; `INSERT` com workspace fora do contexto falha.
- **Integração:** cada ação listada gera exatamente um evento (`count(*)` como `app_migrations` no teste); `metadata` nunca contém o segredo cadastrado (procure o valor bruto no JSON); se a mudança falha, nenhum evento de sucesso é gravado (rollback).
- Invariantes da C02 continuam passando (tabela nova com `FORCE RLS`).

## Aplicação no remoto

Depois do PR aprovado: conferir `schema_migrations`, aplicar com `scripts/migrate.ts`, conferir de novo e rodar os testes SQL. Anexar a saída.

## Aceite

- `pnpm generate && pnpm typecheck && pnpm lint && pnpm test && pnpm build` sem erros, e CI job `db` verde.
- Tabela no remoto com RLS forçado, sem leitura para o runtime e com o trigger append-only ativo.
