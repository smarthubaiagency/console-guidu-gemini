package policy

import (
	"strings"

	"github.com/cartaopro/mcp/internal/mcp/command"
	"github.com/cartaopro/mcp/internal/mcp/context"
	"github.com/cartaopro/mcp/internal/observability/log"
)

// RuleFunc is a function that evaluates a specific set of rules.
type RuleFunc func(ctx context.MCPContext, cmd command.MCPCommand) PolicyDecision

// Engine is the central component for evaluating execution policies.
type Engine struct {
	logger     *log.Logger
	namespaces map[string]RuleFunc
}

func NewEngine(logger *log.Logger) *Engine {
	return &Engine{
		logger:     logger,
		namespaces: make(map[string]RuleFunc),
	}
}

func (e *Engine) RegisterNamespace(prefix string, fn RuleFunc) {
	e.namespaces[prefix] = fn
}

// Evaluate judges if an MCP command can be executed given the current context.
func (e *Engine) Evaluate(ctx context.MCPContext, cmd command.MCPCommand) PolicyDecision {
	e.logger.Info("policy evaluation started",
		log.String("module", "policy"),
		log.String("action", "evaluate"),
		log.String("command", cmd.Name),
		log.String("user_id", ctx.UserID),
		log.String("workspace_id", ctx.WorkspaceID),
	)

	var decision PolicyDecision
	found := false

	for prefix, fn := range e.namespaces {
		if strings.HasPrefix(cmd.Name, prefix) {
			decision = fn(ctx, cmd)
			found = true
			break
		}
	}

	if !found {
		decision = Deny("global.default_deny", "no policy namespace registered for this command")
	}

	if !decision.Allowed {
		e.logger.Warn("policy evaluation denied",
			log.String("module", "policy"),
			log.String("action", "evaluate"),
			log.String("policy", decision.Policy),
			log.String("reason", decision.Reason),
		)
	} else {
		e.logger.Info("policy evaluation allowed",
			log.String("module", "policy"),
			log.String("action", "evaluate"),
			log.String("policy", decision.Policy),
		)
	}

	return decision
}
