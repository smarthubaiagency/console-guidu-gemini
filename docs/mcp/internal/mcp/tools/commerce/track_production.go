package commercetools

import (
	"errors"
	"fmt"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"

	mcpContext "github.com/cartaopro/mcp/internal/mcp/context"
	"github.com/cartaopro/mcp/internal/storage/postgres"
)

// TrackProductionTool implements the `commerce.track_production` MCP tool.
//
// Queries the ProductionOrder table using RLS-backed tenant isolation and
// translates the raw status enum into a human-readable Portuguese string
// that an AI agent can relay directly to the customer.
//
// Namespace: commerce
// Input:     orderCode (required)
// Output:    { orderCode, status, friendlyStatus, quantity, trackingNumber }
type TrackProductionTool struct {
	repo *postgres.ProductionRepo
}

// NewTrackProductionTool creates a commerce.track_production tool wired to the given DB pool.
func NewTrackProductionTool(pool *pgxpool.Pool) *TrackProductionTool {
	return &TrackProductionTool{repo: postgres.NewProductionRepo(pool)}
}

func (t *TrackProductionTool) Name() string  { return "commerce.track_production" }
func (t *TrackProductionTool) Label() string { return "Rastrear Produção de Hardware NFC" }
func (t *TrackProductionTool) Description() string {
	return "Retorna o status atual da ordem de produção física do Cartão NFC dado o código do pedido."
}
func (t *TrackProductionTool) Category() string         { return "commerce" }
func (t *TrackProductionTool) AllowedSources() []string { return []string{"automation", "agent"} }
func (t *TrackProductionTool) InputSchema() map[string]any {
	return map[string]any{
		"properties": map[string]any{
			"orderCode": map[string]any{
				"type":        "string",
				"title":       "Código do Pedido",
				"description": "Código único do pedido no Vendure (ex: XF3GHK).",
			},
		},
		"required": []string{"orderCode"},
	}
}
func (t *TrackProductionTool) OutputSchema() map[string]any {
	return map[string]any{
		"properties": map[string]any{
			"orderCode":      map[string]any{"type": "string", "title": "Código do pedido"},
			"status":         map[string]any{"type": "string", "title": "Status (raw)"},
			"friendlyStatus": map[string]any{"type": "string", "title": "Status amigável em português"},
			"quantity":       map[string]any{"type": "number", "title": "Quantidade de cartões"},
			"trackingNumber": map[string]any{"type": "string", "title": "Código de rastreio (transportadora)"},
		},
	}
}

// Execute queries the ProductionOrder for the given orderCode, scoped to the
// authenticated workspace via RLS.
func (t *TrackProductionTool) Execute(ctx mcpContext.MCPContext, input map[string]any) (any, error) {
	// Validate workspace context
	if _, err := uuid.Parse(ctx.WorkspaceID); err != nil {
		return nil, fmt.Errorf("commerce.track_production: invalid workspace_id: %w", err)
	}

	orderCode, ok := input["orderCode"].(string)
	if !ok || orderCode == "" {
		return nil, fmt.Errorf("commerce.track_production: orderCode is required")
	}

	rec, err := t.repo.GetByOrderCode(ctx.GoContext(), orderCode)
	if err != nil {
		// Distinguish "not found" from actual errors
		if errors.Is(err, postgres.ErrNotFound) {
			return nil, fmt.Errorf("commerce.track_production: nenhuma ordem de produção encontrada para o pedido %s", orderCode)
		}
		return nil, fmt.Errorf("commerce.track_production: %w", err)
	}

	result := map[string]any{
		"orderCode":      rec.OrderCode,
		"status":         rec.Status,
		"friendlyStatus": productionStatusToFriendly(rec.Status),
		"quantity":       rec.Quantity,
	}
	if rec.TrackingNumber != nil {
		result["trackingNumber"] = *rec.TrackingNumber
	} else {
		result["trackingNumber"] = nil
	}

	return result, nil
}

// ─── Status Translation ────────────────────────────────────────────────────────

// productionStatusToFriendly maps ProductionOrder status values to user-facing Portuguese strings.
func productionStatusToFriendly(status string) string {
	switch status {
	case "QUEUED":
		return "Na fila de impressão"
	case "PROCESSING":
		return "Em produção"
	case "PRINTED":
		return "Impresso — aguardando envio"
	case "SHIPPED":
		return "Enviado — em trânsito"
	case "DELIVERED":
		return "Entregue"
	case "CANCELLED":
		return "Cancelado"
	default:
		return status
	}
}
