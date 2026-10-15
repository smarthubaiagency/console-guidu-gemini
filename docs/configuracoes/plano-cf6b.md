# Plano CF6b — API e Integrações

Branch `claude/cf6b-api-integracoes` (worktree `/home/user/wt-cf6b`). Migration `20261121090000_cf6b_api_integrations.sql`.

## Contexto

API REST `/api/v1` e servidor MCP do workspace, sempre com chave (ADR 0009) e escopos; os três limites por minuto vinham só do ambiente (`API_RATE_LIMIT_PER_KEY/USER/WORKSPACE`, 60/120/300). O catálogo de cotas da CF4 já tinha `core.api_requests_per_minute` como "ainda não aplicado". Nada de Google no código; a G1 (`docs/operacao/plano-g1.md`) previa a conexão em Configurações › Integrações. Levantamento, itens 12 e 13.

## Objetivo

API: liga/desliga de emergência da API e do MCP; limites por plano com teto da plataforma; escopos por plano; uso por chave (chamadas e erros por dia) no `/app` e no `/platform`. Integrações: app OAuth do Google da GUIDU no `/platform`, app próprio opcional e restrição de escopos no `/admin`, conexão da conta Google do workspace no `/app` (só configuração e conexão; as ferramentas dos GUIDS ficam para a G1).

## Lógica (decisões)

1. **Liga/desliga em `settings` (ADR 0018).** Chaves só da plataforma `api.rest_enabled` e `api.mcp_enabled` (padrão ligado; só o "desligado" é gravado). Desligado: toda chamada da API REST dos workspaces (inclusive pela sessão) ou do MCP do workspace responde 503 `service_disabled` em inglês, antes de ler a chave. A API e o MCP **da plataforma** não são afetados. Leitura com cache de 5 s por processo, como a manutenção (CF5c); quem salva limpa o próprio cache; falha de leitura mantém a última resposta boa e, sem ela, conta como ligado.
2. **Limites pelo catálogo da CF4.** Três chaves de cota: `core.api_key_requests_per_minute`, `core.api_user_requests_per_minute` e `core.api_requests_per_minute` (workspace), agora "aplicadas", com padrão "do ambiente" (as variáveis viram só o padrão) e sem "sem limite". Valor efetivo = valor do plano, senão o do ambiente, nunca acima do teto (`quota_ceilings`). Um "sem limite" antigo num plano conta como padrão. API e MCP usam os mesmos limites; empresa sem plano usa o padrão. Tetos e valores por plano continuam em Planos e limites; a página API e MCP mostra o resumo.
3. **Escopos por plano** em `api.plan_scopes` (só plataforma): mapa chave do plano → escopos. Plano sem lista (ou empresa sem plano) = todos os escopos. Criar chave com escopo fora do plano é recusado no servidor (`mcp.errors.scopeNotInPlan`); na tela, o escopo aparece desabilitado com "fora do plano". Chave existente: a cada chamada da API ou do MCP, os escopos dela são cruzados com os do plano (o que saiu deixa de funcionar; volta se o plano voltar a permitir). A chave do plano vem de `private.organization_plan_key(org)` (só para a própria empresa do contexto).
4. **Uso por chave** em `api_key_usage_daily` (chave, dia em America/Sao_Paulo, superfície `api`/`mcp`, chamadas, erros). Grava só `private.record_api_key_usage(superfície, erro)`, no contexto da própria chave (principal `api_key`). Erro = resposta 400+ (inclui 403 de escopo e 429), no MCP também ferramenta com erro. 503 do interruptor e 401 de chave inválida não contam (não há chave identificada). Leitura: quem vê a chave vê o uso (RLS das chaves); a plataforma (owner, operations, support) por `private.api_key_usage_overview(desde)`. Telas: últimos 30 dias, por chave e por dia.
5. **Apps OAuth do Google** em `google_oauth_apps`: uma linha da plataforma (`partner_id` nulo) e no máximo uma por parceiro. Client ID, Client Secret cifrado (AES-256-GCM, `src/core/credentials/crypto.ts`) com cópia mascarada, situação da verificação (`testing`, `unverified`, `in_review`, `verified`, informada à mão). O `app_runtime` não tem `select` na coluna cifrada. URL de retorno só leitura: `APP_URL` + `/api/integrations/google/callback` (a mesma para o app do parceiro).
6. **Escopos do Google em cascata**: `integrations.google.scopes` (tipo "só estreita", plataforma e parceiro), padrão os três (`drive.file`, `spreadsheets`, `calendar.events`). O parceiro só desliga o que a plataforma liberou.
7. **Conexão do workspace** em `workspace_google_connections` (uma por workspace): conta, escopos concedidos (cruzados com os liberados), tokens cifrados, app usado. Owner e admin conectam, veem e desconectam; tokens só por `private.workspace_google_tokens()`. O app é o do parceiro do cliente quando existir, senão o da GUIDU (`private.google_oauth_app_for_workspace()`).
8. **Fluxo OAuth** com `fetch` direto nos endpoints do Google, sem SDK: `state` assinado (HMAC com chave derivada do `ENCRYPTION_KEY`, 10 min, com quem, workspace, app e host de origem), PKCE S256 com o verificador num cookie cifrado e httpOnly do host de origem, `access_type=offline`. O Google volta sempre ao `APP_URL`; o retorno confere o `state` e devolve ao host de origem (assinado, nunca parâmetro), onde a rota conclui com a sessão de quem começou e o cookie do mesmo navegador (CSRF). Desconectar apaga a linha e revoga o token no Google (melhor esforço). Provedor falso nos testes e no e2e (`GOOGLE_OAUTH_PROVIDER=fake`, recusado em produção).
9. **Menus.** Plataforma › Configurações: seção "API e integrações" com "API e MCP" e "Google" (gestores das configurações). Parceiro › Configurações: seção "Integrações" › "Google" (todos leem; owner e admin editam). Workspace › Configurações › Canais e integrações: "Integrações" (owner e admin). A página API e Webhooks do `/app` ganhou o uso por chave e mostra os limites do plano.
10. **Auditoria**: `platform.settings.save` (interruptores e escopos), `platform|partner.google_app.save/delete` (sem o segredo), `workspace.google.connect_start/connect/disconnect`. Exclusão do workspace (F3e) apaga a conexão; a exportação leva conta e escopos, sem tokens.

## Plano

Migration → catálogo de settings e de cotas → limites/política/uso no handler da API e no MCP → interruptor com cache → escopos na criação de chave → Google (escopos, estado, provedor real e falso, apps, conexão, rotas) → telas plataforma, parceiro e workspace → i18n 3 idiomas → testes (SQL, unidade, integração, e2e) → docs.

## Testes

SQL `tests/core/api-integrations-rls.sql`; unidade `src/core/api/limits.test.ts`, `src/core/api/switch.test.ts`, `src/core/integrations/google/google.test.ts`; integração `tests/core/api-integrations.test.ts`; e2e `e2e/api-integrations.spec.ts`.

## Decisões para o Marcelo confirmar

- O interruptor vale para a API REST e o MCP dos **workspaces**, inclusive chamadas pela sessão; a API e o MCP da plataforma ficam fora.
- Os limites vêm do plano da empresa (versão assinada), com o ambiente como padrão e o teto acima de tudo; "sem limite" não é aceito nessas três cotas. O limite por pessoa usa o plano do workspace da chamada.
- Escopos por plano guardados por **chave do plano** (não por versão): mudar a lista vale na hora para todos os assinantes; plano sem lista = todos os escopos (inclusive os que surgirem depois). Empresa sem plano: todos.
- Uso por dia no fuso de São Paulo; conta 400+ como erro; 503 do interruptor e chave inválida não contam; sem limpeza automática das linhas antigas (somem com a chave).
- A plataforma (owner, operations e support) vê o uso de todas as chaves, com nome e prefixo da chave, empresa e workspace.
- Escopos do Google liberados por padrão (os três); a situação da verificação é informada à mão (não consultamos o Google).
- A conexão e a página Integrações são só de owner e admin; os demais membros não veem a conta conectada.
- Remover o app próprio do parceiro devolve os clientes ao app da GUIDU; conexões feitas com o app do parceiro deixam de renovar e precisam ser refeitas (não migramos tokens).
- Um app Google por parceiro; a URL de retorno é sempre a do `APP_URL` (o fluxo volta ao domínio do parceiro depois).

## Estado (15/10/2026)

Implementado no worktree `wt-cf6b` (branch `claude/cf6b-api-integracoes`), migration `20261121090000_cf6b_api_integrations.sql`.
