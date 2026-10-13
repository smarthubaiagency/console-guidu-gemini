package registry

// CapabilityProvider exposes the set of tools available to the agent layer.
// Implementations are Side-Effect Free with respect to this interface.
type CapabilityProvider interface {
	// ListCapabilities returns the names of all registered tools.
	ListCapabilities() []string
}
