# API Reference

## Objetivo

Documentar todos os endpoints HTTP do MCP-Go, incluindo request/response schemas, códigos de status, e exemplos de uso.

## Escopo

**Inclui:**

- Endpoints HTTP e métodos
- Request/Response schemas
- Códigos de status e erros
- Exemplos de payloads
- Rate limits (quando implementado)

**Não Inclui:**

- Detalhes de autenticação (ver [SECURITY.md](./SECURITY.md))
- Regras de políticas (ver [POLICY_RULES.md](./POLICY_RULES.md))

## Base URL

**Development:** `http://localhost:3002`  
**Production:** `https://<your-domain>`

**API Version:** `/v1`

## Autenticação

A API utiliza **JWT (JSON Web Tokens)** para autenticação e autorização S2S (Service-to-Service).

**Header:**

```
Authorization: Bearer <jwt_token>
```

**Requisitos do Token:**

- **iss (Issuer):** Deve corresponder ao valor em `SUPABASE_JWT_ISSUER` (URL do projeto Supabase).
- **aud (Audience):**
  - Endpoint S2S (`/v1/command/execute`): Qualquer audiência válida do Supabase (default: `authenticated`).
  - Admin API (futura `/v1/admin/*`): Requer `mcp-admin`.
- **exp (Expiration):** Tokens devem ser de curta duração (expiração recomendada: 5-15 min).
- **Sub:** `sub` claim com o user ID é obrigatório.
- **Workspace Ownership:** O header `X-Cartaopro-Workspace-Id` é validado pelo middleware de ownership. Divergências resultam em `403 Forbidden`.

## Headers Padrão

Em todas as requisições (exceto health checks), os seguintes headers são suportados/retornados:

| Header                  | Tipo             | Descrição                                        |
| :---------------------- | :--------------- | :----------------------------------------------- |
| `X-Request-ID`          | Request/Response | UUID único para rastreabilidade em logs.         |
| `X-RateLimit-Limit`     | Response         | Limite total de requisições no período.          |
| `X-RateLimit-Remaining` | Response         | Requisições restantes na janela atual.           |
| `X-RateLimit-Reset`     | Response         | Timestamp Unix de quando o limite será resetado. |

> [!NOTE]
> As rotas `/v1` (Client) e `/v1/admin` (Admin) compartilham a mesma quota de Rate Limit por tenant.

## S2S Anti-Replay (HMAC)

Para chamadas S2S (obrigatório em todas as rotas protegidas), os seguintes headers devem ser enviados em adição ao Authorization:

| Header                    | Valor                                           | Obrigatório |
| :------------------------ | :---------------------------------------------- | :---------- |
| `X-Cartaopro-Timestamp`   | ISO 8601 / RFC3339 (ex: `2026-03-07T12:34:56Z`) | Sim         |
| `X-Cartaopro-Nonce`       | UUID v4 único por request                       | Sim         |
| `X-Cartaopro-Body-SHA256` | Hex SHA-256 do corpo bruto                      | Sim         |
| `X-Cartaopro-Signature`   | Hex HMAC-SHA256                                 | Sim         |

**Cálculo da Assinatura:**

1. Gerar hash SHA-256 do body: `BODY_SHA256 = hex(sha256(request_body))` (GET sem body usar string vazia).
2. Construir string canônica: `METHOD + "\n" + PATH_WITH_QUERY + "\n" + TIMESTAMP + "\n" + NONCE + "\n" + BODY_SHA256`.
3. Assinar com a chave secreta: `SIGNATURE = hex(hmac_sha256(secret, canonical_string))`.

> [!TIP]
> O `PATH_WITH_QUERY` deve incluir o path escapado e a query string bruta (ex: `/v1/command/execute`).
> O `X-Cartaopro-Timestamp` usa formato ISO 8601. A janela de tolerância máxima é **5 minutos**.

---

## Endpoints

### Health Check

#### `GET /health/live`

**Descrição:** Liveness check simples (apenas confirma que o processo está rodando).
**Response:** `{"status":"ok","service":"mcp-client-server"}`

#### `GET /health/ready` (ou `/health`)

**Descrição:** Readiness check profundo (valida conectividade com DB e estado de shutdown).
**Response:**

```json
{
  "status": "ok",
  "database": "ok",
  "service": "mcp-client-server"
}
```

**Status Codes:**

- `200 OK` - Serviço está rodando

---

### Tool Discovery

#### `GET /v1/tools`

**Descrição:** Lista todas as ferramentas registradas no servidor MCP, com metadados de esquema. Suporta filtragem por fonte.

**Auth:** S2S HMAC + JWT (`Authorization: Bearer <token>`) — `workspaceOwnership` **não** é exigido.

**Query Parameters:**

| Parâmetro | Tipo   | Obrigatório | Descrição                                                                  |
| :-------- | :----- | :---------- | :------------------------------------------------------------------------- |
| `source`  | string | Não         | Filtrar ferramentas pelo campo `allowedSources` (ex: `automation`, `api`). |

**Response 200:**

```json
{
  "tools": [
    {
      "name": "contact.create",
      "label": "Create Contact",
      "description": "Creates a new contact in the workspace.",
      "category": "crm",
      "allowedSources": ["automation", "api"],
      "inputSchema": {
        "fullName": "string (required)",
        "email": "string (optional)",
        "phone": "string (optional)"
      },
      "outputSchema": {}
    }
  ],
  "count": 1
}
```

**Status Codes:**

- `200 OK` — Lista retornada (mesmo que vazia)
- `401 Unauthorized` — Token ausente ou inválido

> [!NOTE]
> Ferramentas que implementam apenas `MCPTool` (sem `DiscoverableTool`) são retornadas com campos de metadados vazios. Para enriquecer o output, implemente a interface `DiscoverableTool` na ferramenta.

---

### Direct Execution

#### `POST /v1/command/execute/direct`

**Descrição:** Executa uma ferramenta MCP de forma determinística, **sem** passar pelo Agent Layer (sem geração de proposta, sem aprovação humana). Indicado para automações e integrações S2S onde o comando é conhecido antecipadamente.

**Auth:** S2S HMAC + JWT + `X-Cartaopro-Workspace-Id` (workspace ownership validado pelo middleware).

**Request Body:**

```json
{
  "tool": "contact.create",
  "input": {
    "fullName": "Ada Lovelace",
    "email": "ada@example.com"
  },
  "source": "automation",
  "sourceId": "550e8400-e29b-41d4-a716-446655440000"
}
```

| Campo      | Tipo   | Obrigatório | Descrição                                           |
| :--------- | :----- | :---------- | :-------------------------------------------------- |
| `tool`     | string | Sim         | Nome exato da ferramenta registrada.                |
| `input`    | object | Não         | Parâmetros de entrada da ferramenta.                |
| `source`   | string | Não         | Identificador da origem da chamada (informacional). |
| `sourceId` | string | Não         | ID de rastreabilidade/idempotência na origem.       |

**Response 200:**

```json
{
  "success": true,
  "executionId": "",
  "tool": "contact.create",
  "status": "completed",
  "data": {
    "id": "uuid",
    "fullName": "Ada Lovelace",
    "email": "ada@example.com"
  },
  "durationMs": 42
}
```

**Status Codes:**

| Código | Descrição                                      |
| :----- | :--------------------------------------------- |
| `200`  | Execução concluída com sucesso.                |
| `400`  | Body inválido ou campo `tool` ausente.         |
| `401`  | Token ausente ou inválido.                     |
| `403`  | Policy engine negou a execução.                |
| `404`  | Ferramenta não registrada.                     |
| `409`  | Tamper ou replay detectado.                    |
| `422`  | Ferramenta retornou erro de lógica de negócio. |

> [!WARNING]
> Este endpoint **não** aceita `AgentProposal` e **não** valida `proposal_hash`. É a via de execução direta, sem a camada de agente.

---

### Agent Gateway

#### `POST /v1/workspaces/{workspaceId}/agent/propose`

**Descrição:** Interpreta mensagem em linguagem natural e gera proposta de ação.

**Path Parameters:**

- `workspaceId` (uuid, required) - ID do workspace

**Request Body:**

```json
{
  "message": "Liste todos os itens do portfólio",
  "context": {}
}
```

**Response:**

```json
{
  "schema_version": "1.0",
  "message": "I've interpreted your request.",
  "confidence": 0.9,
  "proposal": {
    "intent": "list portfolio items",
    "explanation": "User wants to see all portfolio items",
    "requires_human_approval": false,
    "commands": [
      {
        "name": "portfolio",
        "input": {
          "action": "list"
        }
      }
    ]
  },
  "proposal_hash": "a1b2c3d4...",
  "warnings": []
}
```

**Status Codes:**

- `200 OK` - Proposta gerada
- `400 Bad Request` - Payload inválido
- `500 Internal Server Error` - Erro interno

---

#### `POST /v1/workspaces/{workspaceId}/agent/execute`

**Descrição:** Executa proposta de ação com validação de hash (anti-tamper).

**Path Parameters:**

- `workspaceId` (uuid, required) - ID do workspace

**Request Body:**

```json
{
  "proposal_hash": "a1b2c3d4...",
  "intent": "list portfolio items",
  "approved_by_human": false,
  "commands": [
    {
      "name": "portfolio",
      "input": {
        "action": "list"
      }
    }
  ]
}
```

**Response:**

```json
{
  "execution_id": "req-uuid-123",
  "status": "success",
  "request_id": "req-uuid-123",
  "results": [
    {
      "command_name": "portfolio",
      "status": "success",
      "message": "",
      "data": {
        "items": [...],
        "page_info": {...}
      }
    }
  ],
  "warnings": []
}
```

**Status Codes:**

- `200 OK` - Execução concluída (ou retornando resultado de execução prévia via idempotência)
- `202 Accepted` - Execução em andamento (chamada duplicada enquanto a primeira ainda processa)
- `400 Bad Request` - Payload inválido
- `403 Forbidden` - Policy denied
- `409 Conflict` - Hash mismatch (tampering detected)
- `422 Unprocessable Entity` - Requires human approval
- `500 Internal Server Error` - Erro interno

> [!TIP]
> **Idempotência:** Forneça um `execution_id` estável no request body para garantir que a ação não seja executada mais de uma vez. Se o processo ainda estiver rodando, você receberá `202 Accepted`. Se já tiver finalizado, receberá `200 OK` com os resultados persistidos.

---

### Portfolio

#### `GET /v1/workspaces/{workspaceId}/portfolio/items`

**Descrição:** Lista itens do portfolio.

**Path Parameters:**

- `workspaceId` (uuid, required) - ID do workspace

**Query Parameters:**

- `page` (int, optional) - Número da página (default: 1)
- `per_page` (int, optional) - Itens por página (default: 20)

**Response:**

```json
{
  "items": [
    {
      "id": "uuid",
      "workspace_id": "uuid",
      "name": "Product Name",
      "slug": "product-name",
      "description": "Description",
      "category": "category",
      "vertical": "vertical",
      "priority": "high",
      "price": "100.00",
      "base_price": "120.00",
      "promo_price": "95.00",
      "featured": true,
      "rank": 1,
      "created_at": "2026-01-26T15:00:00Z"
    }
  ],
  "page_info": {
    "total": 100,
    "page": 1,
    "per_page": 20
  }
}
```

**Status Codes:**

- `200 OK` - Lista retornada
- `500 Internal Server Error` - Erro interno

---

#### `POST /v1/workspaces/{workspaceId}/portfolio/items`

**Descrição:** Cria novo item no portfolio.

**Path Parameters:**

- `workspaceId` (uuid, required) - ID do workspace

**Request Body:**

```json
{
  "name": "Product Name",
  "slug": "product-name",
  "category": "category",
  "vertical": "vertical",
  "price": "100.00",
  "description": "Description",
  "base_price": "120.00",
  "promo_price": "90.00",
  "featured": true,
  "rank": 1,
  "priority": "high"
}
```

**Response:**

```json
{
  "id": "uuid",
  "workspace_id": "uuid",
  "name": "Product Name",
  ...
}
```

**Status Codes:**

- `201 Created` - Item criado
- `400 Bad Request` - Validação falhou
- `409 Conflict` - Slug duplicado
- `500 Internal Server Error` - Erro interno

---

#### `GET /v1/workspaces/{workspaceId}/portfolio/items/{itemId}`

**Descrição:** Busca item por ID.

**Path Parameters:**

- `workspaceId` (uuid, required) - ID do workspace
- `itemId` (uuid, required) - ID do item

**Response:**

```json
{
  "id": "uuid",
  "workspace_id": "uuid",
  "name": "Product Name",
  "price": "100.00"
}
```

---

### Admin API (`aud: mcp-admin`)

API restrita para operações de governança, configuração de LLM e auditoria.

#### `GET /v1/admin/workspaces/{workspaceId}/llm/settings`

**Descrição:** Retorna configurações de LLM do workspace (Active Config, Fallback).

#### `PUT /v1/admin/workspaces/{workspaceId}/llm/settings`

**Descrição:** Atualiza estratégia de fallback e configuração ativa.

#### `GET /v1/admin/workspaces/{workspaceId}/llm/configs`

**Descrição:** Lista histórico de configurações de LLM (versionadas).

#### `POST /v1/admin/workspaces/{workspaceId}/llm/configs`

**Descrição:** Registra novo modelo/provedor de LLM para o workspace.

#### `GET /v1/admin/workspaces/{workspaceId}/executions/{executionId}`

**Descrição:** Retorna o status mestre e metadados de uma execução.

#### `GET /v1/admin/workspaces/{workspaceId}/executions/{executionId}/spans`

**Descrição:** Lista telemetria de chamadas LLM (`llm_spans`).
**Privacidade:** Conteúdo bruto de prompts/responses não é retornado; apenas hashes SHA-256.

#### `GET /v1/admin/workspaces/{workspaceId}/executions/{executionId}/audit`

**Descrição:** Lista eventos de auditoria vinculados à execução.
**Privacidade:** Dados sensíveis são persistidos de forma redigida.

**Status Codes:**

- `200 OK` - Item encontrado
- `404 Not Found` - Item não encontrado
- `500 Internal Server Error` - Erro interno

---

## Error Response Format

```json
{
  "error_id": "uuid-v4",
  "execution_id": "exec-uuid-v4",
  "code": "error_code",
  "message": "Human-readable error message",
  "details": "Raw error message (only in development)"
}
```

> [!NOTE]
> O `execution_id` é retornado apenas em erros ocorridos durante o fluxo de execução do MCP (Agent Gateway).

## OpenAPI Specification

**Localização:** `openapi/openapi.yaml`

**Versão:** OpenAPI 3.0.3

## Referências no Código

- Routes: `internal/http/routes.go`
- Agent Gateway Handler: `internal/http/handlers/agent_gateway.go`
- Portfolio Handler: `internal/http/handlers/portfolio.go`
- OpenAPI Spec: `openapi/openapi.yaml`

## Checklist de Atualização

Este documento deve ser atualizado quando:

- [ ] Novo endpoint é adicionado
- [ ] Schema de request/response muda
- [ ] Novo código de status é retornado
- [ ] Rate limits são implementados
- [ ] Autenticação é adicionada
- [ ] OpenAPI spec é atualizado
