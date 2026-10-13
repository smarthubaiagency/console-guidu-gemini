package antireplay

import (
	"context"
	"errors"
	"time"
)

var (
	ErrReplayDetected = errors.New("replay detected: nonce already used")
)

// Store defines the interface for checking and persisting nonces.
type Store interface {
	// CheckAndSet attempts to store a nonce with a given TTL.
	// It returns nil if the nonce was successfully stored (first time).
	// It returns ErrReplayDetected if the nonce already exists.
	CheckAndSet(ctx context.Context, nonce string, ttl time.Duration) error
}
