package runtime

import "github.com/cartaopro/mcp/internal/mcp/command"

// AgentProposal is the formal contract between the AI layer and the MCP execution kernel.
// It carries the agent's intent, natural-language explanation, the list of commands to run,
// a confidence score, and a human-approval flag derived from the Confidence Gating rules.
//
// The proposal MUST be accompanied by a ProposalHash (see anti_tamper.go) to prevent
// frontend tampering between the agent's decision and the server-side execution.
type AgentProposal struct {
	Intent                string               `json:"intent"`
	Explanation           string               `json:"explanation"`
	Commands              []command.MCPCommand `json:"commands"`
	Confidence            float64              `json:"confidence"`
	RequiresHumanApproval bool                 `json:"requires_human_approval"`
}
