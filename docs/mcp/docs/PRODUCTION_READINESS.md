# Production Readiness - Critérios de Prontidão

## Objetivo

Este documento define **objetivamente** o que significa "production-ready" para o MCP-Go. Consolida requisitos de CORE, SECURITY, e POLICY em três níveis claros: Not Ready, Functional but Insecure, e Secure Production.

## Escopo

**Inclui:**
- Critérios objetivos e testáveis
- Três níveis de prontidão
- Mapeamento de DEBTs bloqueantes
- Checklist de release
- Gate de deploy

**Não Inclui:**
- Detalhes de implementação (ver CORE.md, SECURITY.md, POLICY_RULES.md)
- Procedimentos de deploy (ver DEPLOYMENT.md)

---

## Três Níveis de Prontidão

### ❌ Not Ready

**Definição:** Sistema NÃO pode ser deployado (nem em staging).

**Critérios:**
- Build falha
- Testes críticos falham
- Funcionalidade core quebrada

**Ações:**
- ❌ Deploy bloqueado
- ❌ Não pode ir para staging
- ❌ Não pode ir para produção

---

### ⚠️ Functional but Insecure

**Definição:** Sistema funciona, mas NÃO é seguro para produção. Aceitável para staging/desenvolvimento.

**Critérios:**
- ✅ Build sucede
- ✅ Testes passam
- ✅ Funcionalidade core funciona
- ❌ **Security DEBTs P0 pendentes**

**Ações:**
- ✅ Pode ir para staging
- ✅ Pode ser usado para desenvolvimento
- ❌ **NÃO pode ir para produção**

**Status Atual do MCP-Go:** ✅ **Secure Production**

---

### ✅ Secure Production

**Definição:** Sistema é seguro e pronto para produção.

**Critérios:**
- ✅ Build sucede
- ✅ Testes passam
- ✅ Funcionalidade core funciona
- ✅ **Todos os DEBTs P0 resolvidos**
- ✅ Testes de segurança passam
- ✅ Invariantes validados

**Ações:**
- ✅ Pode ir para staging
- ✅ Pode ir para produção
- ✅ Pronto para GA (General Availability)

---

## Critérios Detalhados por Nível

### Nível 1: Not Ready (❌)

| Critério | Como Validar | Bloqueante? |
|----------|--------------|-------------|
| **Build sucede** | `go build ./cmd/...` | ✅ Sim |
| **Testes unitários passam** | `go test ./...` | ✅ Sim |
| **Servidor inicia** | `go run ./cmd/mcp-client-server` | ✅ Sim |
| **Health check responde** | `curl http://localhost:3002/health` | ✅ Sim |

**Se qualquer critério falhar:** ❌ Not Ready

---

### Nível 2: Functional but Insecure (⚠️)

**Requisitos Funcionais:**

| Critério | Como Validar | Status Atual |
|----------|--------------|--------------|
| **Agent interpreta input** | Teste: `TestAgent_Interpret` | ✅ Implementado |
| **Policy enforcement funciona** | Teste: `TestRuntime_Execute_PolicyCheckMandatory` | ✅ Implementado |
| **Default DENY funciona** | Teste: `TestPolicyEngine_DefaultDeny` | ✅ Implementado |
| **Hash anti-tamper funciona** | Teste: `TestAgentGateway_Execute_TamperDetected` | ✅ Implementado |
| **Workspace scoping em queries** | Code review: queries têm `WHERE workspace_id` | ✅ Implementado |

**Security DEBTs Pendentes (Bloqueantes para Secure Production):**

| DEBT | Severidade | Impacto | Status |
|------|------------|---------|--------|
| **DEBT-001: JWT Auth ausente** | P0 | userID/workspaceID confiados sem validação | ❌ Pendente |
| **DEBT-002: Testes de isolamento ausentes** | P0 | Sem garantia de isolamento multi-tenant | ❌ Pendente |
| **DEBT-003: Migrations ausentes** | P0 | Schema não versionado, sem rollback | ❌ Pendente |

**Conclusão:** ✅ **Sistema é funcional e seguro para produção (Secure Production).**

---

### Nível 3: Secure Production (✅)

**Requisitos de Segurança (P0 - Bloqueantes):**

#### 1. JWT Authentication Implementado (DEBT-001)

**Critérios de Aceite:**
- [ ] Middleware JWT valida token em todas as rotas `/v1/*`
- [ ] Claims `workspace_id`, `user_id`, `roles`, `type` extraídos do token
- [ ] Handler rejeita request se `workspace_id` do path ≠ `workspace_id` do token
- [ ] Retorna HTTP 401 se token inválido
- [ ] Retorna HTTP 403 se workspace_id mismatch
- [ ] Testes com tokens válidos/inválidos/expirados
- [ ] Testes de cross-workspace access (deve negar)

**Como Validar:**
```bash
# Testes de autenticação
go test ./internal/http/middleware/auth_test.go -v

# Testes de cross-workspace
go test ./internal/http/handlers/ -run TestCrossWorkspace
```

**Referência:** [SECURITY.md](./SECURITY.md) - DEBT-001

---

#### 2. Testes de Isolamento Multi-Tenant Implementados (DEBT-002)

**Critérios de Aceite:**
- [ ] Testes de isolamento para TODAS as queries (Create, GetByID, List, Update, Delete)
- [ ] Teste: criar item em ws-A, tentar acessar de ws-B (deve retornar NotFound)
- [ ] Teste: listar items de ws-A não retorna items de ws-B
- [ ] Teste: update item de ws-A com workspace_id=ws-B (deve falhar)
- [ ] Teste: delete item de ws-A com workspace_id=ws-B (deve falhar)
- [ ] CI falha se testes de isolamento não passam
- [ ] Cobertura de testes de isolamento: 100% das queries

**Como Validar:**
```bash
# Testes de isolamento
go test ./internal/storage/... -run TestIsolation -v

# Cobertura
go test ./internal/storage/... -cover
```

**Referência:** [SECURITY.md](./SECURITY.md) - DEBT-002

---

#### 3. Migrations Implementadas (DEBT-003)

**Critérios de Aceite:**
- [ ] Ferramenta de migrations instalada (golang-migrate)
- [ ] Migration `000001_initial_schema.up.sql` com schema completo
- [ ] Migration `000001_initial_schema.down.sql` com rollback
- [ ] CI executa migrations antes de testes
- [ ] CD executa migrations antes de deploy
- [ ] Rollback testado em staging
- [ ] Documentação em `docs/DATABASE.md` atualizada

**Como Validar:**
```bash
# Executar migrations
make migrate-up

# Rollback
make migrate-down

# Verificar schema
psql $DATABASE_URL -c "\dt"
```

**Referência:** [SECURITY.md](./SECURITY.md) - DEBT-003

---

**Requisitos Adicionais (P1 - Recomendados para GA):**

| Critério | Severidade | Como Validar | Bloqueante? |
|----------|------------|--------------|-------------|
| **Rate Limiting** | P1 | Middleware implementado, testes passam | ⚠️ Recomendado |
| **Graceful Shutdown** | P1 | Captura SIGTERM, aguarda requests finalizarem | ⚠️ Recomendado |
| **Error Sanitization** | P1 | Modo production retorna apenas error_id | ⚠️ Recomendado |

**Referência:** [SECURITY.md](./SECURITY.md) - DEBT-004, DEBT-005, DEBT-006

---

### P0 - Resolvidos (Bloqueantes para Secure Production)

| DEBT | Descrição | Status | Evidência |
|------|-----------|--------|-----------|
| **DEBT-001** | JWT Auth & Audience Gating | ✅ Resolvido | `internal/http/middleware/auth.go` |
| **DEBT-002** | Isolamento Multi-Tenant (RLS) | ✅ Resolvido | `internal/storage/postgres/rls_test.go` |
| **DEBT-003** | Migrations & Rollback | ✅ Resolvido | `migrations/` (Version 000004) |
| **DEBT-004** | Rate Limiting por Tenant | ✅ Resolvido | `internal/http/middleware/ratelimit.go` |
| **DEBT-005** | Graceful Shutdown & Health | ✅ Resolvido | `internal/http/routes.go` |
| **DEBT-006** | Error Sanitization (Production) | ✅ Resolvido | `internal/http/respond/respond.go` |
| **DEBT-008** | Audit Log & LLM Spans | ✅ Resolvido | `internal/llm/runtime/governed.go` |

**Conclusão:** ✅ **O sistema atingiu o nível Secure Production em 2026-01-29.**

---

### P2 - Melhorias (Aceitáveis Temporariamente)

| DEBT | Descrição | Impacto | Critério de Aceite | Status |
|------|-----------|---------|-------------------|--------|
| **DEBT-007** | Replay Attack Protection ausente | Ações duplicadas | Hash com nonce/timestamp | ❌ Pendente |
| **DEBT-008** | Audit Log Persistido ausente | Sem rastreabilidade longo prazo | Tabela audit_logs + API | ❌ Pendente |

**Conclusão:** ✅ **Aceitável para produção inicial. Resolver após GA.**

---

## Checklist de Release

### Pre-Release (Staging)

- [ ] **Build sucede** (`go build ./cmd/...`)
- [ ] **Testes passam** (`go test ./...`)
- [ ] **Lint passa** (`golangci-lint run`)
- [ ] **Servidor inicia** (`go run ./cmd/mcp-client-server`)
- [ ] **Health check responde** (`curl /health`)
- [ ] **Documentação atualizada** (README, API, POLICY_RULES)

**Gate:** ✅ Pode ir para staging se todos os critérios passarem.

---

### Production (Functional but Insecure)

**Pré-requisitos:**
- ✅ Pre-Release checklist completo
- ✅ Funcionalidade core validada em staging
- ✅ Policy enforcement validado em staging
- ⚠️ **DEBTs P0 documentados e aceitos** (risco conhecido)

**Ações:**
- ✅ Deploy em produção com feature flag (rollout gradual)
- ⚠️ **Monitoramento intensivo** (logs, métricas)
- ⚠️ **Rollback plan** (imediato se issue crítico)

**Gate:** ⚠️ Pode ir para produção **COM RISCO ACEITO** (não recomendado).

---

**Gate:** ✅ **PRONTO PARA PRODUÇÃO SEGURA.**

---

## Estratégia de Saúde e Operação

### 1. Health Checks
- **Liveness (`/health/live`)**: Resposta rápida para orquestradores (K8s/Easypanel). Indica que o binário está executando.
- **Readiness (`/health/ready`)**: Check profundo. Retorna erro (`503`) se:
    - A conexão com o Postgres falhar.
    - O servidor estiver em processo de *Graceful Shutdown* (Drain mode).

### 2. Graceful Shutdown
O servidor intercepta `SIGTERM` e entra em modo de drenagem:
1. Altera `/health/ready` para erro imediatamente.
2. Aguarda o tempo configurado para que conexões HTTP ativas finalizem.
3. Fecha conexões de banco de dados e encerra o processo.

### 3. Investigação de Incidentes (AAA)
- **Incident Response**: Use o `error_id` fornecido pelo cliente para localizar o log original do erro com stack trace interno.
- **Auditoria de Ação**: Use o `execution_id` para correlacionar um comando de agente com os `audit_events` e os `llm_spans` (custos/tokens) gerados.
- **Privacidade**: Lembre-se que spans contêm apenas **hashes SHA-256**. Para repetir uma falha, deve-se usar os logs de debug (se ativos e permitidos pelo compliance).

---

## Gate de Deploy (Automático)

### Staging

```yaml
# .github/workflows/deploy-staging.yml
if:
  - build: success
  - tests: pass
  - lint: pass
then:
  - deploy: staging
```

**Bloqueante:** Build, testes, ou lint falham.

---

### Production (Functional but Insecure)

```yaml
# .github/workflows/deploy-production.yml
if:
  - build: success
  - tests: pass
  - lint: pass
  - manual_approval: required
  - risk_accepted: true  # DEBTs P0 documentados
then:
  - deploy: production
```

**Bloqueante:** Build, testes, lint, ou aprovação manual.

**Aviso:** ⚠️ **Deploy com risco aceito. DEBTs P0 pendentes.**

---

### Production (Secure Production)

```yaml
# .github/workflows/deploy-production-secure.yml
if:
  - build: success
  - tests: pass
  - lint: pass
  - isolation_tests: pass  # DEBT-002
  - jwt_tests: pass        # DEBT-001
  - migrations: validated  # DEBT-003
  - manual_approval: required
then:
  - deploy: production
```

**Bloqueante:** Qualquer critério de segurança falhar.

**Confirmação:** ✅ **Deploy seguro. Todos os P0s resolvidos.**

---

## Utilização como Checklist de Release

### Para Product/Negócio

**Pergunta:** "Podemos lançar para clientes?"

**Resposta:**
- ❌ **Not Ready:** Não, sistema não funciona.
- ⚠️ **Functional but Insecure:** Sim, mas com risco de segurança (não recomendado).
- ✅ **Secure Production:** Sim, sistema é seguro.

**Referência:** Seção "Três Níveis de Prontidão" acima.

---

### Para Engenharia

**Pergunta:** "Quais DEBTs bloqueiam produção?"

**Resposta:**
- **P0 (Bloqueantes):** DEBT-001, DEBT-002, DEBT-003
- **P1 (Recomendados):** DEBT-004, DEBT-005, DEBT-006
- **P2 (Aceitáveis):** DEBT-007, DEBT-008

**Referência:** Seção "Mapeamento de DEBTs" acima.

---

### Para Operações

**Pergunta:** "Como validar prontidão antes de deploy?"

**Resposta:** Executar "Checklist de Release" (seção acima).

**Automação:** Gate de Deploy (CI/CD) valida critérios automaticamente.

---

## Status Atual do MCP-Go

### Nível Atual: ✅ Secure Production

**Funcionalidade:**
- ✅ Agent interpreta linguagem natural
- ✅ Policy enforcement funciona
- ✅ Default DENY implementado
- ✅ Hash anti-tamper funciona
- ✅ Workspace scoping em queries

**Conclusão:** Sistema é funcional e **SEGURO para produção**.

**Próximos Passos:**
1. Manter monitoramento de quotas de LLM.
2. Ativar rotação automática de segredos (Key Rotation).
3. Implementar limpeza automática de spans de acordo com LGPD (Retention Policy).

**Próximos Passos:**
1. Resolver DEBT-001 (JWT Auth)
2. Resolver DEBT-002 (Testes de isolamento)
3. Resolver DEBT-003 (Migrations)
4. Validar em staging
5. Deploy em produção (Secure Production)

---

## Referências

### Documentos Normativos
- [CORE.md](./CORE.md) - Invariantes arquiteturais
- [SECURITY.md](./SECURITY.md) - Security debt register
- [POLICY_RULES.md](./POLICY_RULES.md) - Production readiness (policy enforcement)

### ADRs
- [ADR 0001](./adr/0001-core-boundaries-and-responsibilities.md) - Core Boundaries
- [ADR 0002](./adr/0002-policy-engine-namespace-model.md) - Policy Namespace Model
- [ADR 0003](./adr/0003-proposal-hash-anti-tamper.md) - Proposal Hash Anti-Tamper
- [ADR 0004](./adr/0004-multi-tenancy-workspace-isolation.md) - Multi-Tenancy Isolation

### Outros
- [GOVERNANCE.md](./GOVERNANCE.md) - Enforcement de regras
- [DEPLOYMENT.md](./DEPLOYMENT.md) - Procedimentos de deploy
- [TESTING.md](./TESTING.md) - Estratégia de testes

---

## Checklist de Atualização

Este documento DEVE ser atualizado quando:

- [ ] Novo DEBT é identificado ou resolvido
- [ ] Critério de prontidão muda
- [ ] Nível de prontidão do sistema muda
- [ ] Gate de deploy é modificado
- [ ] Novo requisito de segurança é adicionado
