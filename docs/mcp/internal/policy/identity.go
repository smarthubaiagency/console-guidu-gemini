package policy

// IdentityType defines the category of the acting entity.
type IdentityType string

const (
	User        IdentityType = "user"
	Agent       IdentityType = "agent"
	System      IdentityType = "system"
	Integration IdentityType = "integration"
)

// OriginType defines where the request came from.
type OriginType string

const (
	OriginHTTP      OriginType = "http"
	OriginAgent     OriginType = "agent"
	OriginWebhook   OriginType = "webhook"
	OriginScheduler OriginType = "scheduler"
)

// Role represents a high-level group of permissions.
type Role string

const (
	RoleAdmin   Role = "admin"
	RoleManager Role = "manager"
	RoleViewer  Role = "viewer"
)

// Identity represents "who" is performing the action.
type Identity struct {
	ID          string
	Type        IdentityType
	Roles       []Role
	WorkspaceID string
	Origin      OriginType
}

// IsAdmin returns true if the identity has the admin role.
func (i Identity) IsAdmin() bool {
	for _, r := range i.Roles {
		if r == RoleAdmin {
			return true
		}
	}
	return false
}

// IsAgent returns true if the identity is an AI agent.
func (i Identity) IsAgent() bool {
	return i.Type == Agent
}
