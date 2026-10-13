# Deployment

## Objetivo

Documentar como fazer deploy do MCP-Go em diferentes ambientes (Docker, EasyPanel, Kubernetes), incluindo configuração, variáveis de ambiente, e health checks.

## Escopo

**Inclui:**

- Deployment com Docker
- Deployment no EasyPanel
- Deployment no Kubernetes (básico)
- Variáveis de ambiente obrigatórias
- Health checks e readiness probes
- Migrations (quando implementadas)

**Não Inclui:**

- Setup de desenvolvimento local (ver [DEVELOPMENT.md](./DEVELOPMENT.md))
- Detalhes de segurança (ver [SECURITY.md](./SECURITY.md))

## Variáveis de Ambiente

### Obrigatórias

| Variável       | Descrição                             | Exemplo                                             |
| -------------- | ------------------------------------- | --------------------------------------------------- |
| `DATABASE_URL` | PostgreSQL connection string          | `postgres://user:pass@host:5432/db?sslmode=disable` |
| `REDIS_URL`    | Redis connection string (Anti-replay) | `redis://:pass@host:6379/0`                         |
| `JWT_SECRET`   | Secret para validação de tokens JWT   | `your-secret`                                       |
| `JWT_ISSUER`   | Issuer esperado nos tokens            | `linkko-console`                                    |

### Opcionais

| Variável    | Default       | Descrição                                 |
| ----------- | ------------- | ----------------------------------------- |
| `PORT`      | `3002`        | Porta HTTP                                |
| `LOG_LEVEL` | `debug`       | Nível de log (debug/info/warn/error)      |
| `ENV`       | `development` | Ambiente (development/staging/production) |

### Planejadas (TODO)

| Variável                    | Descrição                         |
| --------------------------- | --------------------------------- | ---------------------------------------- |
| `S2S_HMAC_SECRET`           | HMAC Secret para autenticação S2S |
| `S2S_HMAC_REQUIRED`         | `false`                           | Se `true`, falha se HMAC estiver ausente |
| `S2S_HMAC_MAX_SKEW_SECONDS` | `60`                              | Janela de expiração da assinatura        |

## Deployment com Docker

### Build

**Usando Makefile:**

```bash
make build
```

**Usando Docker diretamente:**

```bash
docker build -t mcp-go:latest .
```

**Build de binário específico:**

```bash
docker build --build-arg CMD_PATH=cmd/external-adapter -t external-adapter:latest .
```

### Run

```bash
docker run -d \
  --name mcp-server \
  -p 3002:8080 \
  -e DATABASE_URL="postgres://user:pass@host:5432/db" \
  -e LOG_LEVEL="info" \
  -e ENV="production" \
  mcp-go:latest
```

### Health Check

O Dockerfile inclui health check automático:

```dockerfile
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
    CMD curl -f http://localhost:8080/health || exit 1
```

## Deployment no EasyPanel

### 1. Criar Aplicação

1. Acesse EasyPanel
2. Crie nova aplicação: "MCP Server"
3. Selecione "Docker" como tipo

### 2. Configurar Dockerfile

Use o Dockerfile existente na raiz do projeto.

### 3. Configurar Variáveis de Ambiente

No painel do EasyPanel, adicione:

```
DATABASE_URL=postgres://user:pass@postgres:5432/mcp_db
PORT=8080
LOG_LEVEL=info
ENV=production
```

### 4. Configurar Porta

- **Container Port:** 8080
- **Public Port:** 80 ou 443 (com SSL)

### 5. Deploy

Clique em "Deploy" e aguarde o build.

### 6. Verificar Health

Acesse: `https://<your-domain>/health`

## Deployment no Kubernetes

### Deployment Manifest

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: mcp-server
spec:
  replicas: 3
  selector:
    matchLabels:
      app: mcp-server
  template:
    metadata:
      labels:
        app: mcp-server
    spec:
      containers:
        - name: mcp-server
          image: mcp-go:latest
          ports:
            - containerPort: 8080
          env:
            - name: DATABASE_URL
              valueFrom:
                secretKeyRef:
                  name: mcp-secrets
                  key: database-url
            - name: LOG_LEVEL
              value: "info"
            - name: ENV
              value: "production"
          livenessProbe:
            httpGet:
              path: /health
              port: 8080
            initialDelaySeconds: 10
            periodSeconds: 30
          readinessProbe:
            httpGet:
              path: /health
              port: 8080
            initialDelaySeconds: 5
            periodSeconds: 10
```

### Service Manifest

```yaml
apiVersion: v1
kind: Service
metadata:
  name: mcp-server
spec:
  selector:
    app: mcp-server
  ports:
    - protocol: TCP
      port: 80
      targetPort: 8080
  type: LoadBalancer
```

## Database Migrations

O schema do banco de dados é gerenciado pelo **Prisma** no repositório principal (`cartaopro`). As migrações que habilitam RLS para as tabelas `AiAuditEvent`, `AiExecutionSpan` e `AiExecution` devem ser executadas manualmente no Supabase SQL Editor antes do primeiro deploy em produção.

> [!IMPORTANT]
> Alterações de schema que envolvam RLS **não devem ser aplicadas via `prisma db push`**. Use o Supabase SQL Editor para garantir que as políticas de segurança sejam aplicadas corretamente.

## Health Checks

### Liveness Probe

**Endpoint:** `GET /health`  
**Resposta:** `{"status":"ok","service":"mcp-client-server"}`  
**Uso:** Verifica se o serviço está rodando

**Endpoint:** `GET /health/ready`  
**Verificações:**

- Database connection OK
- Redis connection OK (se `S2S_HMAC_REQUIRED=true`)
- Graceful shutdown NOT in progress

## Graceful Shutdown

**Status: Implementado** (Sprint F — `cmd/mcp-server/main.go`)

O servidor captura `SIGTERM` / `SIGINT` e executa o drain de forma ordenada:

```go
quit := make(chan os.Signal, 1)
signal.Notify(quit, syscall.SIGINT, syscall.SIGTERM)
<-quit

// 1. Marca readiness como 503 imediatamente
healthHandler.SetShuttingDown()

// 2. Drain de até 30 segundos
ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
defer cancel()
server.Shutdown(ctx)

// 3. Fecha Redis
redisClient.Close()
```

**Fluxo de Shutdown:**

1. Sinal recebido → `/health/ready` passa a retornar `503 Service Unavailable`
2. Load balancer / K8s remove o pod do pool em ≤ 5s (readiness probe interval)
3. Requisições em andamento têm até **30s** para finalizar
4. Redis fechado após drain
5. Processo encerra com código 0

## Referências no Código

- Dockerfile: `Dockerfile`
- Main entrypoint: `cmd/mcp-server/main.go`
- Config: `internal/config/config.go`
- Health handler: `internal/http/health/health.go`

## Checklist de Atualização

Este documento deve ser atualizado quando:

- [ ] Nova variável de ambiente é adicionada
- [ ] Migrations são implementadas
- [ ] Novo ambiente de deploy é suportado
- [ ] Health check muda
- [ ] Dockerfile é modificado
