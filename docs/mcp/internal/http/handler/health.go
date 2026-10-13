// Package handler provides HTTP handlers for operational monitoring endpoints.
package handler

import (
	"context"
	"net/http"
	"sync/atomic"
	"time"

	"github.com/cartaopro/mcp/internal/http/respond"
	"github.com/cartaopro/mcp/internal/observability/log"
	"github.com/jackc/pgx/v5/pgxpool"
)

const healthCheckTimeout = 2 * time.Second

// cachePinger is satisfied by *antireplay.RedisStore.
// Defined locally to keep this package free of antireplay import cycles.
type cachePinger interface {
	Ping(ctx context.Context) error
}

// HealthHandler holds the dependencies needed for health check endpoints.
type HealthHandler struct {
	db           *pgxpool.Pool
	cache        cachePinger // nil when Redis is not configured
	logger       *log.Logger
	shuttingDown atomic.Bool
}

// New creates a HealthHandler.
// cache may be nil if Redis is not configured in the current environment.
func New(db *pgxpool.Pool, cache cachePinger, logger *log.Logger) *HealthHandler {
	return &HealthHandler{db: db, cache: cache, logger: logger}
}

// SetShuttingDown signals that the server is draining. Subsequent calls to
// HandleReady will return 503 Service Unavailable so that load-balancers and
// orchestrators stop routing new traffic before in-flight requests complete.
func (h *HealthHandler) SetShuttingDown() {
	h.shuttingDown.Store(true)
}

// HandleLive is a liveness probe — confirms the Go process is alive and the
// event loop is not deadlocked. Always responds 200 OK immediately.
func (h *HealthHandler) HandleLive(w http.ResponseWriter, r *http.Request) {
	respond.JSON(w, http.StatusOK, map[string]string{"status": "alive"})
}

// HandleReady is a readiness probe — performs a real Ping against each
// configured dependency (Postgres + Redis). Returns 200 only when all
// dependencies are reachable; 503 if any check fails or if the server is
// draining (SetShuttingDown was called).
func (h *HealthHandler) HandleReady(w http.ResponseWriter, r *http.Request) {
	if h.shuttingDown.Load() {
		respond.JSON(w, http.StatusServiceUnavailable, map[string]any{
			"status": "shutting_down",
			"checks": map[string]string{},
		})
		return
	}

	checks := map[string]string{}
	allUp := true

	// --- PostgreSQL check ---
	dbCtx, dbCancel := context.WithTimeout(r.Context(), healthCheckTimeout)
	defer dbCancel()

	if err := h.db.Ping(dbCtx); err != nil {
		h.logger.Error("readiness check: postgres ping failed", log.Error(err))
		checks["database"] = "down"
		allUp = false
	} else {
		checks["database"] = "up"
	}

	// --- Redis check (optional) ---
	if h.cache != nil {
		cacheCtx, cacheCancel := context.WithTimeout(r.Context(), healthCheckTimeout)
		defer cacheCancel()

		if err := h.cache.Ping(cacheCtx); err != nil {
			h.logger.Error("readiness check: redis ping failed", log.Error(err))
			checks["cache"] = "down"
			allUp = false
		} else {
			checks["cache"] = "up"
		}
	} else {
		checks["cache"] = "not_configured"
	}

	status := "ready"
	httpCode := http.StatusOK
	if !allUp {
		status = "unavailable"
		httpCode = http.StatusServiceUnavailable
	}

	respond.JSON(w, httpCode, map[string]any{
		"status": status,
		"checks": checks,
	})
}
