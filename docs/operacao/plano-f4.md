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

**Estado:** concluída (PR #34), migration `20261018090000_f4a_api_rate_limits.sql` aplicada no dev.

Entregue:

- `src/core/api/handler.ts`: a camada única de entrada. Na ordem: parceiro do host, quem chama (chave ou sessão), escopo, workspace, limite, consulta e serviço. A saída passa pelo esquema da rota, então campo fora do contrato não sai (AC07).
- Uma chave de outro parceiro, revogada, vencida ou de membro removido responde 401. Workspace fora do alcance responde 404, sem revelar se existe.
- `src/core/api/contracts.ts`: as rotas, os escopos e os esquemas em um só lugar, que também geram o OpenAPI (`/api/v1/openapi.json`).
- Rotas: `/me/workspaces`, `/workspaces/{id}`, `/overview`, `/modules`, `/usage`, `/executions` e `/members`. As duas últimas são paginadas por cursor.
- Limite de requisições: janela de 1 minuto por chave, por pessoa e por workspace, no Redis (`REDIS_URL`). Sem o Redis, ou com ele fora do ar, a contagem vai para `private.hit_rate_limit` no Postgres, e a tabela não fica exposta ao app. Toda resposta traz os cabeçalhos `RateLimit-*`, e o 429 traz também `Retry-After`. A rotina diária apaga as janelas com mais de um dia.
- `/api/health/ready` passa a informar o estado do Redis, que não decide se a aplicação está pronta.
- A página "API e Webhooks" mostra o endereço base, o id do workspace, as rotas com o escopo de cada uma, os limites e o OpenAPI. Webhooks aparecem como "em breve".
- CI: Redis temporário no job `db`.
- Testes:
  - unitários: limites, cursor e OpenAPI;
  - suíte SQL `api-rate-limit-rls.sql`;
  - integração `api.test.ts`: contrato, AC01, AC03, parceiro do host, sessão e 429 no Redis e no Postgres;
  - e2e `api.spec.ts`: sessão, 401 anônimo, OpenAPI e página.

Aprendizado: o cursor guarda o carimbo de tempo como o Postgres o escreve, em microssegundos. Uma `Date` do JavaScript corta em milissegundos, e linhas criadas na mesma transação sumiam da página seguinte.

Planejado:

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

**Estado:** concluída (PR #35), sem migration. Guia de conexão em [mcp-conexao.md](mcp-conexao.md).

Entregue:

- `/mcp/workspace` com o SDK oficial `@modelcontextprotocol/sdk` 1.30.1 (fixado), Streamable HTTP sem sessão e respostas JSON.
- Cada requisição é autenticada de novo pela chave, com a mesma entrada da REST: parceiro do host, chave, limite. Cada requisição monta um servidor novo, só com as ferramentas que os escopos e o papel atual permitem.
- Oito ferramentas de leitura (§17.3), em `src/core/mcp/tools.ts`, com esquemas de entrada e de saída, escopo, permissão e risco. Elas chamam os serviços da REST, que conferem a permissão de novo.
- As entradas são estritas e nunca recebem o workspace: um argumento a mais é recusado (AC10).
- Cada chamada fica auditada como `mcp.tool.call`, com o resultado e o `requestId`.
- Requisição sem chave recebe 401 com `WWW-Authenticate: Bearer`, `Origin` de outro host recebe 403 e `GET` recebe 405.
- `/mcp/` saiu do matcher do proxy, como `/api/`.
- A página Configurações › MCP ganhou a seção "Como conectar", com o endereço e os comandos para Claude Code e Codex.
- Testes:
  - unitários: filtro por escopo e papel, origem, entradas estritas;
  - integração `mcp-workspace.test.ts` com o cliente oficial do SDK: lista filtrada, chamada fora da lista recusada, argumento forjado recusado, execução de outro workspace inexistente, auditoria, 401, 403, 405 e revogação;
  - e2e `mcp.spec.ts`: chave criada pela tela, `initialize`, `tools/list` e `tools/call` no servidor real.

Pendente: a validação com Claude Code e Codex instalados (decisão 5), a registrar no guia.

Planejado:

- `/mcp/workspace` com o SDK oficial (`@modelcontextprotocol/sdk`, versão fixada), Streamable HTTP sem estado e chave validada a cada requisição.
- Ferramentas da §17.3: `get_workspace`, `get_workspace_overview`, `list_enabled_modules`, `get_module_status`, `get_usage_summary`, `list_executions`, `get_execution_status` e `list_workspace_members`.
- Cada ferramenta tem entrada e saída em Zod, escopo exigido, permissão e classificação de risco. `tools/list` filtra pelo que a chave e o papel atual permitem, e `tools/call` confere tudo de novo. Nenhuma ferramenta genérica (SQL, shell, HTTP arbitrário).
- As ferramentas usam os mesmos serviços da REST.
- Testes: AC09 e AC10 com o cliente do SDK, inclusive a tentativa de trocar o workspace pela entrada.
- Guia de conexão para Claude Code e Codex (URL, cabeçalho, limitações).

### F4c — Módulo CRM: contatos

**Estado:** concluída (PR #36), migration `20261019090000_f4c_crm_contacts.sql` aplicada no dev. Especificação em [src/modules/crm/MODULE_SPEC.md](../../src/modules/crm/MODULE_SPEC.md).

Entregue:

- Módulo `crm` (beta) em `src/modules/crm`: manifesto, menu "CRM › Contatos", permissões `crm.contacts.read` (todos os papéis) e `crm.contacts.write` (owner, admin e editor), cota `crm.contacts` (5.000 por workspace quando o plano não define), contrato de dados da F3e e uso medido em Consumo & Limites.
- Tabela `crm_contacts` com RLS FORCE: membros leem, owner, admin e editor criam e editam, e cada linha guarda quem criou e quem alterou por último. Um gatilho mantém workspace, autor e data de criação imutáveis. Não há exclusão nesta etapa.
- Os serviços conferem o estado do módulo (desabilitado bloqueia; suspenso deixa só a leitura), a permissão e a cota, nesta ordem, e auditam `crm.contact.create` e `crm.contact.update`. Telas, REST e MCP usam os mesmos serviços.
- Telas `/app/[slug]/crm/contacts` (lista, busca e criação) e `/app/[slug]/crm/contacts/[id]` (edição, ou consulta para quem só lê).
- REST: `GET` e `POST /workspaces/{id}/crm/contacts`, `GET` e `PATCH .../{contactId}`, no OpenAPI. A camada de entrada passou a aceitar corpo JSON (422 para campo desconhecido) e, na sessão do navegador, só aceita escrita em JSON e da mesma origem (CSRF).
- Escopos novos nas chaves: `crm:read` (leitura) e `crm:write` (escrita só pela REST). Chave de viewer não recebe escopo de escrita.
- MCP: `list_contacts` e `get_contact`, com `crm:read`, só enquanto o módulo está habilitado ou suspenso. Uma chave sem nenhuma ferramenta utilizável recebe lista vazia em `tools/list`.
- Testes:
  - suíte SQL `crm-rls.sql` (job `db`);
  - integração `crm.test.ts`: serviços, viewer, AC08 (módulo desabilitado bloqueia tela, REST e MCP), REST com escopos, CSRF e outro workspace;
  - e2e `crm.spec.ts`: habilitar o módulo, adicionar, editar e buscar contato.

Planejado:

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

**Estado:** concluída (PR #37), migration `20261020090000_f4d_execution_proposals.sql` aplicada no dev. Guia em [mcp-conexao.md](mcp-conexao.md#propostas-f4d).

Entregue:

- Tabela `execution_proposals` com RLS FORCE:
  - só uma chave de API cria (`principal_type = api_key`), assinada pela pessoa e pela chave, com validade de até 24 horas;
  - owner e admin veem todas; quem pediu vê as suas;
  - um gatilho deixa o conteúdo imutável e só aceita as transições pendente → aprovada/rejeitada e aprovada → executada/com falha. A aprovação precisa ser de uma pessoa (sessão), assinada por ela e carregar o hash do conteúdo;
  - entra na exclusão do workspace e na exportação, e ganhou a categoria de retenção `execution_proposals` (desligada, como as outras).
- `src/core/proposals`:
  - registro explícito de operações; o CRM declara `crm.contacts.create` e `crm.contacts.update`;
  - hash SHA-256 do JSON canônico (workspace, operação, alvo, versão do registro e conteúdo normalizado);
  - criar (idempotência por workspace; até 50 pendentes), aprovar (owner/admin, sessão, MFA, hash da tela, versão atual), rejeitar e executar;
  - job `core.proposal-execute`, no contexto de quem aprovou, que reconfere validade, integridade, versão, módulo, permissão e cota. Recusas viram "não executada" com o motivo; o efeito e o novo estado ficam na mesma transação.
- Permissão nova `workspace.proposals.review` (owner e admin) e a tela **Propostas** (`/app/[slug]/proposals`): pendentes e histórico, detalhe com valores atuais e propostos, motivo, impressão do hash, aprovar e rejeitar.
- MCP: `propose_operation` (anotada como escrita, não destrutiva e idempotente) e `get_proposal`, com o escopo `proposals:write`. A resposta traz o link de revisão no host da requisição.
- Auditoria: `proposal.create`, `proposal.approve`, `proposal.reject` e `proposal.execute`.
- Testes:
  - suíte SQL `proposals-rls.sql`;
  - integração `proposals.test.ts`: MCP e idempotência, recusas (chave, sem MFA, viewer, hash errado), execução pelo worker uma só vez, proposta alterada e vencida (AC11), versão do contato e módulo desligado;
  - e2e `proposals.spec.ts`: chave pela tela, proposta pelo MCP, aprovação com MFA, rejeição, worker e contato no CRM.

Planejado:

- `proposals:write` libera `propose_operation`, que só cria a proposta e nunca executa o efeito.
- Operações iniciais: `crm.contacts.create` e `crm.contacts.update`.
- A proposta registra quem pediu, a chave usada, o workspace, a operação, o alvo, o conteúdo canônico, um hash do conteúdo, a versão do recurso e a validade.
- Aprovação humana numa tela do workspace, com MFA, presa ao conteúdo exato. Aprovam owner e admin. Qualquer mudança invalida a aprovação, e a aprovação do próprio modelo não conta.
- A execução roda em job do worker, reconferindo tudo. A idempotência é por workspace: reenvio com conteúdo diferente dá conflito.
- Testes: AC11 (proposta alterada ou vencida não executa, e reexecução não duplica).

### F4e — API e MCP da plataforma

**Estado:** concluída (PR #38), migration `20261021090000_f4e_platform_api_keys.sql` aplicada no dev. Guia em [mcp-conexao.md](mcp-conexao.md#plataforma-f4e).

Entregue:

- Tabela `platform_api_keys`, separada das chaves de workspace, com RLS FORCE:
  - chave `gdu_admin_…` guardada só por hash, com validade obrigatória de até 90 dias;
  - cada membro com papel interno cria e vê as suas; o owner da plataforma vê e revoga todas;
  - um gatilho deixa tudo imutável, menos a revogação e o último uso;
  - busca por hash só pela função `private.resolve_platform_api_key`.
- Criação em **Plataforma › Chaves de API** (`/platform/api-keys`), com MFA e só com os escopos que o papel permite. A cada requisição a chave é reconferida: situação, validade, perfil, papel interno ativo e escopos ainda permitidos. Perder o papel invalida a chave na hora.
- Permissão nova `platform.customers.read` (os quatro papéis internos). `admin:customers:read` usa essa permissão; `admin:operations:read` usa `platform.operations.read` (owner, operations e support).
- REST em `/api/v1/platform` (não `/api/v1/admin`, porque `/admin` já é o console do parceiro e `/api/v1/platform/session` já existia): `/customers`, `/customers/{id}`, `/health` e `/failed-jobs`. Aceita a chave administrativa ou a sessão de um membro com papel interno e MFA, só nos hosts da plataforma (outros hosts respondem 404).
- MCP em `/mcp/platform`, só com chave: `list_customers`, `get_customer_summary`, `get_platform_health` e `list_failed_jobs`, filtradas pelos escopos e pelo papel atual. Nenhuma escrita.
- Dados mínimos: empresa (situação, assentos, número de workspaces e plano, este só para quem lê cobrança); saúde (workers, filas e totais de 24 horas); jobs com falha (tipo, tentativas, data e o erro seguro do worker, nunca o conteúdo do job).
- AC09 nos dois sentidos: a chave administrativa é recusada nas rotas e no MCP de workspace, e a chave de workspace é recusada na API e no MCP da plataforma.
- Auditoria: `platform_api_keys.create`, `.revoke`, `.used` e `mcp.tool.call`.
- Testes:
  - suíte SQL `platform-api-keys-rls.sql`;
  - integração `platform-api.test.ts`: criação (MFA, papel, escopos), leitura por escopo e papel, AC09, host de parceiro, sessão com e sem MFA, ferramentas do MCP, papel perdido e chave revogada;
  - e2e `platform-api.spec.ts`: chave pela tela, REST, MCP, AC09 e revogação.

Planejado:

- Chaves administrativas: exigem papel interno ativo e MFA na criação e nunca valem nas rotas de workspace (AC09).
- `/api/v1/admin` e `/mcp/platform`, com `admin:customers:read` (dados comerciais mínimos) e `admin:operations:read` (saúde e jobs com falha, sem conteúdo de cliente).
- Sem escrita administrativa nesta fase.

## Fora da F4

- Webhooks de saída (decisão 4).
- OAuth próprio (ADR 0009, evolução futura).
- Escrita direta pelo MCP sem proposta.
