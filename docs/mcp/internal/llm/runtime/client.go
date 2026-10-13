package runtime

import (
	"context"
	"time"

	"github.com/google/uuid"
)

// Client is the interface for LLM providers.
type Client interface {
	Complete(ctx context.Context, req Request) (Response, error)
}

// Request represents an LLM completion request.
type Request struct {
	WorkspaceID uuid.UUID         `json:"workspace_id"`
	ExecutionID uuid.UUID         `json:"execution_id"`
	Provider    string            `json:"provider"`
	Model       string            `json:"model"`
	Prompt      string            `json:"prompt"`
	Temperature float64           `json:"temperature,omitempty"`
	MaxTokens   int               `json:"max_tokens,omitempty"`
	Metadata    map[string]string `json:"metadata,omitempty"`
}

// Response represents an LLM completion response.
type Response struct {
	OutputText  string      `json:"output_text"`
	UsageTokens *TokenUsage `json:"usage_tokens,omitempty"`
	Provider    string      `json:"provider"`
	Model       string      `json:"model"`
	LatencyMs   int64       `json:"latency_ms"`
}

// TokenUsage tracks token consumption.
type TokenUsage struct {
	InputTokens  int `json:"input_tokens"`
	OutputTokens int `json:"output_tokens"`
	TotalTokens  int `json:"total_tokens"`
}

// LLMSpan represents a single LLM call attempt for auditing.
type LLMSpan struct {
	ID           uuid.UUID  `json:"id"`
	ExecutionID  uuid.UUID  `json:"execution_id"`
	WorkspaceID  uuid.UUID  `json:"workspace_id"`
	Attempt      int        `json:"attempt"`
	Provider     string     `json:"provider"`
	Model        string     `json:"model"`
	Mode         string     `json:"mode,omitempty"`
	Status       string     `json:"status"` // running, success, failed
	ErrorClass   string     `json:"error_class,omitempty"`
	ErrorMessage string     `json:"error_message,omitempty"`
	LatencyMs    int64      `json:"latency_ms,omitempty"`
	TokensIn     int        `json:"tokens_in,omitempty"`
	TokensOut    int        `json:"tokens_out,omitempty"`
	InputHash    string     `json:"input_hash"`
	OutputHash   string     `json:"output_hash,omitempty"`
	StartedAt    time.Time  `json:"started_at"`
	FinishedAt   *time.Time `json:"finished_at,omitempty"`
}
