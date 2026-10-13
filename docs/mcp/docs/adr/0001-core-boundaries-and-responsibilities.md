# ADR 0001: Core Boundaries and Responsibilities

**Status:** Accepted

**Date:** 2026-01-26

---

## Context

The MCP-Go system is built around three core modules: Agent Layer, MCP Runtime, and Policy Engine. Each module has distinct responsibilities, and maintaining clear boundaries between them is critical for testability, security, and maintainability.

Early in the design, we faced questions about:
- Should the Agent Layer execute commands directly or just propose them?
- Should the MCP Runtime know about HTTP requests and responses?
- Where should policy enforcement happen?

Without clear boundaries, we risk:
- Coupling core logic to transport layer (HTTP)
- Bypassing security controls (policy checks)
- Difficulty testing components in isolation
- Unclear ownership of responsibilities

## Decision

We establish **strict boundaries** for each core module:

### 1. Agent Layer is Side-Effect Free

**Rule:** `internal/agents/` MUST NOT perform I/O operations (database, HTTP, file system).

**Rationale:**
- **Auditability:** Agent proposals must be reproducible. Side effects make this impossible.
- **Testability:** Pure functions are trivial to test without mocks.
- **Human-in-the-loop:** Agent only proposes; execution is separate and controlled.

**Implementation:**
- Agent receives input (natural language) and workspace context
- Returns `AgentResponse` with `AgentProposal` (non-executable)
- No database queries, no HTTP calls, no file I/O
- Only pure computation: parsing, extraction, confidence scoring

**Reference:** `internal/agents/agent.go:34-76`

---

### 2. MCP Runtime is Transport-Agnostic

**Rule:** `internal/mcp/` MUST NOT import `internal/http/` or depend on HTTP-specific types.

**Rationale:**
- **Reusability:** Runtime can be used from HTTP, gRPC, CLI, or tests.
- **Testability:** No need to mock HTTP requests to test execution logic.
- **Separation of Concerns:** Transport layer (HTTP) is an adapter, not core logic.

**Implementation:**
- Runtime consumes **contexto AAA** (typed `tenant.Claims`) and is **enforced by middleware**.
- Returns `MCPResult` (not HTTP response).
- HTTP handlers extract claims from JWT and propagate them as typed context.
- Runtime is **enforced by code structure** to operate within the provided tenant scope.
- **Fail-Closed**: If identity context is missing, the Runtime MUST abort.

**Reference:** `internal/mcp/runtime/executor.go:34-89`

---

### 3. Policy Engine is Mandatory (Central Enforcement)

**Rule:** ALL command executions MUST pass through `PolicyEngine.Evaluate` before tool execution.

**Rationale:**
- **Security:** Single point of enforcement prevents bypass.
- **Auditability:** All authorization decisions are logged.
- **Consistency:** Same rules apply regardless of caller.

**Implementation:**
- `MCP Runtime.Execute` calls `Policy.Evaluate` at line 40 (before tool resolution)
- If `PolicyDecision.Allowed == false`, execution stops with error
- No direct access to tools (tools are private to Runtime)

**Reference:** `internal/mcp/runtime/executor.go:40-43`

---

### 4. Storage Adapters: RLS Fail-Closed Enforcement

**Rule:** `internal/storage/` MUST NOT execute queries outside of a **Tenant-Scoped Unit of Work**.

**Rationale:**
- **Security:** Infrastructure-level isolation prevents human error (forgetting a `WHERE` clause).
- **Fail-Closed:** If the tenant context is not set, the DB returns zero results by design.

**Implementation:**
- Adapters use `postgres.BeginTenant` to start transactions.
- Sets `SET LOCAL app.current_workspace_id` within the session.
- **Multi-tenant enforced by DB** (RLS) instead of application-level logic.

**Reference:** `internal/storage/postgres/tenantdb.go`

---

## Hardened Enforcement (Jan/2026)

Since the original acceptance, the following security layers have been **enforced by technical gates**:

### 1. Fail-Closed Security Gates
- All security-critical code paths (Policy Engine, Runtime) are guarded by **Security Check Gates**.
- **Evidence**: `internal/mcp/runtime/executor_security_test.go` proves that any bypass attempt leads to immediate failure.
- **CI Enforcement**: `make security-check` is mandatory for all PRs.

### 2. Audience Gating
- Separation between **Client API** (`mcp-client`) and **Admin API** (`mcp-admin`) is enforced at the JWT layer.
- Admin routes require specific audience and administrative roles (`type=system` or `admin` role).

### 3. Execution ID as a First-Class Primitive
- **Obrigatoriedade**: Toda execução gerada pelo Runtime ou chamada LLM deve possuir um `ExecutionID` único.
- **Correlação AAA**: Oid é a chave central para vincular: `Request -> Execution -> LLM Spans -> Audit Events -> Error ID`.
- **Reference**: `internal/execution`

### 4. Privacy-First LLM Boundary
- The **GovernedClient** acts as the strict boundary for all AI interactions.
- **Data Privacy**: Storing raw prompts or responses in standard logs or spans is **strictly prohibited**.
- **Audit Prova**: Only SHA-256 hashes are persisted in `llm_spans`.
- **Reference**: `internal/llm/runtime` and `governed_security_test.go`.

---

## Alternatives Considered

### Alternative 1: Agent Executes Commands Directly

**Rejected because:**
- Breaks human-in-the-loop pattern
- Makes Agent stateful (needs DB access)
- Couples Agent to execution infrastructure
- Difficult to audit what Agent "would have done" vs "did"

### Alternative 2: HTTP Handlers Call Tools Directly

**Rejected because:**
- Bypasses policy enforcement
- Duplicates authorization logic in every handler
- Tight coupling between HTTP and domain logic
- Impossible to reuse tools from non-HTTP contexts

### Alternative 3: Optional Policy Check

**Rejected because:**
- Creates security vulnerability (bypass risk)
- Inconsistent enforcement
- Difficult to audit which commands were checked

---

## Consequences

### Positive

✅ **Clear Ownership:** Each module has well-defined responsibilities  
✅ **Testability:** Core modules can be tested without HTTP server  
✅ **Security:** Policy enforcement is mandatory and centralized  
✅ **Auditability:** Agent proposals are reproducible (no side effects)  
✅ **Reusability:** Runtime can be used from multiple transports  

### Negative

⚠️ **Indirection:** HTTP → Handler → Service → Runtime (more layers)  
⚠️ **Context Propagation:** Must manually pass `workspaceID`/`userID` through layers  
⚠️ **Learning Curve:** Developers must understand boundary rules  

### Neutral

- More files/packages (one per module)
- Explicit interfaces between modules

---

## Security/Compliance Notes

**Security Invariants:**
- Agent Layer cannot bypass policy (no execution capability).
- MCP Runtime cannot be called without policy check (**enforced by code structure**).
- HTTP layer cannot leak into core (import restrictions).
- **Multi-tenant isolation is enforced by DB** through RLS fail-closed.
- **Privacy-First**: No PII/raw data persistence in LLM spans.

**Compliance:**
- **Accounting**: Full traceability via `execution_id`.
- **Integrity**: Payload hashes for security audit events.

**Reference:** `docs/SECURITY.md`, `docs/GOVERNANCE.md`

---

## Compliance Evidence

The following files and targets provide the technical proof of adherence to this ADR:

- **Security Checks**: `make security-check` in [Makefile](file:///g:/github-crm-projects/mcp-go/Makefile)
- **Anti-Bypass Enforcement**: [executor_security_test.go](file:///g:/github-crm-projects/mcp-go/internal/mcp/runtime/executor_security_test.go)
- **Privacy-First Enforcement**: [governed_security_test.go](file:///g:/github-crm-projects/mcp-go/internal/llm/runtime/governed_security_test.go)
- **Ownership Gating**: [workspace_ownership.go](file:///g:/github-crm-projects/mcp-go/internal/http/middleware/workspace_ownership.go)
- **RLS Fail-Closed**: [tenantdb.go](file:///g:/github-crm-projects/mcp-go/internal/storage/postgres/tenantdb.go)

---

*Last hardened: 2026-01*

---

## How to Test

### Agent Layer (Side-Effect Free)

```go
func TestAgent_Interpret_NoSideEffects(t *testing.T) {
    agent := agents.NewAgent(nil, logger)
    
    // Call multiple times with same input
    resp1 := agent.Interpret(ctx, "liste portfolio", "ws-123")
    resp2 := agent.Interpret(ctx, "liste portfolio", "ws-123")
    
    // Results should be identical (pure function)
    assert.Equal(t, resp1.Confidence, resp2.Confidence)
    assert.Equal(t, resp1.Proposal.Intent, resp2.Proposal.Intent)
}
```

### MCP Runtime (Transport-Agnostic)

```go
func TestRuntime_Execute_NoHTTPDependency(t *testing.T) {
    // Can call Runtime without HTTP server
    executor := runtime.NewExecutor(registry, policyEngine, logger)
    
    cmd := command.MCPCommand{Name: "portfolio", Input: map[string]any{"action": "list"}}
    result, err := executor.Execute(ctx, cmd, "ws-123", "user-456")
    
    assert.NoError(t, err)
    assert.NotNil(t, result.Data)
}
```

### Policy Enforcement (Mandatory)

```go
func TestRuntime_Execute_PolicyCheckMandatory(t *testing.T) {
    // Mock policy engine that denies
    mockPolicy := &MockPolicyEngine{decision: policy.Deny("test", "denied")}
    executor := runtime.NewExecutor(registry, mockPolicy, logger)
    
    cmd := command.MCPCommand{Name: "portfolio", Input: map[string]any{}}
    _, err := executor.Execute(ctx, cmd, "ws-123", "user-456")
    
    // Execution should fail (policy denied)
    assert.Error(t, err)
    assert.Contains(t, err.Error(), "authorization denied")
}
```

---

## References

### Code
- Agent Layer: `internal/agents/agent.go`
- MCP Runtime: `internal/mcp/runtime/executor.go:34-89`
- Policy Engine: `internal/policy/engine.go:32-73`
- HTTP Handlers: `internal/http/handlers/agent_gateway.go`

### Documentation
- [CORE.md](../CORE.md) - Invariantes Globais #3, #4
- [SECURITY.md](../SECURITY.md) - Linhas Vermelhas #1, #5
