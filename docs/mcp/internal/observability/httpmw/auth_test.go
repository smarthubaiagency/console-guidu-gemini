package httpmw_test

import (
	"crypto/rand"
	"crypto/rsa"
	"encoding/base64"
	"encoding/json"
	"math/big"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/golang-jwt/jwt/v5"

	"github.com/cartaopro/mcp/internal/observability/httpmw"
	"github.com/cartaopro/mcp/internal/observability/log"
)

// testRSAKey holds a generated RSA key pair for test use only.
type testRSAKey struct {
	private *rsa.PrivateKey
	kid     string
}

func newTestRSAKey(t *testing.T) *testRSAKey {
	t.Helper()
	priv, err := rsa.GenerateKey(rand.Reader, 2048)
	if err != nil {
		t.Fatalf("failed to generate RSA test key: %v", err)
	}
	return &testRSAKey{private: priv, kid: "test-key-1"}
}

// jwksHandler returns an HTTP handler that serves a minimal JWKS for the public key.
func (k *testRSAKey) jwksHandler() http.Handler {
	pub := &k.private.PublicKey
	eBytes := big.NewInt(int64(pub.E)).Bytes()
	jwks := map[string]any{
		"keys": []map[string]any{
			{
				"kty": "RSA",
				"alg": "RS256",
				"use": "sig",
				"kid": k.kid,
				"n":   base64.RawURLEncoding.EncodeToString(pub.N.Bytes()),
				"e":   base64.RawURLEncoding.EncodeToString(eBytes),
			},
		},
	}
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(jwks)
	})
}

// signToken creates a signed RS256 JWT with the given registered claims.
func (k *testRSAKey) signToken(t *testing.T, issuer, audience, subject string) string {
	t.Helper()
	claims := jwt.RegisteredClaims{
		Issuer:    issuer,
		Audience:  jwt.ClaimStrings{audience},
		Subject:   subject,
		ExpiresAt: jwt.NewNumericDate(time.Now().Add(time.Hour)),
	}
	tok := jwt.NewWithClaims(jwt.SigningMethodRS256, claims)
	tok.Header["kid"] = k.kid
	signed, err := tok.SignedString(k.private)
	if err != nil {
		t.Fatalf("failed to sign test token: %v", err)
	}
	return signed
}

// setupAuth builds a JWTAuth middleware backed by a local httptest JWKS server.
func setupAuth(t *testing.T, key *testRSAKey, issuer, audience string) func(http.Handler) http.Handler {
	t.Helper()
	jwksSrv := httptest.NewServer(key.jwksHandler())
	t.Cleanup(jwksSrv.Close)

	logger := log.New("error")
	t.Cleanup(func() { _ = logger.Sync() })

	mw, err := httpmw.JWTAuth(jwksSrv.URL, issuer, audience, logger)
	if err != nil {
		t.Fatalf("JWTAuth initialisation failed: %v", err)
	}
	return mw
}

// okHandler is a trivial downstream handler used for success assertions.
var okHandler = http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
	w.WriteHeader(http.StatusOK)
})

// TestJWTAuth_RejectsWrongIssuer validates that a token signed with a known key
// but carrying a different iss claim is rejected with 401.
func TestJWTAuth_RejectsWrongIssuer(t *testing.T) {
	key := newTestRSAKey(t)
	const correctIssuer = "https://supabase.example.com/auth/v1"
	const audience = "authenticated"

	mw := setupAuth(t, key, correctIssuer, audience)
	handler := mw(okHandler)

	wrongToken := key.signToken(t, "https://evil-issuer.com", audience, "user-sub-123")

	req := httptest.NewRequest(http.MethodPost, "/execute", nil)
	req.Header.Set("Authorization", "Bearer "+wrongToken)
	rr := httptest.NewRecorder()

	handler.ServeHTTP(rr, req)

	if rr.Code != http.StatusUnauthorized {
		t.Fatalf("expected 401 for wrong issuer, got %d", rr.Code)
	}
}

// TestJWTAuth_RejectsWrongAudience validates that a token carrying a different aud
// claim (e.g. "mcp-client" trying to access an "authenticated" route) is rejected.
func TestJWTAuth_RejectsWrongAudience(t *testing.T) {
	key := newTestRSAKey(t)
	const issuer = "https://supabase.example.com/auth/v1"
	const correctAudience = "authenticated"

	mw := setupAuth(t, key, issuer, correctAudience)
	handler := mw(okHandler)

	// Simulate mcp-client token attempting to access an authenticated route.
	wrongToken := key.signToken(t, issuer, "mcp-client", "user-sub-123")

	req := httptest.NewRequest(http.MethodPost, "/execute", nil)
	req.Header.Set("Authorization", "Bearer "+wrongToken)
	rr := httptest.NewRecorder()

	handler.ServeHTTP(rr, req)

	if rr.Code != http.StatusUnauthorized {
		t.Fatalf("expected 401 for wrong audience, got %d", rr.Code)
	}
}

// TestJWTAuth_AcceptsValidToken validates the positive path: a correctly signed token
// with matching issuer and audience passes the middleware.
func TestJWTAuth_AcceptsValidToken(t *testing.T) {
	key := newTestRSAKey(t)
	const issuer = "https://supabase.example.com/auth/v1"
	const audience = "authenticated"

	mw := setupAuth(t, key, issuer, audience)
	handler := mw(okHandler)

	validToken := key.signToken(t, issuer, audience, "user-sub-123")

	req := httptest.NewRequest(http.MethodPost, "/execute", nil)
	req.Header.Set("Authorization", "Bearer "+validToken)
	rr := httptest.NewRecorder()

	handler.ServeHTTP(rr, req)

	if rr.Code != http.StatusOK {
		t.Fatalf("expected 200 for valid token, got %d — body: %s", rr.Code, rr.Body.String())
	}
}

// TestJWTAuth_RejectsMissingAuthHeader validates that a request with no Authorization
// header is rejected with 401.
func TestJWTAuth_RejectsMissingAuthHeader(t *testing.T) {
	key := newTestRSAKey(t)
	mw := setupAuth(t, key, "https://example.com", "authenticated")
	handler := mw(okHandler)

	req := httptest.NewRequest(http.MethodPost, "/execute", nil)
	rr := httptest.NewRecorder()

	handler.ServeHTTP(rr, req)

	if rr.Code != http.StatusUnauthorized {
		t.Fatalf("expected 401 for missing Authorization header, got %d", rr.Code)
	}
}
