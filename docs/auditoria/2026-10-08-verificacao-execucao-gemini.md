# Verificação da execução do Gemini — console-guidu-gemini

- **Data:** 08/10/2026
- **Escopo:** `main` em `12970d7` (merge do PR #1), commits `9930cbd` → `f370c9f`
- **Referência:** `smarthub-docs/projetos/guidu/documentos` — originais (Especificação v1.0 e Adendo v1.1), ADRs 0001–0009, `decisoes-validadas-rev3.md`, `context.md`, `pendencias.md`
- **Banco inspecionado (somente leitura):** projeto Supabase conectado `console-guidu` (`ssulunrysnvwyqjlkpry`)
- **Método:** leitura de todas as migrations e do código de domínio; `pnpm install --frozen-lockfile && pnpm generate && pnpm typecheck && pnpm lint && pnpm test && pnpm build` local; consultas SQL de catálogo (`pg_roles`, `pg_policies`, `information_schema`) e advisors do Supabase; histórico do CI no GitHub.

> Os documentos em `docs/` do repo são idênticos à cópia do `smarthub-docs` (conferido com `diff`). Nada foi alterado no banco nem no código.

---

## 1. Resumo executivo

O Gemini entregou, em ~3 horas (Tasks 02 a 08), uma **fundação de identidade multiempresa sólida** — schema núcleo com `FORCE RLS`, contexto `app.*` via `withContext`, Data API fechada, SSR auth com MFA TOTP, convites com hash e controle de vagas sob concorrência, shell app/admin — e o build/lint/typecheck passam. O CI ficou verde só depois das correções do PR #1.

Mas há **desvios de ADR e de invariantes que precisam ser corrigidos antes de seguir**:

1. **Banco errado em relação à ADR 0008**: todo o trabalho foi feito no projeto `console-guidu` (`ssulunrysnvwyqjlkpry`), não no `guidu` (`mmwmhlafzewdyqsgfkzk`), e o repo tem `supabase link` registrado (`supabase/.temp/` commitado). Se isso foi decisão sua, falta registrar em ADR. Hoje `AGENTS.md`/`CLAUDE.md` dizem uma coisa e o `.env.example` aponta para outra.
2. **DDL ad hoc no banco**: a tabela `public.test_migration_probe` existe no banco sem nenhuma migration. Está **sem RLS e com todos os privilégios para `anon` e `authenticated`** (advisor crítico do Supabase).
3. **Ordem das fases violada (ADR 0003) e módulo preenchido por suposição (§1, §14, §25, pendências)**: o módulo Agentes de IA (F5) foi implementado com provedores, modelos, prompts padrão e fallback inventados, antes da Operação (F3: auditoria, quotas, jobs) e da F4. A especificação do módulo continua em aberto.
4. **Falta de autorização por permissão em credenciais BYOK e chaves de API**: qualquer membro do workspace, inclusive `viewer`, pode cadastrar/revogar credenciais e emitir/revogar chaves de API de qualquer pessoa.
5. **Chave mestra de criptografia com fallback fixo no código**: sem `ENCRYPTION_KEY`, os segredos BYOK são cifrados com uma chave derivada de uma string pública do repositório.
6. **Auditoria inexistente**: não há `audit_events`. A ADR 0009 e o AC14 exigem auditoria.
7. **Restos dos spikes no banco**: o schema da fila `sma94_jobs` e o `pgmq` continuam lá, com `app_runtime` tendo CRUD na fila, o que contraria a ADR 0002. O papel `app_worker` não existe.

---

## 2. Verificações executadas

| Verificação | Resultado |
| --- | --- |
| `pnpm install --frozen-lockfile` | ✅ ok (Node 22 local; o projeto pede ≥ 24.10) |
| `pnpm generate` | ✅ ok |
| `pnpm typecheck` | ✅ 0 erros |
| `pnpm lint` | ✅ 0 avisos |
| `pnpm test` | ✅ 71 passaram, **115 pulados** (suítes de banco sem URL local) |
| `pnpm build` | ✅ 29 rotas geradas |
| CI GitHub `main` @ `12970d7` | ✅ success (run 15). Runs 10–13 falharam; os commits das Tasks foram direto para `main` sem PR, com CI vermelho até o PR #1 |
| Testes de integração/SQL contra o banco remoto | ⚠️ **não executados** nesta verificação (sem senha do `app_runtime`). No CI rodam contra Supabase local e passam |
| `pnpm test:e2e` | ⚠️ não executado |
| Supabase: migrations aplicadas × arquivos | ✅ 22 de 22, mesma ordem e nomes |
| Supabase: drift fora das migrations | ❌ `public.test_migration_probe` (ver §4) |
| Supabase advisors (segurança) | ❌ 1 ERROR (RLS desligada em `test_migration_probe`), 6 WARN (`search_path` mutável em funções `sma94_jobs.*`), 1 WARN (proteção contra senha vazada desligada no Auth) |
| Dados no banco | ✅ somente sintéticos (`example.test`, `guidu.co`, `test.guidu.co`), 22 usuários |

---

## 3. Conformidade com os ADRs

| ADR | Situação | Evidência |
| --- | --- | --- |
| **0001 — Prisma como caminho único** | 🟡 Parcial | ✅ `app_runtime` NOSUPERUSER/NOBYPASSRLS/NOINHERIT, não é dono das tabelas (dono: `app_migrations`); ✅ `withContext` com `set_config(..., true)` parametrizado; ✅ `FORCE RLS` nas 12 tabelas de domínio; ✅ `anon`/`authenticated` sem grants nas tabelas de domínio; ✅ helpers `security definer` em papel `app_rls_helper` NOLOGIN. ❌ `DATABASE_URL` com `connection_limit=10` (ADR: `=1`); ❌ `test_migration_probe` exposta à Data API; ⚠️ `app_runtime` é membro concedido a `postgres` (resto do spike `20261007221000`) |
| **0002 — Jobs pg-boss + worker separado** | ❌ Não implementado | Sem worker, sem `app_worker`, sem schema de fila de produto; `src/core/jobs/` vazio. Pior: `sma94_jobs` (spike) e `pgmq` seguem no banco com CRUD para `app_runtime`, contrariando "o runtime web não acessa o schema da fila" |
| **0003 — Ordem das fases** | ❌ Violada | Módulo Agentes de IA (F5) e chaves de API (F4) antes de auditoria, quotas e jobs (F3) |
| **0004 — Nome/domínio configurável** | 🟡 Parcial | `APP_NAME`/`APP_URL` via env em `layout.tsx`, `page.tsx` e `auth-shell.tsx`; mas "GUIDU" está fixo em `app-header.tsx:33`, `admin-header.tsx:20`, `app/app/page.tsx:37,126`, `login/page.tsx:39`, `core/agents/engine.ts:354` e `agents-client.tsx:81`. `.env.example` usa `APP_NAME="CONSOLE GUIDU"` |
| **0005 — Rotas de módulos** | 🟡 Parcial | Existe `/app/[slug]/settings/modules` (lista **fixa no código**, não vem de registro). Faltam `/settings/modules/[moduleKey]`, `/admin/modules` e `/admin/settings/modules/[moduleKey]` |
| **0006 — Manifesto único** | ❌ Não implementado | `src/core/module-contracts/`, `module-runtime/` e `module-templates/` vazios; não há `registry.ts` nem manifesto |
| **0007 — Independência do CartãoPRO** | ✅ Atendido | Nenhuma referência, dado ou credencial do CartãoPRO encontrada |
| **0008 — Supabase dev `guidu`** | ❌ Violada (ou sem registro) | Projeto usado: `console-guidu` `ssulunrysnvwyqjlkpry` (org `rminuvcdsdwmdqkpsujk`, criado em 08/10 17:10 UTC). `supabase/.temp/linked-project.json` e `pooler-url` commitados, o que indica `supabase link` (proibido sem aprovação pelo `CLAUDE.md`). DDL ad hoc (`test_migration_probe`). `package-lock.json` (npm) commitado junto com `pnpm-lock.yaml` |
| **0009 — MCP por chaves de API** | 🟡 Base parcial | ✅ chave `gdu_live_` com 256 bits de CSPRNG, hash SHA-256, exibida uma vez, expiração obrigatória (1–365 dias), revogação. ❌ tela em `/settings/api` (ADR: `/settings/mcp`); ❌ escopos livres (`"read"`), fora do catálogo §17.3, sem `proposals:write` opt-in; ❌ sem auditoria de criação/uso/revogação; ❌ sem rate limit; ❌ sem chaves admin com MFA; ❌ nenhum servidor `/mcp/workspace` ou `/mcp/admin`; ❌ `validateApiKey` depende de contexto RLS de workspace, que não existe antes de identificar a chave, então ainda falta o desenho de lookup; ⚠️ `src/mcp/` ainda tem o resource server OAuth do spike, que foi descartado |

---

## 4. Banco de dados (Supabase `console-guidu`)

**O que está correto**
- 22 migrations aplicadas, idênticas ao repo; histórico reprodutível do zero no CI.
- 12 tabelas de domínio com `RLS` + `FORCE`, dono `app_migrations`, policies só para `app_runtime`/`app_rls_helper`, lendo apenas `app.*`.
- FKs compostas `(workspace_id, organization_id)` em `workspace_members`, `invitations`, `credentials`, `api_keys` e `agent_*` (AC05).
- Trigger `trg_organization_members_last_owner` impede remover o último owner da organização (AC04 no banco).
- Policies finais de `invitations` usam `is_organization_admin`. O bug de escopo na subconsulta da migration `140000` (`m.organization_id = organization_id`, que apontava para a própria coluna interna) foi neutralizado por `151000`.

**Problemas**
| # | Gravidade | Achado |
| --- | --- | --- |
| B1 | 🔴 Crítico | `public.test_migration_probe`: sem migration, RLS desligada, `anon`/`authenticated` com SELECT/INSERT/UPDATE/DELETE/TRUNCATE. Remover por migration versionada |
| B2 | 🔴 Alto | `sma94_jobs.*` (pg-boss do spike) e `pgmq` (`q_/a_sma94_probe`) ainda presentes; `app_runtime` com CRUD nelas. A migration `20261008000000_remove_spike_tables` não limpou isso |
| B3 | 🟠 Médio | Defesa em profundidade fraca em `workspace_members`: INSERT/UPDATE/DELETE liberados a **qualquer membro** do workspace no RLS, inclusive `viewer` alterando o próprio papel para `owner`. O bloqueio existe só no serviço (`members.ts`) |
| B4 | 🟠 Médio | `organization_members_insert` e `workspace_members_insert` aceitam `user_id = app.user_id` com qualquer papel; somado a B6, a segurança depende só do código |
| B5 | 🟠 Médio | RLS de `credentials` e `api_keys` libera qualquer membro (sem distinção de papel/permissão) |
| B6 | 🟠 Médio | Não há proteção de "último owner" no **workspace** (só na organização); `removeWorkspaceMember` permite `isSelf` |
| B7 | 🟡 Baixo | `organizations.max_seats default 5`: número inventado. Planos e cotas estão pendentes com o Comercial |
| B8 | 🟡 Baixo | Auth: proteção contra senha vazada desligada; 6 funções `sma94_jobs` com `search_path` mutável |
| B9 | 🟡 Info | Tabelas do núcleo da §6 ausentes: `plans`, `plan_versions`, `subscriptions`, `workspace_modules`, `entitlement_overrides`, `provider_connections` (substituída por `credentials`), `mcp_clients`/`mcp_grants`, `execution_proposals`, `jobs`/`executions`, `audit_events`, `usage_events`, `privacy_requests`, `support_access_grants` |

---

## 5. Executado com sucesso

**F1 — Fundação**
- Schema núcleo: `profiles`, `organizations`, `organization_members`, `workspaces` (slug único global, UUID interno), `workspace_members`, `platform_admin_members`, `invitations`.
- `resolveWorkspaceContext`: resolve o slug no servidor, só para membro ativo, e não revela a existência de workspaces de terceiros.
- Supabase SSR com cookies, `getClaims` validado no servidor, `proxy.ts` só auxilia a navegação (a decisão fica em `decideAccess`).
- Login, logout (POST com checagem de Origin), recuperação e redefinição de senha, callback, páginas `denied`/`suspended`.
- MFA TOTP: inscrição em `/app/account/security`, desafio em `/auth/mfa`; `/admin` exige AAL2 e papel interno ativo.
- Revogação de identidade: `profiles.status` bloqueia mesmo com JWT válido (AC03 para bloqueio de identidade).
- Convites: token de alta entropia, só o hash é guardado, expiração, uso único, revogação, e `pg_advisory_xact_lock` serializando as vagas na criação e no aceite (AC06), com teste de corrida.
- Papéis com ranking centralizado (`roles.ts`); admin não promove a owner nem remove owner (AC04 no serviço).
- Testes SQL (`tests/core/rls.sql`, `tests/auth/profiles-rls.sql`) e de integração Prisma/Data API rodando no CI com Supabase local e asserção de contagem > 0.

**F2 — Dashboard (parcial)**
- Shell do app (sidebar, header, seletor de workspace) e do admin (`/admin`, `/admin/customers`, `/admin/users`, `/admin/workspaces`).
- Páginas `settings/general`, `team` (convites, papéis, remoção), `usage` (ocupação real de vagas), `credentials`, `api`.
- Estados "Em breve" e "Sem dados" no dashboard, sem métricas fictícias.
- Design system v2 com tokens, dark mode e lint proibindo classes arbitrárias. Esse trabalho veio do Claude no PR #1, não do Gemini.

**F3/F4 — bases**
- Cofre BYOK com AES-256-GCM, valor mascarado e segredo nunca devolvido ao client.
- Chaves de API da plataforma com hash, exibição única, expiração e revogação.

---

## 6. Pendente ou fora do especificado

### 6.1 Correções obrigatórias (bloqueiam a continuidade)
1. **Decidir o banco**: registrar em ADR o uso do `console-guidu` **ou** migrar para o `guidu`. Ajustar `AGENTS.md`, `CLAUDE.md` e `.env.example` para dizer a mesma coisa. Remover `supabase/.temp/` do Git e adicionar ao `.gitignore`.
2. **Migration de limpeza**: `drop table public.test_migration_probe`, `drop schema sma94_jobs cascade`, remover a fila de probe do `pgmq` e a extensão se não for usada, e revogar o `grant app_runtime to postgres`.
3. **Permissões no servidor** para `credentials.manage`, `api_keys.manage` e `agents.manage`, com mapa papel→permissão (§7). Hoje `credentials-actions.ts`, `api-keys-actions.ts` e `agents/actions.ts` só verificam se o usuário é membro.
4. **Chave mestra**: falhar o boot se `ENCRYPTION_KEY` estiver ausente fora de teste (`crypto.ts:23-42`), documentá-la no `.env.example` e avaliar o Supabase Vault (§16).
5. **Congelar ou reverter o módulo Agentes de IA** até existir a especificação do módulo. Fallback, catálogo de modelos (`gpt-4o-mini`, `claude-3-5-sonnet-latest`, `gemini-2.5-flash`) e o agente padrão criado automaticamente foram preenchidos por suposição.
6. **Remover `package-lock.json`** (o projeto usa só pnpm).
7. **`connection_limit=1`** no `DATABASE_URL`, conforme a ADR 0001.

### 6.2 Problemas de código identificados
- `acceptInvitation` não confere se o e-mail do usuário autenticado é o do destinatário do convite. A §8 exige "vínculo com destinatário verificado": quem tiver o link aceita.
- Server actions devolvem `err.message` cru ao navegador, o que pode expor detalhes internos e corpo de erro do provedor de IA (§15: mensagem segura com `requestId`).
- Chamada HTTP ao provedor de IA feita **dentro** da transação `withContext` (`engine.ts`), segurando conexão do pooler durante a latência do LLM.
- Chave do Gemini enviada na query string (`executor.ts`), o que facilita vazar em logs de proxy.
- `settings/modules` lista "Agentes de IA — Disponível em breve" enquanto o módulo já está ativo: lista fixa, sem registro.
- E2E `auth-blocked.spec.ts` foi criado na Task 03 e não existe mais no tree.
- `src/mcp/` contém código do spike OAuth descartado pela D9.

### 6.3 Funcionalidades ainda não iniciadas
| Área | Itens |
| --- | --- |
| Rotas públicas (§10) | `/invite/[token]`, `/onboarding`, `/privacy`, `/terms`, página de convite expirado |
| App (§11) | `settings/integrations`, `settings/mcp`, `settings/audit`, `settings/modules/[moduleKey]`, `/app/organizations/[id]/settings`, `/app/account` (perfil e sessões) |
| Admin (§12) | `customers/[id]`, `workspaces/[id]`, `plans`, `subscriptions`, `modules`, `operations/*`, `audit`, `settings`, `settings/modules/[moduleKey]`; acesso de suporte temporário |
| Contrato de módulos (Adendo §4–9, §17) | manifesto validado por Zod, `registry.ts`, navegação e Settings gerados pelo registro, `module-templates/standard`, módulo de referência, checklist |
| Operação (F3) | `audit_events` append-only, quotas/entitlements, planos/versões/assinaturas, jobs pg-boss + worker `app_worker`, `usage_events`, observabilidade, privacidade |
| API (§15) | REST do núcleo (`/me/workspaces`, `/workspaces/{id}/overview`, `/modules`, `/usage`…), OpenAPI, erros com `code`/`requestId`, paginação, webhooks |
| MCP (§17 + ADR 0009) | `/mcp/workspace` e `/mcp/admin`, catálogo de escopos, tools Zod, propostas, rate limit, auditoria |
| Documentação (§25) | matriz de permissões, modelo de dados, catálogo MCP, `docs/modules/` |

---

## 7. Critérios de aceite (§24)

| AC | Situação |
| --- | --- |
| AC01 isolamento REST/Prisma/Data API/Storage | 🟡 Prisma e Data API testados; sem REST de domínio; Storage não usado |
| AC02 contexto ausente/inválido/reuso | ✅ coberto por testes SQL/integração (CI) |
| AC03 revogação imediata | 🟡 bloqueio de identidade e remoção de membro ✅; grant MCP inexistente |
| AC04 não elevar papel / último owner | 🟡 serviço ✅, banco só na organização; RLS permite elevação direta (B3) |
| AC05 FK entre workspaces | ✅ FKs compostas |
| AC06 convites e vagas sob concorrência | 🟡 ✅ concorrência; ❌ vínculo ao destinatário; número de vagas inventado |
| AC07 segredos fora de DTO/log/erro | 🟡 DTO ✅; erro cru e key em URL ⚠️ |
| AC08 módulo indisponível bloqueia tudo | ❌ sem registro nem estado de módulo |
| AC09–AC11 MCP | ❌ não iniciado |
| AC12–AC13 exportação/exclusão/restore | ❌ não iniciado |
| AC14 auditoria | ❌ não existe |
| AC15–AC16 idempotência, jobs, carga | ❌ não iniciado |
| AC17 MFA admin e recuperação | ✅ |
| AC18 teclado/mobile/falhas | ⚠️ não verificado |

---

## 8. Próximos passos recomendados (em ordem)
1. Decisão do banco + migration de limpeza (itens 6.1-1 e 6.1-2).
2. Matriz de permissões e enforcement em credenciais, chaves e agentes; endurecer as policies de `workspace_members`.
3. Chave mestra obrigatória; vínculo do convite ao e-mail; erros seguros.
4. Decidir o destino do módulo Agentes de IA (congelar atrás de flag ou reverter).
5. Seguir a ordem da ADR 0003: fechar F2 (contrato de módulos, registry, módulo modelo) → F3 (auditoria, quotas, jobs/worker) → F4 (REST, OpenAPI, MCP com chaves).
