package runtime

import (
	"context"
	"fmt"
	"time"

	"github.com/cartaopro/mcp/internal/agents/interpreter"
	"github.com/cartaopro/mcp/internal/domain"
	"github.com/cartaopro/mcp/internal/execution"
	"github.com/cartaopro/mcp/internal/mcp/command"
	mcpContext "github.com/cartaopro/mcp/internal/mcp/context"
	"github.com/cartaopro/mcp/internal/mcp/registry"
	"github.com/cartaopro/mcp/internal/observability"
	"github.com/cartaopro/mcp/internal/observability/log"
	"github.com/cartaopro/mcp/internal/policy"
)

// Runtime defines the interface for executing MCP commands.
type Runtime interface {
	Execute(ctx context.Context, cmd command.MCPCommand, workspaceID, userID string) (MCPResult, error)
}

// AuditWriter is a write-only interface for persisting audit events.
// Implemented by storage/postgres.AuditRepo.
type AuditWriter interface {
	CreateEvent(ctx context.Context, input domain.AuditEventInput) error
}

// SpanWriter is a write-only interface for persisting execution spans.
// Implemented by storage/postgres.SpanRepo.
type SpanWriter interface {
	CreateSpan(ctx context.Context, input domain.ExecutionSpanInput) (string, error)
	UpdateSpan(ctx context.Context, spanID, workspaceID, status string, latencyMs *int, responseHash *string, payloadRedacted map[string]any) error
}

// Executor is the concrete implementation of the MCP Runtime.
type Executor struct {
	registry    *registry.ToolRegistry
	policy      *policy.Engine
	logger      *log.Logger
	auditWriter AuditWriter // optional; nil disables DB persistence of audit events
	spanWriter  SpanWriter  // optional; nil disables DB persistence of execution spans
}

func NewExecutor(registry *registry.ToolRegistry, policy *policy.Engine, logger *log.Logger, auditWriter AuditWriter, spanWriter SpanWriter) *Executor {
	return &Executor{
		registry:    registry,
		policy:      policy,
		logger:      logger,
		auditWriter: auditWriter,
		spanWriter:  spanWriter,
	}
}

// toRedactedMap asserts the result of observability.RedactPayload (which always returns
// map[string]any or nil) to a typed map for use in domain input structs.
func toRedactedMap(v any) map[string]any {
	if m, ok := v.(map[string]any); ok {
		return m
	}
	return nil
}

// persistExecution writes a span record and an audit event record to the database
// at the conclusion of each tool execution. Both writes are best-effort: errors
// are logged but never propagated to callers to avoid masking tool results.
func (e *Executor) persistExecution(ctx context.Context, execID, workspaceID, userID, toolName, inputHash, outputHash, status, proposalHash string, latencyMs int, inputRedacted map[string]any) {
	if e.spanWriter != nil {
		var respHash *string
		if outputHash != "" {
			respHash = &outputHash
		}
		lms := latencyMs
		spanInput := domain.ExecutionSpanInput{
			WorkspaceID:     workspaceID,
			ExecutionID:     execID,
			Provider:        "mcp",
			Model:           toolName,
			PromptHash:      inputHash,
			ResponseHash:    respHash,
			LatencyMs:       &lms,
			Status:          status,
			PayloadRedacted: inputRedacted,
		}
		if _, serr := e.spanWriter.CreateSpan(ctx, spanInput); serr != nil {
			e.logger.Warn("span persistence failed (best-effort)",
				log.Error(serr),
				log.String("execution_id", execID),
				log.String("tool", toolName),
			)
		}
	}
	if e.auditWriter != nil {
		auditInput := domain.AuditEventInput{
			WorkspaceID:     workspaceID,
			ExecutionID:     nil, // AiExecution rows are managed by the Next.js layer; NULL avoids FK violation
			ActorType:       "user",
			ActorID:         userID,
			EventType:       toolName,
			PayloadHash:     inputHash,
			PayloadRedacted: inputRedacted,
			ProposalHash:    proposalHash,
		}
		if aerr := e.auditWriter.CreateEvent(ctx, auditInput); aerr != nil {
			e.logger.Warn("audit event persistence failed (best-effort)",
				log.Error(aerr),
				log.String("execution_id", execID),
				log.String("tool", toolName),
			)
		}
	}
}

func (e *Executor) Execute(ctx context.Context, cmd command.MCPCommand, workspaceID, userID string) (MCPResult, error) {
	startTime := time.Now()

	// 1. Generate and inject a unique Execution ID for this request.
	execID := execution.NewID()
	ctx = execution.WithExecutionID(ctx, execID)

	// 2. Build MCPContext Envelope (immutable after construction).
	mcpCtx := mcpContext.NewEnvelope(ctx, workspaceID, userID, "user", "api", execID)

	// 3. Pre-compute input hash (original payload, before redaction) and redacted copy.
	// Hash is computed FIRST on the raw payload to preserve chain-of-custody integrity.
	inputHash := observability.HashPayload(cmd.Input)
	inputRedacted := observability.RedactPayload(cmd.Input)

	// 4. Policy Evaluation (Mandatory — default DENY).
	decision := e.policy.Evaluate(mcpCtx, cmd)
	if !decision.Allowed {
		observability.LogEvent(e.logger, observability.AuditEvent{
			ExecutionID:    execID.String(),
			Timestamp:      time.Now().UTC(),
			ActorID:        userID,
			ToolName:       cmd.Name,
			InputHash:      inputHash,
			OutputHash:     "",
			InputRedacted:  inputRedacted,
			OutputRedacted: nil,
			ResultStatus:   "denied",
		})
		e.persistExecution(ctx, execID.String(), workspaceID, userID, cmd.Name, inputHash, "", "denied", "", int(time.Since(startTime).Milliseconds()), toRedactedMap(inputRedacted))
		return MCPResult{}, fmt.Errorf("authorization denied: %s (policy: %s)", decision.Reason, decision.Policy)
	}

	e.logger.Info("mcp command execution started",
		log.String("module", "mcp_runtime"),
		log.String("action", "execute_command"),
		log.String("command", cmd.Name),
		log.String("workspace_id", workspaceID),
		log.String("execution_id", execID.String()),
		log.String("request_id", mcpCtx.RequestID),
	)

	// 5. Resolve Tool
	tool, err := e.registry.Resolve(cmd.Name)
	if err != nil {
		e.logger.Error("mcp tool resolution failed",
			log.Error(err),
			log.String("module", "mcp_runtime"),
			log.String("action", "execute_command"),
			log.String("execution_id", execID.String()),
		)
		observability.LogEvent(e.logger, observability.AuditEvent{
			ExecutionID:    execID.String(),
			Timestamp:      time.Now().UTC(),
			ActorID:        userID,
			ToolName:       cmd.Name,
			InputHash:      inputHash,
			OutputHash:     "",
			InputRedacted:  inputRedacted,
			OutputRedacted: nil,
			ResultStatus:   "error",
		})
		e.persistExecution(ctx, execID.String(), workspaceID, userID, cmd.Name, inputHash, "", "error", "", int(time.Since(startTime).Milliseconds()), toRedactedMap(inputRedacted))
		return MCPResult{}, err
	}

	// 6. Execute Tool
	data, err := tool.Execute(mcpCtx, cmd.Input)
	if err != nil {
		e.logger.Error("mcp tool execution failed",
			log.Error(err),
			log.String("module", "mcp_runtime"),
			log.String("action", "execute_command"),
			log.String("tool", tool.Name()),
			log.String("execution_id", execID.String()),
		)
		observability.LogEvent(e.logger, observability.AuditEvent{
			ExecutionID:    execID.String(),
			Timestamp:      time.Now().UTC(),
			ActorID:        userID,
			ToolName:       cmd.Name,
			InputHash:      inputHash,
			OutputHash:     "",
			InputRedacted:  inputRedacted,
			OutputRedacted: nil,
			ResultStatus:   "error",
		})
		e.persistExecution(ctx, execID.String(), workspaceID, userID, cmd.Name, inputHash, "", "error", "", int(time.Since(startTime).Milliseconds()), toRedactedMap(inputRedacted))
		return MCPResult{}, err
	}

	// 7. Audit span — hash computed on original output BEFORE redaction (chain-of-custody).
	outputHash := observability.HashPayload(data)
	outputRedacted := observability.RedactPayload(data)
	observability.LogEvent(e.logger, observability.AuditEvent{
		ExecutionID:    execID.String(),
		Timestamp:      time.Now().UTC(),
		ActorID:        userID,
		ToolName:       tool.Name(),
		InputHash:      inputHash,
		OutputHash:     outputHash,
		InputRedacted:  inputRedacted,
		OutputRedacted: outputRedacted,
		ResultStatus:   "completed",
	})
	e.persistExecution(ctx, execID.String(), workspaceID, userID, tool.Name(), inputHash, outputHash, "completed", "", int(time.Since(startTime).Milliseconds()), toRedactedMap(inputRedacted))

	e.logger.Info("mcp command execution completed",
		log.String("module", "mcp_runtime"),
		log.String("action", "execute_command"),
		log.String("command", cmd.Name),
		log.String("execution_id", execID.String()),
	)

	return MCPResult{
		Data: data,
		Metadata: map[string]any{
			"schema_version": "1.0",
			"executed_at":    mcpCtx.Timestamp,
			"request_id":     mcpCtx.RequestID,
			"execution_id":   execID.String(),
		},
	}, nil
}

// ExecuteProposal validates an AgentProposal's integrity, enforces confidence gating,
// and executes each contained command in sequence.
//
// Security guarantees:
//  1. Hash validation (anti-tamper) — proposalHash must match CalculateProposalHash.
//  2. Confidence gating — VerdictClarify blocks execution; VerdictReview requires human approval.
//  3. Human approval gate — RequiresHumanApproval=true is rejected until a future approval workflow exists.
//  4. Per-command audit spans — each command is audited independently with the ProposalHash carried.
//
// Returns a slice of MCPResult (one per command) and the first error encountered, which halts the sequence.
func (e *Executor) ExecuteProposal(ctx context.Context, proposal AgentProposal, proposalHash, workspaceID, userID string) ([]MCPResult, error) {
	// 1. Anti-tamper validation.
	if err := ValidateProposalHash(workspaceID, proposal.Intent, proposal.RequiresHumanApproval, proposal.Commands, proposalHash); err != nil {
		e.logger.Warn("proposal tamper detection triggered",
			log.String("module", "mcp_runtime"),
			log.String("action", "execute_proposal"),
			log.String("workspace_id", workspaceID),
			log.String("actor_id", userID),
			log.Error(err),
		)
		return nil, err
	}

	// 2. Confidence gating.
	gating := interpreter.NewConfidenceGating()
	verdict := gating.Evaluate(proposal.Confidence)
	if verdict == interpreter.VerdictClarify {
		return nil, fmt.Errorf("execution blocked: agent confidence %.2f is below minimum threshold (%.2f) — clarification required", proposal.Confidence, gating.ThresholdAmbig)
	}
	if verdict == interpreter.VerdictReview || proposal.RequiresHumanApproval {
		return nil, fmt.Errorf("execution blocked: proposal requires human approval (confidence=%.2f)", proposal.Confidence)
	}

	e.logger.Info("executing agent proposal",
		log.String("module", "mcp_runtime"),
		log.String("action", "execute_proposal"),
		log.String("workspace_id", workspaceID),
		log.String("proposal_hash", proposalHash),
		log.String("intent", proposal.Intent),
		log.Int("command_count", len(proposal.Commands)),
	)

	// 3. Execute each command in sequence; first error halts the chain.
	results := make([]MCPResult, 0, len(proposal.Commands))
	for _, cmd := range proposal.Commands {
		result, err := e.executeWithProposalHash(ctx, cmd, workspaceID, userID, proposalHash)
		if err != nil {
			return results, fmt.Errorf("proposal execution halted at command %q: %w", cmd.Name, err)
		}
		results = append(results, result)
	}
	return results, nil
}

// executeWithProposalHash is Execute with proposalHash threaded into audit events.
func (e *Executor) executeWithProposalHash(ctx context.Context, cmd command.MCPCommand, workspaceID, userID, proposalHash string) (MCPResult, error) {
	startTime := time.Now()
	execID := execution.NewID()
	ctx = execution.WithExecutionID(ctx, execID)

	mcpCtx := mcpContext.NewEnvelope(ctx, workspaceID, userID, "user", "api", execID)

	inputHash := observability.HashPayload(cmd.Input)
	inputRedacted := observability.RedactPayload(cmd.Input)

	decision := e.policy.Evaluate(mcpCtx, cmd)
	if !decision.Allowed {
		observability.LogEvent(e.logger, observability.AuditEvent{
			ExecutionID:   execID.String(),
			ProposalHash:  proposalHash,
			Timestamp:     time.Now().UTC(),
			ActorID:       userID,
			ToolName:      cmd.Name,
			InputHash:     inputHash,
			InputRedacted: inputRedacted,
			ResultStatus:  "denied",
		})
		e.persistExecution(ctx, execID.String(), workspaceID, userID, cmd.Name, inputHash, "", "denied", proposalHash, int(time.Since(startTime).Milliseconds()), toRedactedMap(inputRedacted))
		return MCPResult{}, fmt.Errorf("authorization denied: %s (policy: %s)", decision.Reason, decision.Policy)
	}

	tool, err := e.registry.Resolve(cmd.Name)
	if err != nil {
		observability.LogEvent(e.logger, observability.AuditEvent{
			ExecutionID:   execID.String(),
			ProposalHash:  proposalHash,
			Timestamp:     time.Now().UTC(),
			ActorID:       userID,
			ToolName:      cmd.Name,
			InputHash:     inputHash,
			InputRedacted: inputRedacted,
			ResultStatus:  "error",
		})
		e.persistExecution(ctx, execID.String(), workspaceID, userID, cmd.Name, inputHash, "", "error", proposalHash, int(time.Since(startTime).Milliseconds()), toRedactedMap(inputRedacted))
		return MCPResult{}, err
	}

	data, err := tool.Execute(mcpCtx, cmd.Input)
	if err != nil {
		observability.LogEvent(e.logger, observability.AuditEvent{
			ExecutionID:   execID.String(),
			ProposalHash:  proposalHash,
			Timestamp:     time.Now().UTC(),
			ActorID:       userID,
			ToolName:      cmd.Name,
			InputHash:     inputHash,
			InputRedacted: inputRedacted,
			ResultStatus:  "error",
		})
		e.persistExecution(ctx, execID.String(), workspaceID, userID, cmd.Name, inputHash, "", "error", proposalHash, int(time.Since(startTime).Milliseconds()), toRedactedMap(inputRedacted))
		return MCPResult{}, err
	}

	outputHash := observability.HashPayload(data)
	outputRedacted := observability.RedactPayload(data)
	observability.LogEvent(e.logger, observability.AuditEvent{
		ExecutionID:    execID.String(),
		ProposalHash:   proposalHash,
		Timestamp:      time.Now().UTC(),
		ActorID:        userID,
		ToolName:       tool.Name(),
		InputHash:      inputHash,
		OutputHash:     outputHash,
		InputRedacted:  inputRedacted,
		OutputRedacted: outputRedacted,
		ResultStatus:   "completed",
	})
	e.persistExecution(ctx, execID.String(), workspaceID, userID, tool.Name(), inputHash, outputHash, "completed", proposalHash, int(time.Since(startTime).Milliseconds()), toRedactedMap(inputRedacted))

	return MCPResult{
		Data: data,
		Metadata: map[string]any{
			"executed_at":   mcpCtx.Timestamp,
			"request_id":    mcpCtx.RequestID,
			"execution_id":  execID.String(),
			"proposal_hash": proposalHash,
		},
	}, nil
}
