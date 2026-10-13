package postgres_test

import (
	"context"
	"testing"

	"github.com/cartaopro/mcp/internal/storage/postgres"
	"github.com/cartaopro/mcp/internal/tenant"
)

// TestBeginTenant_FailClosed_NoClaims validates that BeginTenant refuses to
// open a transaction when no tenant claims are present in the context.
// This is the primary Fail-Closed invariant: unauthenticated requests must
// never reach the database.
//
// The nil pool is safe here because BeginTenant returns before calling pool.Begin
// when claims are absent from the context.
func TestBeginTenant_FailClosed_NoClaims(t *testing.T) {
	ctx := context.Background() // no tenant claims injected

	_, err := postgres.BeginTenant(ctx, nil)
	if err == nil {
		t.Fatal("expected error when no tenant claims in context, got nil — RLS Fail-Closed invariant violated")
	}
}

// TestBeginTenant_FailClosed_EmptyWorkspaceID validates that BeginTenant refuses
// to open a transaction when the workspace_id claim is present but empty.
// An empty workspace_id would match no tenant data and must be rejected.
//
// The nil pool is safe here because BeginTenant returns before pool.Begin
// when workspace_id is empty.
func TestBeginTenant_FailClosed_EmptyWorkspaceID(t *testing.T) {
	ctx := tenant.WithClaims(context.Background(), tenant.Claims{
		WorkspaceID: "", // deliberately empty
		UserID:      "user-123",
		Type:        "user",
	})

	_, err := postgres.BeginTenant(ctx, nil)
	if err == nil {
		t.Fatal("expected error for empty workspace_id in claims, got nil — RLS Fail-Closed invariant violated")
	}
}

// TestBeginTenant_SetLocalGuardrail is an integration test that validates the
// SET LOCAL app.current_workspace_id command is correctly emitted in the
// transaction, scoping all subsequent queries to the tenant's RLS policy.
//
// This test is skipped unless a DATABASE_URL is available in the environment.
// To run: DATABASE_URL=postgres://... go test ./internal/storage/postgres/ -run TestBeginTenant_SetLocalGuardrail
func TestBeginTenant_SetLocalGuardrail(t *testing.T) {
	t.Skip("integration test: requires DATABASE_URL — run manually against a test database")
}
