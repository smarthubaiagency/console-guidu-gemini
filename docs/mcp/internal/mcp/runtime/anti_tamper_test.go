package runtime_test

import (
	"errors"
	"testing"

	"github.com/cartaopro/mcp/internal/mcp/command"
	"github.com/cartaopro/mcp/internal/mcp/runtime"
)

func TestValidateProposalHash_ValidProposal(t *testing.T) {
	workspaceID := "ws-abc-123"
	intent := "create_contact"
	requiresApproval := false
	commands := []command.MCPCommand{
		{Name: "contact.create", Input: map[string]any{"email": "test@example.com"}},
	}

	hash, err := runtime.CalculateProposalHash(workspaceID, intent, requiresApproval, commands)
	if err != nil {
		t.Fatalf("CalculateProposalHash returned unexpected error: %v", err)
	}

	if err := runtime.ValidateProposalHash(workspaceID, intent, requiresApproval, commands, hash); err != nil {
		t.Fatalf("ValidateProposalHash failed for untampered proposal: %v", err)
	}
}

func TestValidateProposalHash_TamperedCommand(t *testing.T) {
	workspaceID := "ws-abc-123"
	intent := "create_contact"
	requiresApproval := false
	commands := []command.MCPCommand{
		{Name: "contact.create", Input: map[string]any{"email": "test@example.com"}},
	}

	hash, err := runtime.CalculateProposalHash(workspaceID, intent, requiresApproval, commands)
	if err != nil {
		t.Fatalf("CalculateProposalHash returned unexpected error: %v", err)
	}

	// Tamper: change the email parameter in the command.
	tamperedCommands := []command.MCPCommand{
		{Name: "contact.create", Input: map[string]any{"email": "attacker@evil.com"}},
	}
	err = runtime.ValidateProposalHash(workspaceID, intent, requiresApproval, tamperedCommands, hash)
	if err == nil {
		t.Fatal("ValidateProposalHash should have detected tampering but returned nil")
	}
	if !errors.Is(err, runtime.ErrTamperDetected) {
		t.Fatalf("expected ErrTamperDetected, got: %v", err)
	}
}

func TestValidateProposalHash_TamperedWorkspaceID(t *testing.T) {
	workspaceID := "ws-abc-123"
	intent := "echo"
	requiresApproval := false
	commands := []command.MCPCommand{{Name: "echo", Input: map[string]any{"msg": "hello"}}}

	hash, err := runtime.CalculateProposalHash(workspaceID, intent, requiresApproval, commands)
	if err != nil {
		t.Fatalf("CalculateProposalHash returned unexpected error: %v", err)
	}

	// Tamper: swap the workspace_id to escalate to another tenant.
	err = runtime.ValidateProposalHash("ws-attacker-999", intent, requiresApproval, commands, hash)
	if !errors.Is(err, runtime.ErrTamperDetected) {
		t.Fatalf("expected ErrTamperDetected on workspace_id swap, got: %v", err)
	}
}

func TestValidateProposalHash_TamperedApprovalFlag(t *testing.T) {
	workspaceID := "ws-abc-123"
	intent := "delete_all_contacts"
	requiresApproval := true // agent required human approval
	commands := []command.MCPCommand{{Name: "contact.delete_all", Input: map[string]any{}}}

	hash, err := runtime.CalculateProposalHash(workspaceID, intent, requiresApproval, commands)
	if err != nil {
		t.Fatalf("CalculateProposalHash returned unexpected error: %v", err)
	}

	// Tamper: bypass the requires_human_approval flag.
	err = runtime.ValidateProposalHash(workspaceID, intent, false, commands, hash)
	if !errors.Is(err, runtime.ErrTamperDetected) {
		t.Fatalf("expected ErrTamperDetected on requires_human_approval bypass, got: %v", err)
	}
}
