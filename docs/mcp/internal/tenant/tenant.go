package tenant

import (
	"context"
	"errors"
)

// ErrNoClaims is returned when no claims are found in the context.
var ErrNoClaims = errors.New("no tenant claims found in context")

// Claims represents the standardized tenant information.
type Claims struct {
	WorkspaceID string   `json:"workspace_id"`
	UserID      string   `json:"user_id"`
	Roles       []string `json:"roles"`
	Type        string   `json:"type"`
	// Audience is the validated JWT aud claim ("authenticated", "mcp-admin", etc.)
	// Injected by the JWT middleware for downstream use by the PolicyEngine.
	Audience string `json:"audience"`
}

// contextKey is a private type for context keys to avoid collisions.
type contextKey struct{}

var claimsKey = contextKey{}

// WithClaims returns a new context with the provided tenant claims.
func WithClaims(ctx context.Context, c Claims) context.Context {
	return context.WithValue(ctx, claimsKey, c)
}

// FromContext extracts the tenant claims from the context.
// Returns an error if claims are missing (fail-closed).
func FromContext(ctx context.Context) (Claims, error) {
	c, ok := ctx.Value(claimsKey).(Claims)
	if !ok {
		return Claims{}, ErrNoClaims
	}
	return c, nil
}

// MustFromContext extracts the tenant claims from the context or panics if not found.
func MustFromContext(ctx context.Context) Claims {
	c, err := FromContext(ctx)
	if err != nil {
		panic(err)
	}
	return c
}
