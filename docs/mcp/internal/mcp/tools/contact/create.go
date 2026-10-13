package contacttools

import (
	"fmt"

	"github.com/google/uuid"

	"github.com/cartaopro/mcp/internal/domain"
	mcpContext "github.com/cartaopro/mcp/internal/mcp/context"
	"github.com/cartaopro/mcp/internal/storage/postgres"
	"github.com/jackc/pgx/v5/pgxpool"
)

// CreateTool implements the `contact.create` MCP tool.
// It validates the input, creates a Contact record via the ContactRepo,
// and returns the persisted entity.
//
// Namespace: contact
// Input:     fullName (required), email (optional), phone (optional), whatsapp (optional), metadata (optional)
// Output:    the persisted Contact object
type CreateTool struct {
	repo *postgres.ContactRepo
}

// NewCreateTool creates a contact.create tool wired to the given DB pool.
func NewCreateTool(pool *pgxpool.Pool) *CreateTool {
	return &CreateTool{repo: postgres.NewContactRepo(pool)}
}

func (t *CreateTool) Name() string             { return "contact.create" }
func (t *CreateTool) Label() string            { return "Criar Contato" }
func (t *CreateTool) Description() string      { return "Cria um novo contato no workspace." }
func (t *CreateTool) Category() string         { return "contact" }
func (t *CreateTool) AllowedSources() []string { return []string{"automation", "agent"} }
func (t *CreateTool) InputSchema() map[string]any {
	return map[string]any{
		"properties": map[string]any{
			"fullName":  map[string]any{"type": "string", "title": "Nome completo", "description": "Nome completo do contato (obrigatório)."},
			"firstName": map[string]any{"type": "string", "title": "Primeiro nome"},
			"lastName":  map[string]any{"type": "string", "title": "Sobrenome"},
			"email":     map[string]any{"type": "string", "title": "E-mail"},
			"phone":     map[string]any{"type": "string", "title": "Telefone"},
			"whatsapp":  map[string]any{"type": "string", "title": "WhatsApp"},
		},
		"required": []string{"fullName"},
	}
}
func (t *CreateTool) OutputSchema() map[string]any {
	return map[string]any{
		"properties": map[string]any{
			"id":        map[string]any{"type": "string", "title": "ID do contato"},
			"fullName":  map[string]any{"type": "string", "title": "Nome completo"},
			"email":     map[string]any{"type": "string", "title": "E-mail"},
			"createdAt": map[string]any{"type": "string", "title": "Criado em"},
		},
	}
}

// Execute validates the input and persists a new Contact record.
// Business rule: at least one of email, phone, or whatsapp must be present.
func (t *CreateTool) Execute(ctx mcpContext.MCPContext, input map[string]any) (any, error) {
	wsID, err := uuid.Parse(ctx.WorkspaceID)
	if err != nil {
		return nil, fmt.Errorf("contact.create: invalid workspace_id: %w", err)
	}

	fullName, _ := input["fullName"].(string)
	if fullName == "" {
		return nil, fmt.Errorf("contact.create: fullName is required")
	}

	email := stringPtr(input, "email")
	phone := stringPtr(input, "phone")
	whatsapp := stringPtr(input, "whatsapp")

	if email == nil && phone == nil && whatsapp == nil {
		return nil, fmt.Errorf("contact.create: at least one of email, phone, or whatsapp must be provided")
	}

	firstName := stringPtr(input, "firstName")
	lastName := stringPtr(input, "lastName")

	var metadata map[string]any
	if m, ok := input["metadata"].(map[string]any); ok {
		metadata = m
	}

	createInput := domain.ContactCreateInput{
		WorkspaceID: wsID,
		FullName:    fullName,
		FirstName:   firstName,
		LastName:    lastName,
		Email:       email,
		Phone:       phone,
		Whatsapp:    whatsapp,
		Source:      "ai_agent",
		Metadata:    metadata,
	}

	contact, err := t.repo.Create(ctx.GoContext(), createInput)
	if err != nil {
		return nil, fmt.Errorf("contact.create: %w", err)
	}

	return contact, nil
}

// stringPtr extracts a non-empty string pointer from a map value.
func stringPtr(m map[string]any, key string) *string {
	v, ok := m[key].(string)
	if !ok || v == "" {
		return nil
	}
	return &v
}
