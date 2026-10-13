package handler

import (
	"encoding/json"
	"errors"
	"net/http"
	"strings"
	"time"

	"github.com/cartaopro/mcp/internal/antireplay"
	"github.com/cartaopro/mcp/internal/http/respond"
	"github.com/cartaopro/mcp/internal/mcp/command"
	"github.com/cartaopro/mcp/internal/mcp/registry"
	mcpRuntime "github.com/cartaopro/mcp/internal/mcp/runtime"
	"github.com/cartaopro/mcp/internal/observability/log"
	"github.com/cartaopro/mcp/internal/tenant"
)

// ExecuteDirectHandler serves POST /v1/command/execute/direct.
// Unlike /v1/command/execute (Agent Layer), this handler executes a single tool
// deterministically without proposal generation or human-approval gating.
type ExecuteDirectHandler struct {
	executor *mcpRuntime.Executor
	registry *registry.ToolRegistry
	logger   *log.Logger
}

// NewExecuteDirect constructs an ExecuteDirectHandler.
func NewExecuteDirect(executor *mcpRuntime.Executor, reg *registry.ToolRegistry, logger *log.Logger) *ExecuteDirectHandler {
	return &ExecuteDirectHandler{executor: executor, registry: reg, logger: logger}
}

// executeDirectRequest is the expected JSON body for POST /v1/command/execute/direct.
type executeDirectRequest struct {
	Tool     string         `json:"tool"`
	Input    map[string]any `json:"input"`
	Source   string         `json:"source"`
	SourceID string         `json:"sourceId"`
}

// HandleExecuteDirect handles POST /v1/command/execute/direct.
//
// Required headers (enforced by middleware):
//   - Authorization: Bearer <jwt>
//   - X-Cartaopro-Hmac-Signature / X-Cartaopro-Timestamp (S2S HMAC)
//   - X-Cartaopro-Workspace-Id: <uuid>
//
// Request body:
//
//	{
//	  "tool":     "contact.create",
//	  "input":    { ... },
//	  "source":   "automation",   // optional, informational
//	  "sourceId": "<uuid>"        // optional, informational / idempotency key
//	}
//
// Response 200: ExecutionResult JSON.
// Response 400: malformed request body or missing tool name.
// Response 403: policy denied.
// Response 404: tool not registered.
// Response 409: tamper or replay detected.
// Response 422: tool returned a business-logic error.
func (h *ExecuteDirectHandler) HandleExecuteDirect(w http.ResponseWriter, r *http.Request) {
	start := time.Now()

	// Identity — injected by authMW (JWT) + workspaceOwnershipMW.
	claims, err := tenant.FromContext(r.Context())
	if err != nil {
		respond.JSON(w, http.StatusUnauthorized, map[string]string{
			"error":   "unauthorized",
			"message": "Missing identity claims",
		})
		return
	}

	var req executeDirectRequest
	if decodeErr := json.NewDecoder(r.Body).Decode(&req); decodeErr != nil {
		respond.JSON(w, http.StatusBadRequest, map[string]string{
			"error":   "invalid_request",
			"message": decodeErr.Error(),
		})
		return
	}

	if req.Tool == "" {
		respond.JSON(w, http.StatusBadRequest, map[string]string{
			"error":   "invalid_request",
			"message": "tool is required",
		})
		return
	}

	// Fail-fast: verify the tool is registered before executing.
	if _, resolveErr := h.registry.Resolve(req.Tool); resolveErr != nil {
		respond.JSON(w, http.StatusNotFound, map[string]string{
			"error":   "tool_not_found",
			"message": "unknown tool: " + req.Tool,
		})
		return
	}

	cmd := command.MCPCommand{
		Name:  req.Tool,
		Input: req.Input,
	}
	if cmd.Input == nil {
		cmd.Input = map[string]any{}
	}

	h.logger.Info("execute/direct: dispatching",
		log.String("tool", req.Tool),
		log.String("workspace_id", claims.WorkspaceID),
		log.String("source", req.Source),
	)

	mcpResult, execErr := h.executor.Execute(r.Context(), cmd, claims.WorkspaceID, claims.UserID)
	durationMs := int(time.Since(start).Milliseconds())

	if execErr != nil {
		// Integrity violations — tamper or replay → 409.
		if errors.Is(execErr, mcpRuntime.ErrTamperDetected) || errors.Is(execErr, antireplay.ErrReplayDetected) {
			respond.Error(w, r, execErr, h.logger)
			return
		}

		// Policy denial → 403.
		if strings.HasPrefix(execErr.Error(), "authorization denied:") {
			respond.JSON(w, http.StatusForbidden, map[string]string{
				"error":   "forbidden",
				"message": execErr.Error(),
			})
			return
		}

		// Tool business-logic error → 422.
		respond.JSON(w, http.StatusUnprocessableEntity, map[string]string{
			"error":   "tool_error",
			"message": execErr.Error(),
		})
		return
	}

	result := mcpRuntime.ExecutionResult{
		Success:    true,
		Tool:       req.Tool,
		Status:     mcpRuntime.ExecutionStatusCompleted,
		Data:       mcpResult.Data,
		DurationMs: durationMs,
	}

	respond.JSON(w, http.StatusOK, result)
}
