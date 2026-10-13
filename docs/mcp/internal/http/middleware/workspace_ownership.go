package middleware

import (
	"encoding/json"
	"net/http"

	"github.com/cartaopro/mcp/internal/observability/httpmw"
	"github.com/cartaopro/mcp/internal/observability/log"
	"github.com/cartaopro/mcp/internal/tenant"
	"github.com/jackc/pgx/v5/pgxpool"
)

const systemWorkspaceID = "00000000-0000-0000-0000-000000000000"

// WorkspaceOwnership returns a middleware that verifies the authenticated user
// has an active membership in the requested workspace.
// It must run after JWTAuth (which injects tenant.Claims into the context).
// If workspaceID == systemWorkspaceID (Admin bypass), the check is skipped.
func WorkspaceOwnership(db *pgxpool.Pool, logger *log.Logger) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			claims, err := tenant.FromContext(r.Context())
			if err != nil {
				logger.Warn("workspace ownership: no tenant claims in context")
				writeOwnershipError(w, http.StatusUnauthorized, "unauthorized", "Missing identity claims")
				return
			}

			workspaceID := r.Header.Get(httpmw.HeaderWorkspaceID)
			if workspaceID == "" {
				logger.Warn("workspace ownership: missing workspace ID header")
				writeOwnershipError(w, http.StatusBadRequest, "bad_request", "Missing X-Cartaopro-Workspace-Id header")
				return
			}

			// Admin bypass: System Workspace Soberano
			if workspaceID == systemWorkspaceID {
				next.ServeHTTP(w, r)
				return
			}

			// Verify membership using the unique index WorkspaceMember_userId_workspaceId_key
			var exists int
			queryErr := db.QueryRow(r.Context(),
				`-- Guardrail: workspace scoped query. Do not remove tenant filter.
SELECT 1 FROM public."WorkspaceMember" WHERE "userId" = $1 AND "workspaceId" = $2 LIMIT 1`,
				claims.UserID, workspaceID,
			).Scan(&exists)

			if queryErr != nil {
				logger.Warn("workspace ownership: membership not found",
					log.String("user_id", claims.UserID),
					log.String("workspace_id", workspaceID))
				writeOwnershipError(w, http.StatusForbidden, "forbidden", "Access denied: workspace membership required")
				return
			}

			next.ServeHTTP(w, r)
		})
	}
}

func writeOwnershipError(w http.ResponseWriter, status int, code, message string) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	json.NewEncoder(w).Encode(map[string]string{"error": code, "message": message}) //nolint:errcheck
}
