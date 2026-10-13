# MCP-Go Documentation

Welcome to the MCP-Go documentation. This repository implements a Model Context Protocol (MCP) Server in Go, providing a secure gateway for agent-driven command execution with policy enforcement and multi-tenant isolation.

## Documentation Index

### Core Architecture
- **[ARCHITECTURE.md](./ARCHITECTURE.md)** - System architecture, components, and design decisions
- **[CORE.md](./CORE.md)** - Deep dive into core modules (Agent Layer, MCP Runtime, Policy Engine)

### Security & Policies
- **[SECURITY.md](./SECURITY.md)** - Security model, threat model, and multi-tenancy strategy
- **[POLICY_RULES.md](./POLICY_RULES.md)** - Policy namespace catalog and rule definitions
- **[GUARDRAILS.md](./GUARDRAILS.md)** - Repo guardrails and core protection rules

### Governance & Engineering Standards
- **[CORE.md](./CORE.md)** - Architectural contract and invariants (normative)
- **[GOVERNANCE.md](./GOVERNANCE.md)** - Engineering rules enforcement strategy
- **[PRODUCTION_READINESS.md](./PRODUCTION_READINESS.md)** - Production readiness criteria
- **[adr/](./adr/)** - Architecture Decision Records (ADRs)

### API & Integration
- **[API.md](./API.md)** - HTTP API reference and usage guide
- **[DATABASE.md](./DATABASE.md)** - Database schema, migrations, and data model

### Operations
- **[DEPLOYMENT.md](./DEPLOYMENT.md)** - Deployment guide (Docker, EasyPanel, Kubernetes)
- **[OBSERVABILITY.md](./OBSERVABILITY.md)** - Logging, metrics, and monitoring
- **[RUNBOOK.md](./RUNBOOK.md)** - Operational procedures and troubleshooting

### Development
- **[DEVELOPMENT.md](./DEVELOPMENT.md)** - Local setup, testing, and contribution guide
- **[TESTING.md](./TESTING.md)** - Testing strategy and test writing guide

---

## Governance

**This project is governed by architectural and security contracts.** All code changes must respect the normative rules defined in:

- **[CORE.md](./CORE.md)** - Architectural invariants (Agent side-effect free, Runtime transport-agnostic, Policy mandatory)
- **[SECURITY.md](./SECURITY.md)** - Security red lines (workspace isolation, no sensitive data in logs, default DENY)
- **[POLICY_RULES.md](./POLICY_RULES.md)** - Policy enforcement standards (namespace-based, tests required)

**Pull Requests** must pass gates defined in [PR Template](../.github/pull_request_template.md) and comply with [GOVERNANCE.md](./GOVERNANCE.md).

**Production Readiness** is objectively defined in [PRODUCTION_READINESS.md](./PRODUCTION_READINESS.md) with three levels: Not Ready, Functional but Insecure, and Secure Production.

---

## Quick Start

1. **Setup**: See [DEVELOPMENT.md](./DEVELOPMENT.md) for local environment setup
2. **Deploy**: See [DEPLOYMENT.md](./DEPLOYMENT.md) for production deployment
3. **API Usage**: See [API.md](./API.md) for endpoint documentation
4. **Troubleshooting**: See [RUNBOOK.md](./RUNBOOK.md) for common issues

## Project Structure

```
/cmd                    # Binary entrypoints
/internal               # Private application code
  /agents               # Agent cognitive layer
  /mcp                  # MCP runtime and tools
  /policy               # Policy engine
  /domain               # Business entities
  /application          # Use cases
  /http                 # HTTP transport
  /storage              # Persistence layer
  /observability        # Logging and monitoring
/docs                   # This documentation
/openapi                # OpenAPI specification
```

## Contributing

See [DEVELOPMENT.md](./DEVELOPMENT.md) for contribution guidelines.

## License

[Add license information]
