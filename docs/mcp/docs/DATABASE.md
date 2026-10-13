# Database Migrations

The project uses `golang-migrate` to manage database schema changes.

## Local Development

### 1. Prerequisites
Ensure you have `DATABASE_URL` set in your environment or `.env` file.

```bash
export DATABASE_URL="postgres://user:pass@localhost:5432/mcp_db?sslmode=disable"
```

### 2. Running Migrations

To apply all pending migrations:
```bash
make migrate-up
```

To revert the last migration:
```bash
make migrate-down
```

To check the current migration version:
```bash
make migrate-status
```

### 3. Creating a New Migration

Migrations are stored in the `migrations/` directory. Use the following naming convention:
`00000X_description.up.sql` and `00000X_description.down.sql`.

Example:
```sql
-- 000002_add_companies_table.up.sql
CREATE TABLE companies (...);

-- 000002_add_companies_table.down.sql
DROP TABLE IF EXISTS companies;
```

## Continuous Integration (CI)

In CI environments, migrations are automatically applied as part of the pipeline before running tests:

```yaml
steps:
  - name: Run migrations
    run: make migrate-up
    env:
      DATABASE_URL: ${{ secrets.DATABASE_URL }}
```

## Fail-Closed Mechanism

If `DATABASE_URL` is missing or a migration fails, the runner will exit with a non-zero code, preventing the service from starting with an inconsistent schema.

## Schema & Table Map

### Current Version: 000004
| Table | Purpose |
| :--- | :--- |
| `portfolio_items` | Core business data with strict tenant isolation. |
| `llm_configs` | Versioned repository for LLM models and parameters. |
| `tenant_llm_settings`| Workspace-specific active configurations and fallback strategies. |
| `llm_spans` | Token usage, latency, and hashing of LLM interactions. |
| `audit_events` | Immutable security log with PII redaction and SHA256 integrity. |
| `execution_trace_index`| Master correlation index for multi-step agentic executions. |

> [!TIP]
> All tables containing tenant data MUST have indices on `(workspace_id)` or composite keys starting with `workspace_id` to ensure performance and isolation.

## RLS e Tenant Context (Padrão Obrigatório)

O isolamento é garantido por **PostgreSQL Row Level Security (RLS)** em conjunto com variáveis de sessão.

1. **Contexto:** O middleware injeta o `workspace_id` no `context.Context`.
2. **BeginTenant:** O código deve usar `postgres.BeginTenant(ctx, pool)` para iniciar transações.
3. **SET LOCAL:** O wrapper executa `SET LOCAL app.current_workspace_id = $1` dentro da transação.
4. **Enforcement:** O banco rejeita qualquer linha que não pertença ao workspace da sessão (`Fail-Closed`).

> [!IMPORTANT]
> O uso de `FORCE ROW LEVEL SECURITY` é obrigatório em novas tabelas de tenant para evitar bypass pelo dono da tabela.

## Retenção e Purge (LGPD)

O sistema implementa retenção diferenciada para dados de alta volumetria:
- **Audit Events & LLM Spans**: Retenção padrão de **90 dias**.
- **Payload Integrity**: Dados sensíveis são persistidos via `payload_redacted` (JSON) e `payload_hash` (SHA-256), permitindo auditoria sem armazenamento de PII a longo prazo.
- **Purge Automático**: Job de limpeza (GAP-005) remove registros expirados baseados em `created_at`.

---

## checklist: DB Governance

- [ ] **Migração:** Alteração de schema feita apenas via `00000X_filename.up.sql`.
- [ ] **Rollback:** Migração acompanhada de `.down.sql` testado.
- [ ] **RLS:** `ENABLE ROW LEVEL SECURITY` e `FORCE ROW LEVEL SECURITY` aplicados.
- [ ] **Índices:** Presença de índice por `workspace_id` validada.
- [ ] **Query Scoping:** Aplicação usa `BeginTenant` e filtros explícitos em SQL para performance.
