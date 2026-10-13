# Avaliação do MCP Go como camada extra do GUIDU

13/10/2026. Base: `docs/mcp` na `main` (24 documentos, 4,7 mil linhas de Go). O código compila (`go build ./...`) e os 4 pacotes com teste passam (`go test ./...`).

## Resposta curta

**Não recomendo adicionar o MCP Go como serviço do GUIDU.** As boas ideias dele valem muito e já cabem na A2, escritas em TypeScript dentro do motor (`src/core/ai/`). Rodar o serviço Go ao lado do Next.js traria um segundo runtime, um segundo modelo de permissões e um segundo caminho até o banco, sem ganho de segurança sobre o que o GUIDU já tem.

## Estado real do MCP Go

| Ponto                              | O que a documentação promete                  | O que o código faz                                                                                                                                                                                         |
| ---------------------------------- | --------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Política                           | Default deny, namespaces, testes allow e deny | Default deny existe. As regras de `contact`, `workspace` e `commerce` só checam se há workspace; não olham papel nem permissão (`cmd/mcp-server/main.go:139-167`)                                          |
| Anti-tamper da proposta (ADR 0003) | Hash da proposta revalidado no servidor       | `ValidateProposalHash` só é chamada nos testes; nenhum handler a usa                                                                                                                                       |
| Identidade                         | Workspace e usuário vêm do JWT                | O executor usa `workspace_id` e `user_id` do **corpo** da requisição, com padrão `smoke-test` quando vazios (`main.go:218-226`). A checagem de membro valida o **cabeçalho**, que pode ser outro workspace |
| Isolamento                         | Membro obrigatório                            | Cabeçalho com o workspace `0000…` pula a checagem de membro para qualquer usuário autenticado (`workspace_ownership.go:36`)                                                                                |
| RLS                                | `SET LOCAL` com UUID validado do JWT          | O valor vem do cabeçalho, sem validar formato, e entra por `fmt.Sprintf` no SQL (`tenantdb.go:81`). Hoje a checagem de membro barra quase tudo, mas a premissa do comentário é falsa                       |
| Protocolo                          | "Model Context Protocol"                      | É uma API HTTP própria (`POST /v1/command/execute`), não o protocolo MCP (JSON-RPC com `tools/list` e `tools/call`). Um cliente MCP padrão não conversa com ele                                            |
| Agente                             | Camada cognitiva                              | Intenção por palavra-chave e entidades por regex (o próprio `GAPS.md` diz que é MVP); com um LLM decidindo as ferramentas, essa camada não tem uso                                                         |
| Rate limit, admin API, E2E         | Documentados                                  | Não implementados (`GAPS.md` §3)                                                                                                                                                                           |

### Encaixe com o banco do GUIDU

As ferramentas gravam em tabelas de outro esquema: `"Contact"`, `"Workspace"`, `"WorkspaceMember"`, `"AiAuditEvent"` e `"ProductionOrder"`, em PascalCase. Elas vêm do cartaopro/nextcrm. O GUIDU usa `crm_contacts` e `workspace_memberships`, com o contexto `app.workspace_id`, `app.user_id` e outros, aplicado pelo `withContext`. Nenhuma ferramenta funcionaria sem reescrita.

### Arquivos no repositório

Os binários Windows (37 MB), o `start-dev.ps1` (que trazia segredos reais), o `package.json` de placeholder e o `Dockerfile` (apontava para `apps/mcp`) saíram em 13/10/2026.

## Por que não como camada extra

- **ADR 0017:** o motor roda no processo do GUIDU, e só `src/core/ai/` conversa com o SDK. As ferramentas chamam os serviços públicos dos módulos dentro do `withContext`, com o RLS forçado e a matriz de permissões (`requireWorkspacePermission`) que já existem. Um serviço Go teria de reimplementar papéis, parceiros, concessões (ADR 0012), quotas e auditoria. Duas cópias de regra de segurança acabam divergindo.
- **Uma hop de rede a mais por ferramenta**, com HMAC, JWT e outro deploy, outro role de banco e outra observabilidade, para o mesmo banco.
- **Ganho de segurança zero:** o que ele protege (allowlist, isolamento, auditoria) o GUIDU já faz no próprio processo, com testes SQL de RLS no CI.

## O que vale trazer para a A2 (em TypeScript)

1. **Policy check obrigatório antes de cada ferramenta**, com default deny e motivo registrado. Já está no plano como allowlist; adoto o formato de decisão do MCP Go (`allow`, `deny`, `restrict` com política e motivo) na auditoria.
2. **Execution id por turno**, propagado para ferramentas, consumo e auditoria, para reconstruir um turno inteiro.
3. **Spans sem texto cru:** hash SHA-256 de entrada e saída de cada ferramenta e payload com dados sensíveis mascarados na auditoria. O texto da conversa fica só em `ai_messages`, sob RLS e retenção.
4. **Hash da proposta:** o GUIDU já tem isso desde a F4d (`src/core/proposals/`, `proposalHash`, aprovação humana conferindo o `payloadHash`). O `propose_operation` do Assistente vai reaproveitar essas propostas, sem nada novo.
5. **Escudo de erro:** erro 5xx vira mensagem genérica com `error_id`, como o GUIDU já faz com `AppError`, estendido às falhas de ferramenta.

Os itens 2 e 3 entram na A2b sem mudar o tamanho da etapa de forma relevante.

## MCP externo: já existe

O GUIDU já tem servidor MCP oficial desde a F4 (PRs #34 a #38): `/mcp/workspace` e `/mcp/platform` (`src/app/mcp/`, `src/core/mcp/`), com o SDK oficial do protocolo, chaves `gdu_live_` com escopos (ADR 0009), limites em Redis e escrita só por proposta com aprovação humana. Guia em `docs/operacao/mcp-conexao.md`. Clientes externos (Claude, ChatGPT, n8n) já podem se conectar. Quando o motor da A2 ganhar ferramentas novas, as que fizerem sentido para fora entram nesse servidor, com escopo próprio.
