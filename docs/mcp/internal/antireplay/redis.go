package antireplay

import (
	"context"
	"fmt"
	"time"

	"github.com/redis/go-redis/v9"
)

const redisKeyPrefix = "mcp:nonce:"

// RedisStore is a distributed nonce store backed by Redis.
// It uses SetNX (atomic SET if Not eXists) to guarantee that each nonce
// can only be accepted once within its TTL window, surviving server restarts.
type RedisStore struct {
	client *redis.Client
}

// NewRedisStore parses redisURL and returns a connected RedisStore.
// Returns an error if the URL is invalid; actual connectivity is verified
// via Ping so callers can treat an error as a hard failure.
func NewRedisStore(redisURL string) (*RedisStore, error) {
	opts, err := redis.ParseURL(redisURL)
	if err != nil {
		return nil, fmt.Errorf("antireplay: invalid REDIS_URL: %w", err)
	}

	client := redis.NewClient(opts)

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	if err := client.Ping(ctx).Err(); err != nil {
		_ = client.Close()
		return nil, fmt.Errorf("antireplay: redis ping failed: %w", err)
	}

	return &RedisStore{client: client}, nil
}

// CheckAndSet atomically stores nonce with the given TTL.
// Returns nil on first use, ErrReplayDetected if the nonce was already seen,
// or the underlying Redis error if the operation fails (fail-closed).
func (s *RedisStore) CheckAndSet(ctx context.Context, nonce string, ttl time.Duration) error {
	key := redisKeyPrefix + nonce

	set, err := s.client.SetNX(ctx, key, 1, ttl).Result()
	if err != nil {
		// Fail-closed: treat Redis errors as a security denial, not a pass.
		return fmt.Errorf("antireplay: redis SetNX error: %w", err)
	}

	if !set {
		return ErrReplayDetected
	}

	return nil
}

// Close releases the underlying Redis client connection.
func (s *RedisStore) Close() error {
	return s.client.Close()
}

// Ping verifies the Redis connection is alive. Used by health checks.
func (s *RedisStore) Ping(ctx context.Context) error {
	return s.client.Ping(ctx).Err()
}
