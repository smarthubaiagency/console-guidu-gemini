package main

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/cartaopro/mcp/internal/antireplay"
	"github.com/cartaopro/mcp/internal/http/handler"
	mcphttp "github.com/cartaopro/mcp/internal/http/middleware"
	"github.com/cartaopro/mcp/internal/http/respond"
	"github.com/cartaopro/mcp/internal/mcp/command"
	mcpContext "github.com/cartaopro/mcp/internal/mcp/context"
	"github.com/cartaopro/mcp/internal/mcp/registry"
	mcpRuntime "github.com/cartaopro/mcp/internal/mcp/runtime"
	commerceTools "github.com/cartaopro/mcp/internal/mcp/tools/commerce"
	contactTools "github.com/cartaopro/mcp/internal/mcp/tools/contact"
	echoTool "github.com/cartaopro/mcp/internal/mcp/tools/echo"
	workspaceTools "github.com/cartaopro/mcp/internal/mcp/tools/workspace"
	"github.com/cartaopro/mcp/internal/observability/httpmw"
	"github.com/cartaopro/mcp/internal/observability/log"
	"github.com/cartaopro/mcp/internal/observability/requestid"
	"github.com/cartaopro/mcp/internal/policy"
	mcppostgres "github.com/cartaopro/mcp/internal/storage/postgres"
	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

func main() {
	// 1. Logger
	logLevel := os.Getenv("LOG_LEVEL")
	if logLevel == "" {
		logLevel = "info"
	}
	logger := log.New(logLevel)
	defer logger.Sync() //nolint:errcheck
	logger.Info("logger initialized", log.String("log_level", logLevel))

	// S2S HMAC secret — required
	s2sSecret := os.Getenv("MCP_S2S_SECRET")
	if s2sSecret == "" {
		logger.Fatal("MCP_S2S_SECRET is not configured")
	}

	// Supabase JWKS URL — inferred from SUPABASE_URL or explicit SUPABASE_JWKS_URL
	jwksURL := os.Getenv("SUPABASE_JWKS_URL")
	if jwksURL == "" {
		supabaseURL := os.Getenv("SUPABASE_URL")
		if supabaseURL == "" {
			logger.Fatal("SUPABASE_URL (or SUPABASE_JWKS_URL) is not configured")
		}
		jwksURL = supabaseURL + "/rest/v1/auth/jwks"
	}

	// JWT claims hardening — validate iss and aud to bind tokens to this Supabase project.
	jwtIssuer := os.Getenv("SUPABASE_JWT_ISSUER")
	if jwtIssuer == "" {
		logger.Warn("SUPABASE_JWT_ISSUER not set — issuer (iss) claim will NOT be validated")
	}
	jwtAudience := os.Getenv("SUPABASE_JWT_AUDIENCE")
	if jwtAudience == "" {
		jwtAudience = "authenticated" // Supabase default audience
		logger.Info("SUPABASE_JWT_AUDIENCE not set, defaulting to \"authenticated\"")
	}

	// Anti-replay nonce store — Redis in production, MemoryStore in development.
	var replayStore antireplay.Store
	var redisStore *antireplay.RedisStore // retained for health checks
	redisURL := os.Getenv("REDIS_URL")
	appEnv := os.Getenv("APP_ENV")
	if redisURL != "" {
		rs, redisErr := antireplay.NewRedisStore(redisURL)
		if redisErr != nil {
			if appEnv == "production" {
				logger.Fatal("redis connection required in production", log.Error(redisErr))
			}
			logger.Warn("redis unavailable, falling back to MemoryStore (development only)", log.Error(redisErr))
			replayStore = antireplay.NewMemoryStore()
		} else {
			logger.Info("redis anti-replay store connected", log.String("env", appEnv))
			replayStore = rs
			redisStore = rs
		}
	} else if appEnv == "production" {
		logger.Fatal("REDIS_URL is required in production (APP_ENV=production)")
	} else {
		logger.Warn("REDIS_URL not set, using MemoryStore — NOT safe for production")
		replayStore = antireplay.NewMemoryStore()
	}

	// S2S HMAC middleware
	hmacMW := httpmw.S2SHMAC(s2sSecret, replayStore, logger)

	// JWT Auth middleware
	authMW, err := httpmw.JWTAuth(jwksURL, jwtIssuer, jwtAudience, logger)
	if err != nil {
		logger.Fatal("failed to initialize JWT auth middleware", log.Error(err))
	}

	// Database connection pool — used for workspace ownership enforcement
	// AND for RLS-isolated tenant transactions (storage/postgres.BeginTenant).
	// SET LOCAL scopes the workspace session variable to each transaction,
	// so pool connections are safely reused without cross-tenant contamination.
	dbURL := os.Getenv("DATABASE_URL")
	if dbURL == "" {
		logger.Fatal("DATABASE_URL is not configured")
	}
	dbPool, err := pgxpool.New(context.Background(), dbURL)
	if err != nil {
		logger.Fatal("failed to connect to database", log.Error(err))
	}
	defer dbPool.Close()

	// Workspace ownership middleware
	workspaceOwnershipMW := mcphttp.WorkspaceOwnership(dbPool, logger)

	// 2. Tool Registry — register all tools
	toolRegistry := registry.NewToolRegistry()
	toolRegistry.Register(echoTool.New())
	// Batch 1: CRM domain tools (require DB pool)
	toolRegistry.Register(workspaceTools.NewContextGetTool(dbPool))
	toolRegistry.Register(contactTools.NewCreateTool(dbPool))
	toolRegistry.Register(contactTools.NewUpdateTool(dbPool))
	// Batch 2: Commerce domain tools (call Vendure Shop API)
	toolRegistry.Register(commerceTools.NewGetPaymentStatusTool())
	toolRegistry.Register(commerceTools.NewTrackProductionTool(dbPool))

	// 3. Policy Engine — allow "echo" namespace, deny everything else (default)
	policyEngine := policy.NewEngine(logger)
	policyEngine.RegisterNamespace("echo", func(_ mcpContext.MCPContext, _ command.MCPCommand) policy.PolicyDecision {
		return policy.Allow("echo.allow_all", "echo tool allowed for smoke testing")
	})
	// contact.* — domain commands require a valid workspace_id (RLS-backed isolation)
	policyEngine.RegisterNamespace("contact", func(ctx mcpContext.MCPContext, _ command.MCPCommand) policy.PolicyDecision {
		if ctx.WorkspaceID == "" {
			return policy.Deny("contact.workspace_required", "workspace_id is required for contact domain commands")
		}
		return policy.Allow("contact.allow", "contact command allowed for authenticated workspace")
	})
	// workspace.* — requires a valid workspace_id
	policyEngine.RegisterNamespace("workspace", func(ctx mcpContext.MCPContext, _ command.MCPCommand) policy.PolicyDecision {
		if ctx.WorkspaceID == "" {
			return policy.Deny("workspace.workspace_required", "workspace_id is required for workspace domain commands")
		}
		return policy.Allow("workspace.allow", "workspace command allowed for authenticated workspace")
	})
	// mcp.* — restricted to system or admin actors only
	policyEngine.RegisterNamespace("mcp", func(ctx mcpContext.MCPContext, _ command.MCPCommand) policy.PolicyDecision {
		if ctx.Type != "system" && ctx.Type != "admin" {
			return policy.Restrict("mcp.system_only", "mcp namespace is restricted to system or admin actors",
				map[string]any{"required_type": []string{"system", "admin"}, "actual_type": ctx.Type})
		}
		return policy.Allow("mcp.system_allow", "mcp command allowed for system actor")
	})
	// commerce.* — requires a valid workspace_id; calls Vendure Shop API
	policyEngine.RegisterNamespace("commerce", func(ctx mcpContext.MCPContext, _ command.MCPCommand) policy.PolicyDecision {
		if ctx.WorkspaceID == "" {
			return policy.Deny("commerce.workspace_required", "workspace_id is required for commerce domain commands")
		}
		return policy.Allow("commerce.allow", "commerce command allowed for authenticated workspace")
	})

	// 4. Executor
	auditRepo := mcppostgres.NewAuditRepo(dbPool)
	spanRepo := mcppostgres.NewSpanRepo(dbPool)
	executor := mcpRuntime.NewExecutor(toolRegistry, policyEngine, logger, auditRepo, spanRepo)

	// 5. HTTP Server
	port := os.Getenv("PORT")
	if port == "" {
		port = "8080"
	}

	// Health handler — injected with DB pool and optional Redis pinger.
	healthHandler := handler.New(dbPool, redisStore, logger)
	discoveryHandler := handler.NewDiscovery(toolRegistry, logger)
	executeDirectHandler := handler.NewExecuteDirect(executor, toolRegistry, logger)

	r := chi.NewRouter()
	r.Use(httpmw.RequestID)
	r.Use(httpmw.Logger(logger))

	// GET /health/live — liveness probe (public, no auth)
	r.Get("/health/live", healthHandler.HandleLive)
	// GET /health/ready — readiness probe: pings Postgres + Redis (public, no auth)
	r.Get("/health/ready", healthHandler.HandleReady)
	// GET /health — kept for backward compatibility (static liveness)
	r.Get("/health", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusOK)
		w.Write([]byte(`{"status":"ok","service":"mcp-server"}`)) //nolint:errcheck
	})

	// POST /v1/command/execute — versioned MCP pipeline (preferred route)
	executeHandler := func(w http.ResponseWriter, r *http.Request) {
		var req struct {
			Name        string         `json:"name"`
			Input       map[string]any `json:"input"`
			WorkspaceID string         `json:"workspace_id"`
			UserID      string         `json:"user_id"`
		}

		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			respond.JSON(w, http.StatusBadRequest, map[string]string{
				"error":   "invalid_request",
				"message": err.Error(),
			})
			return
		}

		// Inject request ID into context
		ctx := requestid.NewContext(r.Context(), requestid.FromContext(r.Context()))

		cmd := command.MCPCommand{
			Name:  req.Name,
			Input: req.Input,
		}

		workspaceID := req.WorkspaceID
		if workspaceID == "" {
			workspaceID = "smoke-test"
		}
		userID := req.UserID
		if userID == "" {
			userID = "smoke-test-user"
		}

		result, err := executor.Execute(ctx, cmd, workspaceID, userID)
		if err != nil {
			// Integrity violations → 409 Conflict (tamper or replay) — audit-logged + sanitised by respond.Error
			if errors.Is(err, mcpRuntime.ErrTamperDetected) || errors.Is(err, antireplay.ErrReplayDetected) {
				respond.Error(w, r, err, logger)
				return
			}
			// Tool not registered → 404
			if req.Name != "" {
				if _, resolveErr := toolRegistry.Resolve(req.Name); resolveErr != nil {
					respond.JSON(w, http.StatusNotFound, map[string]string{
						"error":   "tool_not_found",
						"message": "unknown tool: " + req.Name,
					})
					return
				}
			}
			// Policy denied or other execution failure → 403 (route through respond.Error for audit log)
			respond.Error(w, r, err, logger)
			return
		}

		respond.JSON(w, http.StatusOK, result)
	}

	// POST /v1/command/execute — canonical versioned route
	r.With(hmacMW, authMW, workspaceOwnershipMW).Post("/v1/command/execute", executeHandler)

	// GET /v1/tools — discovery endpoint: lists registered tools (optionally filtered by ?source=)
	// S2S-only: JWT is not required because this is a trusted backend-to-backend read-only call.
	r.With(hmacMW).Get("/v1/tools", discoveryHandler.HandleListTools)

	// POST /v1/command/execute/direct — deterministic single-tool execution (bypasses Agent Layer)
	r.With(hmacMW, authMW, workspaceOwnershipMW).Post("/v1/command/execute/direct", executeDirectHandler.HandleExecuteDirect)

	// POST /execute — deprecated alias kept for backward compatibility during transition.
	// Logs a deprecation warning on every call; clients should migrate to /v1/command/execute.
	r.With(hmacMW, authMW, workspaceOwnershipMW).Post("/execute", func(w http.ResponseWriter, r *http.Request) {
		logger.Warn("deprecated endpoint called — migrate to POST /v1/command/execute",
			log.String("deprecated_path", "/execute"),
			log.String("replacement", "/v1/command/execute"),
		)
		executeHandler(w, r)
	})

	srv := &http.Server{
		Addr:         ":" + port,
		Handler:      r,
		ReadTimeout:  10 * time.Second,
		WriteTimeout: 10 * time.Second,
	}

	// Graceful shutdown
	quit := make(chan os.Signal, 1)
	signal.Notify(quit, syscall.SIGINT, syscall.SIGTERM)

	go func() {
		logger.Info("mcp-server starting", log.String("port", port))
		if err := srv.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			logger.Fatal("server error", log.Error(err))
		}
	}()

	<-quit
	logger.Info("mcp-server shutting down — draining in-flight requests (30s timeout)")

	// Signal the readiness probe to return 503 immediately so load-balancers
	// stop routing new traffic before the drain window begins.
	healthHandler.SetShuttingDown()

	// Allow up to 30 seconds for in-flight requests to complete.
	shutdownCtx, shutdownCancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer shutdownCancel()
	if err := srv.Shutdown(shutdownCtx); err != nil {
		logger.Fatal("graceful shutdown failed", log.Error(err))
	}

	// Close Redis connection after HTTP drain is complete.
	if redisStore != nil {
		if err := redisStore.Close(); err != nil {
			logger.Error("redis close error during shutdown", log.Error(err))
		} else {
			logger.Info("redis connection closed")
		}
	}

	logger.Info("mcp-server stopped")
}
