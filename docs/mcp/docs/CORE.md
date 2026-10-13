# Core Modules - Contrato Arquitetural

## Objetivo

Este documento define o **CONTRATO ARQUITETURAL** dos módulos centrais do MCP-Go. Estabelece responsabilidades não-negociáveis, invariantes, limites de atuação, e proibições explícitas que DEVEM ser respeitadas por todos os contribuidores.

## Escopo

**Inclui:**
- Responsabilidades normativas de cada módulo core
- Invariantes não-negociáveis
- Limites explícitos de atuação (o que cada módulo NÃO faz)
- Interfaces públicas e contratos
- Anti-patterns proibidos

**Não Inclui:**
- Arquitetura geral (ver [ARCHITECTURE.md](./ARCHITECTURE.md))
- Regras específicas de políticas (ver [POLICY_RULES.md](./POLICY_RULES.md))
- Detalhes de deployment (ver [DEPLOYMENT.md](./DEPLOYMENT.md))

---

## 1. Agent Layer

### Localização
`internal/agents/`

### Responsabilidades

O Agent Layer é o **único responsável** por:

1. **Interpretação de linguagem natural** → Intent estruturado
2. **Extração de entidades** (IDs, slugs, valores) do input do usuário
3. **Avaliação de confiança** e decisão de gating (Clarify/Review/Propose)
4. **Construção de propostas não-executáveis** (AgentProposal)
5. **Versionamento de schema** de respostas (AgentResponse.SchemaVersion)

**Referência:** `internal/agents/agent.go:33-76`

### Invariantes (NÃO NEGOCIÁVEIS)

- ✅ **Agent NUNCA executa comandos** - apenas propõe
- ✅ **AgentResponse é sempre versionado** (schema_version obrigatório)
- ✅ **Confidence é sempre calculado** (nunca hardcoded como 1.0)
- ✅ **workspaceID é sempre incluído** na construção de comandos
- ✅ **AgentProposal é imutável** após criação

**Referência:** `internal/agents/agent.go:34-76`, `internal/agents/planner/proposal.go:22-29`

### O que este módulo NÃO faz

- ❌ **NÃO executa efeitos colaterais** (sem I/O, sem DB, sem HTTP calls)
- ❌ **NÃO valida permissões** (responsabilidade do Policy Engine)
- ❌ **NÃO conhece HTTP** (não lê headers, não escreve responses)
- ❌ **NÃO persiste estado** (stateless, exceto CapabilityProvider injetado)
- ❌ **NÃO conhece MCP Runtime** (não chama Executor diretamente)

### Interface Principal

```go
type Agent struct {
    Interpret(ctx context.Context, input string, workspaceID string) *AgentResponse
}
```

**Contrato:**
- `input`: Linguagem natural do usuário
- `workspaceID`: Contexto de tenant (OBRIGATÓRIO)
- Retorna: `*AgentResponse` (nunca nil, mesmo em erro)

**Referência:** `internal/agents/agent.go:12-30`

### Structs Principais

- `Intent{Domain, Action}` - Resultado do parsing
- `AgentResponse{SchemaVersion, Message, Proposal, Warnings, Confidence}`
- `AgentProposal{Intent, Explanation, Commands, RequiresHumanApproval}`

### Sub-módulos

#### IntentParser (`interpreter/intent_parser.go`)
**Responsabilidade:** Mapear texto → Intent{Domain, Action}  
**Invariante:** Sempre retorna Intent (nunca nil), usa "unknown" para valores não identificados  
**Referência:** `internal/agents/interpreter/intent_parser.go:20-40`

#### EntityExtractor (`interpreter/entity_extractor.go`)
**Responsabilidade:** Extrair IDs, slugs, valores do input  
**Invariante:** Retorna Entities vazio se nada encontrado (nunca nil)

#### ConfidenceGating (`interpreter/confidence.go`)
**Responsabilidade:** Decidir: Clarify | Review | Propose  
**Invariante:** Thresholds são fixos (não configuráveis em runtime)

#### CommandBuilder (`planner/command_builder.go`)
**Responsabilidade:** Intent + Entities → MCPCommand[]  
**Invariante:** Sempre inclui workspaceID no contexto dos comandos  
**Referência:** `internal/agents/planner/command_builder.go`

### Fluxo Interno (Imutável)

```
Input → IntentParser.Parse → EntityExtractor.Extract
  → ConfidenceGating.Evaluate → CommandBuilder.Build
  → AgentResponse
```

**Invariante:** Este fluxo NÃO pode ser bypassado ou reordenado.

---

## 2. MCP Runtime

### Localização
`internal/mcp/`

### Responsabilidades

O MCP Runtime é o **executor soberano** responsável por:

1. **Geração e propagação de Execution ID** como primitiva de primeira classe para rastreabilidade AAA.
2. **Criação de MCPContext** imutável para cada execução.
3. **Enforcement obrigatório de Policy** antes de qualquer execução.
4. **Resolução de Tools** via ToolRegistry.
5. **Integração com GovernedClient** para execuções LLM governadas por quotas e políticas.
6. **Logging estruturado** de todas as execuções vinculadas ao context de tenant.

**Referência:** `internal/mcp/runtime/executor.go`, `internal/execution/execution.go`

### Invariantes (NÃO NEGOCIÁVEIS)

- ✅ **NENHUM comando é executado sem Policy.Evaluate** (linha 40-43 do executor.go)
- ✅ **MCPContext é imutável** após criação via NewEnvelope
- ✅ **Execution ID é obrigatório** em todo o ciclo de vida da execução e spans relacionados.
- ✅ **MCP Runtime é agnóstico ao transporte** (recebe identidades via parâmetros ou contexto tipado).

### Defense in Depth (Autorização)
O sistema opera em múltiplas camadas de proteção:
1. **Identidade:** Extraída e validada em `internal/http/middleware/auth.go` via JWT.
2. **Ownership:** Verificada em `internal/http/middleware/workspace_ownership.go` (Path vs Token).
3. **Runtime Policy:** Gating via `internal/policy/engine.go`.
4. **Data Isolation:** Reforço via RLS (PostgreSQL) ativado por variáveis de sessão.

### Interface Principal

```go
type Runtime interface {
    Execute(ctx context.Context, cmd MCPCommand, workspaceID, userID string) (MCPResult, error)
}

type MCPTool interface {
    Name() string
    Execute(ctx MCPContext, input map[string]any) (any, error)
}
```

**Contrato Runtime.Execute:**
- `ctx`: context.Context para propagação de request_id
- `cmd`: MCPCommand com Name e Input
- `workspaceID`, `userID`: Identificadores de tenant/usuário (OBRIGATÓRIOS)
- Retorna: `MCPResult` ou erro (se policy deny ou tool fail)

**Contrato MCPTool.Execute:**
- `ctx`: MCPContext imutável (contém workspace_id, user_id, permissions)
- `input`: map[string]any com parâmetros do comando
- Retorna: `any` (data) ou erro

**Referência:** `internal/mcp/runtime/executor.go:14-17`, `internal/mcp/registry/tool_registry.go:10-14`

### Structs Principais

- `Executor` - Implementação do Runtime
- `MCPCommand{Name, Input}` - Comando a ser executado
- `MCPContext{RequestID, WorkspaceID, UserID, Type, Roles, Source, Permissions, Timestamp}` - **IMUTÁVEL**
- `MCPResult{Data, Metadata}` - Resultado da execução
- `ToolRegistry` - Registro thread-safe de ferramentas

**Referência:** `internal/mcp/context/envelope.go:10-20`

### Sub-módulos

#### Executor (`runtime/executor.go`)
**Responsabilidade:** Orquestrar policy check → tool resolve → execute  
**Invariante:** Policy.Evaluate SEMPRE executado antes de tool resolution (linha 40)  
**Referência:** `internal/mcp/runtime/executor.go:34-89`

#### ToolRegistry (`registry/tool_registry.go`)
**Responsabilidade:** Gerenciar registro e descoberta de tools  
**Invariante:** Thread-safe (sync.RWMutex), tools registrados no bootstrap (não em runtime)  
**Métodos:**
- `Register(tool MCPTool)` - Adiciona tool (apenas no startup)
- `Resolve(name string) (MCPTool, error)` - Busca tool (thread-safe)

**Referência:** `internal/mcp/registry/tool_registry.go:16-42`

#### MCPContext (`context/envelope.go`)
**Responsabilidade:** Envelope imutável de contexto de execução  
**Invariante:** Struct não tem setters, criado apenas via NewEnvelope  
**Função:** `NewEnvelope(ctx, workspaceID, userID, idType, source) MCPContext`

**Referência:** `internal/mcp/context/envelope.go:22-32`

### Fluxo Interno (Imutável)

```
Execute → NewEnvelope(MCPContext) → Policy.Evaluate
  → [if denied] return error
  → ToolRegistry.Resolve → Tool.Execute → MCPResult
```

**Invariante:** Este fluxo NÃO pode ser bypassado. Policy check é OBRIGATÓRIO.

**Referência:** `internal/mcp/runtime/executor.go:34-89`

---

## 3. Policy Engine

### Localização
`internal/policy/`

### Responsabilidades

O Policy Engine é o **guardião de autorização** responsável por:

1. **Avaliação de autorização** para TODOS os comandos MCP
2. **Registro de namespaces** de políticas (portfolio.*, mcp.*)
3. **Matching de comandos** para namespaces registrados
4. **Logging de decisões** (allow/deny) com contexto completo
5. **Default DENY** para comandos sem namespace registrado

**Referência:** `internal/policy/engine.go:32-73`

### Invariantes (NÃO NEGOCIÁVEIS)

- ✅ **Default é DENY** (não ALLOW) - linha 53 do engine.go
- ✅ **Todas as decisões são logadas** (allow e deny)
- ✅ **Namespace matching é prefix-based** (strings.HasPrefix)
- ✅ **PolicyDecision é sempre retornado** (nunca nil, nunca panic)
- ✅ **workspace_id DEVE ser validado** em todas as policies de domínio

**Referência:** `internal/policy/engine.go:52-54`, `internal/policy/policies/portfolio.go:12-14`

### O que este módulo NÃO faz

- ❌ **NÃO executa comandos** (apenas autoriza/nega)
- ❌ **NÃO conhece HTTP** (não lê headers, não valida JWT)
- ❌ **NÃO persiste audit logs** (apenas loga decisões)
- ❌ **NÃO implementa RBAC completo** (apenas type-based: user/agent/admin/system)
- ❌ **NÃO valida ownership de workspace** (delega à camada de Middleware/RLS)

**Segurança:** A identidade é garantida por `tenant.Claims` extraídos do JWT.

### Interface Principal

```go
type Engine struct {
    Evaluate(ctx MCPContext, cmd MCPCommand) PolicyDecision
    RegisterNamespace(prefix string, fn RuleFunc)
}

type RuleFunc func(ctx MCPContext, cmd MCPCommand) PolicyDecision
```

**Contrato Engine.Evaluate:**
- `ctx`: MCPContext com workspace_id, user_id, type, roles
- `cmd`: MCPCommand com Name e Input
- Retorna: `PolicyDecision{Allowed, Policy, Reason}` (nunca nil)

**Contrato RuleFunc:**
- Implementa lógica de autorização para um namespace
- DEVE validar workspace_id não vazio (para policies de domínio)
- DEVE retornar Allow ou Deny (nunca nil)

**Referência:** `internal/policy/engine.go:11-12`, `internal/policy/policies/portfolio.go:10-24`

### Structs Principais

- `Engine` - Motor de políticas
- `PolicyDecision{Allowed bool, Policy string, Reason string}`
- `RuleFunc` - Função de avaliação de regras

### Namespaces Registrados

- `portfolio.*` → `policies.EvaluatePortfolioPolicy`
- `mcp.*` → `policies.EvaluateMCPPolicy`

**Invariante:** Namespaces são registrados no bootstrap (cmd/mcp-client-server/main.go:51-52), não em runtime.

**Referência:** `cmd/mcp-client-server/main.go:50-52`

### Fluxo Interno (Imutável)

```
Evaluate → Match namespace prefix → Execute RuleFunc
  → [if no match] global.default_deny
  → Allow/Deny → Log decision → PolicyDecision
```

**Invariante:** Default é DENY. Sem namespace registrado = negado.

**Referência:** `internal/policy/engine.go:44-54`

---

## Invariantes Globais do Core

Estes invariantes aplicam-se a **TODOS** os módulos core e NÃO podem ser violados:

### 1. Nenhum Comando é Executado sem PolicyEngine

**Regra:** `MCP Runtime.Execute` SEMPRE chama `PolicyEngine.Evaluate` antes de resolver/executar tool.

**Localização:** `internal/mcp/runtime/executor.go:40-43`

**Violação:** Executar tool sem policy check é **PROIBIDO** e causa vulnerabilidade de segurança.

---

### 2. Tenant-Scoped Unit of Work

**Regra:** TODA operação em tabelas multi-tenant DEVE usar o padrão `postgres.BeginTenant`.

**Localização:** `internal/storage/postgres/tenantdb.go`

**Mecanismo:**
1. Inicia transação SQL.
2. Executa `SET LOCAL app.current_workspace_id = $1`.
3. O PostgreSQL ativa as políticas de **RLS (Row Level Security)**.
4. **Fail-Closed:** Se a variável de sessão não estiver configurada, o banco retorna ZERO linhas.

---

### 3. Privacy First (Data Minimization)

**Regra:** Dados brutos de LLM (prompts/responses) NUNCA são persistidos em logs ou banco de dados.

**Mecanismo:**
- Apenas hashes SHA-256 são permitidos em spans e trilhas de auditoria.
- Erros de provedores LLM são sanitizados antes do armazenamento.

---

### 4. MCP Runtime NÃO Conhece HTTP

**Regra:** `internal/mcp/` NÃO pode importar `internal/http/` ou ler HTTP requests diretamente.

**Razão:** Separação de concerns. Runtime é agnóstico ao transporte.

---

### 5. Execution Tracing & Correlation

**Regra:** O `ExecutionID` deve ser propagado em todo o ciclo de vida da request.

**Contrato:**
- Injetado via `execution.WithExecutionID`.
- Usado como chave de correlação entre `llm_spans`, `audit_events` e `execution_trace_index`.
- Retornado obrigatoriamente em `AgentResponse` e `ErrorResponse`.

---

### 6. Sanitização de Erros & Health

**Responsabilidade:** Proteção contra Information Disclosure.

- **Erros:** Devem retornar `error_id` (UUID). Em produção, detalhes 5xx são ocultados via `internal/http/respond/respond.go`.
- **Health Checks:**
    - `/health/live`: Liveness simples (processo vivo).
    - `/health/ready`: Readiness profundo (valida conectividade DB + estados internos).

---

### 7. Governança de LLM

**Responsabilidade:** Controle e auditoria de consumo de modelos.

- **GovernedClient:** Wrapper mandatório que injeta governança em chamadas LLM.
- **Persistência:** Baseada nas entidades `llm_configs`, `tenant_llm_settings`, `llm_spans` e `audit_events`.
- **Visibilidade:** Provida via Admin API para monitoramento de quotas e violações.

---

### 5. MCPContext é Imutável Após Criação

**Regra:** `MCPContext` struct NÃO tem setters. Criado apenas via `NewEnvelope`.

**Localização:** `internal/mcp/context/envelope.go:10-32`

**Razão:** Garantir auditabilidade. Context não pode ser modificado durante execução.

**Violação:** Adicionar setters a MCPContext é **PROIBIDO**.

---

### 6. ToolRegistry é Thread-Safe

**Regra:** `ToolRegistry` usa `sync.RWMutex` para acesso concorrente.

**Localização:** `internal/mcp/registry/tool_registry.go:17-19`

**Violação:** Remover mutex ou acessar `tools` map diretamente é **PROIBIDO**.

---

### 7. Policy Default é DENY

**Regra:** Se nenhum namespace registrado para um comando, a decisão é **DENY**.

**Localização:** `internal/policy/engine.go:52-54`

**Violação:** Mudar default para ALLOW é **PROIBIDO** (vulnerabilidade de segurança).

---

## Anti-patterns Proibidos

### 1. Bypass Direto do Executor

**Proibido:**
```go
// ❌ NUNCA fazer isso
tool := registry.Resolve("portfolio")
result := tool.Execute(ctx, input) // Bypass de policy!
```

**Correto:**
```go
// ✅ Sempre usar o Executor
result := executor.Execute(ctx, cmd, workspaceID, userID)
```

**Razão:** Policy check é obrigatório. Bypass é vulnerabilidade de segurança.

---

### 2. Executar Queries sem Tenant-Scoped Unit of Work

**Proibido:**
```go
// ❌ NUNCA executar query direta em tabelas multi-tenant
db.Query(ctx, "SELECT * FROM items ...")
```

**Correto:**
```go
// ✅ Sempre usar BeginTenant para ativar RLS
tx, _ := postgres.BeginTenant(ctx, pool)
tx.Query(ctx, "SELECT * FROM items ...")
```

---

### 3. Persistência de Dados Brutos LLM

**Proibido:**
```go
// ❌ NUNCA salvar prompts ou responses originais
span.Prompt = rawPrompt
```

**Correto:**
```go
// ✅ Salvar apenas o hash para integridade
span.InputHash = calculateSHA256(rawPrompt)
```

---

### 2. Chamar Tools sem Passar pelo Runtime

**Proibido:**
```go
// ❌ NUNCA instanciar tool diretamente
portfolioTool := portfolio.NewPortfolioTool(service)
portfolioTool.Execute(ctx, input) // Sem policy check!
```

**Correto:**
```go
// ✅ Tools são registrados no bootstrap e resolvidos pelo Runtime
toolRegistry.Register(portfolio.NewPortfolioTool(service))
// Execução via Runtime
executor.Execute(ctx, cmd, workspaceID, userID)
```

**Localização:** `cmd/mcp-client-server/main.go:54-55`

---

### 3. Ler workspace_id Direto do Request HTTP no Core

**Proibido:**
```go
// ❌ NUNCA fazer isso em internal/mcp/ ou internal/agents/
workspaceID := chi.URLParam(r, "workspaceId") // HTTP no core!
```

**Correto:**
```go
// ✅ HTTP layer extrai e passa como parâmetro
// Handler (internal/http/handlers/)
workspaceID := chi.URLParam(r, "workspaceId")
service.Execute(ctx, workspaceID, req) // Passa como string

// Core recebe como parâmetro
func (e *Executor) Execute(ctx context.Context, cmd MCPCommand, workspaceID, userID string)
```

**Razão:** Core não conhece HTTP. Separação de concerns.

---

### 4. Criar Tools sem Policy Correspondente

**Proibido:**
```go
// ❌ Registrar tool sem policy
toolRegistry.Register(NewMyTool()) // Sem namespace "mytool.*" registrado
```

**Correto:**
```go
// ✅ Sempre registrar namespace de policy primeiro
policyEngine.RegisterNamespace("mytool.", policies.EvaluateMyToolPolicy)
toolRegistry.Register(NewMyTool())
```

**Razão:** Tool sem policy = default DENY = tool inutilizável.

**Localização:** `cmd/mcp-client-server/main.go:50-55`

---

### 5. Modificar MCPContext Durante Execução

**Proibido:**
```go
// ❌ NUNCA fazer isso (struct não tem setters, mas evitar workarounds)
ctx.WorkspaceID = "other-workspace" // Não compila (não tem setter)
// Ou usar reflection para modificar
```

**Correto:**
```go
// ✅ MCPContext é imutável. Criar novo se necessário.
newCtx := context.NewEnvelope(ctx, newWorkspaceID, userID, idType, source)
```

**Razão:** Auditabilidade. Context deve ser imutável para garantir rastreabilidade.

---

### 6. Ignorar PolicyDecision.Allowed

**Proibido:**
```go
// ❌ NUNCA ignorar decisão de policy
decision := policyEngine.Evaluate(ctx, cmd)
// Executar mesmo se decision.Allowed == false
tool.Execute(ctx, input) // Bypass!
```

**Correto:**
```go
// ✅ Sempre respeitar decisão
decision := policyEngine.Evaluate(ctx, cmd)
if !decision.Allowed {
    return MCPResult{}, fmt.Errorf("authorization denied: %s", decision.Reason)
}
```

**Localização:** `internal/mcp/runtime/executor.go:41-43`

---

### 7. Usar context.TODO() em Produção

**Proibido:**
```go
// ❌ Perda de propagação de context
items, err := service.ListItems(context.TODO(), workspaceID)
```

**Correto:**
```go
// ✅ Propagar context recebido
items, err := service.ListItems(ctx, workspaceID)
```

**Localização atual (DEBT):** `internal/mcp/tools/portfolio/tool.go:38,53`

⚠️ **TECH DEBT (P1):** Substituir context.TODO() por propagação de MCPContext.

---

## Referências no Código

### Agent Layer
- `internal/agents/agent.go` - Orquestrador principal
- `internal/agents/interpreter/intent_parser.go` - Parsing de intent
- `internal/agents/planner/command_builder.go` - Construção de comandos
- `internal/agents/planner/proposal.go` - AgentResponse, AgentProposal

### MCP Runtime
- `internal/mcp/runtime/executor.go` - Executor principal (linhas 34-89: fluxo completo)
- `internal/mcp/registry/tool_registry.go` - Registro de tools (thread-safe)
- `internal/mcp/context/envelope.go` - MCPContext imutável (linhas 10-32)
- `internal/mcp/tools/portfolio/tool.go` - Exemplo de tool

### Policy Engine
- `internal/policy/engine.go` - Motor de avaliação (linhas 32-73: Evaluate)
- `internal/policy/policies/portfolio.go` - Regras de portfolio
- `internal/policy/policies/mcp.go` - Regras de mcp
- `internal/policy/decision.go` - PolicyDecision struct

---

## Checklist de Atualização

Este documento DEVE ser atualizado quando:

- [ ] Nova interface pública é adicionada a um módulo core
- [ ] Struct principal é modificada (breaking change)
- [ ] Novo invariante é identificado
- [ ] Novo anti-pattern é descoberto
- [ ] Novo sub-módulo é criado dentro de core
- [ ] Fluxo interno de um módulo muda significativamente
- [ ] Nova tool é adicionada ao registry
- [ ] Novo namespace de policy é registrado
- [ ] Security debt é resolvido ou identificado
- [ ] Responsabilidade de módulo muda
