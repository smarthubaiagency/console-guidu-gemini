# Relatório de Homologação das Correções (C01–C13)

- **Data:** 09/10/2026
- **Repositório:** `console-guidu-gemini` (Next.js 16, React 19, Prisma 6, Supabase, Playwright, pnpm)
- **Branch:** `fix/C13-homologacao` (base: `main` com C01 a C12 integradas)
- **Banco homologado:** Supabase dev `console-guidu` (`ssulunrysnvwyqjlkpry`), conforme ADR 0010
- **Referência:** Especificação v1.0 (§24), ADRs 0001–0010, `docs/correcoes/README.md` e [Relatório de Verificação de 08/10/2026](2026-10-08-verificacao-execucao-gemini.md)

---

## 1. Resumo Executivo da Homologação

A bateria de correções C01–C12 sanou os desvios arquiteturais e de segurança identificados no relatório inicial de 08/10/2026. A presente homologação (C13) confirma:

1. **Testes E2E e Rig Playwright:** Suíte completa com 37 testes executada localmente e integrada ao pipeline do GitHub Actions como um job dedicado (`e2e`) no `.github/workflows/ci.yml`.
2. **Suíte de Banco Remoto (`pnpm test:core`):** Executada com sucesso contra o projeto dev `console-guidu` (`ssulunrysnvwyqjlkpry`) com todas as variáveis de ambiente ativas e `DATABASE_REQUIRED=1`: **120 testes aprovados em 9 arquivos, 0 testes pulados**.
3. **Invariantes e Políticas SQL:** Testes de invariantes (`tests/core/invariants.sql`), integridade de auditoria (`tests/core/audit.sql`) e chaves MCP (`tests/core/api-keys-adr0009.sql`) validados contra o banco remoto com 100% de sucesso.
4. **Inspeção de Catálogo Remoto:** 26 migrations aplicadas perfeitamente alinhadas aos arquivos; todas as 13 tabelas do schema `public` com `FORCE ROW LEVEL SECURITY` ativo; zero privilégios concedidos aos papéis `anon` e `authenticated` em tabelas de domínio; zero privilégios concedidos ao papel `app_runtime` fora dos schemas `public` e `private`.
5. **Security Advisors do Supabase:** **0 ERROR**. Apenas 1 WARN externo (`auth_leaked_password_protection`), correspondente à ação manual M2 do operador no console do Supabase.

---

## 2. Status das Correções C01–C12

| ID | Correção | Status | PR | Evidência Principal |
|---|---|---|---|---|
| **C01** | Governança do ambiente | Concluída | [#2](https://github.com/smarthubaiagency/console-guidu-gemini/pull/2) | ADR 0010 registrada; segredos retirados de código e `.env.example`; `.temp/` e `package-lock.json` removidos; lockfile pnpm fixado. |
| **C02** | Limpeza do banco de dados | Concluída | [#4](https://github.com/smarthubaiagency/console-guidu-gemini/pull/4) | Migration `20261009000000_cleanup_spike_leftovers.sql`: `test_migration_probe`, schema `sma94_jobs` e filas `pgmq` removidas; `tests/core/invariants.sql` criado. |
| **C03** | Remover código de spike descartado | Concluída | [#5](https://github.com/smarthubaiagency/console-guidu-gemini/pull/5) | Remoção do servidor OAuth experimental em `src/mcp/`; scripts pg-boss/pgmq de teste limpos. |
| **C04** | Congelar Agentes de IA atrás de flag | Concluída | [#6](https://github.com/smarthubaiagency/console-guidu-gemini/pull/6) | Flag `GUIDU_MODULE_AI_AGENTS_ENABLED=false`; rota `/ai-agents`, menus e server actions bloqueados com `ModuleUnavailableError`; banner informativo no app. |
| **C05** | Branding configurável | Concluída | [#8](https://github.com/smarthubaiagency/console-guidu-gemini/pull/8) | Literais "GUIDU" substituídos por `APP_NAME` e `APP_URL` nos headers, telas de autenticação e layout; ADR 0004 atendida. |
| **C06** | Matriz papel → permissão e guard servidor | Concluída | [#9](https://github.com/smarthubaiagency/console-guidu-gemini/pull/9) | Módulo `src/core/permissions/matrix.ts` e `guard.ts`; validação de hierarquia RBAC (`owner`, `admin`, `editor`/`member`, `viewer`) no servidor. |
| **C07** | Aplicar permissões em credenciais, chaves e equipe | Concluída | [#10](https://github.com/smarthubaiagency/console-guidu-gemini/pull/10) | Guards de servidor aplicados em `credentials-actions.ts`, `api-keys-actions.ts` e `members.ts`; viewer impedido de manipular credenciais/chaves de terceiros. |
| **C08** | RLS de vínculos e proteção do último owner | Concluída | [#11](https://github.com/smarthubaiagency/console-guidu-gemini/pull/11) | Migration `20261009120000_c08_rls_membership_and_last_owner.sql`: triggers de proteção do último owner na organização e no workspace; RLS reforçado contra auto-escalonamento. |
| **C09** | Convite vinculado ao destinatário | Concluída | [#12](https://github.com/smarthubaiagency/console-guidu-gemini/pull/12) | Vínculo obrigatório do e-mail ao convite no aceite; verificação de `email_confirmed_at`; rota pública `/invite/[token]` com estados de erro claros. |
| **C10** | Chave mestra obrigatória e erros seguros | Concluída | [#13](https://github.com/smarthubaiagency/console-guidu-gemini/pull/13) | `ENCRYPTION_KEY` obrigatória em runtime; envelope `AppError` e `apiErrorResponse` sanitizando mensagens para o cliente com correlação via `requestId`. |
| **C11** | Auditoria (`audit_events` append-only) | Concluída | [#14](https://github.com/smarthubaiagency/console-guidu-gemini/pull/14) | Migration `20261009150000_audit_events.sql`: tabela append-only com trigger anti-mutação; registro transacional em credenciais, chaves, convites, vínculos e negações. |
| **C12** | Chaves de API conforme ADR 0009 | Concluída | [#15](https://github.com/smarthubaiagency/console-guidu-gemini/pull/15) | Migration `20261009160000_api_keys_adr0009.sql`: catálogo de escopos (§17.3); lookup seguro via `private.resolve_api_key`; tela movida para `/settings/mcp`; `/settings/api` como placeholder F4. |

---

## 3. Conformidade com os ADRs (0001–0010)

| ADR | Situação | Evidência e Observações |
|---|---|---|
| **0001 — Prisma como caminho único** | ✅ Conforme | `app_runtime` com NOSUPERUSER/NOBYPASSRLS; todas as 13 tabelas de domínio com `FORCE RLS`; consultas de domínio executadas sob `withContext` parametrizando `app.*`. |
| **0002 — Jobs pg-boss + worker separado** | 🟡 Parcial (F3) | Schemas residuais de spike (`sma94_jobs` e `pgmq`) eliminados; runtime web desacoplado de filas. Implementação do processo `app_worker` e tabelas definitivas de jobs agendada para a Fase 3. |
| **0003 — Ordem das fases** | ✅ Conforme | Desvios de fase sanados: módulo Agentes de IA (F5) congelado via flag (C04); servidor MCP adiado para a F4; foco restrito à Fundação sólida (F1) e Dashboard base (F2). |
| **0004 — Nome/domínio configurável** | ✅ Conforme | Hardcoded "GUIDU" eliminado em favor das variáveis de ambiente `APP_NAME` e `APP_URL`, com validações nos layouts e testes E2E. |
| **0005 — Rotas de módulos** | 🟡 Parcial (F2) | Rotas alinhadas com estado "Em breve" e congelamento; manifesto de rotas dinâmicas e subpáginas de settings de módulos pertencem à Fase 2. |
| **0006 — Manifesto único de módulos** | ⏳ Pendente (F2) | Contrato Zod, runtime dinâmico e template padrão pertencem à Fase 2 (previsto na ADR 0003). |
| **0007 — Independência do CartãoPRO** | ✅ Conforme | Nenhuma dependência externa, código residual ou menção ao CartãoPRO existe no repositório. |
| **0008 — Supabase dev (`guidu`)** | ✅ Conforme (via ADR 0010) | Exceção registrada formalmente na ADR 0010 para este repositório. |
| **0009 — MCP por chaves de API** | ✅ Conforme (Base F1/F4) | Formato `gdu_live_`, hash SHA-256, escopos canônicos (§17.3), opt-in em `proposals:write`, UI em `/settings/mcp`, lookup seguro via `resolve_api_key`. Servidor MCP e rate limit são F4. |
| **0010 — Projeto Supabase dev exclusivo (`console-guidu`)** | ✅ Conforme | Projeto `ssulunrysnvwyqjlkpry` configurado como alvo exclusivo do repositório; migrações aplicadas estritamente de arquivos versionados via `scripts/migrate.ts`. |

---

## 4. Critérios de Aceite da Especificação (§24, AC01–AC18)

| Critério | Situação | Evidência de Homologação |
|---|---|---|
| **AC01 — Isolamento entre workspaces** | ✅ Atendido | Coberto por `tests/core/isolation.test.ts` (27 testes) e `tests/core/data-api.test.ts` (13 testes). Data API bloqueada para todas as tabelas; consultas entre workspaces negadas pelo RLS. |
| **AC02 — Contexto ausente ou inválido** | ✅ Atendido | Coberto por `isolation.test.ts` e suíte SQL. Ausência de variáveis `app.*` resulta em zero registros retornados; conexões limpas após término de transação. |
| **AC03 — Revogação imediata** | ✅ Atendido | Coberto pelo teste E2E `e2e/auth-blocked.spec.ts` (sessão ativa barrada imediatamente ao alterar status para `blocked`), `tests/core/membership.test.ts` e `tests/core/mcp-authenticate.test.ts`. |
| **AC04 — Controle de elevação de papel e último owner** | ✅ Atendido | Coberto por `tests/core/membership.test.ts` (15 testes) e `tests/core/membership-rls.sql`. Triggers impedem remoção/rebaixamento do último owner no workspace e na org; admin não promove para owner. |
| **AC05 — FKs compostas** | ✅ Atendido | FKs `(workspace_id, organization_id)` presentes e verificadas em `workspace_members`, `invitations`, `credentials`, `api_keys`, `agent_configs`, `agent_sessions` e `agent_messages`. |
| **AC06 — Convites, expiração e concorrência** | ✅ Atendido | Coberto por `membership.test.ts` e `e2e/invite.spec.ts`. Vínculo obrigatório ao destinatário, conferência de e-mail confirmado, lock consultivo `pg_advisory_xact_lock` serializando vagas sob concorrência. |
| **AC07 — Segredos protegidos fora de logs/erros/DTOs** | ✅ Atendido | Coberto por `tests/unit/app-error.test.ts`, `tests/core/credentials-and-api-keys.test.ts`. Criptografia AES-256-GCM; chaves mascaradas; ausência de segredos nos payloads e erros sanitizados com `requestId`. |
| **AC08 — Módulo indisponível bloqueia tudo** | ✅ Atendido | Coberto por `src/core/agents/actions.test.ts` e `e2e/ai-agents.spec.ts`. Flag desativada bloqueia rota, esconde item de menu e aborta server actions com erro 503 seguro. |
| **AC09 — Restrição de MCP por escopo** | 🔄 Fora do escopo (F4) | Catálogo de escopos Zod e restrições de criação/emissão prontos (C12); enforcement no servidor MCP pertence à Fase 4. |
| **AC10 — Propostas de execução MCP** | 🔄 Fora do escopo (F4) | Mecanismo human-in-the-loop pertence à Fase 4. |
| **AC11 — Rate limit de MCP** | 🔄 Fora do escopo (F4) | Rate limiting dedicado de MCP pertence à Fase 4. |
| **AC12 — Exportação e portabilidade** | ⏳ Não iniciado (F3) | Exportação de dados pertence à Fase 3 (Privacidade e Compliance). |
| **AC13 — Exclusão lógica e retenção** | ⏳ Não iniciado (F3) | Exclusão lógica de workspaces/organizações pertence à Fase 3. |
| **AC14 — Trilha de auditoria append-only** | ✅ Atendido | Coberto por `tests/core/audit.test.ts` (14 testes) e `tests/core/audit.sql`. Tabela `audit_events` append-only via trigger; eventos registrados atomicamente nas mutações críticas. |
| **AC15 — Idempotência e retentativas em automações** | 🔄 Fora do escopo (F3) | Pertence à infraestrutura de background jobs da Fase 3. |
| **AC16 — Carga e isolamento concorrente** | ✅ Atendido | Coberto por `isolation.test.ts` (50 alternâncias concorrentes isoladas) e `membership.test.ts` (corrida atômica de vagas). |
| **AC17 — MFA de admin da plataforma** | ✅ Atendido | Coberto por `e2e/auth-mfa.spec.ts` e `e2e/platform-admin.spec.ts`. AAL2 obrigatório e verificação de `platform_admin_members`. |
| **AC18 — Operabilidade e design system** | 🟡 Parcial | Navegação base, acessibilidade e design system v2 com tokens e Tailwind v4 validados nos testes de UI e E2E. |

---

## 5. Ações Manuais (M1–M4)

| # | Ação | Status / Orientação |
|---|---|---|
| **M1** | Troca da senha do papel `app_migrations` | **Confirmar com Marcelo** se executada no SQL Editor do Supabase. A senha anterior esteve no histórico git e deve ser mantida rotacionada. |
| **M2** | Ativar *Leaked Password Protection* no Supabase | **Confirmar com Marcelo**. O advisor do Supabase confirmou aviso ativo: `WARN: auth_leaked_password_protection`. Deve ser habilitado em *Authentication → Password Security* no painel do Supabase. |
| **M3** | Desligar *Dynamic Client Registration / OAuth Server* | **Confirmar com Marcelo** se o recurso de OAuth server experimental do Supabase está desligado no projeto `ssulunrysnvwyqjlkpry`. |
| **M4** | Aprovação de PRs antes da aplicação de migrations | **Atendido**. Todas as migrations (C02, C08, C11 e C12) foram aplicadas somente após PRs abertas, testadas no CI e aprovadas. |

---

## 6. Escopo das Próximas Fases (F2, F3, F4)

Conforme a ADR 0003 e o plano em `docs/correcoes/README.md`, os itens abaixo permanecem reservados para as fases seguintes:

### Fase 2 (F2) — Contrato de Módulos e Expansão do Dashboard
- **Contrato Zod de manifesto:** Validação de especificações de módulos em `src/core/module-contracts/`.
- **Registro Central (`registry.ts`):** Navegação dinâmica na sidebar e subpáginas de settings geradas a partir do registro.
- **Template Padrão:** Criação de `module-templates/standard` e módulo de referência documentado.
- **Rotas de Gestão de Módulos:** `/app/[slug]/settings/modules/[moduleKey]`, `/admin/modules` e `/admin/settings/modules/[moduleKey]`.

### Fase 3 (F3) — Operação, Jobs, Cobrança e Privacidade
- **Planos e Assinaturas:** Tabelas `plans`, `plan_versions`, `subscriptions` e sincronização de entitlements.
- **Worker de Segundo Plano:** Processo isolado `app_worker` operando com filas do pg-boss sob permissões mínimas.
- **Métricas e Quotas:** Registro de `usage_events`, contadores de consumo e limites de recursos por workspace.
- **Privacidade e LGPD:** Rotas e fluxos de exportação de dados (AC12) e exclusão com retenção legal (AC13).

### Fase 4 (F4) — APIs REST e Servidor MCP
- **REST da Plataforma:** Endpoints REST em `/api/v1/` com OpenAPI, paginação, idempotência e tratamento seguro de erros.
- **Servidores MCP Completos:** Servidores `/mcp/workspace` e `/mcp/admin` com SSE e stdio, rate limiting por IP/chave e execução de propostas com confirmação humana.
- **Portal de Desenvolvedores (`/settings/api`):** Emissão de chaves REST para integrações externas e webhooks.
- **Chaves Administrativas:** Emissão de chaves MCP com escopos `admin:*`, exigindo MFA TOTP e papel interno ativo.

---

## 7. Registro de Verificação dos Comandos

Executado no ambiente de homologação:

```bash
# 1. Checagens estáticas e compilação
pnpm install --frozen-lockfile  # Ok (versões fixadas)
pnpm generate                 # Ok (Prisma Client 6.12.0)
pnpm typecheck                # Ok (0 erros)
pnpm lint                     # Ok (0 avisos / 0 erros)
pnpm test                     # Ok (24 arquivos / 353 testes unitários e de integração locais aprovados)
pnpm build                    # Ok (Next.js 16.4.0 Turbo build com 32 rotas compiladas)

# 2. Suíte de integração contra o banco remoto console-guidu (ADR 0010)
DATABASE_REQUIRED=1 pnpm test:core
# Resultado: 9 arquivos de teste / 120 testes aprovados / 0 pulados (Duração: 61.66s)

# 3. Testes E2E com Playwright
pnpm test:e2e
# Resultado: 36 testes aprovados / 1 pulado por feature flag de AI Agents (Duração: 1.6m)

# 4. Invariantes e segurança SQL no banco remoto (ssulunrysnvwyqjlkpry)
# - tests/core/invariants.sql: PASSOU (todas as invariantes satisfeitas)
# - tests/core/audit.sql: PASSOU (9/9 testes de segurança append-only e RLS)
# - tests/core/api-keys-adr0009.sql: PASSOU (5/5 suítes de catálogo e resolução)
```
