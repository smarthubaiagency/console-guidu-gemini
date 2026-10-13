package execution

import (
	"context"
	"errors"

	"github.com/google/uuid"
)

// ErrNoExecutionID is returned when no execution ID is found in the context.
var ErrNoExecutionID = errors.New("no execution id found in context")

// ID is the type for execution identifiers.
type ID = uuid.UUID

// contextKey is a private type for context keys to avoid collisions.
type contextKey struct{}

var executionIDKey = contextKey{}

// WithExecutionID returns a new context with the provided execution ID.
func WithExecutionID(ctx context.Context, id ID) context.Context {
	return context.WithValue(ctx, executionIDKey, id)
}

// FromContext extracts the execution ID from the context.
func FromContext(ctx context.Context) (ID, error) {
	id, ok := ctx.Value(executionIDKey).(ID)
	if !ok {
		return uuid.Nil, ErrNoExecutionID
	}
	return id, nil
}

// NewID generates a new stable execution ID.
func NewID() ID {
	return uuid.New()
}
