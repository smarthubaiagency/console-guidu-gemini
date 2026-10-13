# Runbook

## Objetivo

Documentar procedimentos operacionais e troubleshooting para o MCP-Go em produção.

## Escopo

**Inclui:**

- Troubleshooting comum
- Procedimentos de emergência
- Como investigar erros
- Comandos úteis

**Não Inclui:**

- Deployment inicial (ver [DEPLOYMENT.md](./DEPLOYMENT.md))
- Desenvolvimento (ver [DEVELOPMENT.md](./DEVELOPMENT.md))

## Health Checks Operacionais

O sistema utiliza verificação de saúde com semânticas distintas para orquestradores (K8s/Easypanel).

### Liveness (`/health/live`)

- **Objetivo:** Informar se o processo Go está ativo.
- **Ação em Falha:** O orquestrador reinicia o container.
- **Comando:** `curl -f http://localhost:3002/health/live`

### Readiness (`/health/ready`)

- **Objetivo:** Informar se o serviço pode receber tráfego.
- **Causas de Falha (503 Service Unavailable):**
  - Conexão com o banco de dados falhou.
  - Conexão com **Redis** falhou (apenas se `S2S_HMAC_REQUIRED=true`).
  - O serviço está em **Graceful Shutdown** (Drain Mode ativo).
- **Ação em Falha:** O orquestrador remove o container do Load Balancer.
- **Comando:** `curl -f http://localhost:3002/health/ready`

## Troubleshooting Comum

### 1. Serviço Não Inicia

**Sintoma:** Container/processo morre imediatamente

**Investigação:**

```bash
# Ver logs
docker logs mcp-server

# Verificar variáveis de ambiente
docker exec mcp-server env | grep DATABASE_URL
```

**Causas Comuns:**

- `DATABASE_URL` não configurado
- Database inacessível
- Porta já em uso

**Solução:**

1. Verificar `.env` ou variáveis de ambiente
2. Testar conexão com database:
   ```bash
   psql $DATABASE_URL -c "SELECT 1"
   ```
3. Verificar porta disponível:
   ```bash
   lsof -i :3002
   ```

---

## Investigação e Correlação (AAA)

Para troubleshooting eficiente em nível corporativo, siga a cadeia de correlação:

### 1. Correlacionar Erro do Cliente (`error_id`)

Se um cliente reportar um erro, ele fornecerá um `error_id`.
**Procedimento:** Pesquise nos logs estruturados pelo campo `error_id` para encontrar a causa raiz (stack trace completo).

```bash
grep "error_id\":\"<UUID>" logs.json | jq .
```

### 2. Rastrear Fluxo do Agente (`execution_id`)

Use o `execution_id` para correlacionar logs de diferentes módulos (Policy, MCP Runtime, Governed Client).

```bash
grep "execution_id\":\"<UUID>" logs.json | jq -c '.msg, .module, .action'
```

---

## Troubleshooting de Segurança e Tráfego

### 1. Rate Limiting (429 Too Many Requests)

**Sintoma:** Cliente recebe 429.
**Investigação:** Verifique os headers da resposta:

- `X-RateLimit-Limit`: Limite configurado.
- `X-RateLimit-Remaining`: Zero se atingido.
- `X-RateLimit-Reset`: Tempo para nova quota.
  **Ação:** Verificar histórico em logs. NUNCA altere quotas manualmente em produção sem aprovação via Admin API.

### 2. Autenticação Falha (401 Unauthorized)

**Sintoma:** Token rejeitado.
**Causas:**

- **Expirado:** JWT dura 5-15 min.
- **Audiência Errada:** Request para `/v1` com `aud: mcp-admin` ou vice-versa.
- **Assinatura:** Chave de assinatura mismatch.

### 3. Ownership Mismatch (403 Forbidden)

**Sintoma:** Ocorre em rotas com `{workspaceId}`.
**Causa:** O `workspace_id` no path da URL não coincide com a claim `workspace_id` do JWT.
**Garantia:** Isso é enforçado pelo middleware `WorkspaceOwnership`.

### 5. Replay Attack / Nonce Reused (409 Conflict)

**Sintoma:** Cliente recebe 409.
**Causa:** O mesmo `X-Cartaopro-Nonce` foi enviado mais de uma vez dentro da janela de TTL.
**Investigação:**

```bash
grep "replay detected" logs.json
```

**Ação:** Verificar se o cliente está reutilizando nonces ou se houve um ataque de replay real.

### 6. Security Service Unavailable (503 Service Unavailable)

**Sintoma:** Cliente recebe 503 com mensagem "Security service unavailable".
**Causa:** O serviço de Anti-Replay (Redis) está fora do ar e a autenticação S2S é obrigatória.
**Investigação:** Verifique o status do `/health/ready`.
**Ação:** Restaurar conectividade com o Redis.

---

### 7. Database Connection Failed

**Sintoma:** Logs mostram "database connection failed, using mock/no-op repo"

**Investigação:**

```bash
# Testar conexão
psql $DATABASE_URL -c "SELECT 1"

# Ver logs de database
grep "database" logs.json
```

**Solução:**

1. Verificar `DATABASE_URL` está correto
2. Verificar database está rodando
3. Verificar firewall/network
4. Verificar credenciais

---

### 5. Cross-Tenant Data Leakage (CRÍTICO)

**Sintoma:** Usuário vê dados de outro workspace

**Investigação:**

```bash
# Ver logs de queries
grep "workspace_id" logs.json

# Verificar queries SQL (se logging habilitado)
grep "SELECT.*FROM.*portfolio_items" logs.json
```

**Ação Imediata:**

1. **PARAR O SERVIÇO** imediatamente
2. Investigar query que causou o leak
3. Verificar se `WHERE workspace_id = $X` está presente
4. Reportar como incidente de segurança

---

## Comandos Operacionais

### 1. Testar Assinatura S2S HMAC (curl)

Para testar chamadas protegidas manualmente, você precisará gerar os headers `X-Cartaopro-*`.

**Exemplo de script para gerar Bash Curl:**

```bash
# Variables
SECRET="your-s2s-secret"
METHOD="POST"
ENDPOINT="/v1/command/execute"
TIMESTAMP=$(date -u +"%Y-%m-%dT%H:%M:%SZ")  # ISO 8601 / RFC3339
NONCE=$(uuidgen)
BODY='{"name":"echo","input":{"message":"hello"}}'
BODY_HASH=$(echo -n "$BODY" | openssl dgst -sha256 | awk '{print $NF}')

# Canonical String
CANONICAL="${METHOD}\n${ENDPOINT}\n${TIMESTAMP}\n${NONCE}\n${BODY_HASH}"

# Signature
SIGNATURE=$(echo -ne "$CANONICAL" | openssl dgst -sha256 -hmac "$SECRET" | awk '{print $NF}')

# Execute
curl -v -H "X-Cartaopro-Timestamp: $TIMESTAMP" \
        -H "X-Cartaopro-Nonce: $NONCE" \
        -H "X-Cartaopro-Body-SHA256: $BODY_HASH" \
        -H "X-Cartaopro-Signature: $SIGNATURE" \
        -H "Authorization: Bearer $JWT_TOKEN" \
        -H "X-Cartaopro-Workspace-Id: $WORKSPACE_ID" \
        -H "Content-Type: application/json" \
        -d "$BODY" \
        "http://localhost:8080$ENDPOINT"
```

## Auditoria e Contestação (Privacy-First)

Procedimentos para responder a auditorias sem comprometer dados sensíveis.

### 1. Validar Integridade de Proposta

Use o `audit_events` para provar que a proposta executada é a mesma que foi autorizada pela política.

```sql
SELECT payload_hash FROM audit_events WHERE execution_id = '<ID>';
```

### 2. Responder sobre Comportamento LLM

O `llm_spans` registra apenas metadados técnicos e o hash SHA-256 dos prompts.

- **Prova de Custo:** Use `total_tokens` no span.
- **Prova de Falha:** Use o campo `error` no span.
- **NUNCA** tente reconstruir o prompt; utilize o hash para validar com logs do provedor se necessário.

---

## Deploy e Graceful Shutdown

### Drain Mode (Obrigatório)

Ao iniciar o shutdown (SIGTERM), o serviço:

1. Altera `/health/ready` para erro imediatamente.
2. Aguarda 15 segundos (**Drain Period**) para que o Load Balancer redirecione o tráfego.
3. Processa requisições remanescentes antes de fechar o binário.

**Validação durante Deploy:**

```bash
# Acompanhe o readiness durante o rollout
watch kubectl get pods -l app=mcp-server
```

### Database Queries

```bash
# Ver itens de um workspace
psql $DATABASE_URL -c "SELECT id, name, workspace_id FROM portfolio_items WHERE workspace_id = 'uuid'"

# Contar itens por workspace
psql $DATABASE_URL -c "SELECT workspace_id, COUNT(*) FROM portfolio_items GROUP BY workspace_id"
```

## Procedimentos de Emergência

### Rollback de Deploy

```bash
# Docker
docker stop mcp-server
docker run -d --name mcp-server <previous-image>

# Kubernetes
kubectl rollout undo deployment/mcp-server
```

### Restart do Serviço

```bash
# Docker
docker restart mcp-server

# Kubernetes
kubectl rollout restart deployment/mcp-server
```

### Escalar Replicas (Kubernetes)

```bash
kubectl scale deployment/mcp-server --replicas=5
```

## Referências no Código

- Health check: `internal/http/routes.go:22-33`
- Logging: `internal/observability/log/log.go`
- Policy engine: `internal/policy/engine.go`

## Checklist de Atualização

Este documento deve ser atualizado quando:

- [ ] Novo problema comum é identificado
- [ ] Novo procedimento de emergência é criado
- [ ] Comandos úteis são adicionados
- [ ] Métricas são implementadas
