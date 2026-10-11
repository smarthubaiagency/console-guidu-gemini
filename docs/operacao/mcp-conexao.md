# Conectar assistentes ao MCP do workspace

Etapa F4b do [plano da F4](plano-f4.md). O GUIDU expõe um servidor MCP de leitura por workspace, autenticado por chave de API da plataforma ([ADR 0009](../adr/0009-autenticacao-mcp-chaves-api.md)).

## Dados da conexão

| Item         | Valor                                                                                         |
| ------------ | --------------------------------------------------------------------------------------------- |
| Endereço     | `https://<host do parceiro ou da plataforma>/mcp/workspace` (mostrado em Configurações › MCP) |
| Transporte   | Streamable HTTP, sem sessão: cada requisição é independente                                   |
| Autenticação | Cabeçalho `Authorization: Bearer gdu_live_…`, com uma chave criada em Configurações › MCP     |
| Workspace    | O da chave; nenhuma ferramenta recebe outro workspace                                         |
| Ferramentas  | Só leitura, filtradas pelos escopos da chave e pelo papel atual de quem a criou               |
| Limite       | O mesmo da API: 60/min por chave, 120 por pessoa, 300 por workspace (provisórios)             |

Ferramentas por escopo:

| Escopo            | Ferramentas                                 |
| ----------------- | ------------------------------------------- |
| `workspace:read`  | `get_workspace`, `get_workspace_overview`   |
| `modules:read`    | `list_enabled_modules`, `get_module_status` |
| `usage:read`      | `get_usage_summary`                         |
| `executions:read` | `list_executions`, `get_execution_status`   |
| `members:read`    | `list_workspace_members`                    |

## Claude Code

```bash
claude mcp add --transport http guidu https://<host>/mcp/workspace \
  --header "Authorization: Bearer <SUA_CHAVE>"
```

Depois, em uma conversa: `/mcp` mostra o servidor e as ferramentas.

## Codex

Em `~/.codex/config.toml`, com a chave na variável de ambiente `GUIDU_MCP_TOKEN`:

```toml
[mcp_servers.guidu]
url = "https://<host>/mcp/workspace"
bearer_token_env_var = "GUIDU_MCP_TOKEN"
```

## Segurança

- A chave é revogável a qualquer momento em Configurações › MCP, e a próxima requisição já é recusada.
- Requisições de navegador com `Origin` de outro host são recusadas (proteção contra DNS rebinding). Clientes de linha de comando não enviam `Origin`.
- Cada chamada de ferramenta fica na auditoria (`mcp.tool.call`), com o `requestId`.
- A chave nunca aparece em logs nem em respostas.

## Validação com clientes reais

Os testes automáticos usam o cliente oficial do SDK (`tests/core/mcp-workspace.test.ts`) e um cliente JSON-RPC no e2e (`e2e/mcp.spec.ts`). A conexão com os clientes instalados fica com Marcelo, no dev (plano F4, decisão 5). Registrar aqui o que for confirmado:

| Cliente     | Versão | Conectou | Listou ferramentas | Chamou ferramenta | Limitações observadas |
| ----------- | ------ | -------- | ------------------ | ----------------- | --------------------- |
| Claude Code | —      | —        | —                  | —                 | —                     |
| Codex       | —      | —        | —                  | —                 | —                     |
