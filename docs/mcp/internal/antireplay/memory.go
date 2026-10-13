package antireplay

import (
	"context"
	"sync"
	"time"
)

// Deprecated: MemoryStore is volatile and loses all nonces on process restart.
// Use RedisStore for production. MemoryStore is retained as a development/test fallback.
type MemoryStore struct {
	mu     sync.Mutex
	nonces map[string]time.Time
}

func NewMemoryStore() *MemoryStore {
	return &MemoryStore{
		nonces: make(map[string]time.Time),
	}
}

func (s *MemoryStore) CheckAndSet(_ context.Context, nonce string, ttl time.Duration) error {
	s.mu.Lock()
	defer s.mu.Unlock()

	// Clean up expired nonces
	now := time.Now()
	for n, exp := range s.nonces {
		if now.After(exp) {
			delete(s.nonces, n)
		}
	}

	if exp, ok := s.nonces[nonce]; ok && now.Before(exp) {
		return ErrReplayDetected
	}

	s.nonces[nonce] = now.Add(ttl)
	return nil
}
