# Plano da F4 — API REST e MCP

A F4 vem depois da F3 e antes da F5, pela [ADR 0003](../adr/0003-ordem-das-fases.md). Cobre a §15 (API REST) e a §17 (MCP) da especificação, lidas com a [ADR 0009](../adr/0009-autenticacao-mcp-chaves-api.md): a autenticação é por chaves de API da plataforma, e não por OAuth.

Critérios de saída:

- AC01, AC03, AC07, AC08, AC09, AC10 e AC11 cobertos por testes de contrato da REST e do MCP.
- Conexão com Claude Code e Codex validada por Marcelo no dev e registrada.

## Ponto de partida

Já existe:

- Chaves `gdu_live_` guardadas só por hash, com expiração obrigatória e revogação imediata, criadas em `/app/[slug]/settings/mcp`.
- O catálogo de escopos da §17.3, com escrita só por opt-in.
- `authenticateApiKey`, que reconfere usuário, workspace e escopos.

Falta:

- As rotas REST.
- O servidor MCP.
- Limite de requisições.
- Propostas com aprovação humana.
- A superfície da plataforma.
- A checagem de parceiro nas chaves, pendente desde a P2.

## Decisões de Marcelo

1. **Redis gerenciado entra na stack.** Fica hospedado no Coolify e é usado pelo limite de requisições e, depois, pelas automações. Os limites são provisórios e ficam em configuração: 60 req/min por chave, 120 por usuário e 300 por workspace. Se o Redis estiver fora do ar, o limite passa a ser contado no Postgres e um alerta é registrado; a API nunca fica sem limite.
2. **A REST aceita a mesma chave do MCP**, com os mesmos escopos, e também a sessão do navegador. Na sessão valem só as permissões do papel.
3. **Propostas são testadas com contatos**: adicionar e editar contato passam por proposta e aprovação; ver contatos é leitura comum. Contatos são um **módulo CRM**, não parte do núcleo. O módulo começa só com contatos e depois cresce para leads, empresas, negócios e tarefas, sem nada fixo no núcleo.
4. **Webhooks de saída ficam adiados** até haver um consumidor real. A página "API e Webhooks" marca webhooks como "em breve". Webhooks de entrada (o provedor de pagamento) já estão previstos na P6.
5. **Clientes reais.** Os testes automáticos usam o cliente do SDK oficial. Marcelo conecta o Claude Code e o Codex no dev, e as limitações confirmadas ficam registradas aqui.
6. **Ordem:** F4a → F4b → F4c → F4d → F4e. Um PR por etapa, cada um com o "pode começar" do Marcelo.

## Etapas

### F4a — Base da API REST

- Uma camada única de entrada: sessão ou chave Bearer. Ela resolve quem chama, o vínculo, o escopo (só para chave), a permissão, o estado e a contratação do módulo, a cota e valida a entrada com Zod.
- Erros 401, 403, 404, 409, 422 e 429, sempre com código, mensagem segura e `requestId`.
- Paginação por cursor, com até 100 itens por página. A `v1` só muda de forma compatível.
- Limite de requisições no Redis, com o Postgres como reserva (decisão 1).
- A chave vale só no host do parceiro dela.
- O uso da chave é registrado (último uso e auditoria), e a chave nunca aparece em logs.
- Rotas de leitura do núcleo: `GET /api/v1/me/workspaces`, `/workspaces/{id}`, `/workspaces/{id}/overview`, `/modules`, `/usage`, `/executions` e `/members`.
- OpenAPI gerado dos esquemas Zod em `/api/v1/openapi.json`, com referência na página "API e Webhooks".
- Testes de contrato: AC01, AC03, AC07, AC08 e 429 sob carga.

### F4b — MCP do workspace (leitura)

- `/mcp/workspace` com o SDK oficial (`@modelcontextprotocol/sdk`, versão fixada), Streamable HTTP sem estado e chave validada a cada requisição.
- Ferramentas da §17.3: `get_workspace`, `get_workspace_overview`, `list_enabled_modules`, `get_module_status`, `get_usage_summary`, `list_executions`, `get_execution_status` e `list_workspace_members`.
- Cada ferramenta tem entrada e saída em Zod, escopo exigido, permissão e classificação de risco. `tools/list` filtra pelo que a chave e o papel atual permitem, e `tools/call` confere tudo de novo. Nenhuma ferramenta genérica (SQL, shell, HTTP arbitrário).
- As ferramentas usam os mesmos serviços da REST.
- Testes: AC09 e AC10 com o cliente do SDK, inclusive a tentativa de trocar o workspace pela entrada.
- Guia de conexão para Claude Code e Codex (URL, cabeçalho, limitações).

### F4c — Módulo CRM: contatos

- Manifesto `crm`, com rotas, menu, permissões (`crm.contacts.read` e `crm.contacts.write`), cota de contatos por workspace e capacidade `export`.
- Tabela `crm_contacts` por workspace, com RLS:
  - nome (obrigatório), e-mail, telefone, empresa (texto livre até existir o objeto "empresa"), cargo e observações;
  - quem criou e datas.
- Telas `/app/[slug]/crm/contacts`: lista com busca e criação/edição para quem tem a permissão.
- REST: `GET` e `POST /api/v1/workspaces/{id}/crm/contacts` e `GET` e `PATCH .../{contactId}`. O POST e o PATCH respeitam o escopo de escrita. No MCP, a escrita só chega por proposta (F4d).
- MCP (leitura): `list_contacts` e `get_contact`. Precisa de um escopo de módulo; proposta: `crm:read`.
- Contrato de dados (F3e): os contatos entram na exportação e são apagados na exclusão do workspace.
- O módulo nasce extensível: leads, empresas, negócios e tarefas entram depois como novos objetos do mesmo módulo, cada um com a sua especificação.

### F4d — Propostas com aprovação humana

- `proposals:write` libera `propose_operation`, que só cria a proposta e nunca executa o efeito.
- Operações iniciais: `crm.contacts.create` e `crm.contacts.update`.
- A proposta registra quem pediu, a chave usada, o workspace, a operação, o alvo, o conteúdo canônico, um hash do conteúdo, a versão do recurso e a validade.
- Aprovação humana numa tela do workspace, com MFA, presa ao conteúdo exato. Aprovam owner e admin. Qualquer mudança invalida a aprovação, e a aprovação do próprio modelo não conta.
- A execução roda em job do worker, reconferindo tudo. A idempotência é por workspace: reenvio com conteúdo diferente dá conflito.
- Testes: AC11 (proposta alterada ou vencida não executa, e reexecução não duplica).

### F4e — API e MCP da plataforma

- Chaves administrativas: exigem papel interno ativo e MFA na criação e nunca valem nas rotas de workspace (AC09).
- `/api/v1/admin` e `/mcp/platform`, com `admin:customers:read` (dados comerciais mínimos) e `admin:operations:read` (saúde e jobs com falha, sem conteúdo de cliente).
- Sem escrita administrativa nesta fase.

## Fora da F4

- Webhooks de saída (decisão 4).
- OAuth próprio (ADR 0009, evolução futura).
- Escrita direta pelo MCP sem proposta.
