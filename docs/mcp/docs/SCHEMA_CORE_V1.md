# MCP Core Schema v1

## Visão Geral
O schema **MCP Core v1** define a infraestrutura mínima necessária para o funcionamento do MCP Runtime em produção. Ele é focado em governança de LLM, rastreabilidade de execuções e auditoria de segurança.

## Tabelas Core

### 1. `llm_configs`
Armazena configurações versionadas de provedores e modelos de LLM.
- **Chave**: `id` (UUID)
- **Isolamento**: `workspace_id`

### 2. `tenant_llm_settings`
Define qual configuração de LLM está ativa para um determinado workspace e sua estratégia de fallback.
- **Chave**: `workspace_id` (UUID)

### 3. `llm_spans`
Telemetria detalhada de cada chamada de LLM. Segue o princípio **Privacy-First** (não armazena prompts/responses brutos, apenas metadados e hashes).
- **Chave**: `id` (UUID)
- **Correlação**: `execution_id`

### 4. `audit_events`
Log imutável de eventos de segurança e governança.
- **Chave**: `id` (UUID)
- **Integridade**: `payload_hash` (SHA-256)

### 5. `execution_trace_index`
Índice mestre de todas as tarefas agentic executadas pelo sistema. Suporta idempotência e persistência de resultados.
- **Chaves**: `(workspace_id, execution_id)`

## Isolamento de Dados (RLS)
Todas as tabelas possuem **Row Level Security (RLS)** habilitado e forçado. O isolamento é garantido pela variável de sessão do PostgreSQL `app.current_workspace_id`.

```sql
SET LOCAL app.current_workspace_id = 'uuid-do-workspace';
```

## Implantação em Produção

Para criar um novo banco de dados MCP Core do zero:

1.  Execute o script consolidado:
    ```bash
    psql -d mcp_db -f migrations/core_only.sql
    ```

2.  Ou utilize o `golang-migrate` apontando para a pasta core:
    ```bash
    migrate -path migrations/core -database $DATABASE_URL up
    ```

## Ordem de Execução
Caso opte por rodar as migrations manualmente, a ordem obrigatória é:
1. `000003_llm_governance_and_audit.up.sql`
2. `000004_add_execution_id_to_audit_events.up.sql`
3. `000005_execution_idempotency.up.sql`
