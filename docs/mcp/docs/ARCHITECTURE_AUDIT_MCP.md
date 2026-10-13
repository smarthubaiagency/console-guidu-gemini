# Auditoria Arquitetural: MCP Core vs Legacy Domain

## Resumo Executivo

Esta auditoria revisou a estrutura atual do MCP Go em comparação com o planejamento original documentado em `/docs` e `PROJECT_CONTEXT.md`. Identificamos que o MCP Core está bem definido em termos de governança e execução de LLM, porém existe um acoplamento significativo com o domínio de **Portfolio**, que deveria pertencer exclusivamente à **API Go**. 

Não foram encontradas tabelas ativas de **CRM**, embora o domínio seja citado em ADRs como exemplo de extensão.

## Entidades Previstas nos Docs

Com base nos documentos `DATABASE.md`, `PROJECT_CONTEXT.md` e `adr/*.md`, as entidades oficiais do MCP Core são:

1.  **Execution Trace**: Rastreabilidade de execuções agentic.
2.  **LLM Spans**: Telemetria e auditoria de chamadas de LLM (Privacy-First).
3.  **Audit Events**: Logs de segurança e governança com integridade (SHA-256).
4.  **LLM Governance**: Configurações versionadas de modelos e estratégias de fallback por workspace.
5.  **Policy Engine**: Regras de autorização por namespace (Fail-Closed).

## Tabelas Atuais nas Migrations

Identificamos as seguintes tabelas no banco de dados atual (`migrations/`):

- `portfolio_items`
- `llm_configs`
- `tenant_llm_settings`
- `llm_spans`
- `audit_events`
- `execution_trace_index`

## Tabela Comparativa (Docs vs Migrations)

| Tabela | Origem Planejada | Status Atual | Classificação |
| :--- | :--- | :--- | :--- |
| `llm_configs` | MCP Core | Implementada conforme ADR | **CORE** |
| `tenant_llm_settings` | MCP Core | Implementada conforme ADR | **CORE** |
| `llm_spans` | MCP Core | Implementada conforme ADR | **CORE** |
| `audit_events` | MCP Core | Implementada conforme ADR | **CORE** |
| `execution_trace_index`| MCP Core | Implementada conforme ADR | **CORE** |
| `portfolio_items` | API Go (Negócio) | Acoplada no MCP Go | **APPLICATION_SERVICE** |
| `crm_*` (Legacy) | API Go (NexCRM) | Apenas citações conceituais | **LEGACY/CONCEPTUAL**|

## Análise Técnica de Acoplamento

A tabela `portfolio_items` e seu respectivo repositório (`internal/storage/postgres/portfolio_repo.go`) estão atualmente operando dentro da infraestrutura do MCP Go. 

> [!IMPORTANT]
> Segundo o `PROJECT_CONTEXT.md`, o **MCP Go (Client)** deve ser focado em infraestrutura, governança e execução, enquanto a lógica de negócio e integração com CRM pertence à **API Go**.

Trecho do `PROJECT_CONTEXT.md`:
> "MCP Go (Client): Infraestrutura consolidada para Secure Production... NÃO faz onboarding, NÃO cria agentes."

A presença de `portfolio_items` no Core introduz:
- **Poluição de Schema**: Tabelas de negócio misturadas com telemetria.
- **Complexidade de Manutenção**: Alterações no portfólio exigem deploy do Runtime do MCP.
- **Risco de Segurança**: Embora o RLS esteja ativo, a mistura de domínios aumenta a superfície de erro em políticas globais.

## Conclusão e Recomendações

### O que manter no MCP Core
Todas as tabelas relacionadas a LLM e Execução são fundamentais para o **MCP Runtime** em produção:
- `llm_configs`, `tenant_llm_settings`, `llm_spans`, `audit_events`, `execution_trace_index`.

### O que mover ou remover
1.  **Mover**: `portfolio_items` deve ser movido para o repositório/serviço da **API Go**.
2.  **Refatorar**: Os handlers em `internal/http/handlers/portfolio.go` devem ser desativados no MCP Go e implementados na API de negócio.
3.  **Limpeza**: Remover referências conceituais a CRM das ADRs se não houver plano imediato de implementação via MCP (manter apenas se for via Tooling dinâmico).

### Obrigatoriedade para Produção (MCP Runtime)
Para o lançamento GA do MCP Runtime, o foco deve ser total na estabilidade de:
- **Idempotência de Execução** (Migration 000005)
- **RLS Fail-Closed**
- **Política de Retenção de Logs** (90 dias para spans e audit)

---
*Gerado via Auditoria Arquitetural MCP - 2026-02-18*
