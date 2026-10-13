# Security Design (V2)

This document outlines the security architecture, governance standards, and reliability patterns implemented in this repository. It serves as the source of truth for security audits and enterprise compliance.

## 1. Security Principles

Our security architecture is built on five core pillars:

- **Defense in Depth**: Multiple layers of security (JWT → Middleware → RLS) to ensure that a failure in one layer does not compromise the system.
- **Fail-Closed by Default**: Any error in authentication, authorization, or context loading defaults to a denial of service (e.g., 401/403).
- **Least Privilege**: Application roles and database roles are restricted to the minimum set of permissions required for their function.
- **Tenant Isolation as a First-Class Constraint**: Multi-tenancy is enforced at the database layer (RLS) and validated at the HTTP layer.
- **Zero Information Disclosure (Production)**: Internal errors, stack traces, and database implementation details are never exposed to the client in production.

---

## 2. Identity & Authentication

All client access is managed via RS256 JWT tokens issued by **Supabase Auth**. There is no shared symmetric secret; the server validates tokens against the Supabase JWKS endpoint.

### Current Implementation (As-Built — Foundry 3.1)

- **Algorithm**: `RS256` (RSA with SHA-256). Public keys are fetched dynamically from the JWKS endpoint.
- **JWKS URL**: Configured via `SUPABASE_JWKS_URL` or inferred as `SUPABASE_URL + /rest/v1/auth/jwks`.
- **Issuance**:
  - **Issuer**: Validated via `SUPABASE_JWT_ISSUER` env var. If not set, issuer check is skipped with a `WARN` log.
  - **Audience**: Validated via `SUPABASE_JWT_AUDIENCE` env var (default: `authenticated`).
- **Expiration**: `exp` claim is always enforced (short-lived Supabase session tokens).
- **Token Types**:
  - **User**: Supabase Auth session token containing `sub` (user ID) and `app_metadata.roles`.

### Policy & Constraints

- **Validation**: Enforced by `internal/observability/httpmw/auth.go` using `MicahParks/keyfunc/v2` for automatic JWKS rotation. Tokens missing claims, with invalid signatures, wrong issuer, or wrong audience are rejected with `401 Unauthorized`.
- **Prohibited**: Symmetric (HS256) tokens, long-lived tokens, and token reuse for different audiences are strictly forbidden.

---

## 3. S2S Anti-Replay (HMAC)

To prevent replay attacks and ensure request integrity for Server-to-Server (S2S) calls, we implement a mandatory HMAC-SHA256 signature validation layer.

- **Scope**: Mandatory for all `/v1/admin/**` routes. Optional/Feature-flagged for `/v1/**` via `S2S_HMAC_REQUIRED`.
- **Mechanism**: HMAC-SHA256 signature using a shared secret (`S2S_HMAC_SECRET`).
- **Components**:
  - **Timestamp**: `X-Cartaopro-Timestamp` (ISO 8601 / RFC3339 format) to prevent delayed replays. Maximum skew: 5 minutes.
  - **Nonce**: `X-Cartaopro-Nonce` (UUID v4) to prevent replay reuse.
  - **Body Hash**: `X-Cartaopro-Body-SHA256` (hex SHA-256) ensures the request body hasn't been tampered with.
  - **Signature**: `X-Cartaopro-Signature` (hex HMAC-SHA256) authenticates the request.
- **Canonical String**:
  `METHOD + "\n" + PATH_WITH_QUERY + "\n" + TIMESTAMP + "\n" + NONCE + "\n" + BODY_SHA256`
- **Persistence**: Nonces are stored in **Redis** (`internal/antireplay/redis.go`) with a TTL of `max_skew + 60s` (≈ 6 minutes). `REDIS_URL` is **mandatory** in `APP_ENV=production`; falls back to in-memory store in development with a `WARN` log.

> [!IMPORTANT]
> Failure to provide valid signature headers for enforced routes results in a `401 Unauthorized`. Nonce reuse results in a `409 Conflict` (`replay_detected`).

---

## 4. Authorization & Ownership

Authorization is enforced at both the HTTP layer and the Domain layer.

- **Workspace Ownership Validation**: Implemented in `internal/http/middleware/workspace_ownership.go`. Validates that the `X-Cartaopro-Workspace-Id` header matches the authenticated user's workspace claim.
- **Response Rules**:
  - **401 Unauthorized**: Missing or invalid authentication.
  - **403 Forbidden**: Valid authentication but the user/service does not own the requested resource.
- **Context Handling**: Claims are extracted and injected into the request context via `internal/tenant/tenant.go` as the typed `tenant.Claims` struct (`WorkspaceID`, `UserID`, `Roles`, `Type`, `Audience`).

---

## 4. Rate Limiting (SEC-GAP-001)

Resource exhaustion protection is enforced via a Fixed Window rate limiting mechanism.

- **Scope**: Applied to all `/v1/*` routes (Regular and Admin API) via [ratelimit.go](file:///g:/github-crm-projects/mcp-go/internal/http/middleware/ratelimit.go).
- **Exemptions**: Health checks (`/health/*`) and root (`/`) routes are not limited.
- **Fail-Closed**: If tenant claims are missing, the rate limiter is bypassed, allowing the authentication/ownership layer to handle the denial (401/403).

### Response behavior

When a limit is reached:

- **Status Code**: `429 Too Many Requests`
- **Error Code**: `rate_limited`
- **Headers**:
  - `X-RateLimit-Limit`: Maximum requests allowed in the window.
  - `X-RateLimit-Remaining`: Requests remaining in the current window.
  - `X-RateLimit-Reset`: Unix epoch time when the limit will reset.

### Configuration

| Variable                    | Description                    | Default |
| --------------------------- | ------------------------------ | ------- |
| `RATE_LIMIT_ENABLED`        | Toggle rate limiting           | `false` |
| `RATE_LIMIT_PER_TENANT_RPM` | Requests per minute per tenant | `100`   |
| `RATE_LIMIT_GLOBAL_RPM`     | Requests per minute globally   | `1000`  |
| `RATE_LIMIT_WINDOW_SECONDS` | Calculation window             | `60`    |

---

## 5. Data Isolation & Storage Security

Multi-tenancy is enforced at the storage engine level.

### PostgreSQL Row Level Security (RLS)

- **Mechanism**: Every table containing tenant data has RLS enabled.
- **Session Variable**: The application sets `app.current_workspace_id` within a transaction.
- **Fail-Closed**: Queries default to returning zero rows if the session variable is unset or mismatched.
- **Implementation**: Managed in [tenantdb.go](file:///g:/github-crm-projects/mcp-go/internal/storage/postgres/tenantdb.go) via `BeginTenant`.

> [!IMPORTANT]
> The MCP runtime connects to PostgreSQL using a non-privileged role without `bypassrls`. Administrative Supabase roles (e.g., `postgres`, `service_role`) are never used by the runtime path.

---

## 6. Error Shield (Zero Disclosure)

All server errors follow a structured three-field contract to prevent information leakage:

```json
{
  "error": "snake_case_code",
  "message": "Human-readable description",
  "error_id": "uuid-v4"
}
```

- **`error_id`**: UUID v4 generated per request by `internal/http/respond`. The client can share this ID with support to correlate the full stack trace in structured logs.
- **Production sanitisation**: When `APP_ENV=production`, all 5xx messages are replaced with a safe generic string. The original error is logged server-side with the same `error_id` for internal correlation.
- **Integrity violations** (tamper detected, replay detected) map to `409 Conflict` with no internal detail exposed.
- **Implementation**: `internal/http/respond/respond.go`

---

## 7. Migrations & Schema Governance

Database changes are strictly versioned and auditable.

- **Tooling**: [golang-migrate](https://github.com/golang-migrate/migrate) is used for all schema changes.
- **Baseline**: The schema starts from `000001_initial_schema`. RLS, LLM Governance, and Execution ID support are implemented in migrations `000002` through `000004`.
- **Governance**: Every migration must be accompanied by its corresponding rollback (`.down.sql`).

---

## 7. Error Handling & Information Disclosure

We maintain a strict separation between internal errors and public API responses.

- **Sanitization**: Implemented in [respond.go](file:///g:/github-crm-projects/mcp-go/internal/http/respond/respond.go).
- **Error ID**: Every error response returns a unique `error_id` (UUID) to the client.
- **Mapping**:
  - **4xx Errors**: Detail informative messages for client correction.
  - **5xx Errors**: Masked as `"internal_error"` in production, while full details are logged internally with the associated `error_id`.

---

## 8. Observability, Audit & Traceability (AAA)

Global visibility into system health and security events.

- **Request ID**: `X-Request-ID` is propagated throughout the stack for cross-service tracing.
- **Traceability**: `error_id` acts as the bridge between client complaints and internal logs.
- **Health Checks**:
  - `/health/live`: Liveness check (process running).
  - `/health/ready`: Readiness check (database connectivity + shutdown state).

---

## 9. Execution Safety (Agentic / MCP)

Guardrails for autonomous execution.

- **Policy-Based Execution**: All MCP tool executions are gated by search/read policies (e.g., [mcp.go](file:///g:/github-crm-projects/mcp-go/internal/policy/policies/mcp.go)).
- **Identifiable Executions**: Every execution is tagged with a unique `execution_id` (see [execution.go](file:///g:/github-crm-projects/mcp-go/internal/execution/execution.go)).
- **Audit & Accountability**: Governance events are hashed (SHA256) and sensitive fields are redacted before persistence in [service.go](file:///g:/github-crm-projects/mcp-go/internal/application/llmgovernance/service.go).

> [!NOTE]
> Execution identifiers act as first-class primitives to support full end-to-end replay, auditability, and span correlation across the LLM Governance layer.

---

## 10. Environment & Supply Chain Security

Securing the binary and its dependencies.

- **Dependency Management**: Standard Go modules with `go.sum` verification.
- **Container Hardening**:
  - **Non-Root**: Binary runs as `nonroot` user (UID 65532).
  - **Slim Image**: Uses `debian:bookworm-slim` for minimal attack surface.
  - **Hardened Build**: Build uses `-trimpath` to remove local filesystem paths from the binary.

## 11. Security Gates & CI

To maintain the integrity of the security model, the following gates are enforced:

### Checklist for PRs

Before any PR can be merged, the following command MUST pass:

```bash
make security-check
```

This ensures:

1. **No Policy Bypass**: All MCP tools are strictly gated by the Policy Engine.
2. **Data Privacy**: No raw LLM data (prompts/responses) is stored in persistent spans (enforced by `governed_security_test.go`).
3. **Tenant Isolation**: RLS and workspace scoping are verified across all services.

Failure to pass `make security-check` will block the deployment pipeline.

---

## 🔍 Security Gaps & Roadmap

The following gaps have been identified and prioritized for future implementation.

| ID          | Description                   | Impact                                      | Priority | Status           |
| :---------- | :---------------------------- | :------------------------------------------ | :------: | :--------------- |
| SEC-GAP-001 | Rate Limiting per Tenant      | Resource exhaustion protection              |  **P0**  | Implemented      |
| SEC-GAP-002 | Execution Replay & Audit      | Full audit trail for agentic actions        |  **P1**  | Implemented (V1) |
| SEC-GAP-003 | JWT Key Rotation              | Mitigate impact of secret compromise        |  **P1**  | Planned          |
| SEC-GAP-004 | Admin API Hardening           | Protection for sensitive internal endpoints |  **P1**  | Implemented      |
| SEC-GAP-005 | Data Retention & Purge        | LGPD / GDPR compliance for data lifecycle   |  **P2**  | Not Implemented  |
| SEC-GAP-006 | Automated Dependency Scanning | CI protection against vulnerabilities       |  **P2**  | Planned          |
| SEC-GAP-007 | S2S Replay Protection         | Protection against request replay/tampering |  **P1**  | Implemented      |

> [!NOTE]
> This document reflects the architectural state as of January 2026. Items marked as "Planned" or "Not Implemented" are not currently active in the production environment.

---

## 13. Status de Segurança (Snapshot)

**Data:** 2026-01-30

### Radar de Segurança (AAA)

- **P0 (Críticos):** Resolvidos (JWT, RLS Isolation, Rate Limiting, Multi-tenant Gates).
- **P1 (Importantes):** Em progresso (Key Rotation, Automated Scanning). Resolvido: Anti-Replay (HMAC + Redis).
- **P2 (Melhorias):** Planejados (Retention Policy).

### Como Provar

- **Autenticação/Autorização:** Ver `internal/http/middleware/auth_test.go` e `workspace_ownership_test.go`.
- **Anti-Replay:** Ver `internal/http/middleware/s2s_hmac_test.go`.
- **Data Isolation:** Ver migrations `000002` (RLS) e `internal/storage/postgres/tenantdb.go`.
- **Policy Enforcement:** Ver `internal/mcp/runtime/executor_security_test.go`.
- **Privacidade LLM:** Ver `internal/llm/runtime/governed_security_test.go` (Hashing & Error Truncation).
- **Accounting:** Ver logs de `audit_events` e `llm_spans` vinculados ao `execution_id`.
