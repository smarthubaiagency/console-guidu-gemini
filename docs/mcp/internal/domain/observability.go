package domain

// AuditEventInput is the input for persisting an AiAuditEvent record.
// ExecutionID is optional; when nil it is stored as SQL NULL, satisfying
// the optional FK constraint to AiExecution.
type AuditEventInput struct {
	WorkspaceID     string
	ExecutionID     *string        // nil → SQL NULL (optional FK to AiExecution)
	ActorType       string         // e.g. "user", "system"
	ActorID         string
	EventType       string         // e.g. "TOOL_CALL", "POLICY_DENIED"
	PayloadHash     string         // SHA-256 of original (pre-redaction) input
	PayloadRedacted map[string]any // deep-redacted input; nil stored as SQL NULL
	ProposalHash    string         // canonical SHA-256 of originating proposal; empty → ""
	ProposalID      *string        // UUID of originating proposal; nil → SQL NULL
}

// ExecutionSpanInput is the input for persisting an AiExecutionSpan record.
// Requires a pre-existing AiExecution row (FK: workspaceId + executionId).
// Column mapping follows the Prisma schema (camelCase): provider, model,
// promptHash, responseHash, latencyMs, status.
type ExecutionSpanInput struct {
	WorkspaceID     string
	ExecutionID     string         // required; FK to AiExecution (workspaceId, executionId)
	Provider        string         // e.g. "mcp"
	Model           string         // tool name, e.g. "contact.create"
	PromptHash      string         // SHA-256 of tool input (maps to promptHash column)
	ResponseHash    *string        // SHA-256 of tool output; nil on error/denial (maps to responseHash)
	LatencyMs       *int           // execution duration in milliseconds (maps to latencyMs column)
	Status          string         // "completed" | "error" | "denied"
	PayloadRedacted map[string]any // deep-redacted tool input; nil stored as SQL NULL
}
