# syntax=docker/dockerfile:1
# ─────────────────────────────────────────────────────────────
# Stage 1 — builder: compilar o binário Go
# ─────────────────────────────────────────────────────────────
FROM golang:1.24-alpine AS builder

# Instalar gcc para CGO (pgx usa cgo)
RUN apk add --no-cache git ca-certificates tzdata

WORKDIR /build

# Copiar go.mod e go.sum para cache de dependências
COPY apps/mcp/go.mod apps/mcp/go.sum ./
RUN go mod download

# Copiar source do MCP
COPY apps/mcp/ .

# Build estático
RUN CGO_ENABLED=0 GOOS=linux GOARCH=amd64 \
    go build -ldflags="-w -s" -o /app/mcp-server ./cmd/mcp-server

# ─────────────────────────────────────────────────────────────
# Stage 2 — runner: imagem mínima Alpine
# ─────────────────────────────────────────────────────────────
FROM alpine:3.20 AS runner

RUN apk add --no-cache ca-certificates tzdata

WORKDIR /app

RUN addgroup -S mcpgroup && adduser -S mcpuser -G mcpgroup

COPY --from=builder /app/mcp-server ./mcp-server

USER mcpuser

EXPOSE 8080

CMD ["./mcp-server"]
