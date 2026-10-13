# ADR 0003: Proposal Hash Anti-Tamper Mechanism

**Status:** Accepted

**Date:** 2026-01-26

---

## Context

The MCP-Go system implements a **two-phase execution model**:
1. **Propose:** Agent interprets user input and generates a proposal (non-executable)
2. **Execute:** Client sends proposal back for execution

Beyond human-in-the-loop approval, this pattern presents an **adversarial risk**:
- Attacker-controlled clients can modify proposals between phases.
- Proposals could be replayed across workspaces or time.
- Standard audit logs may lose context of *what* was actually interpreted vs *what* was executed.

We need an **Immutable Integrity Anchor** to detect tampering and ensure AAA (Accounting) compliance.

## Decision

We implement **SHA-256 hash validation** to ensure proposal integrity.

### Hash Calculation

**What's Included in Hash:**
```go
payload := map[string]any{
    "workspace_id":            workspaceID,
    "intent":                  intent,
    "requires_human_approval": humanApproval,
    "commands":                commands,
}
hash := sha256(JSON(payload))
```

**Rationale for Each Field:**
- `workspace_id`: Prevents cross-workspace replay
- `intent`: Human-readable description of action
- `requires_human_approval`: Ensures approval flag cannot be removed
- `commands`: The actual commands to execute (core of the proposal)

**Reference:** `internal/application/agentgateway/service.go:108-125`

---

### 2. Validation Gate (Fail-Closed)

**Rule:** The `Execute` phase MUST recalculate and verify the hash. Any mismatch results in **immediate abortion**.

**Adversarial Enforcement:**
- If `computedHash != receivedHash` → **HTTP 409 (Tamper Detected)**.
- The check is performed **before** any database transaction or tool execution starts.
- **Fail-Closed**: If hash calculation fails technically, the system defaults to denial.

**Reference:** `internal/application/agentgateway/service.go:72-85`

---

### 3. Execution-Linked Integrity (AAA Integration)

**Rule:** Every `proposal_hash` MUST be linked to a unique `ExecutionID` during the execution phase.

**Rationale:**
- **Accounting**: The hash serves as the "Proof of Intent" in the `audit_events` table (`payload_hash` column).
- **Traceability**: Link the exact set of proposed commands to the resulting LLM spans and side effects.

**Implementation:**
- `ExecutionTrace` records the initiation of the handshake.
- `audit_events` persist the `payload_hash` as an immutable record of what was authorized.

**Reference:** `internal/application/agentgateway/service.go:63-151`

---

### Why SHA-256?

**Rationale:**
- **Collision Resistance:** Computationally infeasible to find two inputs with same hash
- **One-Way:** Cannot reverse hash to get original data
- **Fast:** Minimal performance overhead
- **Standard:** Well-understood, widely used

**Alternatives Considered:**
- MD5: Rejected (collision attacks exist)
- SHA-1: Rejected (deprecated, collision attacks)
- HMAC: Overkill (no shared secret needed, client doesn't generate hash)

---

## Alternatives Considered

### Alternative 1: No Integrity Check

**Rejected because:**
- Client can modify proposal arbitrarily
- Defeats purpose of human-in-the-loop (user approves X, system executes Y)
- No auditability (what was actually approved?)

---

### Alternative 2: Server-Side Session Storage

Store proposal on server, return only `proposal_id`:
```json
{"proposal_id": "uuid-123"}
```

Client sends `proposal_id` to execute, server retrieves stored proposal.

**Rejected because:**
- Requires state storage (Redis/DB)
- Adds complexity (TTL, cleanup)
- Doesn't scale horizontally (session affinity)
- Client cannot inspect proposal before execution

---

### Alternative 3: Digital Signature (HMAC or RSA)

Sign proposal with server private key, verify on execute.

**Rejected because:**
- Overkill (client doesn't generate proposals)
- Adds key management complexity
- Hash is sufficient (server generates and validates both sides)

---

✅ **Tamper Detection**: Modifications by malicious clients are technically impossible to hide.
✅ **AAA Proof**: The hash provides a non-repudiable record for audit `audit_events`.
✅ **Stateless Integrity**: No Redis lookup needed for hash verification.
✅ **Correlation**: Directly links Propose phase outcomes to Execute phase side-effects via `execution_id`.

⚠️ **No Temporal Replay Protection**: Same proposal can be re-executed (see Gap below).
⚠️ **Canonicalization Warning**: Hash depends on deterministic JSON ordering (Go's `json.Marshal` is enforced).

### Neutral

- Hash is 64 characters (hex-encoded SHA-256)
- Hash is included in API response (`proposal_hash` field)

---

## Security/Compliance Notes

### Current Security Posture

**Protects Against:**
- ✅ Proposal tampering (modification of commands)
- ✅ Intent manipulation (changing what user approved)
- ✅ Approval bypass (removing `requires_human_approval` flag)

**Does NOT Protect Against:**
- ❌ **Replay Attacks:** Same proposal can be executed multiple times

### Security Debt

**DEBT-007 (P2): Replay Attack Protection Ausente**

**Gap:** Hash does not include `nonce` or `timestamp`, allowing replay.

**Attack Scenario:**
```http
# User approves "create item X"
POST /execute
{"proposal_hash": "abc123", "intent": "create X", "commands": [...]}
# → Item X created

# Attacker replays same request
POST /execute
{"proposal_hash": "abc123", "intent": "create X", "commands": [...]}
# → Item X created AGAIN (duplicate)
```

**Mitigation Planned (P2):**
1. Add `nonce` (UUID) and `timestamp` to hash payload
2. Validate timestamp (max 5min age)
3. Store used nonces in cache (Redis, TTL 5min)
4. Return HTTP 409 if nonce already used

**Reference:** `docs/SECURITY.md` - DEBT-007

---

## Rollout / Migration Plan

**Status:** Already implemented (no migration needed).

**Future Evolution (Replay Protection):**

**Phase 1: Add nonce/timestamp to hash (Breaking Change)**
1. Update hash payload:
   ```go
   payload := map[string]any{
       "workspace_id": workspaceID,
       "intent": intent,
       "requires_human_approval": humanApproval,
       "commands": commands,
       "nonce": nonce,        // NEW
       "timestamp": timestamp, // NEW
   }
   ```
2. Client must generate `nonce` (UUID) and `timestamp` (ISO8601)
3. Server validates timestamp (max 5min old)

**Phase 2: Nonce deduplication**
1. Add Redis for nonce storage
2. Store `nonce` with TTL 5min on first use
3. Reject if nonce already exists

**Backward Compatibility:**
- Breaking change (old clients won't work)
- Requires coordinated frontend/backend deploy
- Consider feature flag for gradual rollout

---

## How to Test

### Hash Validation (Tamper Detection)

```go
func TestAgentGateway_Execute_TamperDetected(t *testing.T) {
    service := agentgateway.NewService(agent, executor, logger)
    
    // Propose
    proposeResp, _ := service.Propose(ctx, "ws-123", agentgateway.ProposeRequest{
        Message: "liste portfolio",
    })
    originalHash := proposeResp.ProposalHash
    
    // Tamper with commands
    tamperedReq := agentgateway.ExecuteRequest{
        ProposalHash: originalHash, // Original hash
        Intent: proposeResp.Proposal.Intent,
        Commands: []command.MCPCommand{
            {Name: "portfolio", Input: map[string]any{"action": "delete"}}, // TAMPERED
        },
    }
    
    // Execute should fail
    _, err := service.Execute(ctx, "ws-123", "user-123", tamperedReq)
    
    assert.ErrorIs(t, err, agentgateway.ErrTamperDetected)
}
```

### Valid Execution (No Tampering)

```go
func TestAgentGateway_Execute_ValidHash(t *testing.T) {
    service := agentgateway.NewService(agent, executor, logger)
    
    // Propose
    proposeResp, _ := service.Propose(ctx, "ws-123", agentgateway.ProposeRequest{
        Message: "liste portfolio",
    })
    
    // Execute with UNMODIFIED proposal
    execReq := agentgateway.ExecuteRequest{
        ProposalHash: proposeResp.ProposalHash,
        Intent: proposeResp.Proposal.Intent,
        Commands: proposeResp.Proposal.Commands,
    }
    
    result, err := service.Execute(ctx, "ws-123", "user-123", execReq)
    
    assert.NoError(t, err)
    assert.Equal(t, "success", result.Status)
}
```

### Replay Attack (Current Gap)

```go
func TestAgentGateway_Execute_ReplayAttack(t *testing.T) {
    // TODO: This test will PASS (replay is allowed)
    // After DEBT-007 is resolved, this should FAIL
    
    service := agentgateway.NewService(agent, executor, logger)
    
    proposeResp, _ := service.Propose(ctx, "ws-123", agentgateway.ProposeRequest{
        Message: "crie item X",
    })
    
    execReq := agentgateway.ExecuteRequest{
        ProposalHash: proposeResp.ProposalHash,
        Intent: proposeResp.Proposal.Intent,
        Commands: proposeResp.Proposal.Commands,
    }
    
    // Execute TWICE with same proposal
    result1, err1 := service.Execute(ctx, "ws-123", "user-123", execReq)
    result2, err2 := service.Execute(ctx, "ws-123", "user-123", execReq)
    
    // Currently: both succeed (REPLAY ALLOWED)
    assert.NoError(t, err1)
    assert.NoError(t, err2)
    
    // After DEBT-007: second should fail
    // assert.Error(t, err2)
    // assert.Contains(t, err2.Error(), "nonce already used")
}
```

---

---

## Compliance Evidence

Technical proof of adherence for ADR 0003:

- **Hash Verification**: `Execute` method in [service.go](file:///g:/github-crm-projects/mcp-go/internal/application/agentgateway/service.go#L72)
- **Trace Persistence**: `traceRepo.Create` in [service.go](file:///g:/github-crm-projects/mcp-go/internal/application/agentgateway/service.go#L103)
- **Integrity Testing**: `TestGateway_HandshakeFlow` in [service_test.go](file:///g:/github-crm-projects/mcp-go/internal/application/agentgateway/service_test.go)
- **Audit Schema**: `audit_events.payload_hash` in [000003_llm_governance_and_audit.up.sql](file:///g:/github-crm-projects/mcp-go/migrations/000003_llm_governance_and_audit.up.sql)

---

*Last hardened: 2026-01*
