# Development Guide

## Objetivo

Documentar como configurar ambiente de desenvolvimento local, executar testes, e contribuir para o MCP-Go.

## Escopo

**Inclui:**
- Setup de ambiente local
- Como rodar o servidor
- Como rodar testes
- Guia de contribuição
- Padrões de código

**Não Inclui:**
- Deployment em produção (ver [DEPLOYMENT.md](./DEPLOYMENT.md))
- Detalhes de arquitetura (ver [ARCHITECTURE.md](./ARCHITECTURE.md))

## Pré-requisitos

- **Go:** 1.25.6 ou superior
- **PostgreSQL:** 14 ou superior
- **Make:** (opcional, para usar Makefile)
- **Docker:** (opcional, para rodar DB local)

## Setup Local

### 1. Clone o Repositório

```bash
git clone https://github.com/linkkotech/mcp-go.git
cd mcp-go
```

### 2. Instale Dependências

```bash
make install
# ou
go mod download
```

### 3. Configure Variáveis de Ambiente

Copie `.env.example` para `.env`:
```bash
cp .env.example .env
```

Edite `.env`:
```bash
DATABASE_URL=postgres://user:password@localhost:5432/mcp_db?sslmode=disable
PORT=3002
LOG_LEVEL=debug
ENV=development
```

### 4. Inicie PostgreSQL

**Com Docker:**
```bash
docker run -d \
  --name mcp-postgres \
  -e POSTGRES_USER=user \
  -e POSTGRES_PASSWORD=password \
  -e POSTGRES_DB=mcp_db \
  -p 5432:5432 \
  postgres:14
```

**Ou use PostgreSQL local.**

### 5. Execute Migrations

⚠️ **TODO:** Migrations não implementadas.

**Planejado:**
```bash
make migrate-up
```

### 6. Execute o Servidor

```bash
make run-mcp
# ou
go run ./cmd/mcp-client-server
```

**Servidor rodando em:** `http://localhost:3002`

## Comandos Úteis

### Build

```bash
make build
# Gera binários em bin/
```

### Testes

```bash
make test
# ou
go test ./...
```

### Lint

```bash
make lint
# ou
golangci-lint run
```

### Format

```bash
make fmt
# ou
gofmt -w .
```

### Clean

```bash
make clean
# Remove bin/
```

## Estrutura de Testes

### Testes Unitários

**Localização:** `*_test.go` ao lado do código

**Exemplo:**
```go
func TestAgentInterpret(t *testing.T) {
    // Arrange
    agent := agents.NewAgent(nil, logger)
    
    // Act
    resp := agent.Interpret(ctx, "liste portfolio", "workspace-123")
    
    // Assert
    if resp.Confidence < 0.8 {
        t.Errorf("expected high confidence, got %f", resp.Confidence)
    }
}
```

### Testes de Integração (TODO)

**Planejado:** `internal/integration_test/`

**Exemplo:**
```go
func TestAgentGatewayE2E(t *testing.T) {
    // Setup HTTP server
    // Call /agent/propose
    // Call /agent/execute
    // Verify results
}
```

### Testes de Multi-Tenancy (TODO - CRÍTICO)

**Planejado:** Verificar isolamento de workspace

## Padrões de Código

### Naming Conventions

- **Packages:** lowercase, singular (ex: `agent`, `policy`)
- **Files:** lowercase, snake_case (ex: `intent_parser.go`)
- **Structs:** PascalCase (ex: `AgentResponse`)
- **Functions:** PascalCase (public), camelCase (private)

### Logging

Use structured logging (zap):
```go
logger.Info("operation started",
    log.String("module", "agent"),
    log.String("action", "interpret"),
    log.String("workspace_id", workspaceID),
)
```

**Campos obrigatórios:**
- `module` - Nome do módulo
- `action` - Ação sendo executada

### Error Handling

```go
if err != nil {
    logger.Error("operation failed",
        log.Error(err),
        log.String("module", "agent"),
    )
    return nil, fmt.Errorf("failed to interpret: %w", err)
}
```

### Context Propagation

⚠️ **Evitar `context.TODO()`** - Propagar context sempre que possível.

**Correto:**
```go
func (s *Service) DoSomething(ctx context.Context, ...) error {
    return s.repo.Query(ctx, ...)
}
```

**Incorreto:**
```go
return s.repo.Query(context.TODO(), ...) // ❌
```

## Como Adicionar Nova Feature

### 1. Adicionar Tool

1. Criar `internal/mcp/tools/<domain>/tool.go`
2. Implementar interface `MCPTool`
3. Registrar em `cmd/mcp-client-server/main.go`
4. Adicionar testes

### 2. Adicionar Policy

1. Criar `internal/policy/policies/<namespace>.go`
2. Implementar `RuleFunc`
3. Registrar namespace em `main.go`
4. Adicionar testes
5. Documentar em `docs/POLICY_RULES.md`

### 3. Adicionar Endpoint

1. Criar handler em `internal/http/handlers/`
2. Adicionar rota em `internal/http/routes.go`
3. Atualizar `openapi/openapi.yaml`
4. Adicionar testes
5. Documentar em `docs/API.md`

## Guia de Contribuição

### 1. Fork e Branch

```bash
git checkout -b feature/my-feature
```

### 2. Faça Mudanças

- Escreva código
- Adicione testes
- Atualize documentação

### 3. Commit

```bash
git commit -m "feat: add new feature"
```

**Formato de commit:** [Conventional Commits](https://www.conventionalcommits.org/)

### 4. Push e PR

```bash
git push origin feature/my-feature
```

Abra Pull Request no GitHub.

## Referências no Código

- Main: `cmd/mcp-client-server/main.go`
- Config: `internal/config/config.go`
- Makefile: `Makefile`

## Checklist de Atualização

Este documento deve ser atualizado quando:
- [ ] Pré-requisitos mudam (versão Go, dependências)
- [ ] Setup local muda
- [ ] Novos comandos são adicionados ao Makefile
- [ ] Padrões de código mudam
- [ ] Processo de contribuição muda
