package agents

import (
	"fmt"

	"github.com/cartaopro/mcp/internal/agents/interpreter"
	"github.com/cartaopro/mcp/internal/mcp/command"
	"github.com/cartaopro/mcp/internal/mcp/runtime"
)

// AgentResponse is the versioned top-level response contract for the agent layer.
// SchemaVersion allows the frontend to apply version-aware response handling.
type AgentResponse struct {
	SchemaVersion string                 `json:"schemaVersion"`
	Proposal      *runtime.AgentProposal `json:"proposal,omitempty"`
	Metadata      map[string]any         `json:"metadata,omitempty"`
	Message       string                 `json:"message,omitempty"`
	Confidence    float64                `json:"confidence"`
	Warnings      []string               `json:"warnings,omitempty"`
}

// NewAgentResponse constructs a baseline AgentResponse with schema version 1.0.
func NewAgentResponse(message string, confidence float64) *AgentResponse {
	return &AgentResponse{
		SchemaVersion: "1.0",
		Message:       message,
		Confidence:    confidence,
		Metadata:      make(map[string]any),
	}
}

// CommandBuilder constructs an AgentProposal from parsed intent and entities.
// Side-Effect Free: no IO, no database, no network calls.
type CommandBuilder struct{}

// NewCommandBuilder returns a ready-to-use CommandBuilder.
func NewCommandBuilder() *CommandBuilder { return &CommandBuilder{} }

// Build constructs an AgentProposal from the parsed intent and extracted entities.
// Returns an error when the intent is ambiguous (domain or action is "unknown").
func (b *CommandBuilder) Build(intent interpreter.Intent, entities interpreter.Entities, workspaceID string) (*runtime.AgentProposal, error) {
	if intent.Domain == "unknown" || intent.Action == "unknown" {
		return nil, fmt.Errorf("ambiguous intent: domain=%q action=%q", intent.Domain, intent.Action)
	}

	toolName := intent.Domain + "." + intent.Action
	return &runtime.AgentProposal{
		Intent:                toolName,
		Explanation:           "Automated proposal from intent: " + intent.Raw,
		Commands:              []command.MCPCommand{{Name: toolName, Input: entitiesToInput(entities)}},
		Confidence:            0.9,
		RequiresHumanApproval: false,
	}, nil
}

func entitiesToInput(e interpreter.Entities) map[string]any {
	result := make(map[string]any, len(e.Fields)+len(e.IDs))
	for k, v := range e.Fields {
		result[k] = v
	}
	for i, id := range e.IDs {
		result[fmt.Sprintf("id_%d", i)] = id
	}
	return result
}
