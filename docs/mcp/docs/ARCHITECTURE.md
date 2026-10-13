# Architecture

## Objetivo

Documentar a arquitetura de alto nível do MCP-Go, incluindo componentes principais, suas responsabilidades, e como eles interagem para fornecer execução segura de comandos com policy enforcement e isolamento multi-tenant.

## Escopo

**Inclui:**

- Visão geral dos componentes (Agent Layer, MCP Runtime, Policy Engine)
- Fluxo de dados entre camadas
- Decisões arquiteturais e trade-offs
- Diagramas de componentes e sequência

**Não Inclui:**

- Detalhes de implementação de cada módulo (ver [CORE.md](./CORE.md))
- Regras específicas de políticas (ver [POLICY_RULES.md](./POLICY_RULES.md))
- Detalhes de API (ver [API.md](./API.md))

## Invariantes / Linhas Vermelhas

- ❌ **NUNCA** permitir execução de comandos sem passar pelo Policy Engine
- ❌ **NUNCA** permitir acesso cross-tenant (workspace isolation é obrigatório)
- ❌ **NUNCA** confiar em dados do cliente sem validação (hash validation obrigatória)

## Modelo de Segurança (Defense in Depth)

O sistema implementa múltiplas camadas de proteção independentes para garantir a integridade dos dados e prevenir acessos não autorizados:

1. **Camada 1 - Transporte & Identidade**: Autenticação via JWT obrigatória em todas as rotas `/v1`. Validação rigorosa de emissor (`iss`), audiência (`aud`) e expiração (`exp`). Diferenciação mandatória entre audiências corporativas (`mcp-client`) e administrativas (`mcp-admin`).
2. **Camada 2 - Acesso & Ownership**: Middleware de propriedade de workspace que valida se o `{workspaceId}` no path da URL corresponde ao `workspace_id` contido nas claims do token. Rejeição com 401/403 ocorre antes que o tráfego atinja o Core.
3. **Camada 3 - Execução & Policy**: O `Executor` atua como o único ponto de entrada para ferramentas MCP. O fluxo é obrigatoriamente `Policy.Evaluate` -> `Execute`, disparando um `fail-closed` em caso de negação. O bypass direto de ferramentas é bloqueado pela arquitetura do módulo.
4. **Camada 4 - Persistência & Multi-tenancy**: Isolamento físico/lógico via PostgreSQL Row Level Security (RLS). Operações são envelopadas em transações (`SET LOCAL app.current_workspace_id`) que garantem que, na ausência de contexto, o banco retorne **ZERO** linhas.

## Componentes Principais

### 1. Agent Layer

**Localização:** `internal/agents/`  
**Responsabilidade:** Interpretar linguagem natural e gerar propostas estruturadas (não-executáveis)

**Sub-componentes:**

- `interpreter/` - Parsing de intent e extração de entidades
- `planner/` - Construção de comandos MCP a partir de intents
- `registry/` - Descoberta de capabilities

### 2. MCP Runtime

**Localização:** `internal/mcp/`  
**Responsabilidade:** Executar comandos MCP com policy enforcement e rastreabilidade total.

**Mecanismos de Segurança:**

- **Execution ID**: Primitiva de primeira classe gerada no entrypoint (Handler) e propagada via `context`. Vincula de forma imutável Responses, LLM Spans, Audit Events e Errors.
- **GovernedClient**: Wrapper para chamadas LLM que garante conformidade com quotas, fallbacks controlados e a política de **Privacy-First** (apenas hashes SHA-256 de prompts/responses são persistidos).
- **Imutabilidade**: Contextos de execução (`MCPContext`) são imutáveis após a criação.

### 3. Policy Engine

**Localização:** `internal/policy/`  
**Responsabilidade:** Avaliar autorização baseada em regras namespace-based

**Sub-componentes:**

- `engine.go` - Motor de avaliação
- `policies/` - Implementações de regras por namespace

### 4. Application Layer

**Localização:** `internal/application/`  
**Responsabilidade:** Casos de uso orquestrando domain + storage

**Serviços:**

- `agentgateway/` - Orquestração de propose/execute
- `portfolio/` - Gestão de itens de portfolio

### 5. Domain Layer

**Localização:** `internal/domain/`  
**Responsabilidade:** Entidades de negócio e regras constitucionais

### 6. HTTP Layer

**Localização:** `internal/http/`  
**Responsabilidade:** Transporte HTTP (handlers, routes, middlewares)

### 7. Storage Layer

**Localização:** `internal/storage/postgres/`  
**Responsabilidade:** Persistência com isolamento de tenant garantido pelo motor de banco de dados.

**Isolamento Multitenant:**

- **RLS Fail-Closed**: O isolamento é forçado via PostgreSQL RLS (`FORCE ROW LEVEL SECURITY`).
- **Padrão BeginTenant**: Toda operação deve utilizar o padrão `BeginTenant` -> `SET LOCAL app.current_workspace_id`, ativando as políticas de segurança na transação.
- **Seguridade**: A ausência de um contexto de workspace válido na transação resulta em visibilidade zero de dados (0 rows).

## Superfícies de API (Admin vs Client)

O MCP-Go separa estritamente as superfícies de operação para evitar escalada de privilégios:

- **MCP Client API (/v1)**: Destinada ao consumo agentic e integrações padrão. Exige audiência `mcp-client`.
- **MCP Admin API (/v1/admin)**: Superfície de gestão (Settings, Configs, Audit). Exige obrigatoriamente audiência `mcp-admin` e validação extra de `type=admin` nas claims.
- **Consistência de Isolamento**: Ambas as superfícies herdam o mesmo rigor de isolamento via RLS e validação de ownership de workspace.

## Fluxos Principais

### Fluxo 1: Propose (Interpretação)

```
Client → HTTP Handler → AgentGateway.Propose → Agent.Interpret
  → IntentParser → EntityExtractor → CommandBuilder
  → AgentProposal + Hash → Response
```

### Fluxo 2: Execute (Execução)

```
Client → POST /v1/command/execute
  → S2S HMAC (X-Cartaopro-*) → JWT Auth (RS256/JWKS) → Workspace Ownership
  → json.Decode(req) → Executor.Execute
  → Policy.Evaluate → ToolRegistry.Resolve → Tool.Execute
  → Storage/RLS (if needed) → persistExecution (AuditEvent + Span)
  → MCPResult{ Data, Metadata{ schema_version:"1.0", request_id, execution_id } }
```

> **Rota legada:** `POST /execute` mantida como alias deprecated durante transição. Emite `WARN` log em cada chamada.

### Fluxo 3: Direct API (Portfolio)

```
Client → HTTP Handler → Portfolio.Service
  → Domain Logic → Storage → Response
```

## Decisões Arquiteturais

### 1. Separação Agent vs Runtime

**Decisão:** Agent gera propostas, Runtime executa  
**Razão:** Human-in-the-loop, auditabilidade, segurança

### 2. Policy Engine Namespace-Based

**Decisão:** Regras organizadas por namespace (portfolio._, mcp._)  
**Razão:** Extensibilidade, separação de concerns

### 3. Workspace Scoping Obrigatório

**Decisão:** Todos os comandos/queries incluem workspace_id  
**Razão:** Multi-tenancy, isolamento de dados

## Referências no Código

- Bootstrap: `cmd/mcp-server/main.go`
- Agent: `internal/agents/agent.go`
- Executor: `internal/mcp/runtime/executor.go`
- Policy Engine: `internal/policy/engine.go`
- S2S HMAC Middleware: `internal/observability/httpmw/s2s_hmac.go`
- JWT Auth Middleware: `internal/observability/httpmw/auth.go`

## Checklist de Atualização

Este documento deve ser atualizado quando:

- [ ] Novo componente principal é adicionado
- [ ] Fluxo de execução é modificado
- [ ] Nova camada arquitetural é introduzida
- [ ] Decisão arquitetural significativa é tomada
- [ ] Padrão de comunicação entre componentes muda
