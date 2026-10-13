# MCP Go (referência)

Código e documentação do servidor MCP em Go do projeto anterior (`github.com/cartaopro/mcp`), guardados como referência. **Não faz parte do build nem do deploy do GUIDU.**

O GUIDU não usa este serviço. As ideias que valem (decisão de política com motivo, execution id por turno, hash de entrada e saída sem texto cru na auditoria, erro seguro com `error_id`) entram no motor dos agentes, em TypeScript, na etapa A2b. O servidor MCP do GUIDU é o de `/mcp/workspace` e `/mcp/platform` (F4, `src/core/mcp/`).

A avaliação completa está em [AVALIACAO.md](AVALIACAO.md). A documentação original continua em [docs/](docs/README.md).
