# C07 — Aplicar permissões em credenciais BYOK, chaves de API e agentes

> Copie todo o conteúdo abaixo da linha para o Antigravity.

---

Você vai trabalhar no repositório **console-guidu-gemini** (Next.js 16, Prisma 6, Supabase, pnpm).

**Antes de qualquer alteração, leia:** `AGENTS.md`, `docs/architecture/permissoes.md` (criado na C06), `src/core/permissions/`, a Especificação §7, §16 e §19, `docs/adr/0009-*.md` e `docs/correcoes/README.md` (regras comuns, que valem integralmente). Leia também o guia de Server Actions em `node_modules/next/dist/docs/`.

**Branch:** `fix/C07-aplicar-permissoes`, a partir da `main` com a C06 integrada. Entregue via PR.

## Contexto

Hoje, em `src/core/credentials/credentials-actions.ts`, `src/core/credentials/api-keys-actions.ts` e `src/core/agents/actions.ts`, o único controle é "ser membro do workspace". Consequências verificadas:
- um `viewer` cadastra e revoga credenciais BYOK;
- qualquer membro revoga a chave de API de **outro** usuário (`revokeApiKey(tx, apiKeyId)` atualiza por id, sem checar dono);
- `listApiKeys` mostra as chaves de todos os membros a qualquer membro;
- as páginas `settings/credentials` e `settings/api` mostram os controles de alteração sem considerar permissão.

## Objetivo

Toda operação de credenciais, chaves e agentes passa pelo guard da C06 **no serviço**: as actions chamam o serviço, e o serviço exige a permissão. A UI reflete as permissões, mas não decide.

## Requisitos

1. **Credenciais (`vault.ts`):**
   - `registerCredential` e `revokeCredential` exigem `credentials.manage`;
   - `listWorkspaceCredentials` exige `credentials.read`;
   - `resolveProviderSecret` é interno: não é exposto a action nenhuma e recebe o contexto já autorizado pelo chamador.
   - As funções passam a receber `ctx: RequestContext` além do `tx`. Remova os parâmetros `workspaceId`/`organizationId` soltos e use os do `ctx`.
2. **Chaves de API (`api-keys.ts`):**
   - `createApiKey` exige `api_keys.create_own` e grava `userId = ctx.userId`, nunca um valor vindo de parâmetro;
   - `revokeApiKey`: permitido se a chave é do próprio usuário (`api_keys.revoke_own`) **ou** se ele tem `api_keys.revoke_any`. Caso contrário, `PermissionDeniedError`. A busca usa `findFirst({ where: { id, workspaceId: ctx.workspaceId } })`; uma chave inexistente ou de outro workspace responde igual ("não encontrada");
   - `listApiKeys`: com `api_keys.read_all`, lista todas; sem ela, só as do próprio usuário.
3. **Agentes (`engine.ts`):** `ai_agents.manage` para criar e editar configuração; `ai_agents.use` para executar e ler sessões. Isso vale mesmo com o módulo congelado (C04), que continua bloqueando antes de tudo.
4. **Equipe:** confira que `team-actions.ts`, `workspaces/members.ts` e `organizations/*` já usam o guard (C06). Se faltar algum caminho, por exemplo listar convites, aplique.
5. **Páginas:** `settings/credentials`, `settings/api` e `settings/team` recebem do servidor um DTO `capabilities` (`{ canManage: boolean, … }`) calculado pela matriz, e escondem ou desabilitam os controles. O servidor continua rejeitando por conta própria.
6. **Mensagens:** negação devolve "Você não tem permissão para esta ação." Não exponha o papel exigido nem detalhes internos.

## Testes

- Integração (`describeDatabase`), estendendo `tests/core/credentials-and-api-keys.test.ts`:
  - viewer não cadastra nem revoga credencial; admin sim;
  - editor não revoga a chave de outro usuário; revoga a própria; admin revoga qualquer uma;
  - membro sem `read_all` lista só as próprias chaves;
  - chave de outro workspace: "não encontrada";
  - vínculo desativado no meio do teste perde o acesso na chamada seguinte (AC03).
- E2E (`e2e/credentials-and-api-keys.spec.ts`): um usuário viewer não vê o botão de cadastrar credencial, e a action chamada direto (via `fetch` do form) é rejeitada.

## Aceite

- `pnpm generate && pnpm typecheck && pnpm lint && pnpm test && pnpm build` sem erros, e CI verde.
- Nenhum serviço de credenciais, chaves ou agentes acessa dados sem passar pelo guard. Liste no PR cada função exportada e a permissão exigida.
