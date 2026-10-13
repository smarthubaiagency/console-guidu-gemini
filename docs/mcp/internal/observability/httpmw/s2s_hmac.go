package httpmw

import (
	"bytes"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"io"
	"net/http"
	"strings"
	"time"

	"github.com/cartaopro/mcp/internal/antireplay"
	"github.com/cartaopro/mcp/internal/observability/log"
)

const (
	HeaderS2STimestamp  = "X-Cartaopro-Timestamp"
	HeaderS2SNonce      = "X-Cartaopro-Nonce"
	HeaderS2SBodySHA256 = "X-Cartaopro-Body-SHA256"
	HeaderS2SSignature  = "X-Cartaopro-Signature"

	s2sMaxSkew = 5 * time.Minute
)

func writeS2SError(w http.ResponseWriter, status int, code, message string) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	json.NewEncoder(w).Encode(map[string]string{"error": code, "message": message}) //nolint:errcheck
}

// S2SHMAC validates the HMAC-SHA256 signature and prevents replay attacks.
// It expects headers X-Cartaopro-Timestamp (ISO 8601), X-Cartaopro-Nonce (UUID v4),
// X-Cartaopro-Body-SHA256 (hex) and X-Cartaopro-Signature (hex).
// Canonical string: METHOD + "\n" + PATH + "\n" + TIMESTAMP + "\n" + NONCE + "\n" + BODY_SHA256.
func S2SHMAC(secret string, store antireplay.Store, logger *log.Logger) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			timestampStr := r.Header.Get(HeaderS2STimestamp)
			nonce := r.Header.Get(HeaderS2SNonce)
			bodySHA256 := r.Header.Get(HeaderS2SBodySHA256)
			signature := r.Header.Get(HeaderS2SSignature)

			if timestampStr == "" || nonce == "" || bodySHA256 == "" || signature == "" {
				logger.Warn("S2S HMAC missing required headers")
				writeS2SError(w, http.StatusUnauthorized, "unauthorized", "Missing security headers")
				return
			}

			// 1. Validate Timestamp Skew (ISO 8601 / RFC3339)
			t, err := time.Parse(time.RFC3339Nano, timestampStr)
			if err != nil {
				t, err = time.Parse(time.RFC3339, timestampStr)
				if err != nil {
					logger.Warn("S2S HMAC invalid timestamp format", log.String("timestamp", timestampStr))
					writeS2SError(w, http.StatusUnauthorized, "unauthorized", "Invalid timestamp format")
					return
				}
			}

			skew := time.Since(t)
			if skew < 0 {
				skew = -skew
			}
			if skew > s2sMaxSkew {
				logger.Warn("S2S HMAC timestamp skew exceeded", log.String("timestamp", timestampStr))
				writeS2SError(w, http.StatusUnauthorized, "unauthorized", "Timestamp skew exceeded")
				return
			}

			// 2. Validate Body Hash
			var rawBody []byte
			if r.Body != nil {
				rawBody, err = io.ReadAll(r.Body)
				if err != nil {
					logger.Error("S2S HMAC failed to read body", log.Error(err))
					writeS2SError(w, http.StatusInternalServerError, "internal_error", "Failed to read request body")
					return
				}
				r.Body = io.NopCloser(bytes.NewBuffer(rawBody))
			}

			calculatedHash := sha256.Sum256(rawBody)
			calculatedHashHex := hex.EncodeToString(calculatedHash[:])

			if !strings.EqualFold(calculatedHashHex, bodySHA256) {
				logger.Warn("S2S HMAC body hash mismatch",
					log.String("expected", bodySHA256),
					log.String("calculated", calculatedHashHex))
				writeS2SError(w, http.StatusUnauthorized, "unauthorized", "Body hash mismatch")
				return
			}

			// 3. Validate Signature
			// Canonical: METHOD + "\n" + PATH + "\n" + TIMESTAMP + "\n" + NONCE + "\n" + BODY_SHA256
			pathWithQuery := r.URL.EscapedPath()
			if r.URL.RawQuery != "" {
				pathWithQuery += "?" + r.URL.RawQuery
			}

			canonicalStr := strings.Join([]string{
				r.Method,
				pathWithQuery,
				timestampStr,
				nonce,
				calculatedHashHex,
			}, "\n")

			mac := hmac.New(sha256.New, []byte(secret))
			mac.Write([]byte(canonicalStr))
			expectedSig := hex.EncodeToString(mac.Sum(nil))

			if !hmac.Equal([]byte(signature), []byte(expectedSig)) {
				logger.Warn("S2S HMAC signature mismatch",
					log.String("method", r.Method),
					log.String("path", pathWithQuery))
				writeS2SError(w, http.StatusUnauthorized, "unauthorized", "Invalid signature")
				return
			}

			// 4. Validate Nonce (Anti-Replay)
			ttl := s2sMaxSkew + 60*time.Second
			if storeErr := store.CheckAndSet(r.Context(), nonce, ttl); storeErr != nil {
				if storeErr == antireplay.ErrReplayDetected {
					logger.Warn("S2S HMAC replay detected", log.String("nonce", nonce))
					writeS2SError(w, http.StatusConflict, "replay_detected", "Request already processed")
					return
				}
				logger.Error("S2S HMAC nonce store error", log.Error(storeErr))
				writeS2SError(w, http.StatusServiceUnavailable, "service_unavailable", "Security service unavailable")
				return
			}

			next.ServeHTTP(w, r)
		})
	}
}
