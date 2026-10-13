# Gap Analysis — MCP Server As-Built vs. Especificação de Arquitetura

> **Data de Geração:** 2025 (Sprint `mcp-docs-rebranding-and-reality-sync`)  
> **Baseline:** Sprint F `ca28163` (Foundry 3.1 Hardening Cycle completo)

Este documento cataloga as divergências entre o que está _documentado_ e o que está _efetivamente implementado_ no servidor MCP Go (`github.com/cartaopro/mcp`).

---

## 1. Camada Cognitiva (Agente)

### 1.1 IntentParser

| Atributo                | Documentado                    | Real (As-Built)                                   |
| ----------------------- | ------------------------------ | ------------------------------------------------- |
| **Localização**         | `internal/agents/interpreter/` | `internal/agents/interpreter/intent_parser.go` ✅ |
| **Implementação**       | NLP / ML inference             | Keyword-based (`strings.Contains`) — **MVP**      |
| **Domínios detectados** | Múltiplos com confiança        | `contact`, `workspace`, `unknown`                 |
| **Ações detectadas**    | NLU estruturado                | `create`, `update`, `get`, `delete`, `unknown`    |
| **Confidence Scoring**  | Previsto                       | **Não implementado**                              |
| **Multilingual NLP**    | Previsto                       | **Não implementado**                              |

**Gap:** A detecção de intenção é baseada em correspondência de palavras-chave simples. Não há modelo NLP, não há desambiguação de entidades a nível de parsing, e não há pontuação de confiança. Adequado para MVP; requer roadmap de ML para GA.

---

### 1.2 EntityExtractor

| Atributo                | Documentado                        | Real (As-Built)                                      |
| ----------------------- | ---------------------------------- | ---------------------------------------------------- |
| **Localização**         | `internal/agents/interpreter/`     | `internal/agents/interpreter/entity_extractor.go` ✅ |
| **Implementação**       | NER (Named Entity Recognition)     | Regex-based (UUID v4 + email regex) — **MVP**        |
| **Entidades extraídas** | Nomes, datas, endereços, telefones | UUIDs (IDs), e-mails, slugs, campos                  |
| **NLP/ML**              | Previsto                           | **Não implementado**                                 |

**Gap:** A extração de entidades é inteiramente baseada em expressões regulares. Não há reconhecimento de entidades nomeadas (NER), não há extração de datas/telefones/endereços a partir de linguagem natural.

---

## 2. TODOs e FIXMEs no Código Go

**Resultado do audit (grep recursivo em `apps/mcp/internal/`):**

```
Zero ocorrências de // TODO ou // FIXME encontradas.
```

✅ O codebase Go está limpo — nenhum débito técnico marcado com anotações de código.

---

## 3. Funcionalidades Documentadas mas Não Implementadas

### 3.1 Rate Limiting

- **Referência na doc:** `SECURITY.md §4`, `OBSERVABILITY.md` (Rate Limit Monitoring headers)
- **Status:** ❌ **Não implementado**
- **Detalhe:** Headers `X-RateLimit-*` documentados não são emitidos por nenhum middleware atual. Nenhum rate limiter foi encontrado em `internal/observability/httpmw/`.

### 3.2 Admin API (`/v1/admin`)

- **Referência na doc:** `ARCHITECTURE.md`, `API.md`
- **Status:** ❌ **Não implementado**
- **Detalhe:** Nenhuma rota `/v1/admin` está registrada em `cmd/mcp-server/main.go`.

### 3.3 Portfolio Domain (`MCP_ENABLE_PORTFOLIO`)

- **Referência na doc:** `PORTFOLIO_DECOUPLING.md`
- **Status:** ❌ **Não implementado**
- **Detalhe:** A variável de ambiente `MCP_ENABLE_PORTFOLIO` não está presente na config atual. Nenhuma tool de portfólio está registrada no `tool_registry`.

### 3.4 Testes de Integração / E2E

- **Referência na doc:** `TESTING.md`, `DEVELOPMENT.md`
- **Status:** ⚠️ **Parcialmente implementado**
- **Detalhe:** Sprint F implementou testes de hardening unitários (`anti_tamper_test.go`, `engine_test.go`, `auth_test.go`, `rls_test.go`). Uma suite completa de integração/E2E ainda não existe.

---

## 4. Implementado mas Não Documentado (Agora Corrigido)

As seguintes divergências foram encontradas e **corrigidas neste sprint**:

| Item                    | Doc Anterior                        | As-Built                                                            | Arquivo Corrigido                                                |
| ----------------------- | ----------------------------------- | ------------------------------------------------------------------- | ---------------------------------------------------------------- |
| Graceful Shutdown       | "TODO / Não implementado"           | Implementado: 30s drain, `SetShuttingDown()`, `Redis.Close()`       | `DEPLOYMENT.md`                                                  |
| JWT Algorithm           | HS256                               | RS256 via Supabase JWKS (`MicahParks/keyfunc/v2`)                   | `SECURITY.md`, `API.md`                                          |
| JWT env vars            | `JWT_ISSUER`, `JWT_AUDIENCE`        | `SUPABASE_JWT_ISSUER`, `SUPABASE_JWT_AUDIENCE`, `SUPABASE_JWKS_URL` | `SECURITY.md`, `DEPLOYMENT.md`                                   |
| S2S Headers             | `X-Linkko-*` (18 ocorrências)       | `X-Cartaopro-*`                                                     | `SECURITY.md`, `API.md`, `API_ENDPOINTS_REPORT.md`, `RUNBOOK.md` |
| Timestamp S2S           | Unix epoch seconds                  | ISO 8601 / RFC3339                                                  | `SECURITY.md`, `API.md`, `API_ENDPOINTS_REPORT.md`               |
| Endpoint canônico       | `/v1/workspaces/{id}/agent/execute` | `POST /v1/command/execute`                                          | `ARCHITECTURE.md`, `DEPLOYMENT.md`, `RUNBOOK.md`                 |
| Bootstrap entrypoint    | `cmd/mcp-client-server/main.go`     | `cmd/mcp-server/main.go`                                            | `ARCHITECTURE.md`, `DEPLOYMENT.md`                               |
| PORT default            | `3002`                              | `8080`                                                              | `DEPLOYMENT.md`                                                  |
| LOG_LEVEL default       | `debug`                             | `info`                                                              | `DEPLOYMENT.md`, `OBSERVABILITY.md`                              |
| Error Shield            | Não documentado                     | `{error, message, error_id}` + sanitização 5xx em produção          | `SECURITY.md` (nova §6)                                          |
| LLM Span persistence    | Superficial                         | `ai_execution_spans` via `ExecutionSpanRepo` com colunas completas  | `OBSERVABILITY.md`                                               |
| Audit Event persistence | `audit_events` (nome incorreto)     | `ai_audit_events` via `AuditRepo.CreateEvent()`                     | `OBSERVABILITY.md`                                               |

---

## 5. Próximos Passos Recomendados (Roadmap)

| Prioridade | Item                                                                        | Estimativa  |
| ---------- | --------------------------------------------------------------------------- | ----------- |
| 🔴 Alta    | Implementar Rate Limiting (middleware chi)                                  | 1 sprint    |
| 🟡 Média   | IntentParser: adicionar confidence scoring + testes de cobertura de domínio | 1 sprint    |
| 🟡 Média   | EntityExtractor: adicionar extração de datas e valores monetários           | 1 sprint    |
| 🟢 Baixa   | Suite de integração E2E (docker-compose + testcontainers)                   | 2 sprints   |
| 🟢 Baixa   | Admin API `/v1/admin` (gestão de workspaces)                                | 2-3 sprints |
