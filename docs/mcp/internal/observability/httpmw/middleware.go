package httpmw

import (
	"net/http"
	"time"

	"github.com/cartaopro/mcp/internal/observability/log"
	"github.com/cartaopro/mcp/internal/observability/requestid"
	"github.com/go-chi/chi/v5/middleware"
	"go.uber.org/zap"
)

func RequestID(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		id := r.Header.Get("X-Request-ID")
		ctx := requestid.NewContext(r.Context(), id)
		w.Header().Set("X-Request-ID", requestid.FromContext(ctx))
		next.ServeHTTP(w, r.WithContext(ctx))
	})
}

func Logger(l *log.Logger) func(next http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			ww := middleware.NewWrapResponseWriter(w, r.ProtoMajor)
			t1 := time.Now()

			defer func() {
				l.Info("request completed",
					zap.String("request_id", requestid.FromContext(r.Context())),
					zap.String("method", r.Method),
					zap.String("path", r.URL.Path),
					zap.Int("status", ww.Status()),
					zap.Duration("latency", time.Since(t1)),
				)
			}()

			next.ServeHTTP(ww, r)
		})
	}
}
