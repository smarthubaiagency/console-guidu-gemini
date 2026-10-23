# Kong no GUIDU: análise para o piloto de Búzios

- **Status:** análise para discussão. Nada aqui foi decidido.
- **Data:** 23/10/2026
- **Base:** [análise da proposta de infraestrutura](analise-proposta-infra-2026-10-22.md), guias de operação (`docs/operacao/`), código da `main` e pesquisa pública sobre o Kong (fontes na seção 9).

## 1. Pergunta

Búzios é pequena e recebe muito turista. O volume sobe muito em réveillon, carnaval, feriados e alta temporada, e cai fora deles. A estrutura precisa aguentar esses picos e ficar no ar. A pergunta é quanto o Kong contribui para isso e o que ele custa.

## 2. Resposta curta

1. **O Kong não é o que garante pico nem alta disponibilidade no GUIDU.** Os pontos que caem primeiro num pico estão atrás de qualquer gateway: servidor único, conexões do Postgres, Synapse, worker e limites dos provedores de IA (seção 4). Um gateway na frente não resolve nenhum deles.
2. **O que o Kong OSS faz na borda, o projeto já tem ou consegue com o que já usa:** Cloudflare (DDoS, WAF, cache e regras de limite), Traefik do EasyPanel (roteamento, TLS, balanceamento e health check) e o rate limit da aplicação por chave, usuário e workspace, conforme o plano.
3. **O risco do Kong mudou em 2025–2026.** A linha open source parou na 3.9. A partir da 3.10, rodar sem licença equivale a uma licença Enterprise expirada, e não saíram mais imagens OSS no Docker Hub. O próprio Supabase trocou o Kong pelo Envoy como gateway padrão do self-hosted em agosto de 2026, com o argumento de que a linha OSS não é mais mantida. Adotar o Kong hoje é escolher entre **Enterprise (pago)** e **uma versão congelada na borda**, que deixa de receber correções.
4. **Recomendação:** não colocar um gateway de API no piloto. Investir em alta disponibilidade onde ela falta (seção 7) e definir agora o critério que faz um gateway entrar (seção 8). Quando esse critério for atingido, comparar Kong Enterprise/Konnect, Apache APISIX e Envoy Gateway.

## 3. Perfil de carga em Búzios

| Público | Volume | Como chega | Sensível a |
| --- | --- | --- | --- |
| Turistas | Alto e com picos fortes, previsíveis pelo calendário | WhatsApp (webhook da Meta) e, depois, guidu.chat e mini-apps | Tempo de resposta do agente, disponibilidade do checkout |
| Comerciantes e equipes | Baixo a médio (dezenas a centenas de lojas) | Console (console.guidu.co e domínios de parceiro), Inbox no Matrix | Inbox em tempo real, aprovação de propostas |
| Agentes e integrações | Baixo hoje | MCP (`/mcp/workspace`) e API com chaves `gdu_live_` | Limites por chave |
| Páginas públicas | Médio, com picos junto do turismo | Perfil digital e sites (`*.mobio.pro`, `*.mobio.page`) | Cache e CDN |

Duas consequências:

- **O pico é previsível.** Dá para escalar antes da data (réveillon e carnaval) em vez de depender de escala automática.
- **O tráfego mais pesado vem por webhook e pelo motor de IA, não por chamadas de API de terceiros.** Esse é o tipo de tráfego em que um gateway de API mais agrega (muitos consumidores externos, chaves, cotas, monetização), e ele não é o nosso caso no piloto.

## 4. O que quebra primeiro num pico

Ordem estimada de risco, do mais provável ao menos provável:

| # | Ponto | Por que quebra | Gateway resolve? | O que resolve |
| --- | --- | --- | --- | --- |
| 1 | **Servidor único do EasyPanel** | Synapse, web, worker e Redis no mesmo host: uma falha de disco, rede ou memória derruba tudo | Não. O gateway roda no mesmo host e vira mais um ponto único | Dois ou mais hosts, ou serviços críticos fora do host (banco gerenciado, Synapse separado) |
| 2 | **Conexões e CPU do Postgres (Supabase)** | Cada instância web e cada worker abre conexões pelo Supavisor; turnos de IA abrem transações longas (pendência "Synapse dentro da transação") | Não | Tamanho de compute do Supabase para o pico, pool dimensionado, transações curtas |
| 3 | **Synapse** | Processo Python único por padrão; Sliding Sync e mídia pesam; tem Postgres próprio | Não | Workers do Synapse (sync, client reader, media), banco próprio dimensionado, plano de escala já previsto na ADR 0023 |
| 4 | **Worker (pg-boss) e motor de IA** | Concorrência 1 por conversa (ADR 0011), latência do modelo de segundos; fila cresce no pico | Não | Mais instâncias do worker (a trava por workspace já foi provada com dois workers, F3a), alertas de fila (observabilidade) |
| 5 | **Limites dos provedores de IA** | Chaves dos clientes (BYOK) com cota baixa recebem 429 no pico | Pouco. Um gateway de IA pode distribuir chamadas, mas a chave é do cliente | Chave reserva (já existe), modelo mais barato no orquestrador, aviso de chave (já existe no Painel de IA) |
| 6 | **Webhook da Meta** | Rajada de mensagens | Pouco | Já tratado: o webhook só confere, grava e enfileira (ADR 0011) |
| 7 | **Instâncias web (Next.js)** | SSR e streaming do Assistente | Em parte: balanceia entre réplicas | O Traefik já balanceia e faz health check; basta ter réplicas e usar `/api/health/ready` |
| 8 | **Ataque ou abuso** | Robôs, varredura, DDoS | Em parte: limite por IP e por rota | Cloudflare na frente (DDoS volumétrico, WAF, bot management); rate limit da aplicação |

## 5. O que o Kong OSS entrega e o que já temos

| Capacidade | Kong OSS (até 3.9) | O que o GUIDU já tem ou pode usar |
| --- | --- | --- |
| Roteamento e TLS | Sim | Traefik do EasyPanel; TLS curinga por DNS-01 e Cloudflare for SaaS para domínios de parceiro (CF2b, CF2c) |
| Balanceamento e health check | Sim (ativo e passivo) | Traefik com réplicas e health check; probes `/api/health/live` e `/api/health/ready` (F3d) |
| Rate limit | Sim, janela fixa, contadores em Redis para vários nós. Janela deslizante é do `rate-limiting-advanced`, Enterprise | Rate limit por chave, usuário e workspace, com limites do plano e Postgres como reserva se o Redis falhar (`src/core/api/rate-limit.ts`). Regras de limite do Cloudflare por IP e rota |
| Proteção DDoS e WAF | Não (limite por IP não segura ataque volumétrico) | Cloudflare |
| Cache | `proxy-cache` em memória por nó | Cloudflare CDN para assets e páginas públicas |
| Validação de JWT | Plugin `jwt` com chave cadastrada no consumer, sem buscar JWKS; JWKS e OIDC completos são Enterprise | O console autentica pela sessão SSR do Supabase; API e MCP por chave `gdu_live_`; a autorização fica no app de qualquer forma (princípio 1 da proposta) |
| Métricas e tracing | Plugins Prometheus e OpenTelemetry | Logs estruturados com `requestId` (F3d); métricas da fila; falta exportação para um coletor (F6c) |
| Portal do desenvolvedor, monetização, analytics de API | Enterprise / Konnect | Não há necessidade no piloto |

O ganho real do Kong OSS sobre o que existe seria a **métrica de borda unificada** (latência e erros por rota) e o **limite por IP antes do Next.js**. As duas coisas também se conseguem com o Traefik (métricas Prometheus nativas) e com o Cloudflare.

## 6. Custos e riscos de colocar o Kong agora

1. **Licença e manutenção.** A linha OSS parou na 3.9.x. Da 3.10 em diante, sem licença, o Kong se comporta como Enterprise expirado, e as imagens OSS não foram mais publicadas. Ficar na 3.9 é aceitar uma borda pública sem atualizações. Isso contraria a regra do projeto de dependências fixadas e auditadas (F6a).
2. **O Supabase saiu do Kong.** O self-hosted do Supabase trocou o Kong pelo Envoy como gateway padrão (aviso de 17/07/2026, troca na semana de 09/08/2026), citando a falta de manutenção da linha OSS. A proposta original pensava em Supabase self-hosted com Auth e Kong; esse caminho já não usa o Kong.
3. **Ponto único a mais.** Para não piorar a disponibilidade, o Kong precisa de pelo menos dois nós e de um balanceador ou DNS na frente. Num servidor só, ele só acrescenta um processo que pode cair.
4. **Dois proxies em série.** O EasyPanel já usa o Traefik. O Kong ficaria atrás do Traefik (dois saltos, duas configurações de TLS e timeout) ou no lugar dele. Neste caso seria preciso refazer certificados curinga, Cloudflare for SaaS e o ForwardAuth dos domínios de parceiro.
5. **Conexões longas.** O streaming do Assistente, o MCP com Streamable HTTP e o Sliding Sync do Matrix exigem buffer desligado e timeouts longos em cada proxy. Cada camada a mais é mais um lugar para errar essa configuração.
6. **Operação.** Mais um serviço com banco ou config declarativa, plugins e atualização, para uma equipe pequena e num piloto.

## 7. O que dá alta disponibilidade e aguenta pico no piloto

Em ordem de impacto:

1. **Tirar o ponto único.** Pelo menos dois hosts para os serviços de aplicação, ou web e worker num provedor com réplicas. A F6c já prevê Coolify com web, worker e Redis; decidir isso na ADR de produção.
2. **Banco gerenciado dimensionado para o pico.** Supabase com compute e pool calculados no teste de carga, PITR ligado e prova de restore (F6d).
3. **Synapse com workers e banco próprio**, em host separado do web. Backup do banco e da mídia, que hoje não está no [backup-restore.md](../operacao/backup-restore.md).
4. **Cloudflare na frente** do console, do guidu.chat e das páginas públicas, com WAF, regras de limite e cache de assets. Os domínios padrão hoje estão sem proxy (nuvem cinza) por causa do certificado curinga de dois níveis. Para ligar o proxy é preciso o Advanced Certificate Manager, como o próprio guia já indica.
5. **Réplicas web e worker** atrás do Traefik, com health check em `/api/health/ready`. O web é sem estado, e o worker escala com a trava por workspace já testada.
6. **Teste de carga com o perfil de Búzios** (F6b): rajada de webhooks da Meta, turnos de IA simultâneos, Inbox com muitas salas e checkout. Registrar os limites medidos.
7. **Plano de pico por calendário:** escalar antes do réveillon e do carnaval, alertas da F3d ligados e um runbook de degradação. Exemplo de degradação: se a fila passar de X minutos, o orquestrador responde só com a mensagem de espera e transfere para a equipe.
8. **IA resiliente:** a chave reserva já existe; somar fallback de modelo e orçamento por workspace no pico.

## 8. Quando um gateway de API passa a valer a pena

Um gateway entra quando pelo menos um destes critérios for verdadeiro:

| Critério | Exemplo no roadmap |
| --- | --- |
| Muitos consumidores externos de API, com chaves, cotas e planos próprios | `/commerce` aberto a agentes externos (UCP), API para parceiros |
| Vários serviços de backend atrás do mesmo domínio | Vendure, Synapse e GUIDU expostos juntos (proposta de 22/10) |
| OAuth e OIDC padronizados na borda para vários serviços | Claude Cowork e outros conectores, depois da revisão da ADR 0009 |
| Necessidade de portal do desenvolvedor e analytics por consumidor | Ecossistema de parceiros integrando por API |
| Tráfego de agentes em grande volume, com política de saída | Agentes do comerciante chamando MCP externos |

Nessa hora, comparar:

| Opção | Licença | Pontos a favor | Pontos contra |
| --- | --- | --- | --- |
| **Kong Enterprise / Konnect** | Comercial | Produto maduro, OIDC, rate limit avançado, portal, plugins de IA | Custo de licença; dependência do fornecedor |
| **Kong OSS 3.9** | Apache-2.0, congelado | Gratuito, conhecido | Sem atualizações; a 3.10+ exige licença |
| **Apache APISIX** | Apache-2.0, ativo | Plugins de OIDC e rate limit com Redis na versão aberta; configuração dinâmica | Comunidade menor no Brasil; outro sistema para aprender |
| **Envoy Gateway** | Apache-2.0, ativo (CNCF) | Escolha do Supabase self-hosted; padrão Gateway API | Pensado para Kubernetes; mais complexo fora dele |
| **Traefik (já usado)** | MIT | Já está no EasyPanel; middlewares de limite, ForwardAuth e métricas | Gestão de API completa só no Traefik Hub, pago |

Antes de escolher, confirmar nas fontes oficiais de cada projeto a lista de recursos abertos da versão vigente.

## 9. Fontes

- Supabase, changelog: [Self-hosted Supabase: Envoy becomes the default API gateway (breaking change)](https://supabase.com/changelog/48048-self-hosted-supabase-envoy-becomes-the-default-api-gateway-b)
- Kong, discussão no GitHub sobre a imagem OSS da 3.10: [Kong/kong#14405](https://github.com/Kong/kong/discussions/14405)
- Kong, discussão sobre Enterprise sem licença e OSS: [Kong/kong#14628](https://github.com/Kong/kong/discussions/14628)
- Fórum do Kong: [Is opensource support for Kong ceased](https://discuss.konghq.com/t/is-opensource-support-for-kong-ceased/13529) e [KIC Helm charts don't upgrade Gateway above version 3.9](https://discuss.konghq.com/t/kic-helm-charts-dont-upgrade-gateway-above-version-3-9/13895)
- Kong, breaking changes da 3.10: [docs.konghq.com/gateway/3.10.x/breaking-changes](https://docs.konghq.com/gateway/3.10.x/breaking-changes)
- Docker Hardened Images, versões do Kong depois da 3.9: [catalog#591](https://github.com/docker-hardened-images/catalog/issues/591)
- Kong, rate limiting com Redis: [docs.konghq.com — redis rate limiting](https://docs.konghq.com/kubernetes-ingress-controller/2.8.x/guides/redis-rate-limiting)

Os pontos sobre a 3.10 (fim do modo gratuito e das imagens OSS) vêm do changelog do Supabase e de discussões da comunidade. A página oficial de breaking changes do Kong não pôde ser aberta neste ambiente e deve ser conferida antes da decisão.
