# Desacoplamento do Domínio de Portfolio

## Objetivo
Reduzir a superfície de ataque do **MCP Runtime** e manter o núcleo do sistema focado apenas em governança, política e execução agentic. O domínio de **Portfolio** é agora considerado um componente opcional/legado dentro deste repositório.

## Estratégia de Desacoplamento

### Feature Flag
O controle é feito através da variável de ambiente `MCP_ENABLE_PORTFOLIO`.

- **`false` (Padrão/Produção)**: O MCP sobe em modo **Core Only**.
  - Rotas `/v1/workspaces/{id}/portfolio/*` são desabilitadas (404).
  - O Policy Engine não registra o namespace `portfolio.*`.
  - O Tool Registry não registra a ferramenta `PortfolioTool`.
  - Não há inicialização de repositórios ou serviços de portfolio.
- **`true`**: O MCP sobe com suporte legado ao Portfolio.
  - Todas as funcionalidades originais são mantidas.

## Impactos no Startup
Ao iniciar o servidor, o log indicará o modo de operação:

```text
# Portfólio desabilitado
{"level":"info","module":"infra","msg":"portfolio domain: DISABLED (Core Only Mode)"}

# Portfólio habilitado
{"level":"info","module":"infra","msg":"portfolio domain: ENABLED"}
```

## Como Reativar (Local/Referência)
Para habilitar o domínio de portfolio em ambiente de desenvolvimento:

1. Adicione ao seu `.env`:
   ```env
   MCP_ENABLE_PORTFOLIO=true
   ```
2. Certifique-se de que a tabela `portfolio_items` existe no banco de dados (usando as migrations em `migrations/legacy_or_app/`).

## Próximos Passos
Este desacoplamento é o primeiro passo para a remoção completa do código de portfolio deste repositório, movendo-o para a **API Go** dedicada.
