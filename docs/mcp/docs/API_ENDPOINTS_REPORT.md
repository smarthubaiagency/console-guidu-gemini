# API Endpoints Report - mcp-client-server

Este documento fornece uma descrição detalhada de todos os endpoints disponíveis na API do servidor MCP.

## Sumário

- [Padronização de Segurança](#padronização-de-segurança)
- [Grupo: Health & Status](#grupo-health--status)
- [Grupo: Portfolio (v1)](#grupo-portfolio-v1)
- [Grupo: Agent Gateway (v1)](#grupo-agent-gateway-v1)
- [Grupo: Admin & Governance (v1/admin)](#grupo-admin--governance-v1admin)

---

## Padronização de Segurança

A maioria dos endpoints requer dois mecanismos de autenticação:

1.  **JWT (JSON Web Token)**: Enviado no header `Authorization: Bearer <token>`.
    - **Client API**: Requer claims válidas de tenant/user.
    - **Admin API**: Requer claim de audiência `mcp-admin` e privilégios de `admin` ou `system`.
2.  **S2S HMAC**: Assinatura de requisição para integridade e anti-replay.
    - Header `X-Cartaopro-Timestamp`: ISO 8601 / RFC3339 timestamp.
    - Header `X-Cartaopro-Nonce`: Identificador único da requisição (UUID v4).
    - Header `X-Cartaopro-Body-SHA256`: Hash SHA256 do corpo da requisição.
    - Header `X-Cartaopro-Signature`: HMAC-SHA256(Secret, CanonicalString).

---

## Grupo: Health & Status

Endpoints públicos para monitoramento de saúde do serviço.

### Liveness Check

- **Método**: `GET`
- **Rota**: `/` ou `/health/live`
- **Descrição**: Verifica se o processo da aplicação está rodando.
- **Autenticação**: Nenhuma
- **Status Codes**:
  - `200 OK`: Serviço vivo.
- **Exemplo**:

```bash
curl http://localhost:3002/health/live
# Resposta: {"status":"ok","service":"mcp-client-server"}
```

### Readiness Check

- **Método**: `GET`
- **Rota**: `/health` ou `/health/ready`
- **Descrição**: Verifica se a aplicação está pronta para receber tráfego (DB e Redis conectados).
- **Autenticação**: Nenhuma
- **Status Codes**:
  - `200 OK`: Tudo pronto.
  - `503 Service Unavailable`: Dependência fora do ar ou em processo de shutdown.
- **Exemplo**:

```bash
curl http://localhost:3002/health/ready
# Resposta: {"status":"ok","database":"ok","redis":"ok","service":"mcp-client-server"}
```

---

## Grupo: Portfolio (v1)

Gerenciamento de itens do portfólio dentro de um workspace.

### Listar Itens

- **Método**: `GET`
- **Rota**: `/v1/workspaces/{workspaceId}/portfolio/items`
- **Descrição**: Lista todos os itens de portfólio de um workspace específico.
- **Auth**: JWT + HMAC
- **Response**:

```json
{
  "items": [ { "id": "...", "name": "Item 1", ... } ],
  "page_info": { "total": 10, "page": 1, "per_page": 20 }
}
```

### Criar Item

- **Método**: `POST`
- **Rota**: `/v1/workspaces/{workspaceId}/portfolio/items`
- **Body**:

```json
{
  "name": "string (required)",
  "slug": "string (required)",
  "description": "string",
  "category": "string (required)",
  "vertical": "string (required)",
  "price": "string (required)",
  "featured": "bool"
}
```

- **Status Codes**: `201 Created`, `400 Bad Request`, `409 Conflict (slug)`.

### Obter Item Detalhado

- **Método**: `GET`
- **Rota**: `/v1/workspaces/{workspaceId}/portfolio/items/{itemId}`
- **Auth**: JWT + HMAC
- **Status Codes**: `200 OK`, `404 Not Found`.

---

## Grupo: Agent Gateway (v1)

Interação com agentes de IA e execução de planos.

### Propor Ação (Propose)

- **Método**: `POST`
- **Rota**: `/v1/workspaces/{workspaceId}/agent/propose`
- **Descrição**: Envia uma mensagem em linguagem natural para que o agente gere um plano de ação.
- **Body**:

```json
{
  "message": "Crie um novo item no portfólio chamado X",
  "context": { "key": "value" }
}
```

- **Response**: Retorna o plano sugerido e um `proposal_hash`.

### Executar Plano (Execute)

- **Método**: `POST`
- **Rota**: `/v1/workspaces/{workspaceId}/agent/execute`
- **Descrição**: Confirma e executa uma proposta de agente previamente gerada.
- **Body**:

```json
{
  "proposal_hash": "string (required)",
  "intent": "string",
  "commands": [],
  "approved_by_human": true
}
```

- **Status Codes**: `200 OK`, `202 Accepted (Already Running)`, `409 Conflict (Tamper Detected)`.

---

## Grupo: Admin & Governance (v1/admin)

Endpoints exclusivos para administradores para gestão de modelos de IA e auditoria.

### Configurações de LLM (Settings)

- **GET** `/v1/admin/workspaces/{workspaceId}/llm/settings`: Obtém configurações ativas do workspace.
- **PUT** `/v1/admin/workspaces/{workspaceId}/llm/settings`: Atualiza estratégia de fallback e config ativa.

### Gestão de Configurações (Configs)

- **GET** `/v1/admin/workspaces/{workspaceId}/llm/configs`: Lista versões de configurações de LLM.
- **POST** `/v1/admin/workspaces/{workspaceId}/llm/configs`: Cria uma nova configuração de provedor/modelo.
- **PUT** `/v1/admin/workspaces/{workspaceId}/llm/configs/{configId}/deprecate`: Desativa uma configuração.

### Rastreamento de Execução (Executions)

- **GET** `/v1/admin/workspaces/{workspaceId}/executions/{executionId}`: Trace principal.
- **GET** `/v1/admin/workspaces/{workspaceId}/executions/{executionId}/spans`: Detalhes de chamadas LLM e latência.
- **GET** `/v1/admin/workspaces/{workspaceId}/executions/{executionId}/audit`: Log de auditoria e eventos de segurança.
  - **Query Params**: `limit`, `offset`, `severity`, `event_type`.
