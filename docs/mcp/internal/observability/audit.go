package observability

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"strings"
	"time"

	"github.com/cartaopro/mcp/internal/observability/log"
)

// sensitiveKeys is the canonical list of field names that must be redacted.
// Sourced from the Linkko Constitution §3.3 and mcp-go legacy service.go.
// All comparisons are case-insensitive.
var sensitiveKeys = []string{"api_key", "secret", "password", "token", "credential"}

// AuditEvent holds the privacy-safe audit record for one tool execution.
//
// Chain-of-custody guarantee:
//   - InputHash / OutputHash  → SHA-256 of the ORIGINAL payload (before redaction)
//   - InputRedacted / OutputRedacted → deep copy with sensitive fields replaced by "[REDACTED]"
//   - ProposalHash → canonical SHA-256 of the AgentProposal that originated this execution
//
// Raw payloads are NEVER stored or logged. This complies with LGPD and Linkko Constitution §3.3.
type AuditEvent struct {
	ExecutionID    string
	ProposalHash   string // canonical SHA-256 of the originating AgentProposal; empty for direct executions
	Timestamp      time.Time
	ActorID        string
	ToolName       string
	InputHash      string // SHA-256 hex of the ORIGINAL (pre-redaction) input payload
	OutputHash     string // SHA-256 hex of the ORIGINAL (pre-redaction) output payload; empty on error/denial
	InputRedacted  any    // redacted input map — safe to log, sensitive values are "[REDACTED]"
	OutputRedacted any    // redacted output map — safe to log; nil on error/denial
	ResultStatus   string // "completed" | "denied" | "error"
}

// HashPayload calculates the SHA-256 hex digest of v marshalled as canonical JSON.
// MUST be called on the ORIGINAL payload, before any redaction, to preserve integrity.
func HashPayload(v any) string {
	b, err := json.Marshal(v)
	if err != nil {
		b = []byte("{}")
	}
	sum := sha256.Sum256(b)
	return hex.EncodeToString(sum[:])
}

// RedactPayload returns a deep copy of v with all sensitive fields replaced by "[REDACTED]".
// Sensitive fields: api_key, secret, password, token, credential (case-insensitive, recursive).
// If v is not a JSON object, an empty map is returned — raw scalar values are never logged.
func RedactPayload(v any) any {
	b, err := json.Marshal(v)
	if err != nil {
		return map[string]any{}
	}
	var m map[string]any
	if err := json.Unmarshal(b, &m); err != nil {
		// Not a JSON object — return empty map rather than exposing the raw value.
		return map[string]any{}
	}
	recursiveRedact(m)
	return m
}

func recursiveRedact(m map[string]any) {
	for k, v := range m {
		if isSensitive(k) {
			m[k] = "[REDACTED]"
			continue
		}
		if nested, ok := v.(map[string]any); ok {
			recursiveRedact(nested)
		}
	}
}

func isSensitive(key string) bool {
	lower := strings.ToLower(key)
	for _, sk := range sensitiveKeys {
		if lower == sk {
			return true
		}
	}
	return false
}

// LogEvent emits a structured audit log entry via the provided logger.
// This is the single authorised audit sink in the MCP kernel.
// InputRedacted and OutputRedacted must already have sensitive fields replaced — never pass raw data.
func LogEvent(logger *log.Logger, event AuditEvent) {
	logger.Info("mcp audit event",
		log.String("module", "audit"),
		log.String("execution_id", event.ExecutionID),
		log.String("proposal_hash", event.ProposalHash),
		log.String("actor_id", event.ActorID),
		log.String("tool_name", event.ToolName),
		log.String("input_hash", event.InputHash),
		log.String("output_hash", event.OutputHash),
		log.String("input_redacted", marshalSafe(event.InputRedacted)),
		log.String("output_redacted", marshalSafe(event.OutputRedacted)),
		log.String("result_status", event.ResultStatus),
		log.String("timestamp", event.Timestamp.Format(time.RFC3339Nano)),
	)
}

// marshalSafe serialises v to a JSON string for log embedding. Returns empty string on nil or error.
func marshalSafe(v any) string {
	if v == nil {
		return ""
	}
	b, err := json.Marshal(v)
	if err != nil {
		return ""
	}
	return string(b)
}
