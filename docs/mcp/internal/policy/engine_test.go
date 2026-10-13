package policy_test

import (
	"testing"

	"github.com/cartaopro/mcp/internal/mcp/command"
	mcpctx "github.com/cartaopro/mcp/internal/mcp/context"
	"github.com/cartaopro/mcp/internal/observability/log"
	"github.com/cartaopro/mcp/internal/policy"
)

func newTestEngine(t *testing.T) *policy.Engine {
	t.Helper()
	logger := log.New("error")
	t.Cleanup(func() { _ = logger.Sync() })
	return policy.NewEngine(logger)
}

func testMCPContext(workspaceID, userID, actorType string) mcpctx.MCPContext {
	return mcpctx.MCPContext{
		WorkspaceID: workspaceID,
		UserID:      userID,
		Type:        actorType,
	}
}

// TestEngine_DefaultDeny_UnregisteredNamespace is the primary hardening test:
// any command in a namespace that has no registered policy MUST be denied.
func TestEngine_DefaultDeny_UnregisteredNamespace(t *testing.T) {
	engine := newTestEngine(t)

	ctx := testMCPContext("ws-test", "user-123", "user")
	cmd := command.MCPCommand{Name: "unregistered.do_something", Input: map[string]any{}}

	decision := engine.Evaluate(ctx, cmd)

	if decision.Allowed {
		t.Fatal("expected DENY verdict for unregistered namespace, got ALLOW")
	}
	if decision.Policy != "global.default_deny" {
		t.Fatalf("expected policy %q, got %q", "global.default_deny", decision.Policy)
	}
}

// TestEngine_DefaultDeny_EmptyCommandName validates that an empty command name
// has no registered namespace and must also be denied.
func TestEngine_DefaultDeny_EmptyCommandName(t *testing.T) {
	engine := newTestEngine(t)

	ctx := testMCPContext("ws-test", "user-123", "user")
	cmd := command.MCPCommand{Name: "", Input: map[string]any{}}

	decision := engine.Evaluate(ctx, cmd)

	if decision.Allowed {
		t.Fatal("expected DENY for empty command name, got ALLOW")
	}
	if decision.Policy != "global.default_deny" {
		t.Fatalf("expected policy %q, got %q", "global.default_deny", decision.Policy)
	}
}

// TestEngine_RegisteredNamespace_Allow verifies that a command under a registered
// namespace that returns Allow is correctly permitted.
func TestEngine_RegisteredNamespace_Allow(t *testing.T) {
	engine := newTestEngine(t)
	engine.RegisterNamespace("echo", func(_ mcpctx.MCPContext, _ command.MCPCommand) policy.PolicyDecision {
		return policy.Allow("echo.allow_all", "echo tool allowed for smoke testing")
	})

	ctx := testMCPContext("ws-test", "user-123", "user")
	cmd := command.MCPCommand{Name: "echo.ping", Input: map[string]any{}}

	decision := engine.Evaluate(ctx, cmd)

	if !decision.Allowed {
		t.Fatalf("expected ALLOW for registered echo namespace, got DENY: policy=%q reason=%q",
			decision.Policy, decision.Reason)
	}
}

// TestEngine_RegisteredNamespace_CanDeny verifies that a registered namespace rule
// can return Deny based on context (e.g. missing workspace_id).
func TestEngine_RegisteredNamespace_CanDeny(t *testing.T) {
	engine := newTestEngine(t)
	engine.RegisterNamespace("contact", func(ctx mcpctx.MCPContext, _ command.MCPCommand) policy.PolicyDecision {
		if ctx.WorkspaceID == "" {
			return policy.Deny("contact.workspace_required", "workspace_id is required")
		}
		return policy.Allow("contact.allow", "allowed")
	})

	ctx := testMCPContext("", "user-123", "user") // empty workspace_id
	cmd := command.MCPCommand{Name: "contact.create", Input: map[string]any{}}

	decision := engine.Evaluate(ctx, cmd)

	if decision.Allowed {
		t.Fatal("expected DENY for contact command without workspace_id, got ALLOW")
	}
	if decision.Policy != "contact.workspace_required" {
		t.Fatalf("expected policy %q, got %q", "contact.workspace_required", decision.Policy)
	}
}
