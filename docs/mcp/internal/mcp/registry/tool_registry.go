package registry

import (
	"fmt"
	"sync"

	"github.com/cartaopro/mcp/internal/mcp/context"
)

// MCPTool defines the interface for an executable capability.
type MCPTool interface {
	Name() string
	Execute(ctx context.MCPContext, input map[string]any) (any, error)
}

// DiscoverableTool extends MCPTool with metadata required for the Discovery API.
// Tools that implement this interface will be surfaced via GET /v1/tools with
// full schema and categorisation data. Tools that only implement MCPTool are
// included in discovery with empty metadata fields.
type DiscoverableTool interface {
	MCPTool
	Label() string
	Description() string
	Category() string
	// AllowedSources returns the list of sources permitted to invoke this tool
	// (e.g. "automation", "agent", "api"). An empty slice means all sources.
	AllowedSources() []string
	InputSchema() map[string]any
	OutputSchema() map[string]any
}

// ToolDefinition is the discovery payload for a single registered tool.
type ToolDefinition struct {
	Name           string         `json:"name"`
	Label          string         `json:"label"`
	Description    string         `json:"description"`
	Category       string         `json:"category"`
	AllowedSources []string       `json:"allowedSources"`
	InputSchema    map[string]any `json:"inputSchema"`
	OutputSchema   map[string]any `json:"outputSchema,omitempty"`
}

// ToolRegistry manages the registration and discovery of tools.
type ToolRegistry struct {
	tools map[string]MCPTool
	mu    sync.RWMutex
}

func NewToolRegistry() *ToolRegistry {
	return &ToolRegistry{
		tools: make(map[string]MCPTool),
	}
}

func (r *ToolRegistry) Register(tool MCPTool) {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.tools[tool.Name()] = tool
}

func (r *ToolRegistry) Resolve(name string) (MCPTool, error) {
	r.mu.RLock()
	defer r.mu.RUnlock()
	tool, ok := r.tools[name]
	if !ok {
		return nil, fmt.Errorf("tool not found: %s", name)
	}
	return tool, nil
}

// List returns ToolDefinition entries for all registered tools, optionally
// filtered by source. If source is empty all tools are returned.
// Tools that implement DiscoverableTool contribute full metadata; others are
// included with empty fields so discovery is always comprehensive.
func (r *ToolRegistry) List(source string) []ToolDefinition {
	r.mu.RLock()
	defer r.mu.RUnlock()

	defs := make([]ToolDefinition, 0, len(r.tools))
	for _, tool := range r.tools {
		var def ToolDefinition
		if dt, ok := tool.(DiscoverableTool); ok {
			def = ToolDefinition{
				Name:           dt.Name(),
				Label:          dt.Label(),
				Description:    dt.Description(),
				Category:       dt.Category(),
				AllowedSources: dt.AllowedSources(),
				InputSchema:    dt.InputSchema(),
				OutputSchema:   dt.OutputSchema(),
			}
		} else {
			def = ToolDefinition{
				Name:           tool.Name(),
				AllowedSources: []string{},
			}
		}

		// If a source filter is active, skip tools that have an explicit
		// AllowedSources list that does not include the requested source.
		if source != "" && len(def.AllowedSources) > 0 {
			allowed := false
			for _, s := range def.AllowedSources {
				if s == source {
					allowed = true
					break
				}
			}
			if !allowed {
				continue
			}
		}

		defs = append(defs, def)
	}
	return defs
}
