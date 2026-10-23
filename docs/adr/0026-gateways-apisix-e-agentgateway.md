# ADR 0026 — Borda com dois gateways: APISIX para os apps e agentgateway para os agentes

- **Status:** Proposto (etapa GW0); vira aceito com a aprovação do Marcelo no PR
- **Data:** 23/10/2026
- **Aprovador:** Marcelo
- **Decisão de origem:** decisão do Marcelo em 23/10/2026 ("vamos trazer o APISIX e o Agentgateway para o projeto, cada um cuidando da sua parte"), depois da [análise da proposta de infraestrutura](../architecture/analise-proposta-infra-2026-10-22.md), da [análise do Kong](../architecture/analise-kong-2026-10-23.md) e da [auditoria de segurança de borda](../auditoria/2026-10-23-seguranca-de-borda.md).
- **Plano:** [gateways.md](../architecture/gateways.md)
- **Relaciona-se com:** [ADR 0009](0009-autenticacao-mcp-chaves-api.md) (MCP por chaves), [ADR 0011](0011-camada-de-canais-no-nucleo.md) (canais), [ADR 0017](0017-sdk-dos-agentes-de-ia.md) (motor), [ADR 0018](0018-configuracoes-em-cascata.md) (cascata, `ai.base_urls`), [ADR 0023](0023-chat-interno-como-cliente-matrix.md) (Matrix). Os números 0024 e 0025 estão reservados para as salas de agentes e a compra agêntica ([agentes-na-matrix-e-compra-agentica.md](../architecture/agentes-na-matrix-e-compra-agentica.md), seção 9).

## Contexto

O piloto é em Búzios, com picos fortes de turismo. A borda hoje é Cloudflare (DNS) e o Traefik do EasyPanel, e as proteções de borda estão espalhadas entre o Traefik e o app. A auditoria de 23/10/2026 registrou oito lacunas, entre elas a API admin do Synapse exposta (L1), o `/mcp/platform` sem restrição de IP (L2), a falta de limite por IP antes da autenticação (L3) e de limite de tamanho de corpo (L7).

A proposta de 22/10/2026 previa Kong para os apps e Agentgateway para os agentes. O Kong saiu: a linha aberta parou na 3.9, e da 3.10 em diante ele exige licença. O Apache APISIX ocupa o lugar dele, com o mesmo modelo de plugins e OIDC, limites com Redis e plugins de IA abertos (Apache-2.0, Apache Software Foundation). O agentgateway (Apache-2.0, Linux Foundation) entende o protocolo MCP, as chamadas de LLM e o A2A.

## Decisão

1. **Dois gateways, cada um com a sua borda.**
   - **APISIX: borda dos apps.** Tráfego de navegador, app e webhook: console (`console.guidu.co` e hosts da plataforma), API REST, rotas do guidu.chat, Synapse (`matrix.guidu.chat`), webhooks de canais e, depois, as rotas públicas de comércio.
   - **agentgateway: borda dos agentes.** Entrada de clientes MCP externos (`/mcp/workspace` e `/mcp/platform`), saída do motor para os provedores de LLM e, quando existir, saída para servidores MCP externos cadastrados pelo comerciante.
   - Uma rota pertence a um gateway só. Um gateway nunca encaminha para o outro.
2. **Nenhum gateway decide permissão dentro do workspace.** Papel, permissão, módulo, plano, quota e quais ferramentas um agente usa continuam no GUIDU (`withContext`, RLS, `requireWorkspacePermission`, `decideTool`, escopos das chaves). Os gateways autenticam o transporte quando isso cabe a eles, limitam, filtram rotas e destinos e registram. O app revalida tudo como hoje: uma requisição que contornar o gateway continua barrada no app.
3. **APISIX: o que ele faz.**
   - Limite por IP e por rota antes da autenticação, com contadores no Redis compartilhados entre instâncias (L3).
   - Bloqueio de `/_synapse/admin` na internet (L1) e lista de IPs nas rotas administrativas.
   - Limite de tamanho de corpo por rota, com exceção para upload de mídia (L7).
   - Health check dos upstreams pelas probes `/api/health/ready` e balanceamento entre réplicas do web.
   - Métricas Prometheus e propagação do id da requisição (OpenTelemetry), ligadas aos logs do app (`requestId`).
   - **Não** valida a sessão do console: o console autentica pelo cookie SSR do Supabase, no app.
4. **agentgateway: o que ele faz.**
   - **Entrada MCP:** um endereço próprio (`mcp.guidu.co`, a confirmar) para `/workspace` e `/platform`. No `/platform`, lista de IPs (L2). Repassa as chaves `gdu_live_` ao GUIDU sem validá-las nem guardá-las (ADR 0009 continua valendo). O OAuth para conectores como o Claude Cowork entra aqui depois da revisão da ADR 0009, numa ADR própria.
   - **Saída para LLM:** o `ai.base_urls` da CF6a aponta cada provedor para o agentgateway. A chave continua sendo a do dono (cliente, parceiro ou plataforma), decifrada pelo GUIDU a cada turno e repassada na chamada. O gateway não guarda chave nem tem chave própria. O consumo e o custo por workspace continuam em `ai_usage_events`. Transcrição e voz seguem direto ao provedor, como hoje.
   - **Saída para MCP externos:** quando existir o cadastro de MCP externos pelo comerciante, o gateway só deixa sair para servidores cadastrados por aquele workspace. A escolha de ferramentas por agente fica no motor. A política por ferramenta do agentgateway (`mcpAuthorization`) pode ser usada como segunda barreira, nunca como a única.
   - Não usamos A2A: a delegação entre agentes é interna (GF2).
5. **Topologia.** Os dois gateways rodam no mesmo projeto do EasyPanel que o GUIDU, na rede interna, com pelo menos duas instâncias cada em produção. O Traefik do EasyPanel continua dono do TLS e dos certificados (curinga por DNS-01, Cloudflare for SaaS para domínios de parceiro, ForwardAuth da CF2b) e encaminha cada host para o gateway dono dele. Web, worker, Synapse, Redis e bancos não publicam porta na internet.
6. **Configuração versionada.** As duas configurações vivem no repositório: APISIX em modo standalone (YAML, sem etcd) e agentgateway por arquivo. Nada é configurado à mão no painel. Segredos entram por variável de ambiente.
7. **Versões fixadas e atualização de segurança.** Cada gateway usa versão exata, publicada há pelo menos duas semanas, como toda dependência do projeto. Avisos de segurança dos dois projetos entram na rotina da F6a. Uma versão maior nova exige revisar esta ADR.
8. **Conexões longas.** Rotas com streaming (Assistente, MCP Streamable HTTP, Sliding Sync do Matrix) ficam sem buffer e com timeouts longos nos dois gateways e no Traefik.
9. **Endereço do visitante.** Com o gateway entre o Traefik e o app, o `TRUSTED_PROXY_HOPS` sobe um salto e a lista de proxies confiáveis passa a incluir o gateway (ver [seguranca.md](../operacao/seguranca.md)).

## Alterações em outras ADRs

| ADR               | O que muda                                                                                                                                                                                                                               |
| ----------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **0017** (motor)  | Regra 2: em vez de "não há gateway intermediário", as chamadas de texto aos provedores passam pelo agentgateway quando o `ai.base_urls` aponta para ele. A chave continua sendo do dono, decifrada por turno; o gateway não guarda chave |
| **0009** (MCP)    | Sem mudança na autenticação. O MCP passa a ter um endereço público próprio, servido pelo agentgateway                                                                                                                                    |
| **0023** (Matrix) | O Synapse fica atrás do APISIX, com `/_synapse/admin` fechado para a internet; o núcleo acessa a API admin pela rede interna                                                                                                             |
| **0011** (canais) | Os webhooks de canais entram pelo APISIX, com limite de tamanho e de taxa; a verificação de assinatura continua no adaptador                                                                                                             |

## Alternativas avaliadas

| Alternativa                     | Por que não                                                                                                                                        |
| ------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| Kong OSS 3.9                    | Linha aberta sem novas versões; da 3.10 em diante exige licença                                                                                    |
| Kong Enterprise ou Konnect      | Custo de licença sem ganho que justifique no piloto                                                                                                |
| Só Traefik e Cloudflare         | Fecha as lacunas de agora, mas não traz limite compartilhado, OIDC nem plugins de IA quando a borda crescer                                        |
| Só APISIX nas duas bordas       | Não entende MCP por ferramenta, não junta servidores MCP e não faz A2A; a separação também limita o estrago de um erro de configuração a uma borda |
| Só agentgateway nas duas bordas | Feito para tráfego de agentes, não para a borda de navegador, webhooks e Synapse                                                                   |

## Consequências

- Mais dois serviços para operar, com config, atualização, métricas e backup da config. Isso é compensado pela config versionada e por um conjunto pequeno de plugins.
- Fecha as lacunas L1, L2, L3 e L7 da auditoria. L4 (proxy do Cloudflare), L5 (login por senha do Synapse), L6 (portas e firewall do host) e L8 (backup do Synapse) continuam com as suas próprias correções.
- Os e2e ganham um caminho pelo gateway (streaming, MCP, webhook da Meta e Matrix) para provar que nada quebra com mais um salto.
- O Redis passa a ser usado também pelo APISIX, com índice próprio.
- Em produção, a borda faz parte da ADR de produção (F6c).
