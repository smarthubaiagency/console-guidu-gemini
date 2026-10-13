# Guardrails - MCP-Go

Este documento define regras obrigatórias para a evolução do repositório MCP-Go, visando proteger o core e manter a integridade do isolamento multitenant.

## Classificação de Diretórios

### 🔴 NO-TOUCH (Bloqueado)
Alterações nestas pastas exigem justificativa técnica profunda e revisão humana obrigatória.
- `internal/mcp/**` (Core runtime do MCP)
- `internal/policy/**` (Engine de políticas)
- `internal/agents/**` (Camada de agentes/execução)
- `internal/execution/**` (Primitiva de Execution ID / Rastreabilidade AAA)
- `internal/llm/runtime/**` (Governança e privacidade de LLM)
- `internal/mcp/context/**` (Imutabilidade do MCPContext)
- `internal/mcp/runtime/**` (Onde o policy check é mandatório)

### 🟡 EDIT-WITH-CARE (Cuidado)
Alterações permitidas, mas exigem checklist rigoroso e novos testes.
- `internal/storage/**` (Risco de quebra de isolamento)
- `internal/http/**` (Sanitização de erros e contratos)
- `cmd/**` (Ponto de entrada/configuração)
- `openapi/**` (Compatibilidade de contrato)

### 🟢 FREE (Livre)
- `docs/**`
- `deployments/**`
- `scripts/**`

---

## Invariantes de Segurança (NÃO PODE)
1. **Remover Policy Check**: Jamais ignorar a validação de política no executor de tools.
2. **Accesso sem Tenant Context**: Qualquer acesso a tabelas multi-tenant protegidas por RLS DEVE ocorrer dentro de `postgres.BeginTenant` (`SET LOCAL app.current_workspace_id`).
3. **I/O no Agente**: Agentes não devem fazer I/O direto (DB/HTTP). Devem usar ferramentas (Tools) mediadas pelo Core.
4. **Importação Circular/Layering**: Camadas de baixo nível (`internal/mcp`) NUNCA podem importar a camada de transporte (`internal/http`).
5. **Permissividade**: A política padrão (default policy) deve ser sempre **DENY**.
6. **Dívida Técnica**: O uso de `context.TODO()` é proibido em produção. Registre um ticket/comment se necessário.
7. **No Raw LLM Data**: É proibido persistir prompts/responses em texto claro em spans/auditoria; apenas hashes SHA-256.
8. **Role Bypass Protection**: É proibido usar role/usuário de banco no runtime com permissões que bypassam RLS (ex: `bypassrls` / `owner`).
9. **Audience Gating (Admin)**: Rotas `/v1/admin` exigem obrigatoriamente JWT com `aud=mcp-admin`.

## Requisitos de Implementação (DEVE)
1. **Novas Tools**: Toda tool nova exige um `policy namespace` e testes de permissão.
2. **Novas Políticas**: Toda mudança em política exige testes positivos (allow) e negativos (deny).
3. **Isolamento**: Mudanças em storage devem ser acompanhadas de testes que validem que os dados de um `workspace_id` não vazam para outro.
4. **Security Gate Obrigatório**: PRs em runtime/storage devem passar em `make security-check`.
5. **Health Integrity**: Manter `/health/live` (processo) separado de `/health/ready` (dependências/DB + drain).
6. **Error Sanitization**: Em produção, 5xx retornam "internal_error", diferenciados apenas por `error_id` e `execution_id`.
7. **API**: Manter compatibilidade do OpenAPI ou versionar se houver breaking change.

---

## Gates de CI & Evidências

| Controle | Prova / Evidência (Teste) | Objetivo / Risco Mitigado |
| :--- | :--- | :--- |
| **Anti-bypass Policy** | `executor_security_test.go` | Tools não executam se a Policy negar. |
| **Privacy breach** | `governed_security_test.go` | Spans gravam apenas hashes; erros são truncados. |
| **Identity leak** | Testes de Middleware (Auth/Admin) | Token `aud=mcp-client` não acessa `/v1/admin`. |
| **Connection safety** | `rls_test.go` | Falha no `SET LOCAL` = zero linhas retornadas. |

### Referências Técnicas
- [executor_security_test.go](file:///g:/github-crm-projects/mcp-go/internal/mcp/runtime/executor_security_test.go)
- [governed_security_test.go](file:///g:/github-crm-projects/mcp-go/internal/llm/runtime/governed_security_test.go)
- [tenantdb.go](file:///g:/github-crm-projects/mcp-go/internal/storage/postgres/tenantdb.go) (BeginTenant)
- [auth.go](file:///g:/github-crm-projects/mcp-go/internal/http/middleware/auth.go) (Audience validation)
