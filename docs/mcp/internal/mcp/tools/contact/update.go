package contacttools

import (
	"fmt"

	"github.com/google/uuid"

	"github.com/cartaopro/mcp/internal/domain"
	mcpContext "github.com/cartaopro/mcp/internal/mcp/context"
	"github.com/cartaopro/mcp/internal/storage/postgres"
	"github.com/jackc/pgx/v5/pgxpool"
)

// UpdateTool implements the `contact.update` MCP tool.
// It partially updates an existing Contact record (PATCH semantics).
//
// Namespace: contact
// Input:     id (UUID, required), data (map with any subset of: fullName, firstName, lastName, email, phone, whatsapp, metadata)
// Output:    the updated Contact object
type UpdateTool struct {
	repo *postgres.ContactRepo
}

// NewUpdateTool creates a contact.update tool wired to the given DB pool.
func NewUpdateTool(pool *pgxpool.Pool) *UpdateTool {
	return &UpdateTool{repo: postgres.NewContactRepo(pool)}
}

func (t *UpdateTool) Name() string  { return "contact.update" }
func (t *UpdateTool) Label() string { return "Atualizar Contato" }
func (t *UpdateTool) Description() string {
	return "Atualiza parcialmente um contato existente no workspace."
}
func (t *UpdateTool) Category() string         { return "contact" }
func (t *UpdateTool) AllowedSources() []string { return []string{"automation", "agent"} }
func (t *UpdateTool) InputSchema() map[string]any {
	return map[string]any{
		"properties": map[string]any{
			"id":   map[string]any{"type": "string", "title": "ID do contato", "description": "UUID do contato a ser atualizado (obrigatório)."},
			"data": map[string]any{"type": "object", "title": "Dados para atualizar", "description": "Campos a atualizar: fullName, firstName, lastName, email, phone, whatsapp, metadata."},
		},
		"required": []string{"id", "data"},
	}
}
func (t *UpdateTool) OutputSchema() map[string]any {
	return map[string]any{
		"properties": map[string]any{
			"id":        map[string]any{"type": "string", "title": "ID do contato"},
			"fullName":  map[string]any{"type": "string", "title": "Nome completo"},
			"updatedAt": map[string]any{"type": "string", "title": "Atualizado em"},
		},
	}
}

// Execute validates the input, builds a partial update, and persists it.
func (t *UpdateTool) Execute(ctx mcpContext.MCPContext, input map[string]any) (any, error) {
	idStr, _ := input["id"].(string)
	if idStr == "" {
		return nil, fmt.Errorf("contact.update: id is required")
	}

	contactID, err := uuid.Parse(idStr)
	if err != nil {
		return nil, fmt.Errorf("contact.update: invalid id: %w", err)
	}

	data, ok := input["data"].(map[string]any)
	if !ok || len(data) == 0 {
		return nil, fmt.Errorf("contact.update: data map is required and must not be empty")
	}

	updateInput := domain.ContactUpdateInput{
		FullName:  stringPtr(data, "fullName"),
		FirstName: stringPtr(data, "firstName"),
		LastName:  stringPtr(data, "lastName"),
		Email:     stringPtr(data, "email"),
		Phone:     stringPtr(data, "phone"),
		Whatsapp:  stringPtr(data, "whatsapp"),
		Source:    stringPtr(data, "source"),
	}

	if m, ok := data["metadata"].(map[string]any); ok {
		updateInput.Metadata = m
	}

	contact, err := t.repo.Update(ctx.GoContext(), contactID, updateInput)
	if err != nil {
		return nil, fmt.Errorf("contact.update: %w", err)
	}

	return contact, nil
}
