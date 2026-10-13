package postgres

import (
	"context"
	"encoding/json"
	"fmt"

	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/cartaopro/mcp/internal/domain"
)

// AuditRepo persists AiAuditEvent records under RLS isolation.
type AuditRepo struct {
	pool *pgxpool.Pool
}

// NewAuditRepo creates a new AuditRepo backed by the given pool.
func NewAuditRepo(pool *pgxpool.Pool) *AuditRepo {
	return &AuditRepo{pool: pool}
}

// CreateEvent persists an audit event inside a BeginTenant transaction.
// input.ExecutionID may be nil; when set it must reference an existing AiExecution row.
// Passing nil (SQL NULL) is safe because the FK constraint is optional (SetNull policy).
func (r *AuditRepo) CreateEvent(ctx context.Context, input domain.AuditEventInput) error {
	tx, err := BeginTenant(ctx, r.pool)
	if err != nil {
		return fmt.Errorf("audit_repo.create_event: begin tenant: %w", err)
	}
	defer tx.Rollback(ctx) //nolint:errcheck

	var payloadJSON []byte
	if input.PayloadRedacted != nil {
		b, merr := json.Marshal(input.PayloadRedacted)
		if merr != nil {
			return fmt.Errorf("audit_repo.create_event: marshal payloadRedacted: %w", merr)
		}
		payloadJSON = b
	}

	const q = `-- Guardrail: workspace scoped query. Do not remove tenant filter.
INSERT INTO "AiAuditEvent" ("workspaceId", "executionId", "actorType", "actorId", "eventType", "payloadHash", "payloadRedacted", "proposalHash")
VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`

	_, err = tx.Exec(ctx, q,
		input.WorkspaceID,
		input.ExecutionID,  // nil pointer → SQL NULL; satisfies optional FK constraint
		input.ActorType,
		input.ActorID,
		input.EventType,
		input.PayloadHash,
		payloadJSON,        // nil → SQL NULL; []byte → stored as JSONB
		input.ProposalHash,
	)
	if err != nil {
		return fmt.Errorf("audit_repo.create_event: exec: %w", err)
	}

	if err := tx.Commit(ctx); err != nil {
		return fmt.Errorf("audit_repo.create_event: commit: %w", err)
	}

	return nil
}
