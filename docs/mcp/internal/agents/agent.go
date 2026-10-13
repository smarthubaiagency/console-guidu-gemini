package agents

import (
	"context"

	"github.com/cartaopro/mcp/internal/agents/interpreter"
	"github.com/cartaopro/mcp/internal/agents/registry"
	"github.com/cartaopro/mcp/internal/observability/log"
)

// Agent is the cognitive orchestrator for user interactions.
// Side-Effect Free: no direct database or network access.
type Agent struct {
	parser    *interpreter.IntentParser
	extractor *interpreter.EntityExtractor
	gating    *interpreter.ConfidenceGating
	builder   *CommandBuilder
	caps      registry.CapabilityProvider
	logger    *log.Logger
}

func NewAgent(caps registry.CapabilityProvider, logger *log.Logger) *Agent {
	return &Agent{
		parser:    interpreter.NewIntentParser(),
		extractor: interpreter.NewEntityExtractor(),
		gating:    interpreter.NewConfidenceGating(),
		builder:   NewCommandBuilder(),
		caps:      caps,
		logger:    logger,
	}
}

// Interpret transforms natural language into a standardized AgentResponse.
func (a *Agent) Interpret(_ context.Context, input string, workspaceID string) *AgentResponse {
	intent := a.parser.Parse(input)
	entities := a.extractor.Extract(input)

	confidence := 0.0
	if intent.Domain != "unknown" && intent.Action != "unknown" {
		confidence = 0.9
	}

	if len(entities.Ambiguous) > 0 && len(entities.IDs) == 0 && len(entities.Slugs) == 0 {
		confidence -= 0.2
	}

	verdict := a.gating.Evaluate(confidence)

	resp := NewAgentResponse("I've interpreted your request.", confidence)

	switch verdict {
	case interpreter.VerdictClarify:
		resp.Message = "I'm not sure what you want to do. Could you please clarify?"
		return resp

	case interpreter.VerdictReview:
		resp.Warnings = append(resp.Warnings, "This action requires review due to potential ambiguity.")
		fallthrough

	case interpreter.VerdictPropose:
		proposal, err := a.builder.Build(intent, entities, workspaceID)
		if err != nil {
			resp.Message = "I encountered an error planning your request: " + err.Error()
			resp.Confidence = 0.4
			return resp
		}
		resp.Proposal = proposal
		if verdict == interpreter.VerdictReview {
			resp.Proposal.RequiresHumanApproval = true
		}
	}

	return resp
}
