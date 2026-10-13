# ADR 0002: Policy Engine Namespace Model

**Status:** Accepted

**Date:** 2026-01-26

---

## Context

The MCP-Go system executes commands from various domains (portfolio, CRM, agents). We need a scalable authorization model that:
- Allows domain-specific rules without coupling
- Prevents unauthorized command execution
- Is extensible for new domains
- Has clear ownership of policy logic

Early questions:
- Should we use a single monolithic policy function?
- Should each tool implement its own authorization?
- How do we handle commands without registered policies?
- What should the default behavior be (allow or deny)?

Without a clear model, we risk:
- **Policy bypass**: Tools without authorization.
- **Inconsistent enforcement**: Logic scattered across handlers.
- **Audit failure**: Decisions not linked to executions or identities.
- **Security vulnerabilities**: Attackers exploiting default-allow or conditional rules.

## Decision

We implement a **namespace-based policy model** with **default DENY**.

### 1. Prefix-Based Namespace Matching

**Rule:** Commands are matched to policies by prefix (e.g., `portfolio.*`, `mcp.*`).

**Rationale:**
- **Scalability:** Each domain owns its policy namespace
- **Separation of Concerns:** Portfolio policies don't know about MCP policies
- **Extensibility:** Adding new domain = register new namespace
- **Clear Ownership:** Namespace prefix indicates which team owns the policy

**Implementation:**
```go
policyEngine.RegisterNamespace("portfolio.", policies.EvaluatePortfolioPolicy)
policyEngine.RegisterNamespace("mcp.", policies.EvaluateMCPPolicy)
```

**Reference:** `cmd/mcp-client-server/main.go:50-52`

---

### 2. Default DENY

**Rule:** If no namespace is registered for a command, the decision is **DENY**.

**Rationale:**
- **Security by Default:** Unknown commands are rejected
- **Fail-Safe:** Missing policy = denied (not allowed)
- **Explicit Registration:** Forces developers to think about authorization
- **Auditability:** All allowed commands have explicit policies

**Implementation:**
```go
// internal/policy/engine.go:52-54
if !found {
    decision = Deny("global.default_deny", "no policy namespace registered for this command")
}
```

### 3. Execution-Linked Accounting (AAA)

**Rule:** Every policy decision MUST be linked to an `ExecutionID` and recorded in logs/audit events.

**Rationale:**
- **Accountability:** We must prove *why* a specific agent execution was allowed or denied.
- **Correlation:** Link policy decisions to LLM spans and error IDs for full-spectrum investigation.
- **Compliance:** AAA (Authentication, Authorization, Accounting) requires proof of audit.

**Implementation:**
- `PolicyEngine.Evaluate` receives `ctx.ExecutionID`.
- Decisions are logged as structured events with the associated `execution_id`.

**Reference:** `internal/policy/engine.go:45-55`

---

### 4. Technical Gate (Fail-Closed)

**Rule:** The Policy Engine is a **MANDATORY technical gate** enforced by the Runtime Executor. It is NOT optional.

**Rationale:**
- **Adversarial Design:** We assume attempts will be made to bypass the engine.
- **Fail-Closed:** If the evaluation fails or returns an error, execution ABORTS.

**Evidence:** `internal/mcp/runtime/executor_security_test.go` verifies that even a "forced zero" or bypass attempt fails.

### 3. No Tool Without Policy

**Rule:** Every tool MUST have a corresponding policy namespace registered BEFORE the tool is registered.

**Rationale:**
- **Prevents Orphan Tools:** Tool without policy = unusable (default DENY)
- **Forces Security Review:** Policy must be written before tool works
- **Clear Dependency:** Policy registration happens in bootstrap (visible)

**Implementation:**
```go
// cmd/mcp-client-server/main.go:50-55
// Policy FIRST
policyEngine.RegisterNamespace("portfolio.", policies.EvaluatePortfolioPolicy)
// Tool SECOND
toolRegistry.Register(mcpTools.NewPortfolioTool(portfolioService))
```

**Reference:** `cmd/mcp-client-server/main.go:50-55`

---

## Alternatives Considered

### Alternative 1: Single Monolithic Policy Function

```go
func EvaluatePolicy(ctx MCPContext, cmd MCPCommand) PolicyDecision {
    switch cmd.Name {
    case "portfolio.create": // ...
    case "portfolio.publish": // ...
    case "mcp.execute": // ...
    // 100+ cases...
    }
}
```

**Rejected because:**
- Doesn't scale (one giant function)
- Tight coupling (all domains in one file)
- Merge conflicts (everyone edits same file)
- Difficult to test (must test all domains together)

---

### Alternative 2: Tool-Level Authorization

```go
type MCPTool interface {
    Name() string
    Execute(ctx MCPContext, input map[string]any) (any, error)
    IsAuthorized(ctx MCPContext) bool // Each tool implements
}
```

**Rejected because:**
- Duplicates authorization logic across tools
- Inconsistent enforcement (each tool does it differently)
- Easy to forget (tool works without `IsAuthorized` check)
- Difficult to audit (authorization scattered across codebase)

---

## Prohibited Anti-Patterns

To maintain the integrity of the gate, the following are strictly forbidden:

1.  **Direct Tool Execution**: Executing a tool without calling `Executor.Execute` (bypasses policy).
2.  **Conditional Policies**: Policies that allow "by default" if a condition is met (violates fail-closed).
3.  **Unlinked Decisions**: Evaluations without a valid `ExecutionID` in context.
4.  **Bypass logic in Handlers**: Implementing "quick access" routes that avoid the Policy Engine.

---

## Consequences

### Positive

✅ **Scalable:** New domains add namespaces without touching existing policies  
✅ **Secure by Default:** Unknown commands are denied  
✅ **Clear Ownership:** Namespace prefix indicates domain ownership  
✅ **Testable:** Each namespace policy can be tested independently  
✅ **Auditable:** All authorization decisions are logged with policy name  

### Negative

⚠️ **Bootstrap Order Matters:** Policy must be registered before tool  
⚠️ **Namespace Collisions:** Must coordinate namespace prefixes (e.g., `portfolio.*` vs `portfolio-v2.*`)  
⚠️ **Verbosity:** Each domain needs a separate policy file  

### Neutral

- Namespaces are registered at startup (not runtime)
- Policy functions are stateless (receive context + command)

---

## Security/Compliance Notes

**Security Invariants:**
- **Default DENY:** Fail-safe if policy is missing
- **Central Registration:** All policies registered in `main.go` (visible)
- **Immutable at Runtime:** Namespaces cannot be added/removed after startup

**Compliance:**
- **Auditability:** All policy decisions are logged with policy name
- **Least Privilege:** Commands must have explicit policy to be allowed

**Security Debt:**
- ✅ **DEBT-001 (P0):** Resolved. JWT middleware validates audience and roles. Identity is typed via `tenant.Claims`.

**Reference:** `docs/SECURITY.md`, `docs/GOVERNANCE.md`

---

## Rollout / Migration Plan

**Status:** Already implemented (no migration needed).

**For Adding New Domain:**

1. Create policy file: `internal/policy/policies/<domain>.go`
2. Implement `RuleFunc`:
   ```go
   func Evaluate<Domain>Policy(ctx MCPContext, cmd MCPCommand) PolicyDecision {
       // Validate workspace_id (if domain-scoped)
       // Check permissions/roles
       // Return Allow or Deny
   }
   ```
3. Register namespace in `main.go` BEFORE tool:
   ```go
   policyEngine.RegisterNamespace("<domain>.", policies.Evaluate<Domain>Policy)
   ```
4. Add tests in `internal/policy/policies/<domain>_test.go`
5. Document in `docs/POLICY_RULES.md`

---

## How to Test

### Default DENY

```go
func TestPolicyEngine_DefaultDeny(t *testing.T) {
    engine := policy.NewEngine(logger)
    // No namespaces registered
    
    ctx := context.MCPContext{WorkspaceID: "ws-123"}
    cmd := command.MCPCommand{Name: "unknown.command"}
    
    decision := engine.Evaluate(ctx, cmd)
    
    assert.False(t, decision.Allowed)
    assert.Equal(t, "global.default_deny", decision.Policy)
}
```

### Namespace Matching

```go
func TestPolicyEngine_NamespaceMatching(t *testing.T) {
    engine := policy.NewEngine(logger)
    engine.RegisterNamespace("portfolio.", policies.EvaluatePortfolioPolicy)
    
    ctx := context.MCPContext{WorkspaceID: "ws-123", Type: "user"}
    cmd := command.MCPCommand{Name: "portfolio.create"}
    
    decision := engine.Evaluate(ctx, cmd)
    
    assert.True(t, decision.Allowed) // Portfolio policy allows create
    assert.Contains(t, decision.Policy, "portfolio.")
}
```

### Tool Without Policy

```go
func TestToolRegistry_ToolWithoutPolicy(t *testing.T) {
    policyEngine := policy.NewEngine(logger)
    // No namespace registered for "orphan"
    
    toolRegistry := registry.NewToolRegistry()
    toolRegistry.Register(NewOrphanTool()) // Tool registered
    
    executor := runtime.NewExecutor(toolRegistry, policyEngine, logger)
    cmd := command.MCPCommand{Name: "orphan.action"}
    
    _, err := executor.Execute(ctx, cmd, "ws-123", "user-456")
    
    // Should fail (default DENY)
    assert.Error(t, err)
    assert.Contains(t, err.Error(), "authorization denied")
}
```

---

## Compliance Evidence

Technical proof of adherence for ADR 0002:

- **Fail-Closed Engine**: `TestPolicyEngine_DefaultDeny` in `internal/policy/engine_test.go`.
- **Anti-Bypass Gate**: `internal/mcp/runtime/executor_security_test.go`.
- **Accounting Correlation**: `audit_events` table linked by `execution_id`.
- **Identity Gating**: `internal/http/middleware/admin_auth.go`.

---

*Last hardened: 2026-01*
