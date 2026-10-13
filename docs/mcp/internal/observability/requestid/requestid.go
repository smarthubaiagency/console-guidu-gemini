package requestid

import (
	"context"

	"github.com/google/uuid"
)

type contextKey string

const RequestIDKey contextKey = "request_id"

func FromContext(ctx context.Context) string {
	if id, ok := ctx.Value(RequestIDKey).(string); ok {
		return id
	}
	return ""
}

func NewContext(ctx context.Context, id string) context.Context {
	if id == "" {
		id = uuid.New().String()
	}
	return context.WithValue(ctx, RequestIDKey, id)
}
