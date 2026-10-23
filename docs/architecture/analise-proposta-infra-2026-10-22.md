# Análise da proposta de reorganização da estrutura tecnológica

- **Status:** análise para discussão. Nada aqui foi decidido.
- **Data:** 23/10/2026
- **Base:** proposta de 22/10/2026 (Kong, Agentgateway, Vendure, identidade no Supabase), comparada com as ADRs, os planos e o código da `main`.

As ADRs são a referência do que está decidido e implementado, não regra imutável (`AGENTS.md`). Por isso, onde a proposta contraria uma ADR, esta análise diz qual ADR mudaria, o que já foi construído sobre ela e o que se ganha com a troca. A decisão é do Marcelo.

## 1. Resumo

Os seis princípios da proposta já estão no projeto. As diferenças estão nos componentes novos:

| Componente | Situação |
| --- | --- |
| Vendure para o Portfólio | Revisaria o Portfólio da F5 e a CA1. É a mudança mais cara |
| OAuth do Supabase para o MCP | Revisaria a ADR 0009 |
| OIDC no Synapse | Revisaria a regra 9 da ADR 0023 |
| WhatsApp por bridge | Revisaria a regra 11 da ADR 0023 e a IN7a |
| Agentgateway na saída para os LLMs | Revisaria a regra 2 da ADR 0017. A CF6a já deixou isso possível |
| Kong | Ainda não há ADR de produção (F6c); afeta os domínios da CF2b e da CF2c |

## 2. Onde a proposta confirma o que já existe

| Proposta | Onde já está |
| --- | --- |
| Uma regra de permissão só, no GUIDU | `withContext`, RLS e `requireWorkspacePermission` ([permissoes.md](permissoes.md), ADR 0001) |
| Um motor de IA só, no processo | ADR 0017; só `src/core/ai/` importa o SDK |
| Ferramentas internas sem salto de rede | `AGENT_TOOLS` em `src/core/ai/config/tools.ts` |
| Matrix como fonte da verdade; console e guidu.chat como clientes | ADR 0023, regras 1 e 5 |
| Escrita vira proposta; liberação por tipo de ação | ADR 0019, regra 7 ("automático é uma proposta aprovada pela regra") |
| Descartar o mcp-go | [AVALIACAO.md](../mcp/AVALIACAO.md). Policy check (`allow`, `deny`, `restrict`), `execution_id` e SHA-256 de entrada e saída já estão em `src/core/ai/tools/guard.ts` |
| Supabase próprio, separado do CartãoPRO | ADR 0007; o dev deste repositório é o `console-guidu` (ADR 0010) |
| Delegação interna, sem A2A | GF2: ferramentas `delegate` e `return_to_reception` |

## 3. Pontos que exigiriam revisar ADRs ou planos

| Sugestão | Estado atual | O que mudaria | Custo e risco |
| --- | --- | --- | --- |
| **Portfólio no Vendure (Admin API)** | Portfólio no Supabase (migrations `f5a_portfolio` e `f5d_portfolio_scopes`), no formato UCP, com variante obrigatória e lodging (F5c). MCP com `search_catalog`, `lookup_catalog` e `get_product`. A CA1 prevê carrinho e pedido no núcleo; a regra 2.2 da [compra agêntica](agentes-na-matrix-e-compra-agentica.md) diz "o que vale é o banco" | Plano da F5, CA1 e a regra 2.2 | Migração do Portfólio, segundo banco e um segundo modelo de acesso (channels e papéis do Vendure). A Shop API pública faria o Vendure decidir o acesso a carrinho e pedido, o que contraria o princípio 1 da própria proposta. Ganho: carrinho, pedido, promoções e fluxos de comércio prontos |
| **Supabase OAuth 2.1 para o Claude Cowork + claim `workspace_id`** | A ADR 0009 descartou o Supabase OAuth Server como emissor do MCP: o token é uma sessão completa do Supabase, sem escopos próprios, sem revogação e sem introspecção. Prevê um servidor OAuth próprio no futuro. O [spike](../spikes/mcp-oauth.md) propôs a tabela `mcp_grants` e nenhum RLS lendo claim do JWT | ADR 0009 | O claim fica velho quando o usuário tem vários workspaces ou perde o vínculo. Alternativa: OAuth do Supabase só para login, com a concessão em `mcp_grants`, como o spike recomendou. Ganho: o Claude Cowork e outros conectores web passam a se conectar |
| **Login no Synapse por OIDC do Supabase** | ADR 0023, regra 9: login por JWT RS256 assinado pelo console (`src/core/matrix/jwt.ts`, `jwt_config`), implementado e testado | ADR 0023, regra 9 | Troca um mecanismo que funciona por um recurso em beta. Ganho só se o guidu.chat precisar de login direto no Synapse sem passar pelo console |
| **WhatsApp por bridge** | ADR 0023, regra 11, e [IN7a](../modules/inbox/whatsapp-meta.md): adaptador Meta Cloud API no núcleo, com contato como usuário virtual `@_guidu_c_…` | ADR 0023, regra 11 | Refazer a IN7. A preocupação com o MAS por causa do bridge deixa de existir se o adaptador continuar |
| **Agentgateway na saída para os LLMs** | ADR 0017, regra 2: "não há gateway intermediário". A CF6a criou `ai.base_urls`, um gateway por provedor só na plataforma (`src/core/ai/catalog.ts`), para conversa e teste de chave. O custo por workspace já está em `ai_usage_events` e no Painel de IA | ADR 0017, regra 2 (formalizar o que a CF6a já permite) | As chaves dos clientes (BYOK) atravessam mais um serviço. Transcrição e voz continuam direto no provedor |
| **Agentgateway na entrada e na saída MCP** | `/mcp/workspace` e `/mcp/platform` com chaves `gdu_live_` e limites em Redis. Ainda não há MCP externo cadastrado pelo comerciante | Nova ADR | Faz sentido quando houver MCP externo por workspace (lista de saída permitida) |
| **BotCompara e Shopper; "guidu" como único participante visível** | botmercado (guidu.bot) fechando com o GUIDS vendedor de cada loja numa sala de negócio; consumidor pelo WhatsApp; `@guidu` é o assistente da plataforma; "uma persona por lado". Compra agêntica em espera desde 19/10 | Documento de compra agêntica (ADR 0025 proposta) | Alinhar nomes e decidir se o comprador fala pelo guidu.chat, pelo WhatsApp ou pelos dois. O modelo de pagamento (3.5.2) segue aberto. "BegooPay" não aparece nos documentos |
| **Kong na frente de console.guidu.co** | Domínios personalizados e de parceiro com Traefik, Cloudflare for SaaS e ForwardAuth `/api/domains/check` (CF2b e CF2c). Produção planejada no Coolify (F6c). Rate limit em Redis por chave, usuário e workspace | ADR de produção (F6c, ainda não escrita) e os guias de domínios | Dois proxies em série; certificados e hosts dos parceiros precisariam passar pelo Kong. O console autentica por cookie SSR, não por cabeçalho |

## 4. Imprecisões técnicas

- **Kong OSS com JWKS:** ao que tudo indica, o plugin `jwt` da versão OSS não busca JWKS e exige a chave pública cadastrada numa credencial; quem busca JWKS é o `openid-connect`, que é Enterprise. Falta confirmar na documentação do Kong. Se for isso, a rotação de chaves do Supabase vira tarefa manual.
- **"Redis com BullMQ depois":** o GUIDU já usa Redis (rate limit e cache de domínios) e o pg-boss para jobs (ADR 0002). O BullMQ seria só do Vendure: mais um sistema de fila.
- **Rotas:** a superfície interna do MCP é `/mcp/platform` (a ADR 0009 ainda fala em `/mcp/admin`).
- **Synapse e `/sync`:** o Inbox usa Sliding Sync (ADR 0023, regra 10), e o Synapse de dev está no EasyPanel sem Kong.

## 5. Checklist da proposta, respondido pelo repositório

| Item | Resposta |
| --- | --- |
| Nenhuma ferramenta do motor aprova ou executa proposta | Sim. O motor só tem `propose_operation`; o MCP tem `propose_operation` e `get_proposal` |
| Aprovação exige sessão humana | Sim. `approveProposalAction` chama `requireUser()` (`src/core/proposals/actions.ts`) |
| Como o motor registra ferramentas | Catálogo fixo por tipo (`assistant`, `guid` e `specialist` da ADR 0019), allowlist por agente e `decideTool`. Separar BotCompara e Shopper por conjunto de ferramentas cabe nesse modelo |
| SDK, provedor e URL base | AI SDK com OpenAI, Anthropic, Google e OpenRouter; URL base por `ai.base_urls` |
| A2/A2b | Policy check, `execution_id` e spans com hash implementados |
| `/mcp/workspace` aceita OAuth | Não, só chaves `gdu_live_` (ADR 0009) |
| Supabase do GUIDU | Próprio; dev `console-guidu`; produção pendente (F6c) |
| Onde fica o portfólio | Supabase, tabelas da F5, formato UCP |
| Como o guidu.chat autentica | O app ainda não existe; o Element faz o papel dele nos testes. Plano: JWT do console e telefone verificado pelo canal |
| Synapse no ar | Dev no EasyPanel, com `jwt_config` e Application Service. Produção: `server_name` `guidu.chat` |
| Bridge e Inbox | Sem bridge; adaptador Meta (IN7a) e Inbox (IN4 a IN7) prontos |
| Kong, recursos do servidor, backup, pagamento | Sem registro nos documentos. [backup-restore.md](../operacao/backup-restore.md) não cobre Synapse nem Vendure. O modelo de pagamento continua aberto |

## 6. Recomendações

1. **Vendure:** decidir na CA0, junto com o modelo de pagamento e marketplace. Se entrar, a sugestão é como motor de carrinho, pedido e repasse, com o Portfólio continuando a fonte do catálogo, ou com uma migração planejada do Portfólio. Em qualquer caso, o GUIDU chama o Vendure e continua decidindo o acesso.
2. **OIDC no Synapse e bridge:** só trocar se aparecer um ganho concreto em relação ao JWT e ao adaptador Meta, que já funcionam.
3. **OAuth do MCP para o Claude Cowork:** abrir uma ADR que revise a 0009, escolhendo entre o caminho do spike (`mcp_grants`) e o servidor OAuth próprio. Isso vem antes do Agentgateway na entrada.
4. **Agentgateway:** a saída para os LLMs já tem ponto de configuração (`ai.base_urls`). O gateway passa a ser útil com MCP externo por workspace.
5. **Kong:** decidir na ADR de produção (F6c), junto com Coolify ou EasyPanel e o lugar do Traefik e do Cloudflare for SaaS.
6. **Nomes dos agentes:** alinhar BotCompara ↔ botmercado e Shopper ↔ GUIDS vendedor com o documento de compra agêntica, e manter a ordem P1 a P3 de 19/10.
7. **Ordem de implementação:** a etapa "Identidade" não bloqueia nada, porque o Supabase próprio já existe. O bloqueio real é a decisão de pagamento e marketplace (CA0), que também decide o Vendure.
