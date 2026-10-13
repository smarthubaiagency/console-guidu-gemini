# ADR 0004: Multi-Tenancy Workspace Isolation

**Status:** Accepted

**Date:** 2026-01-26

---

## Context

MCP-Go is a **multi-tenant system** where multiple organizations (workspaces) share the same infrastructure. Each workspace must be **completely isolated** from others:
- Workspace A cannot see data from Workspace B
- Workspace A cannot modify data from Workspace B
- Workspace A cannot execute commands in Workspace B's context

Without proper isolation, we risk:
- **Cross-tenant data leakage**: GDPR/LGPD violation, total loss of corporate trust.
- **Inadvertent Data Corruption**: Workspace A mutating Workspace B's state.
- **Compliance Failure**: Violation of SOC2/ISO 27001 mandatory isolation.
- **Developer Error**: Forgetting a filtering clause in a complex join.

We need a **fail-closed infrastructure mandate** that makes cross-tenant access technically impossible.

We implement **PostgreSQL Row Level Security (RLS)** with a **Fail-Closed** mandate.

### 1. DB-Enforced RLS (Fail-Closed)

**Rule:** Every table containing tenant data MUST have RLS enabled and a `FORCE ROW LEVEL SECURITY` policy.

**Rationale:**
- **Infrastructural Enforcement**: Isolation is handled by the DB engine, not the application.
- **Fail-Closed**: If the tenant context (`app.current_workspace_id`) is missing, the DB returns **ZERO rows** by design.
- **Defense in Depth**: Prevents leakage even if a developer forgets a `WHERE` clause in the Go code.

**Implementation:**
```sql
ALTER TABLE portfolio_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE portfolio_items FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON portfolio_items
    USING (workspace_id = current_setting('app.current_workspace_id', true)::uuid);
```

**Reference:** `internal/storage/postgres/portfolio_repo.go:22-33`

---

### 2. Tenant-Scoped Unit of Work (BeginTenant)

**Rule:** All repository operations MUST be executed within a transaction initiated by `postgres.BeginTenant`.

**Rationale:**
- **Mandatory Context**: Ensures `SET LOCAL app.current_workspace_id` is called before any DML/Query.
- **Fail-Closed**: If `BeginTenant` fails, the transaction is never started, and no data is accessed.

**Implementation:**
```go
tx, err := postgres.BeginTenant(ctx, db.Pool)
if err != nil {
    return nil, err // Access denied (Fail-Closed)
}
```

**Reference:** `internal/storage/postgres/tenantdb.go`

---

### 4. MCPContext Carries workspace_id (Immutable)

**Rule:** `workspace_id` is included in `MCPContext` and cannot be modified after creation.

**Rationale:**
- **Immutability:** Prevents accidental modification during execution
- **Auditability:** workspace_id in logs is guaranteed to match execution context
- **Propagation:** Passed through all layers (HTTP → Service → Runtime → Tool → Storage)

**Reference:** `internal/mcp/context/envelope.go:10-32`

---

## Alternatives Considered

### Alternative 2: Separate Database Per Workspace
(Rejected due to operational overhead and lack of cross-tenant admin capabilities).

### Alternative 3: Application-Level Filtering Only
(Rejected as unsafe; one forgotten filter leads to P0 data leakage).

---

### Alternative 3: Application-Level Filtering Only

Trust application code to filter by workspace_id (no DB enforcement).

**Rejected because:**
- **Single Point of Failure:** One forgotten filter = data leakage
- **No Defense in Depth:** If app logic fails, no backup
- **Difficult to Audit:** Must review every query manually

---

## Consequences

### Positive

✅ **Infrastructure-Level Security**: DB denies access if tenant context is missing.
✅ **Developer-Proof**: Forgetting a `WHERE` clause no longer causes a leak.
✅ **AAA Compliance**: Isolation is provable and auditable at the engine level.
✅ **Fail-Closed**: System defaults to empty results on any context error.

⚠️ **Indirection**: Requires strict usage of `BeginTenant` transactions.

### Neutral

- Guardrail comments add verbosity to code
- Repository methods have extra parameter (workspace_id)

---

## Security/Compliance Notes

**Security Invariant:** Multi-tenant isolation MUST be enforced by **RLS + Force SQL Security**.

**Evidence**: `migrations/000003_llm_governance_and_audit.up.sql` (RLS policies).

---

**Security Debt:**
- ✅ **DEBT-002 (P0):** Resolved. Isolation tests implemented in `rls_test.go` and repo tests.
- ✅ **DEBT-003 (P0):** Resolved. Versioned migrations implemented using `golang-migrate`.

**Reference:** `docs/SECURITY.md`, `docs/GOVERNANCE.md`

---

### Compliance

**GDPR/LGPD:**
- Workspace isolation prevents cross-tenant data access
- Each workspace is a separate "data controller"

**SOC2 / ISO 27001:**
- Logical separation of tenant data
- Audit trail (workspace_id in all logs)

---

## Rollout / Migration Plan

**Status:** Already implemented (no migration needed).

**Future Enhancement: Database-Level RLS (P1)**

**Phase 1: Add RLS Policies**
1. Create migration:
   ```sql
   -- Enable RLS on all tables
   ALTER TABLE portfolio_items ENABLE ROW LEVEL SECURITY;
   
   -- Create policy
   CREATE POLICY workspace_isolation ON portfolio_items
       USING (workspace_id = current_setting('app.workspace_id')::uuid);
   ```

2. Update DB connection to set `app.workspace_id`:
   ```go
   _, err := db.Exec(ctx, "SET app.workspace_id = $1", workspaceID)
   ```

**Phase 2: Test RLS**
1. Verify RLS blocks cross-workspace queries
2. Test performance impact
3. Add RLS to all tables

**Phase 3: Remove Application-Level Filters (Optional)**
- RLS makes `WHERE workspace_id` redundant
- Keep filters for defense in depth + performance (index hint)

---

## How to Test

### Isolation Test (Create in ws-A, Access from ws-B)

```go
func TestPortfolioRepo_Isolation_GetByID(t *testing.T) {
    repo := postgres.NewPortfolioRepo(db)
    
    wsA := uuid.New()
    wsB := uuid.New()
    
    // Create item in workspace A
    itemA := &portfolio.PortfolioItem{
        ID: uuid.New(),
        WorkspaceID: wsA,
        Name: "Item A",
    }
    err := repo.Create(ctx, itemA)
    require.NoError(t, err)
    
    // Try to access from workspace B
    _, err = repo.GetByID(ctx, wsB, itemA.ID)
    
    // Should fail (not found, not unauthorized)
    assert.Error(t, err)
    assert.Contains(t, err.Error(), "not found")
}
```

### Isolation Test (List from ws-A does not return ws-B items)

```go
func TestPortfolioRepo_Isolation_List(t *testing.T) {
    repo := postgres.NewPortfolioRepo(db)
    
    wsA := uuid.New()
    wsB := uuid.New()
    
    // Create items in both workspaces
    itemA := &portfolio.PortfolioItem{ID: uuid.New(), WorkspaceID: wsA, Name: "A"}
    itemB := &portfolio.PortfolioItem{ID: uuid.New(), WorkspaceID: wsB, Name: "B"}
    repo.Create(ctx, itemA)
    repo.Create(ctx, itemB)
    
    // List from workspace A
    items, err := repo.List(ctx, wsA)
    require.NoError(t, err)
    
    // Should only return item A
    assert.Len(t, items, 1)
    assert.Equal(t, "A", items[0].Name)
    assert.NotContains(t, items, itemB) // Item B should NOT be in list
}
```

### Isolation Test (Update cross-workspace should fail)

```go
func TestPortfolioRepo_Isolation_Update(t *testing.T) {
    repo := postgres.NewPortfolioRepo(db)
    
    wsA := uuid.New()
    wsB := uuid.New()
    
    // Create item in workspace A
    item := &portfolio.PortfolioItem{ID: uuid.New(), WorkspaceID: wsA, Name: "Original"}
    repo.Create(ctx, item)
    
    // Try to update with workspace B context
    item.WorkspaceID = wsB // Attacker tries to change workspace
    item.Name = "Hacked"
    
    err := repo.Update(ctx, item)
    
    // Should fail (no rows affected)
    assert.Error(t, err)
}
```

---

---

## Compliance Evidence

Technical proof of adherence for ADR 0004:

- **RLS Policies**: [000003_llm_governance_and_audit.up.sql](file:///g:/github-crm-projects/mcp-go/migrations/000003_llm_governance_and_audit.up.sql)
- **Tenant Context**: `BeginTenant` in [tenantdb.go](file:///g:/github-crm-projects/mcp-go/internal/storage/postgres/tenantdb.go)
- **Isolation Tests**: `internal/storage/postgres/rls_test.go`
- **Security Check**: `make security-check` enforces isolation coverage.

---

*Last hardened: 2026-01*
