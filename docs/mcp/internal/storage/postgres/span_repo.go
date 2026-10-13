package postgres

import (
	"context"
	"encoding/json"
	"fmt"

	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/cartaopro/mcp/internal/domain"
)

// SpanRepo persists AiExecutionSpan records under RLS isolation.
// Note: AiExecutionSpan has a mandatory FK to AiExecution (workspaceId, executionId).
// Caller is responsible for ensuring the AiExecution row exists before calling CreateSpan.
// Writes are best-effort: callers should log but not propagate FK violation errors.
type SpanRepo struct {
	pool *pgxpool.Pool
}

// NewSpanRepo creates a new SpanRepo backed by the given pool.
func NewSpanRepo(pool *pgxpool.Pool) *SpanRepo {
	return &SpanRepo{pool: pool}
}

// CreateSpan persists an execution span inside a BeginTenant transaction and
// returns the newly generated span ID.
// Requires a matching (workspaceId, executionId) pair in the AiExecution table.
func (r *SpanRepo) CreateSpan(ctx context.Context, input domain.ExecutionSpanInput) (string, error) {
	tx, err := BeginTenant(ctx, r.pool)
	if err != nil {
		return "", fmt.Errorf("span_repo.create_span: begin tenant: %w", err)
	}
	defer tx.Rollback(ctx) //nolint:errcheck

	var payloadJSON []byte
	if input.PayloadRedacted != nil {
		b, merr := json.Marshal(input.PayloadRedacted)
		if merr != nil {
			return "", fmt.Errorf("span_repo.create_span: marshal payloadRedacted: %w", merr)
		}
		payloadJSON = b
	}

	const q = `-- Guardrail: workspace scoped query. Do not remove tenant filter.
INSERT INTO "AiExecutionSpan" ("workspaceId", "executionId", "provider", "model", "promptHash", "responseHash", "latencyMs", "status", "payloadRedacted")
VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
RETURNING "id"`

	var id string
	row := tx.QueryRow(ctx, q,
		input.WorkspaceID,
		input.ExecutionID,
		input.Provider,
		input.Model,
		input.PromptHash,
		input.ResponseHash, // nil pointer → SQL NULL
		input.LatencyMs,    // nil pointer → SQL NULL
		input.Status,
		payloadJSON,        // nil → SQL NULL; []byte → stored as JSONB
	)
	if err := row.Scan(&id); err != nil {
		return "", fmt.Errorf("span_repo.create_span: scan: %w", err)
	}

	if err := tx.Commit(ctx); err != nil {
		return "", fmt.Errorf("span_repo.create_span: commit: %w", err)
	}

	return id, nil
}

// UpdateSpan updates the status, latency, response hash, and redacted payload of an existing span.
// The workspaceId predicate enforces tenant isolation at the query level.
func (r *SpanRepo) UpdateSpan(ctx context.Context, spanID, workspaceID, status string, latencyMs *int, responseHash *string, payloadRedacted map[string]any) error {
	tx, err := BeginTenant(ctx, r.pool)
	if err != nil {
		return fmt.Errorf("span_repo.update_span: begin tenant: %w", err)
	}
	defer tx.Rollback(ctx) //nolint:errcheck

	var payloadJSON []byte
	if payloadRedacted != nil {
		b, merr := json.Marshal(payloadRedacted)
		if merr != nil {
			return fmt.Errorf("span_repo.update_span: marshal payloadRedacted: %w", merr)
		}
		payloadJSON = b
	}

	const q = `-- Guardrail: workspace scoped query. Do not remove tenant filter.
UPDATE "AiExecutionSpan"
SET "status" = $1, "latencyMs" = $2, "responseHash" = $3, "payloadRedacted" = $4
WHERE "id" = $5 AND "workspaceId" = $6`

	_, err = tx.Exec(ctx, q, status, latencyMs, responseHash, payloadJSON, spanID, workspaceID)
	if err != nil {
		return fmt.Errorf("span_repo.update_span: exec: %w", err)
	}

	if err := tx.Commit(ctx); err != nil {
		return fmt.Errorf("span_repo.update_span: commit: %w", err)
	}

	return nil
}
