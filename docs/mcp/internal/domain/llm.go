package domain

import "time"

// LLMTokenUsage tracks token consumption for a single LLM call.
type LLMTokenUsage struct {
	InputTokens  int `json:"input_tokens"`
	OutputTokens int `json:"output_tokens"`
	TotalTokens  int `json:"total_tokens"`
}

// LLMSpan represents a single round-trip to an LLM provider for auditing and FinOps.
// Mirrors the llm/runtime.LLMSpan type to provide a domain-level view
// decoupled from the runtime transport layer.
type LLMSpan struct {
	Provider     string     `json:"provider"`
	Model        string     `json:"model"`
	Status       string     `json:"status"` // "success" | "failed"
	PromptTokens int        `json:"prompt_tokens"`
	CompTokens   int        `json:"completion_tokens"`
	LatencyMs    int64      `json:"latency_ms"`
	InputHash    string     `json:"input_hash"`
	OutputHash   string     `json:"output_hash,omitempty"`
	StartedAt    time.Time  `json:"started_at"`
	FinishedAt   *time.Time `json:"finished_at,omitempty"`
}
