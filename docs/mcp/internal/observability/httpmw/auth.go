package httpmw

import (
	"net/http"
	"strings"

	"github.com/MicahParks/keyfunc/v2"
	"github.com/cartaopro/mcp/internal/http/respond"
	"github.com/cartaopro/mcp/internal/observability/log"
	"github.com/cartaopro/mcp/internal/tenant"
	"github.com/golang-jwt/jwt/v5"
)

const HeaderWorkspaceID = "X-Cartaopro-Workspace-Id"

// customClaims extends the standard JWT registered claims with Supabase-specific fields.
type customClaims struct {
	jwt.RegisteredClaims
	AppMetadata struct {
		Roles []string `json:"roles"`
	} `json:"app_metadata"`
}

// JWTAuth returns a middleware that validates Supabase RS256 JWT tokens.
// jwksURL must point to the JWKS endpoint (e.g. SUPABASE_URL + "/rest/v1/auth/jwks").
// issuer is the expected iss claim (SUPABASE_JWT_ISSUER); pass "" to skip issuer check.
// audience is the expected aud claim (SUPABASE_JWT_AUDIENCE); pass "" to skip audience check.
// On success, it injects tenant.Claims (including the validated Audience) into the request context.
func JWTAuth(jwksURL, issuer, audience string, logger *log.Logger) (func(http.Handler) http.Handler, error) {
	jwks, err := keyfunc.Get(jwksURL, keyfunc.Options{
		RefreshErrorHandler: func(e error) {
			logger.Error("JWKS refresh error", log.Error(e))
		},
	})
	if err != nil {
		return nil, err
	}

	// Build parse options — always require RS256 and expiration.
	parseOpts := []jwt.ParserOption{
		jwt.WithValidMethods([]string{"RS256"}),
		jwt.WithExpirationRequired(),
	}
	if issuer != "" {
		parseOpts = append(parseOpts, jwt.WithIssuer(issuer))
	}
	if audience != "" {
		parseOpts = append(parseOpts, jwt.WithAudience(audience))
	}

	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			authHeader := r.Header.Get("Authorization")
			if authHeader == "" || !strings.HasPrefix(authHeader, "Bearer ") {
				logger.Warn("JWT auth: missing or malformed Authorization header")
				respond.JSON(w, http.StatusUnauthorized, map[string]string{
					"error":   "invalid_token",
					"message": "Missing or malformed Authorization header",
				})
				return
			}

			rawToken := strings.TrimPrefix(authHeader, "Bearer ")

			claims := &customClaims{}
			token, err := jwt.ParseWithClaims(rawToken, claims, jwks.Keyfunc, parseOpts...)
			if err != nil || !token.Valid {
				logger.Warn("JWT auth: token validation failed",
					log.Error(err),
					log.String("issuer_expected", issuer),
					log.String("audience_expected", audience),
				)
				respond.JSON(w, http.StatusUnauthorized, map[string]string{
					"error":   "invalid_token",
					"message": "Authentication failed: invalid issuer, audience, or expired token",
				})
				return
			}

			userID, err := claims.GetSubject()
			if err != nil || userID == "" {
				logger.Warn("JWT auth: missing sub claim")
				respond.JSON(w, http.StatusUnauthorized, map[string]string{
					"error":   "invalid_token",
					"message": "Missing subject claim",
				})
				return
			}

			// Extract the first audience value for context injection.
			validatedAudience := audience
			if aud, audErr := claims.GetAudience(); audErr == nil && len(aud) > 0 {
				validatedAudience = aud[0]
			}

			workspaceID := r.Header.Get(HeaderWorkspaceID)

			tc := tenant.Claims{
				WorkspaceID: workspaceID,
				UserID:      userID,
				Roles:       claims.AppMetadata.Roles,
				Type:        "user",
				Audience:    validatedAudience,
			}

			ctx := tenant.WithClaims(r.Context(), tc)
			next.ServeHTTP(w, r.WithContext(ctx))
		})
	}, nil
}
