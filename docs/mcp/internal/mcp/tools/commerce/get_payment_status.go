package commercetools

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"os"
	"time"

	mcpContext "github.com/cartaopro/mcp/internal/mcp/context"
)

// GetPaymentStatusTool implements the `commerce.get_payment_status` MCP tool.
//
// Queries the Vendure Shop API for an order by its code and translates the
// raw Vendure order state into a human-readable Portuguese status string.
//
// Namespace: commerce
// Input:     orderCode (required), channelToken (optional — workspace-scoped)
// Output:    { orderCode, state, friendlyStatus, totalWithTax }
type GetPaymentStatusTool struct {
	shopAPIURL string
	httpClient *http.Client
}

// NewGetPaymentStatusTool creates a commerce.get_payment_status tool.
// shopAPIURL defaults to the VENDURE_SHOP_API_URL env var or http://localhost:3001/shop-api.
func NewGetPaymentStatusTool() *GetPaymentStatusTool {
	shopAPIURL := os.Getenv("VENDURE_SHOP_API_URL")
	if shopAPIURL == "" {
		shopAPIURL = "http://localhost:3001/shop-api"
	}
	return &GetPaymentStatusTool{
		shopAPIURL: shopAPIURL,
		httpClient: &http.Client{Timeout: 10 * time.Second},
	}
}

func (t *GetPaymentStatusTool) Name() string  { return "commerce.get_payment_status" }
func (t *GetPaymentStatusTool) Label() string { return "Consultar Status de Pagamento" }
func (t *GetPaymentStatusTool) Description() string {
	return "Retorna o status de pagamento de um pedido Vendure dado o seu código."
}
func (t *GetPaymentStatusTool) Category() string         { return "commerce" }
func (t *GetPaymentStatusTool) AllowedSources() []string { return []string{"automation", "agent"} }
func (t *GetPaymentStatusTool) InputSchema() map[string]any {
	return map[string]any{
		"properties": map[string]any{
			"orderCode": map[string]any{
				"type":        "string",
				"title":       "Código do Pedido",
				"description": "Código único do pedido no Vendure (ex: XF3GHK).",
			},
			"channelToken": map[string]any{
				"type":        "string",
				"title":       "Token do Canal",
				"description": "Token do canal Vendure do workspace. Opcional — usa o canal padrão se omitido.",
			},
		},
		"required": []string{"orderCode"},
	}
}
func (t *GetPaymentStatusTool) OutputSchema() map[string]any {
	return map[string]any{
		"properties": map[string]any{
			"orderCode":      map[string]any{"type": "string", "title": "Código do pedido"},
			"state":          map[string]any{"type": "string", "title": "Estado Vendure (raw)"},
			"friendlyStatus": map[string]any{"type": "string", "title": "Status amigável em português"},
			"totalWithTax":   map[string]any{"type": "number", "title": "Total com impostos (centavos)"},
		},
	}
}

// Execute queries the Vendure Shop API for the order status.
func (t *GetPaymentStatusTool) Execute(ctx mcpContext.MCPContext, input map[string]any) (any, error) {
	orderCode, ok := input["orderCode"].(string)
	if !ok || orderCode == "" {
		return nil, fmt.Errorf("commerce.get_payment_status: orderCode is required")
	}

	channelToken, _ := input["channelToken"].(string)
	if channelToken == "" {
		channelToken = os.Getenv("DEFAULT_VENDURE_CHANNEL_TOKEN")
	}
	if channelToken == "" {
		channelToken = "default"
	}

	order, err := t.queryOrderByCode(ctx.GoContext(), orderCode, channelToken)
	if err != nil {
		return nil, fmt.Errorf("commerce.get_payment_status: %w", err)
	}
	if order == nil {
		return nil, fmt.Errorf("commerce.get_payment_status: order not found: %s", orderCode)
	}

	return map[string]any{
		"orderCode":      order.Code,
		"state":          order.State,
		"friendlyStatus": vendureStateToFriendly(order.State),
		"totalWithTax":   order.TotalWithTax,
	}, nil
}

// ─── Internal Types ────────────────────────────────────────────────────────────

type vendureOrder struct {
	Code         string  `json:"code"`
	State        string  `json:"state"`
	TotalWithTax float64 `json:"totalWithTax"`
}

type graphqlRequest struct {
	Query     string         `json:"query"`
	Variables map[string]any `json:"variables"`
}

type graphqlResponse[T any] struct {
	Data   T              `json:"data"`
	Errors []graphqlError `json:"errors,omitempty"`
}

type graphqlError struct {
	Message string `json:"message"`
}

type orderByCodeData struct {
	OrderByCode *vendureOrder `json:"orderByCode"`
}

// ─── Shop API Query ───────────────────────────────────────────────────────────

const orderByCodeQuery = `
query GetPaymentStatusByCode($code: String!) {
  orderByCode(code: $code) {
    code
    state
    totalWithTax
  }
}`

func (t *GetPaymentStatusTool) queryOrderByCode(
	ctx context.Context,
	orderCode string,
	channelToken string,
) (*vendureOrder, error) {
	payload := graphqlRequest{
		Query:     orderByCodeQuery,
		Variables: map[string]any{"code": orderCode},
	}

	body, err := json.Marshal(payload)
	if err != nil {
		return nil, fmt.Errorf("marshal request: %w", err)
	}

	req, err := http.NewRequestWithContext(ctx, http.MethodPost, t.shopAPIURL, bytes.NewReader(body))
	if err != nil {
		return nil, fmt.Errorf("build request: %w", err)
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("vendure-token", channelToken)

	resp, err := t.httpClient.Do(req)
	if err != nil {
		return nil, fmt.Errorf("http request: %w", err)
	}
	defer resp.Body.Close() //nolint:errcheck

	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("unexpected status: %d", resp.StatusCode)
	}

	var result graphqlResponse[orderByCodeData]
	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		return nil, fmt.Errorf("decode response: %w", err)
	}

	if len(result.Errors) > 0 {
		return nil, fmt.Errorf("graphql error: %s", result.Errors[0].Message)
	}

	return result.Data.OrderByCode, nil
}

// ─── State Translation ─────────────────────────────────────────────────────────

// vendureStateToFriendly maps Vendure order states to user-facing Portuguese strings.
func vendureStateToFriendly(state string) string {
	switch state {
	case "AddingItems":
		return "Carrinho aberto"
	case "ArrangingPayment":
		return "Aguardando pagamento"
	case "PaymentAuthorized":
		return "Pagamento autorizado"
	case "PaymentSettled":
		return "Pagamento aprovado"
	case "PartiallyShipped":
		return "Enviado parcialmente"
	case "Shipped":
		return "Enviado"
	case "PartiallyDelivered":
		return "Entregue parcialmente"
	case "Delivered":
		return "Entregue"
	case "Cancelled":
		return "Cancelado"
	case "Modifying":
		return "Em modificação"
	case "ArrangingAdditionalPayment":
		return "Aguardando pagamento adicional"
	default:
		return state
	}
}
