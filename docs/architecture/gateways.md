# Plano dos gateways: APISIX e agentgateway

- **Status:** plano da [ADR 0026](../adr/0026-gateways-apisix-e-agentgateway.md), aguardando a aprovação do Marcelo. Nenhuma etapa começa sem o "pode começar".
- **Data:** 23/10/2026

## 1. Contexto

O Marcelo decidiu em 23/10/2026 colocar dois gateways no projeto: o **APISIX** na borda dos apps e o **agentgateway** na borda dos agentes. O piloto é em Búzios, com picos de turismo, e a [auditoria de segurança de borda](../auditoria/2026-10-23-seguranca-de-borda.md) registrou lacunas que a borda nova fecha.

## 2. Objetivo

Toda requisição pública passa por um gateway que é dono da rota. Os gateways limitam, filtram e registram. A autorização continua no GUIDU, e nada que funciona hoje quebra: console, API, MCP, Inbox no Matrix, streaming do Assistente e webhooks da Meta.

## 3. Quem cuida de quê

| Tráfego                                                                  | Gateway      | Upstream                     | Políticas principais                                                                                                                                           |
| ------------------------------------------------------------------------ | ------------ | ---------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Console e hosts da plataforma (`console.guidu.co`, domínios de parceiro) | APISIX       | `guidu` web                  | Limite por IP nas rotas anônimas (login, convite, páginas públicas), tamanho de corpo, métricas                                                                |
| API REST (`/api/v1/...`)                                                 | APISIX       | `guidu` web                  | Limite por IP; o limite por chave, usuário e workspace continua no app                                                                                         |
| Webhooks de canais (`/api/channels/...`)                                 | APISIX       | `guidu` web                  | Tamanho de corpo e taxa; a assinatura continua no adaptador                                                                                                    |
| Synapse (`matrix.guidu.chat`)                                            | APISIX       | `synapse`                    | `/_synapse/admin` fechado (L1), Sliding Sync sem buffer, limite de upload igual ao `max_upload_size`                                                           |
| guidu.chat (rotas de API, quando existir)                                | APISIX       | `guidu` web                  | Iguais às do console                                                                                                                                           |
| Mini-apps e Bridge API (`apps.guidu.chat`)                               | APISIX       | `guidu` web                  | Cache das páginas públicas, limite por IP e tamanho de corpo; moldura liberada só para o guidu.chat web ([ponte dos mini-apps](mini-apps-bridge.md), seção 11) |
| Páginas públicas (`*.mobio.pro`, `*.mobio.page`)                         | APISIX       | `guidu` web                  | Cache de assets, limite por IP; o ForwardAuth da CF2b continua no Traefik                                                                                      |
| MCP do workspace (`mcp.guidu.co/workspace`)                              | agentgateway | `guidu` web `/mcp/workspace` | Repasse da chave, limite, registro; Streamable HTTP sem buffer                                                                                                 |
| MCP da plataforma (`mcp.guidu.co/platform`)                              | agentgateway | `guidu` web `/mcp/platform`  | Lista de IPs (L2), limite, registro                                                                                                                            |
| Saída para LLM (OpenAI, Anthropic, Google, OpenRouter)                   | agentgateway | Provedores                   | Destinos fixos, repasse da chave do dono, timeouts, registro sem conteúdo                                                                                      |
| Saída para MCP externos (futuro)                                         | agentgateway | Servidores cadastrados       | Só destinos cadastrados pelo workspace                                                                                                                         |

Rotas que **não** saem na internet: `/_synapse/admin`, a porta de métricas e de administração dos dois gateways, Redis, bancos e o worker.

## 4. Requisitos

1. Nenhum gateway decide papel, permissão, plano, quota ou ferramenta de agente (ADR 0026, regra 2).
2. Config versionada no repositório, sem edição manual no painel.
3. Versões exatas, publicadas há pelo menos duas semanas.
4. Streaming e conexões longas funcionando: Assistente, MCP e Sliding Sync.
5. O endereço do visitante continua correto para a lista de IPs e a auditoria (`TRUSTED_PROXY_HOPS`).
6. Nenhum segredo na config: chaves, tokens e senhas por variável de ambiente.
7. Logs dos gateways sem corpo de requisição e sem cabeçalho `Authorization`.
8. O agentgateway nunca guarda chave de LLM; a chave vem do GUIDU em cada chamada.

## 5. Lógica

```
Internet ─▶ Cloudflare ─▶ Traefik (TLS, certificados, ForwardAuth)
                              ├─▶ APISIX ─▶ guidu web │ synapse
                              └─▶ agentgateway (entrada MCP) ─▶ guidu web
guidu web / worker ─▶ agentgateway (saída) ─▶ provedores de LLM │ MCP externos
```

- O Traefik escolhe o gateway pelo host: `mcp.*` vai para o agentgateway; os demais hosts públicos vão para o APISIX.
- A saída para LLM usa o `ai.base_urls` (CF6a), que já existe: cada provedor aponta para uma rota do agentgateway na rede interna. O `pinnedFetch` precisa aceitar esse destino interno: hoje ele exige https e DNS fixado. Isso é decidido na GW3, sem afrouxar a guarda para os demais destinos.
- O APISIX roda em modo standalone, com um arquivo declarativo, e usa o Redis do GUIDU com índice próprio para os contadores compartilhados.

## 6. Etapas

| Etapa   | Entrega                                                                                                                                                                                                                                                                                               | Depende de                                 |
| ------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------ |
| **GW0** | ADR 0026 e este plano                                                                                                                                                                                                                                                                                 | Aprovação do Marcelo                       |
| **GW1** | APISIX no ambiente local e no CI: config standalone em `infra/apisix/`, docker compose local, rotas do console, da API, dos webhooks e do Synapse local; teste de fumaça que passa pelo gateway (login, streaming do Assistente, webhook da Meta assinado, Sliding Sync e `/_synapse/admin` recusado) | GW0                                        |
| **GW2** | APISIX no EasyPanel de dev, atrás do Traefik: fecha L1, L3 e L7; `TRUSTED_PROXY_HOPS` ajustado e conferido na tela de segurança; guia em `docs/operacao/`                                                                                                                                             | GW1 e aprovação de infraestrutura          |
| **GW3** | agentgateway no local e no CI: config em `infra/agentgateway/`; entrada MCP (`/workspace` e `/platform` com lista de IPs) e saída para LLM pelo `ai.base_urls`, provando que a chave do dono passa sem ser guardada; teste de fumaça MCP com o SDK oficial                                            | GW0                                        |
| **GW4** | agentgateway no EasyPanel de dev, com `mcp.guidu.co` (ou o host escolhido): fecha L2; guia em `docs/operacao/mcp-conexao.md`                                                                                                                                                                          | GW3 e aprovação de infraestrutura          |
| **GW5** | Observabilidade: métricas dos dois gateways, id da requisição propagado até os logs do app, alertas somados aos da [observabilidade](../operacao/observabilidade.md)                                                                                                                                  | GW2 e GW4                                  |
| **GW6** | Teste de carga com o perfil de Búzios, passando pelos gateways (F6b)                                                                                                                                                                                                                                  | GW5                                        |
| **GW7** | OAuth na entrada MCP para conectores como o Claude Cowork                                                                                                                                                                                                                                             | Revisão da ADR 0009                        |
| **GW8** | Saída para MCP externos cadastrados pelo comerciante                                                                                                                                                                                                                                                  | Funcionalidade de cadastro de MCP externos |

GW1 e GW3 podem andar em paralelo (duas etapas por vez, `AGENTS.md`). A produção entra na F6c, com pelo menos duas instâncias de cada gateway.

## 7. Testes

- Teste de fumaça por gateway no CI, com o gateway na frente do app local (porta deslocada pelo `E2E_PORT_OFFSET`).
- Casos negativos: `/_synapse/admin` recusado, `/mcp/platform` de IP fora da lista recusado, corpo acima do limite recusado, rajada acima do limite por IP recebendo 429.
- Streaming: resposta do Assistente chega em partes pelo gateway; MCP Streamable HTTP completa uma chamada de ferramenta; Sliding Sync recebe evento novo.
- Endereço do visitante: o IP registrado na auditoria é o do cliente, não o do gateway.
- Saída de LLM: chamada pelo gateway com a chave do dono funciona, e a chave não aparece em log do gateway.

## 8. Aceite

- `pnpm typecheck && pnpm lint && pnpm test && pnpm build` verdes, e os e2e com o caminho pelo gateway verdes no CI.
- Lacunas L1, L2, L3 e L7 fechadas no dev, com evidência (requisição recusada e registro).
- Guias de operação atualizados: [dominios.md](../operacao/dominios.md), [seguranca.md](../operacao/seguranca.md), [synapse-easypanel.md](../operacao/synapse-easypanel.md), [mcp-conexao.md](../operacao/mcp-conexao.md) e [observabilidade.md](../operacao/observabilidade.md).

## 9. Perguntas para o Marcelo

1. Host público do agentgateway: `mcp.guidu.co`? O `/mcp/workspace` atual no host do console continua funcionando durante a transição ou é desligado?
2. Os domínios de parceiro e os domínios públicos dos workspaces também passam pelo APISIX desde a GW2, ou só os hosts da plataforma no começo?
3. A saída para LLM pelo agentgateway vale para todos os provedores e todas as chaves (cliente, parceiro e plataforma) ou começa só pela chave da plataforma?
4. Redis do APISIX: o mesmo serviço do GUIDU com índice próprio, ou um Redis separado?
