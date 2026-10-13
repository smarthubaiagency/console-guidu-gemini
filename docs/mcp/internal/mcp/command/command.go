package command

// MCPCommand represents an explicit execution intent.
type MCPCommand struct {
	Name  string
	Input map[string]any
}
