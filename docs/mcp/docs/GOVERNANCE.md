# Governance - Enforcement de Regras de Engenharia

## Objetivo

Este documento define **como** as regras normativas (CORE, SECURITY, POLICY) são enforçadas no MCP-Go. Estabelece o que é automático (CI), o que requer code review, e o que é anti-goal (não fazer).

## Escopo

**Inclui:**
- Regras automáticas (CI/testes)
- Regras manuais (code review obrigatório)
- Recomendações realistas de enforcement
- Anti-goals explícitos

**Não Inclui:**
- Regras normativas em si (ver CORE.md, SECURITY.md, POLICY_RULES.md)
- Detalhes de CI/CD pipeline (ver DEPLOYMENT.md)

---

## Regras Automáticas (CI Enforcement)

Estas regras SÃO enforçadas automaticamente via CI e DEVEM passar antes de merge:

### 1. Build & Test (Básico)

**Comandos:** `go build ./...` e `go test ./...`

**O que valida:** integridade do código, compilação e testes unitários.

---

### 2. Security Check (Gates Obrigatórios)

**Comandos:** `make security-check` e `make security-check-race`

**O que valida:**
- **Anti-bypass**: Garante que nenhuma tool pode ser executada sem `Policy.Evaluate` (fail-closed).
- **Concurrency**: Valida segurança de thread em ToolRegistry e Policy Engine via race detector.

**Evidência:** `internal/mcp/runtime/executor_security_test.go`

---

### 3. Isolamento Multi-Tenant (RLS Enforcement)

**Comando:** `go test ./internal/storage/... -run TestIsolation`

**O que valida:**
- **Fail-Closed**: Garante que transações sem `BeginTenant` (SET LOCAL) retornem ZERO linhas.
- **Isolamento**: Impede vazamento de dados entre workspaces distintos.

**Evidência:** `internal/storage/postgres/rls_test.go`

---

### 4. Privacidade LLM (Privacy-First Gate)

**Comando:** `go test ./internal/llm/runtime/... -run TestGovernedSecurity`

**O que valida:**
- **Data Minimization**: Garante que prompts e responses brutos NUNCA sejam persistidos (apenas hashes).

**Evidência:** `internal/llm/runtime/governed_security_test.go`

---

## Regras Manuais (Code Review Obrigatório)

Estas regras NÃO são automáticas e DEVEM ser validadas por code review:

### 1. Import Boundaries (ADR 0001)

**Regra:** `internal/mcp/` e `internal/agents/` NÃO podem importar `internal/http/`

**Por que não é automático:**
- Linter customizado seria overkill
- Fácil de verificar manualmente (grep imports)

**Como validar:**
```bash
# Verificar imports proibidos
grep -r "internal/http" internal/mcp/ internal/agents/
# Deve retornar vazio
```

**Checklist PR:** CORE Gate - "Runtime não conhece HTTP"

**Referência:** [ADR 0001](./adr/0001-core-boundaries-and-responsibilities.md)

---

### 2. Admin API Gating

**Regra:** Toda rota administrativa sob `/v1/admin` DEVE usar `middleware.AdminAuth` e audiencia `mcp-admin`.

**Como validar:**
- Verificar no `routes.go` a aplicação do middleware correto.
- Validar que o token exigido contém as claims `type=system` ou `role=admin`.

**Checklist PR:** SECURITY Gate - "Admin API protegida com audiência específica"

---

### 3. Guardrail Comments em Queries

**Regra:** Queries SQL DEVEM ter comentário "Guardrail" explicando risco de remover `WHERE workspace_id`

**Por que não é automático:**
- Comentários são contextuais
- Regex/lint seria frágil

**Como validar:**
- Verificar que queries em `internal/storage/` têm comentário guardrail
- Verificar que `WHERE workspace_id` está presente

**Checklist PR:** SECURITY Gate - "Guardrail comments mantidos"

**Referência:** [ADR 0004](./adr/0004-multi-tenancy-workspace-isolation.md)

---

### 4. MCPContext Imutabilidade

**Regra:** `MCPContext` struct NÃO pode ter setters

**Por que não é automático:**
- Análise de struct fields requer AST parsing
- Code review é suficiente

**Como validar:**
- Verificar que `internal/mcp/context/envelope.go` não tem métodos `Set*()`
- Struct fields são read-only

**Checklist PR:** CORE Gate - "MCPContext não foi tornado mutável"

**Referência:** [CORE.md](./CORE.md) - Invariante Global #5

---

### 5. Agent Side-Effect Free

**Regra:** `internal/agents/` NÃO pode fazer I/O (DB, HTTP, File)

**Por que não é automático:**
- Detectar I/O requer análise semântica complexa
- Code review + testes são mais efetivos

**Como validar:**
- Verificar que `internal/agents/` não importa `database/sql`, `net/http`, `os`
- Testes confirmam que Agent é pure function

**Checklist PR:** CORE Gate - "Agent continua side-effect free"

**Referência:** [ADR 0001](./adr/0001-core-boundaries-and-responsibilities.md)

---

## Governança de Execução e Auditoria (AAA)

Toda atividade agentic no sistema é governada por identidades imutáveis:

### 1. Obrigatoriedade de Execution ID
- **Regra:** Nenhuma execução de ferramenta (tool) ou chamada LLM pode ocorrer sem um `ExecutionID` válido no contexto.
- **Enforcement:** Injetado via `execution.WithExecutionID` nos entrypoints da API.

### 2. Governança de Modelos (LLM)
- **Settings por Tenant**: Cada workspace possui sua configuração ativa (`tenant_llm_settings`) e estratégia de fallback.
- **Integridade de Config**: Modelos são buscados em `llm_configs` (imutáveis após criação). Alterações exigem criação de nova versão.

### 3. Persistência e Prova de Ação
- **Audit Events**: Toda decisão de segurança ou bypass de erro deve gerar um registro em `audit_events`.
- **Hashes SHA-256**: O `GovernedClient` garante que a auditoria contenha provas de entrada/saída sem vazar conteúdo PII.

---

## Recomendações Realistas de Enforcement

### Princípio: Testes > Lint

**Regra Geral:** Se uma regra pode ser validada por teste, prefira teste a lint.

**Exemplo:**
- ✅ **Teste:** "Policy default DENY" → `TestPolicyEngine_DefaultDeny`
- ❌ **Lint:** Regex para detectar `policy.Allow` sem namespace

**Razão:** Testes são mais confiáveis, menos frágeis, e documentam comportamento.

---

### Onde Teste é Melhor que Lint

| Regra | Teste | Lint | Recomendação |
|-------|-------|------|--------------|
| Default DENY | ✅ Fácil | ❌ Impossível | **Teste** |
| Policy enforcement antes de tool | ✅ Mock policy | ❌ Análise de fluxo | **Teste** |
| workspace_id em queries | ⚠️ Possível | ⚠️ Regex frágil | **Teste + Review** |
| Import boundaries | ❌ Difícil | ✅ Simples | **Lint (futuro)** |
| Guardrail comments | ❌ Impossível | ❌ Regex frágil | **Review** |

---

### Onde Code Review é Obrigatório

**Situações que SEMPRE requerem review humano:**

1. **Decisões arquiteturais** (ADRs)
2. **Mudanças em invariantes** (CORE.md, SECURITY.md)
3. **Novas policies** (POLICY_RULES.md)
4. **Bootstrap order** (main.go)
5. **Security-sensitive code** (auth, crypto, multi-tenancy)

**Razão:** Contexto e julgamento humano são insubstituíveis.

---

## Anti-Goals Explícitos

### ❌ NÃO Criar Framework Interno

**Anti-goal:** Criar framework customizado de enforcement (ex: "policy validator framework")

**Razão:**
- Overengineering
- Manutenção custosa
- Ferramentas padrão (Go test, golangci-lint) são suficientes

**Alternativa:** Usar ferramentas padrão + testes + code review

---

### ❌ NÃO Adicionar Tooling Pesado

**Anti-goal:** Adicionar ferramentas complexas (ex: SonarQube, custom AST parsers)

**Razão:**
- Slow CI
- Overhead de manutenção
- Falsos positivos

**Alternativa:** Testes bem escritos + linters leves (golangci-lint)

---

### ❌ NÃO Duplicar Regras em Múltiplos Lugares

**Anti-goal:** Ter regras em CORE.md, SECURITY.md, POLICY_RULES.md, CI config, e linter config

**Razão:**
- Inconsistência
- Difícil de manter
- Confusão

**Alternativa:**
- **Fonte de verdade:** Documentos normativos (CORE, SECURITY, POLICY)
- **Enforcement:** CI (testes) + PR template (checklist)
- **Validação:** Code review

---

### ❌ NÃO Enforçar 100% de Cobertura

**Anti-goal:** Exigir 100% de cobertura de testes em todo o código

**Razão:**
- Incentiva testes inúteis
- Foco em quantidade, não qualidade
- Diminishing returns

**Alternativa:**
- **Policy:** 80% de cobertura (crítico)
- **Core:** 70% de cobertura (importante)
- **Handlers:** 60% de cobertura (aceitável)
- **Foco:** Testes de comportamento, não linhas

---

## Estratégia de Enforcement (Resumo)

### Camada 1: CI Automático (Obrigatório)

- ✅ Testes unitários/Build passam
- ✅ Lint passa (golangci-lint)
- ✅ Security Check (`make security-check`)
- ✅ Testes de isolamento (RLS)
- ✅ Privacidade LLM (Hash-only)

**Gate:** CI DEVE passar antes de merge

---

### Camada 2: PR Template (Checklist)

- ✅ CORE Gate
- ✅ SECURITY Gate
- ✅ POLICY Gate
- ✅ Testes
- ✅ Documentação
- ✅ Impacto em produção

**Gate:** Checklist DEVE ser preenchido (não enforçado automaticamente, mas visível)

---

### Camada 3: Code Review (Humano)

- ✅ Import boundaries
- ✅ Bootstrap order
- ✅ Guardrail comments
- ✅ Decisões arquiteturais
- ✅ Security-sensitive code

**Gate:** Mínimo 1 aprovação de reviewer

---

## Evolução Futura (Roadmap)

### Resolvidos (Em Conformidade)

- ✅ **Testes de isolamento multi-tenant** (RLS)
- ✅ **Mecanismo de Security Gates** (`make security-check`)
- ✅ **Admin vs Client API Separation**
- ✅ **Execution ID Traceability**

### Médio Prazo (P1)

- [ ] **Rotação Automática de Segredos** (Key Rotation)
- [ ] **Políticas de Retenção LGPD** (Purge de Spans > 90 dias)
- [ ] **Adicionar linter para import boundaries**

- [ ] **Adicionar mutation testing** (validar qualidade de testes)
- [ ] **Adicionar security scanning** (gosec, dependabot)

---

## Referências

### Documentos Normativos
- [CORE.md](./CORE.md) - Invariantes arquiteturais
- [SECURITY.md](./SECURITY.md) - Linhas vermelhas de segurança
- [POLICY_RULES.md](./POLICY_RULES.md) - Padrão normativo de policies

### ADRs
- [ADR 0001](./adr/0001-core-boundaries-and-responsibilities.md) - Core Boundaries
- [ADR 0002](./adr/0002-policy-engine-namespace-model.md) - Policy Namespace Model
- [ADR 0004](./adr/0004-multi-tenancy-workspace-isolation.md) - Multi-Tenancy Isolation

### Outros
- [PRODUCTION_READINESS.md](./PRODUCTION_READINESS.md) - Critérios de produção
- [TESTING.md](./TESTING.md) - Estratégia de testes

---

## Checklist de Atualização

Este documento DEVE ser atualizado quando:

- [ ] Nova regra automática é adicionada ao CI
- [ ] Nova regra manual é identificada
- [ ] Ferramenta de enforcement é adicionada/removida
- [ ] Anti-goal é identificado
- [ ] Estratégia de enforcement muda
