package handler

import (
	"net/http"

	"github.com/cartaopro/mcp/internal/http/respond"
	"github.com/cartaopro/mcp/internal/mcp/registry"
	"github.com/cartaopro/mcp/internal/observability/log"
)

// DiscoveryHandler serves GET /v1/tools — returns the list of registered tools
// visible to the caller, optionally filtered by the ?source= query parameter.
type DiscoveryHandler struct {
	registry *registry.ToolRegistry
	logger   *log.Logger
}

// NewDiscovery constructs a DiscoveryHandler.
func NewDiscovery(reg *registry.ToolRegistry, logger *log.Logger) *DiscoveryHandler {
	return &DiscoveryHandler{registry: reg, logger: logger}
}

// HandleListTools handles GET /v1/tools.
//
// Query parameters:
//
//	source (optional) — filter tools to those that allow the given source
//	                    (e.g. "automation", "agent", "api"). Omit to return all.
//
// Response 200:
//
//	{"tools": [...ToolDefinition], "count": N}
func (h *DiscoveryHandler) HandleListTools(w http.ResponseWriter, r *http.Request) {
	source := r.URL.Query().Get("source")

	tools := h.registry.List(source)
	if tools == nil {
		tools = []registry.ToolDefinition{}
	}

	h.logger.Info("tool discovery request",
		log.String("source_filter", source),
		log.Int("tool_count", len(tools)),
	)

	respond.JSON(w, http.StatusOK, map[string]any{
		"tools": tools,
		"count": len(tools),
	})
}
