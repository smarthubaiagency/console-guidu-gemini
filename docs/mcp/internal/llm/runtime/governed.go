package runtime

import (
	"context"
	"crypto/sha256"
	"fmt"
	"time"

	"github.com/cartaopro/mcp/internal/execution"
	"github.com/cartaopro/mcp/internal/tenant"
	"github.com/google/uuid"
)

// TenantLLMSettings represents tenant LLM configuration (to avoid import cycle).
type TenantLLMSettings struct {
	WorkspaceID      uuid.UUID
	FallbackEnabled  bool
	FallbackStrategy string
}

// SettingsLoader loads tenant LLM settings.
type SettingsLoader interface {
	LoadSettings(ctx context.Context, workspaceID uuid.UUID) (*TenantLLMSettings, error)
}

// SpanRecorder records LLM spans.
type SpanRecorder interface {
	RecordSpan(ctx context.Context, span *LLMSpan) error
}

// GovernedClient wraps an LLM client with governance, fallback, and auditing.
type GovernedClient struct {
	primaryClient  Client
	fallbackClient Client
	settingsLoader SettingsLoader
	spanRecorder   SpanRecorder
}

// NewGovernedClient creates a new governed LLM client.
func NewGovernedClient(
	primary Client,
	fallback Client,
	settingsLoader SettingsLoader,
	spanRecorder SpanRecorder,
) *GovernedClient {
	return &GovernedClient{
		primaryClient:  primary,
		fallbackClient: fallback,
		settingsLoader: settingsLoader,
		spanRecorder:   spanRecorder,
	}
}

// Complete executes an LLM request with governance, fallback, and span auditing.
func (g *GovernedClient) Complete(ctx context.Context, req Request) (Response, error) {
	// 1. Extract context
	claims, err := tenant.FromContext(ctx)
	if err != nil {
		return Response{}, fmt.Errorf("tenant context required: %w", err)
	}
	req.WorkspaceID, _ = uuid.Parse(claims.WorkspaceID)

	execID, err := execution.FromContext(ctx)
	if err != nil {
		execID = execution.NewID()
	}
	req.ExecutionID = execID

	// 2. Load settings (fail-closed)
	settings, err := g.settingsLoader.LoadSettings(ctx, req.WorkspaceID)
	if err != nil {
		return Response{}, fmt.Errorf("failed to load LLM settings: %w", err)
	}

	// 3. Attempt primary provider
	resp, span := g.attemptCall(ctx, req, g.primaryClient, 1)
	if span.Status == "success" {
		return resp, nil
	}

	// 4. Check fallback
	if !settings.FallbackEnabled {
		return Response{}, fmt.Errorf("LLM call failed: %s", span.ErrorMessage)
	}

	// 5. Attempt fallback
	if g.fallbackClient == nil {
		return Response{}, fmt.Errorf("fallback enabled but no fallback client configured")
	}

	req.Provider = settings.FallbackStrategy // Use fallback provider
	resp, span = g.attemptCall(ctx, req, g.fallbackClient, 2)

	if span.Status == "success" {
		return resp, nil
	}

	return Response{}, fmt.Errorf("LLM call failed after fallback: %s", span.ErrorMessage)
}

// attemptCall executes a single LLM call and records a span.
func (g *GovernedClient) attemptCall(ctx context.Context, req Request, client Client, attempt int) (Response, LLMSpan) {
	span := LLMSpan{
		ID:          uuid.New(),
		ExecutionID: req.ExecutionID,
		WorkspaceID: req.WorkspaceID,
		Attempt:     attempt,
		Provider:    req.Provider,
		Model:       req.Model,
		Status:      "running",
		InputHash:   hashString(req.Prompt),
		StartedAt:   time.Now(),
	}

	// Execute call
	start := time.Now()
	resp, err := client.Complete(ctx, req)
	latency := time.Since(start).Milliseconds()

	now := time.Now()
	span.FinishedAt = &now
	span.LatencyMs = latency

	if err != nil {
		span.Status = "failed"
		span.ErrorClass = "llm_error"
		span.ErrorMessage = sanitizeError(err)
	} else {
		span.Status = "success"
		span.OutputHash = hashString(resp.OutputText)
		if resp.UsageTokens != nil {
			span.TokensIn = resp.UsageTokens.InputTokens
			span.TokensOut = resp.UsageTokens.OutputTokens
		}
	}

	// Record span
	g.spanRecorder.RecordSpan(ctx, &span)

	return resp, span
}

func hashString(s string) string {
	hash := sha256.Sum256([]byte(s))
	return fmt.Sprintf("%x", hash)
}

func sanitizeError(err error) string {
	// Basic sanitization - remove potentially sensitive details
	msg := err.Error()
	if len(msg) > 200 {
		msg = msg[:200] + "..."
	}
	return msg
}
