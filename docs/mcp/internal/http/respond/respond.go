// Package respond provides helpers for writing standardised JSON HTTP responses
// in the MCP server. Error payloads follow the structure:
//
//	{ "error": "snake_case_code", "message": "Human-readable description", "error_id": "uuid-v4" }
//
// In production (APP_ENV=production) all internal/infrastructure errors are sanitised:
// the original message is replaced by a generic string and the full error is logged
// server-side with the same error_id for correlation.
package respond

import (
	"encoding/json"
	"errors"
	"net/http"
	"os"

	"github.com/cartaopro/mcp/internal/antireplay"
	"github.com/cartaopro/mcp/internal/mcp/runtime"
	"github.com/cartaopro/mcp/internal/observability/log"
	"github.com/cartaopro/mcp/internal/tenant"
	"github.com/google/uuid"
)

type errorBody struct {
	Error   string `json:"error"`
	Message string `json:"message"`
	ErrorID string `json:"error_id"`
}

// JSON writes v as a JSON response with the given HTTP status code.
func JSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	json.NewEncoder(w).Encode(v) //nolint:errcheck
}

// Error maps err to its canonical HTTP status code, generates a UUID error_id,
// sanitises the message in production, logs the original error with the error_id,
// and writes a standardised JSON error payload.
//
// The request r is used to extract the path and workspace_id for the audit log.
func Error(w http.ResponseWriter, r *http.Request, err error, logger *log.Logger) {
	errorID := uuid.New().String()
	code, key, msg := resolveError(err)

	// In production, replace internal error messages with a safe generic string.
	isProduction := os.Getenv("APP_ENV") == "production"
	if isProduction && code >= http.StatusInternalServerError {
		msg = "Ocorreu um erro interno de processamento. Informe o ID de erro ao suporte."
	}

	// Audit log: always emit the original error with the error_id for correlation.
	workspaceID := ""
	if claims, claimErr := tenant.FromContext(r.Context()); claimErr == nil {
		workspaceID = claims.WorkspaceID
	}
	logger.Error("request error",
		log.String("error_id", errorID),
		log.String("original_error", err.Error()),
		log.Int("status_code", code),
		log.String("path", r.URL.Path),
		log.String("workspace_id", workspaceID),
	)

	JSON(w, code, errorBody{Error: key, Message: msg, ErrorID: errorID})
}

func resolveError(err error) (int, string, string) {
	switch {
	case errors.Is(err, runtime.ErrTamperDetected):
		return http.StatusConflict, "tamper_detected", "Proposal integrity check failed"
	case errors.Is(err, antireplay.ErrReplayDetected):
		return http.StatusConflict, "replay_detected", "Request already processed"
	default:
		return http.StatusInternalServerError, "internal_error", "An unexpected error occurred"
	}
}
