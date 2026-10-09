# C06 — Matriz papel → permissão e guard de servidor

> Copie todo o conteúdo abaixo da linha para o Antigravity.

---

Você vai trabalhar no repositório **console-guidu-gemini** (Next.js 16, Prisma 6, Supabase, pnpm).

**Antes de qualquer alteração, leia:** `AGENTS.md`, `docs/context.md`, `docs/adr/0001-*.md`, a Especificação §4, §7 e §25 (pede uma "matriz de permissões" no repositório), o Adendo §5 e §6, `docs/pendencias.md` (linha "Herança de acesso empresarial") e `docs/correcoes/README.md` (regras comuns, que valem integralmente).

**Branch:** `fix/C06-matriz-permissoes`, a partir da `main` atualizada. Entregue via PR.

## Contexto

A Especificação §7 diz: "Papéis mapeiam permissões, como `workspace.members.invite` e `integrations.manage`. Não espalhar comparações de nome de papel pelo código. Exportar, excluir, publicar, alterar credenciais e delegar acesso são permissões distintas."

Hoje existe só `src/core/permissions/roles.ts`, com ranking e regras de escalonamento (AC04). Não há permissões nomeadas. Por isso, credenciais BYOK, chaves de API e agentes só verificam se o usuário é membro: até um `viewer` cadastra e revoga credenciais.

## Objetivo

Criar o catálogo de permissões do núcleo, a matriz papel → permissão e um guard de servidor que lê o papel **atual no banco** (dentro do `withContext`) e decide. Esta tarefa **não** aplica o guard nas actions: isso é a C07. Aqui entram a base, os testes e a documentação.

## Requisitos

1. **Catálogo** `src/core/permissions/catalog.ts`, com constantes tipadas e nomes estáveis com namespace. Escopo mínimo do que já existe no produto:
   - `workspace.read`
   - `workspace.settings.update`
   - `workspace.members.read`, `workspace.members.invite`, `workspace.members.manage` (alterar papel ou remover outro membro)
   - `credentials.read` (ver metadados mascarados), `credentials.manage` (cadastrar, substituir, revogar)
   - `api_keys.create_own`, `api_keys.revoke_own`, `api_keys.revoke_any`, `api_keys.read_all`
   - `ai_agents.use`, `ai_agents.manage` (só declaradas; o módulo está congelado pela C04)
   - organização: `organization.read`, `organization.members.invite`, `organization.members.manage`, `organization.settings.update`
   - **Não** invente permissões para módulos sem especificação (Catálogo, Google Business) nem para áreas inexistentes (cobrança, exportação).
2. **Matriz** `src/core/permissions/matrix.ts`: `Record<WorkspaceRole, ReadonlySet<Permission>>` e equivalente para `OrganizationRole`. Proposta, que deve ser registrada como **proposta sujeita à confirmação do produto**:
   - `owner`: tudo do workspace;
   - `admin`: tudo, exceto alterar ou remover um owner (essa regra continua em `roles.ts`);
   - `editor`: `workspace.read`, `workspace.members.read`, `credentials.read`, `api_keys.create_own`, `api_keys.revoke_own`, `ai_agents.use`;
   - `viewer`: `workspace.read`, `workspace.members.read`, `api_keys.create_own` **somente se** os escopos forem só de leitura (a C12 aplica essa restrição), `api_keys.revoke_own`.
   - **Herança empresarial:** é pendência aberta, com proposta de concessão explícita. **Não** dê a `organization owner/admin` permissões de dados do workspace pela matriz. Mantenha só o que já existe em `roles.ts` (owner da organização pode gerir vínculos de workspace, porque a §7 lhe atribui "concessão de acesso aos workspaces") e documente isso.
3. **Guard** `src/core/permissions/guard.ts` (`server-only`):
   - `async function requireWorkspacePermission(tx: ContextTransaction, ctx: RequestContext, permission: Permission): Promise<{ workspaceRole; organizationRole | null }>`;
   - lê o vínculo **ativo** do `ctx.userId` em `workspace_members` e `organization_members` via `tx` (o RLS já restringe ao contexto);
   - lança `PermissionDeniedError` (code `forbidden`, sem revelar detalhes) quando falta permissão ou vínculo;
   - **nunca** recebe o papel como parâmetro vindo do cliente.
   - Equivalente `requireOrganizationPermission`.
4. **Refatorar** `src/core/workspaces/members.ts`, `src/core/organizations/members.ts` e `src/core/organizations/invitations.ts` para usar o guard nas checagens de "pode convidar" e "pode gerir". As regras de escalonamento (`canAssign*`, `canManage*`) **continuam** em `roles.ts` e são chamadas depois do guard. Nenhuma mudança de comportamento observável além de mensagens de erro padronizadas.
5. **Documentação** `docs/architecture/permissoes.md`: tabela papel × permissão, origem (§7), o que é proposta e o que é decisão, e o ponto de herança empresarial como pendência. Linkar em `docs/context.md`.

## Lógica

Papel é dado; permissão é a pergunta. Centralizar a pergunta no guard, lendo o estado atual do banco dentro da transação contextualizada, garante revogação imediata (AC03) e uma regra única para REST, MCP e páginas (§4).

## Testes

- Unitários da matriz: cada papel × cada permissão, em tabela (`it.each`). Snapshot explícito, sem `toMatchSnapshot` cego.
- Integração (`tests/core/permissions.test.ts`, com `describeDatabase`): viewer negado em `workspace.members.invite`; admin permitido; vínculo `inactive` negado mesmo com papel `owner`; usuário de outro workspace negado.
- Testes existentes de `membership.test.ts` continuam verdes.

## Aceite

- `pnpm generate && pnpm typecheck && pnpm lint && pnpm test && pnpm build` sem erros, e CI verde (job `db` inclusive).
- Nenhuma comparação de nome de papel nova fora de `src/core/permissions/`. Verifique com `git grep -n "'owner'\|\"owner\"" src` e justifique no PR o que sobrar.
- `docs/architecture/permissoes.md` publicado.
