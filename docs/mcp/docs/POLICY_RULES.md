# Policy Rules - Padrão Normativo e Operacional

## Objetivo

Este documento é o **PADRÃO NORMATIVO** para policies no MCP-Go. Define regras não-negociáveis, procedimentos operacionais, matriz de testes obrigatórios, e gates de PR para garantir que policy enforcement seja consistente, testado, e production-ready.

## Escopo

**Inclui:**
- Regras normativas (não-negociáveis)
- Catálogo completo de namespaces e regras
- Procedimento passo-a-passo para adicionar policies/tools
- Matriz de testes obrigatórios
- Policy Change Gate (checklist de PR)
- Critérios de production readiness

**Não Inclui:**
- Implementação do Policy Engine (ver [CORE.md](./CORE.md))
- Modelo de segurança geral (ver [SECURITY.md](./SECURITY.md))
- Detalhes de ADRs (ver [adr/0002-policy-engine-namespace-model.md](./adr/0002-policy-engine-namespace-model.md))

---

## Regras Normativas (NÃO NEGOCIÁVEIS)

Estas regras DEVEM ser respeitadas em TODOS os Pull Requests:

### 1. Policy Default é DENY

**Regra:** Se nenhum namespace é registrado para um comando, a decisão é **DENY**.

**Localização:** `internal/policy/engine.go:52-54`

**Razão:** Fail-safe. Comandos desconhecidos são rejeitados por padrão.

**Violação:** Mudar default para ALLOW é **PROIBIDO** (vulnerabilidade de segurança).

**Referência:** [ADR 0002](./adr/0002-policy-engine-namespace-model.md), [CORE.md](./CORE.md) - Invariante Global #7

---

### 2. Nenhuma Tool Entra sem Policy Correspondente

**Regra:** Toda tool DEVE ter um namespace de policy registrado ANTES da tool ser registrada.

**Localização:** `cmd/mcp-client-server/main.go:50-55`

**Razão:** Tool sem policy = default DENY = tool inutilizável. Força security review.

**Ordem Obrigatória:**
```go
// 1. Policy PRIMEIRO
policyEngine.RegisterNamespace("domain.", policies.EvaluateDomainPolicy)

// 2. Tool DEPOIS
toolRegistry.Register(tools.NewDomainTool(service))
```

**Violação:** Registrar tool sem policy correspondente é **PROIBIDO**.

**Referência:** [ADR 0002](./adr/0002-policy-engine-namespace-model.md)

---

### 3. Namespaces Devem Ser Registrados Antes das Tools (Bootstrap Order)

**Regra:** No bootstrap (`cmd/mcp-client-server/main.go`), namespaces DEVEM ser registrados ANTES de tools.

**Razão:** Tool registration pode falhar se policy não existir. Bootstrap order matters.

**Validação:** Code review DEVE verificar ordem de registro.

**Referência:** [ADR 0002](./adr/0002-policy-engine-namespace-model.md)

---

### 4. Policies de Domínio DEVEM Validar workspace_id

**Regra:** Policies para comandos domain-scoped (ex: `portfolio.*`) DEVEM validar `ctx.WorkspaceID != ""`.

**Localização:** `internal/policy/policies/portfolio.go:12-14`

**Razão:** Multi-tenancy obrigatório. Workspace vazio = cross-tenant risk.

**Exemplo:**
```go
func EvaluatePortfolioPolicy(ctx context.MCPContext, cmd command.MCPCommand) policy.PolicyDecision {
    // OBRIGATÓRIO para policies de domínio
    if ctx.WorkspaceID == "" {
        return policy.Deny("portfolio.workspace_required", "workspace_id is missing in context")
    }
    // ...
}
```

**Violação:** Omitir validação de workspace_id em policy de domínio é **PROIBIDO**.

**Referência:** [SECURITY.md](./SECURITY.md) - Linhas Vermelhas #2

---

### 5. Policies Sensíveis DEVEM Exigir ApprovedByHuman Quando Aplicável

**Regra:** Policies para ações sensíveis (ex: `publish`, `delete`, `execute`) DEVEM verificar `ctx.Type` ou exigir aprovação humana.

**Localização:** `internal/policy/policies/portfolio.go:29-30`

**Razão:** Ações destrutivas ou públicas não devem ser executadas por agents sem supervisão.

**Exemplo:**
```go
func evaluatePublish(ctx context.MCPContext) policy.PolicyDecision {
    // OBRIGATÓRIO para ações sensíveis
    if ctx.Type == "agent" {
        return policy.Deny("portfolio.publish.human_only", "agents are not allowed to publish")
    }
    return policy.Allow("portfolio.publish.ok", "publication authorized for human user")
}
```

**Violação:** Permitir agents executarem ações sensíveis sem check é **PROIBIDO**.

---

### 6. Policy Changes Exigem Testes

**Regra:** TODA mudança em policy (nova regra, modificação de critério, novo namespace) DEVE incluir testes.

**Localização:** `internal/policy/policies/*_test.go`

**Razão:** Policy sem testes = risco de bypass ou regressão.

**Testes Mínimos:**
- Caso positivo (ALLOW esperado)
- Caso negativo (DENY esperado)
- Edge cases (workspace vazio, type inválido, etc)

**Violação:** PR que modifica policy sem testes DEVE ser rejeitado.

**Referência:** Ver seção "Matriz de Testes Obrigatórios" abaixo.

---

## Catálogo de Namespaces e Regras

### 1. Portfolio Namespace (`portfolio.*`)

**Localização:** `internal/policy/policies/portfolio.go`

**Regras:**

#### `portfolio.workspace_required`
**Trigger:** Todos os comandos `portfolio.*`  
**Critério:** `ctx.WorkspaceID != ""`  
**Decisão:** DENY se workspace_id vazio  
**Razão:** Multi-tenancy obrigatório  
**Testes:** `internal/policy/policies/portfolio_test.go` (TODO: implementar)

#### `portfolio.publish.human_only`
**Trigger:** Comando `portfolio.publish`  
**Critério:** `ctx.Type != "agent"`  
**Decisão:** DENY se Type == "agent"  
**Razão:** Apenas humanos podem publicar itens  
**Testes:** `internal/policy/policies/portfolio_test.go` (TODO: implementar)

#### `portfolio.create.ok`
**Trigger:** Comando `portfolio.create`  
**Critério:** Workspace válido  
**Decisão:** ALLOW  
**Razão:** Criação permitida com workspace  
**Testes:** `internal/policy/policies/portfolio_test.go` (TODO: implementar)

#### `portfolio.default_allow`
**Trigger:** Outros comandos `portfolio.*`  
**Critério:** Workspace válido  
**Decisão:** ALLOW  
**Razão:** Leitura permitida com workspace  
**Testes:** `internal/policy/policies/portfolio_test.go` (TODO: implementar)

---

### 2. MCP Namespace (`mcp.*`)

**Localização:** `internal/policy/policies/mcp.go`

**Regras:**

#### `mcp.execute.privileged`
**Trigger:** Comando `mcp.execute`  
**Critério:** `ctx.Type == "admin" || ctx.Source == "system"`  
**Decisão:** ALLOW se admin ou system  
**Razão:** Apenas privilegiados podem executar comandos arbitrários  
**Testes:** `internal/policy/policies/mcp_test.go` (TODO: implementar)

#### `mcp.default_deny`
**Trigger:** Outros comandos `mcp.*`  
**Critério:** Nenhum  
**Decisão:** DENY  
**Razão:** Comandos MCP internos são restritos  
**Testes:** `internal/policy/policies/mcp_test.go` (TODO: implementar)

---

### 3. Global Default

**Regra:** `global.default_deny`  
**Trigger:** Nenhum namespace registrado para o comando  
**Decisão:** DENY  
**Razão:** Segurança por padrão  
**Localização:** `internal/policy/engine.go:52-54`  
**Testes:** `internal/policy/policy_test.go`

---

## Como Adicionar um Novo Namespace de Policy (Passo a Passo)

### Passo 1: Criar Arquivo de Policy

**Arquivo:** `internal/policy/policies/<domain>.go`

**Template:**
```go
package policies

import (
    "github.com/linkkotech/mcp-go/internal/mcp/command"
    "github.com/linkkotech/mcp-go/internal/mcp/context"
    "github.com/linkkotech/mcp-go/internal/policy"
)

// Evaluate<Domain>Policy avalia regras para o namespace <domain>.*
func Evaluate<Domain>Policy(ctx context.MCPContext, cmd command.MCPCommand) policy.PolicyDecision {
    // OBRIGATÓRIO: Validar workspace_id para policies de domínio
    if ctx.WorkspaceID == "" {
        return policy.Deny("<domain>.workspace_required", "workspace_id is missing in context")
    }

    // Switch por comando
    switch cmd.Name {
    case "<domain>.<action>":
        return evaluate<Action>(ctx, cmd)
    default:
        // Default para namespace (ALLOW ou DENY dependendo do domínio)
        return policy.Allow("<domain>.default_allow", "basic access granted")
    }
}

func evaluate<Action>(ctx context.MCPContext, cmd command.MCPCommand) policy.PolicyDecision {
    // Lógica de autorização específica
    
    // Exemplo: verificar Type para ações sensíveis
    if ctx.Type == "agent" {
        return policy.Deny("<domain>.<action>.agent_denied", "agents cannot perform this action")
    }
    
    // Exemplo: verificar Roles
    // if !contains(ctx.Roles, "admin") {
    //     return policy.Deny("<domain>.<action>.admin_only", "admin role required")
    // }
    
    return policy.Allow("<domain>.<action>.ok", "action authorized")
}
```

---

### Passo 2: Registrar Namespace no Bootstrap

**Arquivo:** `cmd/mcp-client-server/main.go`

**Localização:** Após criação de `policyEngine`, ANTES de `toolRegistry.Register()`

**Código:**
```go
// Policy Engine setup
policyEngine := policy.NewEngine(logger)

// Register namespaces (ORDEM IMPORTA: antes de tools)
policyEngine.RegisterNamespace("portfolio.", policies.EvaluatePortfolioPolicy)
policyEngine.RegisterNamespace("mcp.", policies.EvaluateMCPPolicy)
policyEngine.RegisterNamespace("<domain>.", policies.Evaluate<Domain>Policy) // NOVO

// Tool Registry setup (DEPOIS de policies)
toolRegistry := registry.NewToolRegistry()
toolRegistry.Register(mcpTools.NewPortfolioTool(portfolioService))
toolRegistry.Register(mcpTools.New<Domain>Tool(domainService)) // NOVO
```

**Validação:** Namespace DEVE ser registrado ANTES da tool correspondente.

---

### Passo 3: Criar/Atualizar Testes

**Arquivo:** `internal/policy/policies/<domain>_test.go`

**Template:**
```go
package policies

import (
    "testing"

    "github.com/linkkotech/mcp-go/internal/mcp/command"
    "github.com/linkkotech/mcp-go/internal/mcp/context"
    "github.com/stretchr/testify/assert"
)

func TestEvaluate<Domain>Policy_WorkspaceRequired(t *testing.T) {
    // OBRIGATÓRIO: testar validação de workspace_id
    ctx := context.MCPContext{WorkspaceID: ""} // Vazio
    cmd := command.MCPCommand{Name: "<domain>.action"}
    
    decision := Evaluate<Domain>Policy(ctx, cmd)
    
    assert.False(t, decision.Allowed)
    assert.Equal(t, "<domain>.workspace_required", decision.Policy)
}

func TestEvaluate<Domain>Policy_<Action>_Allow(t *testing.T) {
    // OBRIGATÓRIO: testar caso positivo (ALLOW)
    ctx := context.MCPContext{WorkspaceID: "ws-123", Type: "user"}
    cmd := command.MCPCommand{Name: "<domain>.<action>"}
    
    decision := Evaluate<Domain>Policy(ctx, cmd)
    
    assert.True(t, decision.Allowed)
    assert.Contains(t, decision.Policy, "<domain>.<action>.ok")
}

func TestEvaluate<Domain>Policy_<Action>_Deny(t *testing.T) {
    // OBRIGATÓRIO: testar caso negativo (DENY)
    ctx := context.MCPContext{WorkspaceID: "ws-123", Type: "agent"}
    cmd := command.MCPCommand{Name: "<domain>.<action>"}
    
    decision := Evaluate<Domain>Policy(ctx, cmd)
    
    assert.False(t, decision.Allowed)
    assert.Contains(t, decision.Policy, "<domain>.<action>.agent_denied")
}
```

**Executar Testes:**
```bash
go test ./internal/policy/policies/<domain>_test.go -v
```

---

### Passo 4: Atualizar Este Documento (Catálogo)

Adicionar nova seção em "Catálogo de Namespaces e Regras" acima com:
- Namespace prefix
- Localização do arquivo
- Lista de regras (trigger, critério, decisão, razão)
- Referência aos testes

---

### Passo 5: Validar Default Deny e Negative Cases

**Testes Obrigatórios:**

1. **Default DENY para comando desconhecido:**
   ```go
   func TestPolicyEngine_DefaultDeny_<Domain>(t *testing.T) {
       engine := policy.NewEngine(logger)
       // NÃO registrar namespace <domain>
       
       ctx := context.MCPContext{WorkspaceID: "ws-123"}
       cmd := command.MCPCommand{Name: "<domain>.unknown"}
       
       decision := engine.Evaluate(ctx, cmd)
       
       assert.False(t, decision.Allowed)
       assert.Equal(t, "global.default_deny", decision.Policy)
   }
   ```

2. **Tool sem policy falha:**
   ```go
   func TestToolRegistry_ToolWithoutPolicy_<Domain>(t *testing.T) {
       policyEngine := policy.NewEngine(logger)
       // NÃO registrar namespace <domain>
       
       toolRegistry := registry.NewToolRegistry()
       toolRegistry.Register(New<Domain>Tool(service))
       
       executor := runtime.NewExecutor(toolRegistry, policyEngine, logger)
       cmd := command.MCPCommand{Name: "<domain>.action"}
       
       _, err := executor.Execute(ctx, cmd, "ws-123", "user-456")
       
       assert.Error(t, err)
       assert.Contains(t, err.Error(), "authorization denied")
   }
   ```

---

## Matriz de Testes Obrigatórios

| Categoria de Policy | Testes Mínimos (Given/When/Then) | Arquivo de Teste | Erro/Status Esperado |
|---------------------|----------------------------------|------------------|----------------------|
| **Workspace Required** | **Given:** workspace_id vazio<br>**When:** executar comando de domínio<br>**Then:** DENY com policy `<domain>.workspace_required` | `internal/policy/policies/<domain>_test.go` | Policy DENY |
| **Human-Only / Approval Required** | **Given:** ctx.Type == "agent"<br>**When:** executar ação sensível (publish, delete)<br>**Then:** DENY com policy `<domain>.<action>.human_only` | `internal/policy/policies/<domain>_test.go` | Policy DENY → HTTP 403 |
| **Privileged/Admin/System Only** | **Given:** ctx.Type == "user" (não admin)<br>**When:** executar comando privilegiado (mcp.execute)<br>**Then:** DENY com policy `<domain>.<action>.forbidden` | `internal/policy/policies/mcp_test.go` | Policy DENY → HTTP 403 |
| **Default Deny (No Namespace)** | **Given:** namespace não registrado<br>**When:** executar comando desconhecido<br>**Then:** DENY com policy `global.default_deny` | `internal/policy/policy_test.go` | Policy DENY → HTTP 403 |
| **Tool Not Found / Namespace Mismatch** | **Given:** tool registrado sem policy<br>**When:** executar comando da tool<br>**Then:** DENY (default) → erro "authorization denied" | `internal/mcp/runtime/executor_test.go` | Policy DENY → HTTP 403 |
| **Positive Case (ALLOW)** | **Given:** contexto válido (workspace, type correto)<br>**When:** executar comando autorizado<br>**Then:** ALLOW com policy `<domain>.<action>.ok` | `internal/policy/policies/<domain>_test.go` | Policy ALLOW → HTTP 200 |

**Cobertura Mínima:** 100% das regras de policy DEVEM ter testes positivos e negativos.

---

## Policy Change Gate (Checklist de PR)

### Para PRs que Tocam `internal/policy/**`

- [ ] **Testes adicionados/atualizados** para TODAS as regras modificadas
- [ ] **Testes positivos** (ALLOW esperado) incluídos
- [ ] **Testes negativos** (DENY esperado) incluídos
- [ ] **Edge cases** testados (workspace vazio, type inválido, etc)
- [ ] **Default DENY mantido** (verificar `internal/policy/engine.go:52-54`)
- [ ] **Catálogo atualizado** neste documento (seção "Namespaces Registrados")
- [ ] **Invariantes respeitados** (ver [CORE.md](./CORE.md), [SECURITY.md](./SECURITY.md))
- [ ] **CI passa** (todos os testes de policy)

---

### Para PRs que Tocam `internal/mcp/**` (Executor/Tool Registry)

- [ ] **Policy check NÃO foi bypassado** (verificar `internal/mcp/runtime/executor.go:40-43`)
- [ ] **Testes de policy enforcement** adicionados/atualizados
- [ ] **Mock policy engine** usado em testes (testar DENY)
- [ ] **Default DENY mantido** (nenhum allow sem policy)
- [ ] **Invariantes respeitados** (ver [CORE.md](./CORE.md) - Invariante Global #1)

---

### Para PRs que Tocam `internal/mcp/tools/**`

- [ ] **Policy namespace correspondente existe** (verificar `cmd/mcp-client-server/main.go`)
- [ ] **Namespace registrado ANTES de tool** (bootstrap order)
- [ ] **Testes de policy para a tool** adicionados
- [ ] **Tool sem policy testado** (deve falhar com default DENY)
- [ ] **Documentação atualizada** ([POLICY_RULES.md](./POLICY_RULES.md), [API.md](./API.md))

---

### Para PRs que Tocam `cmd/mcp-client-server/main.go` (Bootstrap Order)

- [ ] **Namespaces registrados ANTES de tools** (ordem validada)
- [ ] **Todos os namespaces têm testes** (verificar `internal/policy/policies/*_test.go`)
- [ ] **Todas as tools têm policy correspondente** (1:1 mapping)
- [ ] **Comentários explicam ordem** (ex: "// Policy FIRST, Tool SECOND")
- [ ] **CI passa** (bootstrap não quebra)

---

## Production Readiness (Policy/Enforcement)

### Critérios Mínimos para Production (Policy Enforcement)

Para considerar o **policy enforcement** production-ready, os seguintes critérios DEVEM ser atendidos:

#### 1. Default DENY Testado

- [ ] Teste `TestPolicyEngine_DefaultDeny` existe e passa
- [ ] Comando sem namespace registrado retorna `global.default_deny`
- [ ] CI falha se default DENY for removido

**Validação:** `internal/policy/policy_test.go`

---

#### 2. Namespaces Registrados e Cobertos por Testes

- [ ] TODOS os namespaces em `cmd/mcp-client-server/main.go` têm arquivo de teste correspondente
- [ ] Cobertura de testes: 100% das regras de policy
- [ ] Testes positivos (ALLOW) e negativos (DENY) para cada regra

**Validação:** `go test ./internal/policy/... -cover` → coverage ≥ 80%

---

#### 3. Tool sem Policy Não Passa

- [ ] Teste `TestToolRegistry_ToolWithoutPolicy` existe e passa
- [ ] Tool registrado sem namespace correspondente falha com "authorization denied"
- [ ] CI detecta tools órfãs (sem policy)

**Validação:** `internal/mcp/runtime/executor_test.go`

---

#### 4. Policy Enforcement Antes de Tool Execution Comprovado em Testes

- [ ] Teste `TestRuntime_Execute_PolicyCheckMandatory` existe e passa
- [ ] Mock policy engine que nega → execução falha (não chega na tool)
- [ ] Policy check acontece ANTES de tool resolution (linha 40 do executor.go)

**Validação:** `internal/mcp/runtime/executor_test.go`

---

#### 5. Bootstrap Order Validado

- [ ] Namespaces registrados ANTES de tools em `main.go`
- [ ] Comentários explicam ordem obrigatória
- [ ] Testes de integração validam bootstrap (TODO: implementar)

**Validação:** Code review manual + comentários em `cmd/mcp-client-server/main.go`

---

### Dependências Externas (Não Bloqueantes para Policy Enforcement)

⚠️ **DEBT-001 (P0): JWT Authentication Ausente**

**Impacto em Policy Enforcement:**
- `ctx.Type` e `ctx.Roles` são confiados do input (não validados)
- Policies que dependem de Type/Roles (ex: `mcp.execute.privileged`, `portfolio.publish.human_only`) **não são seguras** sem JWT

**Status:** Policy enforcement funciona, mas **não é secure** sem JWT.

**Mitigação Planejada:** Implementar JWT middleware (DEBT-001) para validar Type/Roles de token claims.

**Critério de "Secure Production":**
- [ ] DEBT-001 resolvido (JWT auth implementado)
- [ ] Type e Roles extraídos de JWT (não confiados do input)
- [ ] Testes de policy com JWT válido/inválido

**Referência:** [SECURITY.md](./SECURITY.md) - DEBT-001

---

### Checklist de Production Readiness (Policy Enforcement)

**Mínimo para Deploy (Policy Enforcement Funcional):**
- [x] Default DENY testado
- [x] Namespaces registrados (portfolio, mcp)
- [ ] **Testes de policy implementados** (TODO: P0)
- [x] Policy enforcement antes de tool execution (código implementado)
- [x] Bootstrap order correto (namespaces antes de tools)

**Mínimo para Secure Production (Policy Enforcement Seguro):**
- [ ] **DEBT-001 resolvido** (JWT auth) - **BLOCKER**
- [ ] **Testes de policy implementados** (TODO: P0) - **BLOCKER**
- [ ] Type/Roles validados de JWT (não confiados)
- [ ] Testes de isolamento multi-tenant (DEBT-002) - **BLOCKER**

---

## Estrutura de PolicyDecision

```go
type PolicyDecision struct {
    Allowed bool   // true = ALLOW, false = DENY
    Policy  string // Nome da policy (ex: "portfolio.publish.human_only")
    Reason  string // Explicação da decisão
}
```

**Helpers:**
- `policy.Allow(policyName, reason)` → `PolicyDecision{Allowed: true, ...}`
- `policy.Deny(policyName, reason)` → `PolicyDecision{Allowed: false, ...}`

---

## Referências no Código

- Engine: `internal/policy/engine.go`
- Portfolio policies: `internal/policy/policies/portfolio.go`
- MCP policies: `internal/policy/policies/mcp.go`
- Registration: `cmd/mcp-client-server/main.go:50-52`
- Executor (policy check): `internal/mcp/runtime/executor.go:40-43`

---

## Referências Externas

- [CORE.md](./CORE.md) - Policy Engine section, Invariantes Globais #1, #7
- [SECURITY.md](./SECURITY.md) - Linhas Vermelhas #4, Threat Model 2.1, 2.2, DEBT-001
- [ADR 0002](./adr/0002-policy-engine-namespace-model.md) - Policy Engine Namespace Model
- [API.md](./API.md) - HTTP status codes (403 Forbidden, 422 Unprocessable Entity)

---

## Checklist de Atualização

Este documento DEVE ser atualizado quando:

- [ ] Novo namespace é adicionado
- [ ] Nova regra é implementada em namespace existente
- [ ] Critério de avaliação de regra muda
- [ ] Policy é removida ou deprecated
- [ ] Testes de policy são adicionados/modificados
- [ ] Production readiness criteria mudam
- [ ] Security debt relacionado a policy é resolvido
