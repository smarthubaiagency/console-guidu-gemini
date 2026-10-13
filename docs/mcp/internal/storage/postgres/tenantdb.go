package postgres

import (
	"context"
	"fmt"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/cartaopro/mcp/internal/tenant"
)

// Querier is a common interface for pgx.Pool, pgx.Conn, and pgx.Tx.
type Querier interface {
	Exec(ctx context.Context, sql string, arguments ...any) (pgconn.CommandTag, error)
	Query(ctx context.Context, sql string, args ...any) (pgx.Rows, error)
	QueryRow(ctx context.Context, sql string, args ...any) pgx.Row
}

// Transaction is a common interface for transactions.
type Transaction interface {
	Querier
	Commit(ctx context.Context) error
	Rollback(ctx context.Context) error
}

// TenantTx is a wrapper around pgx.Tx that ensures tenant isolation.
type TenantTx struct {
	tx pgx.Tx
}

// Exec implements Querier.
func (t *TenantTx) Exec(ctx context.Context, sql string, arguments ...any) (pgconn.CommandTag, error) {
	return t.tx.Exec(ctx, sql, arguments...)
}

// Query implements Querier.
func (t *TenantTx) Query(ctx context.Context, sql string, args ...any) (pgx.Rows, error) {
	return t.tx.Query(ctx, sql, args...)
}

// QueryRow implements Querier.
func (t *TenantTx) QueryRow(ctx context.Context, sql string, args ...any) pgx.Row {
	return t.tx.QueryRow(ctx, sql, args...)
}

// Commit commits the transaction.
func (t *TenantTx) Commit(ctx context.Context) error {
	return t.tx.Commit(ctx)
}

// Rollback rolls back the transaction. Safe to call even if the tx is already committed.
func (t *TenantTx) Rollback(ctx context.Context) error {
	return t.tx.Rollback(ctx)
}

// BeginTenant starts a new transaction and sets the workspace session variable for RLS.
// This is the Fail-Closed pattern: if workspace_id is absent or invalid in the context,
// the function returns an error and no transaction is opened.
func BeginTenant(ctx context.Context, pool *pgxpool.Pool) (Transaction, error) {
	claims, err := tenant.FromContext(ctx)
	if err != nil {
		return nil, fmt.Errorf("auth required: %w", err)
	}

	if claims.WorkspaceID == "" {
		return nil, fmt.Errorf("workspace_id missing in claims")
	}

	tx, err := pool.Begin(ctx)
	if err != nil {
		return nil, fmt.Errorf("failed to begin transaction: %w", err)
	}

	// Defense in Depth: SET LOCAL scopes the variable to this transaction only.
	// SET LOCAL does not support parameterized queries ($1) in PostgreSQL —
	// the parameter protocol only works for DML statements.
	// WorkspaceID is a JWT-validated UUID (alphanumeric + hyphens only),
	// so fmt.Sprintf is safe here — no SQL injection risk.
	_, err = tx.Exec(ctx, fmt.Sprintf("-- Guardrail: security enforcement. Do not remove RLS context.\nSET LOCAL app.current_workspace_id = '%s'", claims.WorkspaceID))
	if err != nil {
		_ = tx.Rollback(ctx)
		return nil, fmt.Errorf("failed to set session variable: %w", err)
	}

	return &TenantTx{tx: tx}, nil
}
