# ADR 0009 — Autenticação do MCP por chaves de API da plataforma

- **Status:** Aceito
- **Data:** 08/10/2026
- **Aprovador:** Marcelo
- **Decisão de origem:** D9, documento `decisoes` da [SMA-88](https://paperclip.local/SMA/issues/SMA-88)
- **Altera a especificação:** sim — substitui o modelo principal de autenticação do MCP da **§17** da Especificação v1.0, onde chaves de API eram apenas complemento (§17.5) e o OAuth Authorization Code com PKCE era o caminho principal.

## Contexto

O spike [SMA-93](https://paperclip.local/SMA/issues/SMA-93) (PR #6, revisões [SMA-118](https://paperclip.local/SMA/issues/SMA-118) e [SMA-119](https://paperclip.local/SMA/issues/SMA-119)), registrado em [`docs/spikes/mcp-oauth.md`](../spikes/mcp-oauth.md), concluiu que o Supabase OAuth Server atende só parcialmente ao contrato da §17:

1. recusa escopos customizados em `/authorize`;
2. não tem `revocation_endpoint` nem `introspection_endpoint`;
3. o access token emitido é **uma sessão completa do Supabase**, dando ao assistente externo o mesmo alcance do usuário em Data API e Storage — hoje neutralizado apenas pela Data API fechada da [ADR 0001](0001-prisma-como-caminho-unico.md).

## Decisão

- A **Fase 4 usa chaves de API emitidas pela própria plataforma** (tokens pessoais) como autenticação do MCP, em substituição ao OAuth como caminho principal.
- Cada chave é criada pelo usuário em `/app/[workspaceSlug]/settings/mcp` e fica vinculada a **um usuário, um workspace e escopos explícitos** (catálogo da §17.3).
- A chave é armazenada **somente por hash**, exibida uma única vez, tem **expiração obrigatória** e é revogável a qualquer momento com efeito imediato, porque a checagem ocorre a cada requisição.
- Chaves são **somente leitura por padrão**; escopos de escrita (`proposals:write`) exigem escolha explícita do usuário.
- A chave **não é token do Supabase** e não dá acesso a Data API, Storage ou Auth. O servidor MCP valida a chave, reavalia vínculo, permissão, módulo e plano, e monta o contexto `app.*` via `withContext` (ADR 0001).
- As superfícies `/mcp/workspace` e `/mcp/admin` continuam separadas: chaves de workspace não autorizam o admin, e chaves administrativas exigem papel interno ativo e MFA na criação.
- Auditoria de criação, uso e revogação; rate limit por chave, por usuário e por workspace; chave nunca em logs.
- O **Supabase OAuth Server fica descartado como emissor de tokens do MCP**. O Dynamic Client Registration ligado no projeto de desenvolvimento `guidu` serviu apenas ao spike e deve ser **desligado** no dev quando não houver mais testes; nunca habilitado em produção sem nova decisão.
- **Evolução futura:** quando forem necessários clientes que exigem OAuth (por exemplo, conectores web), implementar **servidor OAuth próprio** com biblioteca madura, sem protocolo caseiro, emitindo tokens próprios — não sessões do Supabase — e usando o Supabase Auth apenas como login. Isso exige nova decisão.

## Consequências

Limitação aceita: clientes que só aceitam OAuth não se conectam nesta etapa. O alvo inicial são clientes técnicos que aceitam cabeçalho de autorização (Claude Code, Codex, Cursor e similares).

A §17 da especificação passa a ser lida com esta ADR no lugar do seu modelo principal de autenticação. O detalhamento de quais trechos da §17 são substituídos e como o registro de concessões da §17.2 fica na forma de chaves é trabalho de especificação da Fase 4, não desta ADR.
