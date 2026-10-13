# Testing Strategy

## Objetivo

Documentar estratégia de testes do MCP-Go: tipos de testes, como escrever, e cobertura esperada.

## Escopo

**Inclui:**
- Tipos de testes (unit, integration, e2e)
- Como escrever testes
- Testes de multi-tenancy
- Cobertura de código

**Não Inclui:**
- Setup de desenvolvimento (ver [DEVELOPMENT.md](./DEVELOPMENT.md))

- ❌ **NUNCA** permitir merge sem aprovação do `make security-check`.
- ❌ **NUNCA** fazer deploy sem testes de isolamento multi-tenant (RLS).
- ❌ **NUNCA** adicionar policy sem testes de negar/permitir.
- ❌ **NUNCA** persistir dados brutos de LLM (validação via `governed_security_test.go`).

```
        /\
       /E2E\       (Integridade de fluxos Agentic)
      /------\
     /  INT  \     (Database RLS, Auth Middleware)
    /----------\
   /   UNIT    \   (Policy Engine, Logic, Formatting)
  /--------------\
```

## Security Gates (Obrigatórios)

Toda alteração deve passar pelo gate de segurança antes do merge.

| Comando | Descrição | Risco Coberto |
| :--- | :--- | :--- |
| `make security-check` | Executa todos os testes de segurança | Regressão de acesso, bypass de policy |
| `make security-check-race` | Testes com race detector ativo | Concurrency issues em ToolRegistry |

## Testes Unitários

### Localização
`*_test.go` ao lado do código testado

### Executar
```bash
go test ./...
```

### Exemplo

```go
func TestIntentParser_Parse(t *testing.T) {
    parser := interpreter.NewIntentParser()
    
    tests := []struct{
        input string
        expectedDomain string
        expectedAction string
    }{
        {"liste portfolio", "portfolio", "list"},
        {"crie novo item", "unknown", "create"},
    }
    
    for _, tt := range tests {
        t.Run(tt.input, func(t *testing.T) {
            intent := parser.Parse(tt.input)
            if intent.Domain != tt.expectedDomain {
                t.Errorf("expected domain %s, got %s", tt.expectedDomain, intent.Domain)
            }
        })
    }
}
```

### Cobertura Esperada
- **Core modules:** >80%
- **Handlers:** >70%
- **Utilities:** >90%

## Testes de Integração (TODO)

### Localização
`internal/integration_test/`

### Exemplo

```go
func TestPortfolioService_CreateItem(t *testing.T) {
    // Setup: DB, service
    db := setupTestDB(t)
    defer db.Close()
    
    service := portfolio.NewService(postgres.NewPortfolioRepo(db), logger)
    
    // Act
    item, err := service.CreateItem(ctx, workspaceID, dto)
    
    // Assert
    require.NoError(t, err)
    assert.Equal(t, "Product", item.Name)
}
```

## Testes E2E (TODO)

### Localização
`internal/e2e_test/`

### Exemplo

```go
func TestAgentGateway_ProposeAndExecute(t *testing.T) {
    // Setup: HTTP server
    server := setupTestServer(t)
    defer server.Close()
    
    // Propose
    proposeResp := callPropose(t, server, "liste portfolio")
    assert.NotEmpty(t, proposeResp.ProposalHash)
    
    // Execute
    execResp := callExecute(t, server, proposeResp.ProposalHash)
    assert.Equal(t, "success", execResp.Status)
}
```

---

## Verificação de Segurança AAA

As "Linhas Vermelhas" de segurança são testadas em arquivos específicos de alta sensibilidade.

### 1. Anti-Bypass (Executor)
**Risco:** Execução de comando sem passar pela avaliação de Policy.
**Teste:** `internal/mcp/runtime/executor_security_test.go`
**Mecânica:** Mock de Policy Engine injeta falha. O Runtime deve abortar imediatamente.

### 2. Privacy-First (LLM)
**Risco:** Vazamento de prompts ou dados sensíveis em spans/logs.
**Teste:** `internal/llm/runtime/governed_security_test.go`
**Mecânica:** Valida que spans contêm apenas hashes SHA-256 e metadados técnicos, nunca o texto claro.

### 3. Fail-Closed RLS (Storage)
**Risco:** Acesso a dados de outro tenant por falha na query SQL.
**Teste:** `internal/storage/postgres/rls_test.go`
**Mecânica:** Valida que, sem o `BeginTenant` (comando `SET LOCAL`), o banco de dados retorna ZERO linhas, impedindo vazamento lateral.

### 4. Auth & Audience Gating
**Risco:** Uso de token de cliente para rotas de Admin ou acesso a workspace de terceiro.
**Testes:**
- `internal/http/middleware/auth_test.go` (JWT validity/Audience)
- `internal/http/middleware/workspace_ownership_test.go` (Cross-workspace mismatch)

### 5. Rate Limiting por Tenant
**Risco:** Um único cliente monopolizar recursos de LLM.
**Teste:** `internal/http/middleware/ratelimit_test.go`
**Mecânica:** Simula burst de requisições e valida o retorno de HTTP 429 com headers corretos.

## Observabilidade e Correlação
Testes de integração garantem que:
1. `X-Request-ID` é gerado e propagado.
2. `ExecutionID` está presente no contexto de toda chamada à `Tool`.
3. Erros 5xx retornam um `error_id` único para rastreamento sem vazar detalhes.

## Referências no Código

- Testes existentes: `internal/agents/agent_test.go`, `internal/policy/policy_test.go`
- Test helpers: (TODO)

## Checklist de Atualização

Este documento deve ser atualizado quando:
- [ ] Novo tipo de teste é adicionado
- [ ] Estratégia de testes muda
- [ ] Cobertura esperada muda
- [ ] Test helpers são criados
