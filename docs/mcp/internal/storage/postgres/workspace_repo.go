package postgres

import (
	"context"
	"fmt"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/cartaopro/mcp/internal/domain"
)

// WorkspaceRepo is the RLS-backed data-access layer for the Workspace model.
// Every operation MUST execute within a BeginTenant transaction to satisfy
// the Linkko Constitution §1 (Tenant Sovereignty).
type WorkspaceRepo struct {
	pool *pgxpool.Pool
}

// NewWorkspaceRepo creates a new WorkspaceRepo backed by the given connection pool.
func NewWorkspaceRepo(pool *pgxpool.Pool) *WorkspaceRepo {
	return &WorkspaceRepo{pool: pool}
}

// GetContext returns the workspace display context for the current tenant.
// It joins the Workspace with its active WorkspaceSubscription and Plan to
// resolve the plan name. A default plan label is returned when no subscription exists.
//
// RLS guarantee: the query executes inside a BeginTenant transaction so that
// `app.current_workspace_id` is set for the duration of the call.
func (r *WorkspaceRepo) GetContext(ctx context.Context, workspaceID uuid.UUID) (domain.WorkspaceContext, error) {
	tx, err := BeginTenant(ctx, r.pool)
	if err != nil {
		return domain.WorkspaceContext{}, fmt.Errorf("workspace_repo: begin tenant: %w", err)
	}
	defer tx.Rollback(ctx) //nolint:errcheck

	const q = `-- Guardrail: workspace scoped query. Do not remove tenant filter.
SELECT
    w.name,
    COALESCE(p.name, 'free') AS plan
FROM "Workspace" w
LEFT JOIN "WorkspaceSubscription" ws
    ON ws."workspaceId" = w.id AND ws.status = 'Active'
LEFT JOIN "Plan" p
    ON p.id = ws."planId"
WHERE w.id = $1
LIMIT 1`

	var name, plan string
	row := tx.QueryRow(ctx, q, workspaceID)
	if err := row.Scan(&name, &plan); err != nil {
		return domain.WorkspaceContext{}, fmt.Errorf("workspace_repo: query: %w", err)
	}

	if err := tx.Commit(ctx); err != nil {
		return domain.WorkspaceContext{}, fmt.Errorf("workspace_repo: commit: %w", err)
	}

	return domain.WorkspaceContext{
		Name:     name,
		Plan:     plan,
		Timezone: "UTC", // Workspace model has no timezone column; UTC is the platform default.
	}, nil
}
