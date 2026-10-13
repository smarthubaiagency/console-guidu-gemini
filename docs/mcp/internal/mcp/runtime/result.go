package runtime

// MCPResult represents the outcome of an MCP execution.
type MCPResult struct {
	Data     any `json:"data"`
	Metadata any `json:"metadata,omitempty"`
}

// ExecutionStatus is the terminal state of a direct execution request.
type ExecutionStatus string

const (
	ExecutionStatusCompleted ExecutionStatus = "completed"
	ExecutionStatusError     ExecutionStatus = "error"
	ExecutionStatusDenied    ExecutionStatus = "denied"
)

// ExecutionResult is the HTTP response body for POST /v1/command/execute/direct.
// It wraps MCPResult with enriched identity and status fields consumed by web clients.
type ExecutionResult struct {
	Success     bool            `json:"success"`
	ExecutionID string          `json:"executionId"`
	Tool        string          `json:"tool"`
	Status      ExecutionStatus `json:"status"`
	Data        any             `json:"data,omitempty"`
	Error       string          `json:"error,omitempty"`
	DurationMs  int             `json:"durationMs"`
}
