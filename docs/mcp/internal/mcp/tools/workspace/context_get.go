package workspacetools

import (
	"fmt"

	"github.com/google/uuid"

	mcpContext "github.com/cartaopro/mcp/internal/mcp/context"
	"github.com/cartaopro/mcp/internal/storage/postgres"
	"github.com/jackc/pgx/v5/pgxpool"
)

// ContextGetTool implements the `workspace.context.get` MCP tool.
// It returns the workspace display name, active plan name, and timezone.
//
// Namespace: workspace
// Input:     empty (workspace_id is taken from the MCPContext envelope)
// Output:    { name, plan, timezone }
type ContextGetTool struct {
	repo *postgres.WorkspaceRepo
}

// NewContextGetTool creates a workspace.context.get tool wired to the given DB pool.
func NewContextGetTool(pool *pgxpool.Pool) *ContextGetTool {
	return &ContextGetTool{repo: postgres.NewWorkspaceRepo(pool)}
}

func (t *ContextGetTool) Name() string  { return "workspace.context.get" }
func (t *ContextGetTool) Label() string { return "Obter Contexto do Workspace" }
func (t *ContextGetTool) Description() string {
	return "Retorna nome, plano e fuso horário do workspace atual."
}
func (t *ContextGetTool) Category() string         { return "workspace" }
func (t *ContextGetTool) AllowedSources() []string { return []string{"automation", "agent"} }
func (t *ContextGetTool) InputSchema() map[string]any {
	return map[string]any{"properties": map[string]any{}}
}
func (t *ContextGetTool) OutputSchema() map[string]any {
	return map[string]any{
		"properties": map[string]any{
			"name":     map[string]any{"type": "string", "title": "Nome do workspace"},
			"plan":     map[string]any{"type": "string", "title": "Plano ativo"},
			"timezone": map[string]any{"type": "string", "title": "Fuso horário"},
		},
	}
}

// Execute resolves the workspace context for the tenant in the MCPContext envelope.
// No input fields are required; the workspace_id is read from ctx.WorkspaceID.
func (t *ContextGetTool) Execute(ctx mcpContext.MCPContext, _ map[string]any) (any, error) {
	wsID, err := uuid.Parse(ctx.WorkspaceID)
	if err != nil {
		return nil, fmt.Errorf("workspace.context.get: invalid workspace_id: %w", err)
	}

	// Pass the MCPContext's Go context so BeginTenant can read the tenant claims.
	wctx, err := t.repo.GetContext(ctx.GoContext(), wsID)
	if err != nil {
		return nil, fmt.Errorf("workspace.context.get: %w", err)
	}

	return map[string]any{
		"name":     wctx.Name,
		"plan":     wctx.Plan,
		"timezone": wctx.Timezone,
	}, nil
}
