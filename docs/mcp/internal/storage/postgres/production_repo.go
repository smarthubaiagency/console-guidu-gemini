package postgres

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// ErrNotFound is returned when a record is not found in the database.
var ErrNotFound = errors.New("record not found")

// ProductionRecord holds the fields returned by a ProductionOrder query.
type ProductionRecord struct {
	ID             string
	WorkspaceID    string
	OrderCode      string
	Status         string
	Quantity       int
	TrackingNumber *string
	CreatedAt      time.Time
	UpdatedAt      time.Time
}

// ProductionRepo is the RLS-backed data-access layer for the ProductionOrder model.
// Every query runs inside a BeginTenant transaction so that
// `app.current_workspace_id` is enforced at the database layer.
type ProductionRepo struct {
	pool *pgxpool.Pool
}

// NewProductionRepo creates a new ProductionRepo backed by the given pool.
func NewProductionRepo(pool *pgxpool.Pool) *ProductionRepo {
	return &ProductionRepo{pool: pool}
}

// GetByOrderCode returns the most recent ProductionOrder for a given orderCode,
// scoped to the authenticated workspace via RLS.
//
// RLS guarantee: the SELECT runs inside a BeginTenant transaction which
// sets `app.current_workspace_id` before executing the query.
func (r *ProductionRepo) GetByOrderCode(ctx context.Context, orderCode string) (*ProductionRecord, error) {
	tx, err := BeginTenant(ctx, r.pool)
	if err != nil {
		return nil, fmt.Errorf("production_repo.get: begin tenant: %w", err)
	}
	defer tx.Rollback(ctx) //nolint:errcheck

	const q = `-- Guardrail: workspace scoped query. Do not remove tenant filter.
SELECT "id", "workspaceId", "orderCode", "status", "quantity",
       "trackingNumber", "createdAt", "updatedAt"
FROM "ProductionOrder"
WHERE "orderCode" = $1
ORDER BY "createdAt" DESC
LIMIT 1`

	var rec ProductionRecord
	var trackingNumber *string

	row := tx.QueryRow(ctx, q, orderCode)
	if err := row.Scan(
		&rec.ID,
		&rec.WorkspaceID,
		&rec.OrderCode,
		&rec.Status,
		&rec.Quantity,
		&trackingNumber,
		&rec.CreatedAt,
		&rec.UpdatedAt,
	); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, ErrNotFound
		}
		return nil, fmt.Errorf("production_repo.get: scan: %w", err)
	}

	rec.TrackingNumber = trackingNumber

	if err := tx.Commit(ctx); err != nil {
		return nil, fmt.Errorf("production_repo.get: commit: %w", err)
	}

	return &rec, nil
}
