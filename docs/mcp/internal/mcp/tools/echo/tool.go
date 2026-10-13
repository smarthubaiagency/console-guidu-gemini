package echo

import (
	mcpContext "github.com/cartaopro/mcp/internal/mcp/context"
)

// EchoTool is a minimal MCPTool used for smoke testing the runtime pipeline.
// It returns the input it received without modification.
type EchoTool struct{}

func New() *EchoTool {
	return &EchoTool{}
}

func (t *EchoTool) Name() string {
	return "echo"
}

func (t *EchoTool) Execute(_ mcpContext.MCPContext, input map[string]any) (any, error) {
	return input, nil
}
