# Avaliação do CopilotKit Intelligence e do Channels SDK

- **Data:** 10/10/2026
- **Estado:** avaliação, sem código nem dependência adicionada.
- **Fontes lidas:** documentação em `showcase/shell-docs` e pacotes `packages/channels*` do repositório `CopilotKit/CopilotKit` (commit `04bc56aeff506d8d529fe3ebd4b1b442c49fdee5`), e o repositório `CopilotKit/channels-sdk`. O site `docs.copilotkit.ai` estava inacessível no ambiente da avaliação.
- **Relaciona-se com:** [ADR 0011](../adr/0011-camada-de-canais-no-nucleo.md) e a [especificação do módulo Agentes de IA](../modules/ai-agents/especificacao.md).

## 1. O que é

| Camada                                                          | Licença   | Papel                                                                                                                                                                                                                                                       |
| --------------------------------------------------------------- | --------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| CopilotKit (frontend React, runtime, adaptadores de frameworks) | MIT       | Copiloto dentro de uma aplicação web; fala com o agente pelo protocolo aberto AG-UI                                                                                                                                                                         |
| CopilotKit Intelligence                                         | Comercial | Threads persistidas, memória por usuário com embeddings, aprendizado de skills com revisão humana, canais Slack/Teams e analytics. Nuvem gerenciada (plano Developer grátis) ou self-host só nos planos Team Self-hosted e Enterprise, com token de licença |
| Channels SDK (`@copilotkit/channels*` 0.11.0)                   | MIT       | Núcleo de canais, vocabulário único de UI e adaptadores Slack, Teams, Discord, Telegram e WhatsApp (Meta Cloud API). Roda gerenciado pela Intelligence ou com runner próprio                                                                                |

## 2. Decisão

- **Intelligence:** não adotar. Conversas, memórias e analytics ficariam fora do nosso banco e do RLS (ADR 0001), com outro modelo de empresa e projeto, e o self-host é pago e fechado.
- **Channels SDK como camada de canais:** não adotar. Não tem Chatwoot, Evolution, Matrix nem o chat interno. Roda num processo próprio, com servidor de webhook e loop do agente internos, o que conflita com webhook no Next, eventos gravados, jobs no pg-boss e entregas idempotentes (ADRs 0002 e 0011). Cada adaptador recebe credenciais fixas, e nós precisamos de conexões por workspace vindas do cofre. Está na versão 0.x.
- **Usar como referência:** o desenho do contrato e o adaptador de WhatsApp, como descrito abaixo.

## 3. Adaptador de WhatsApp como modelo para os nossos adaptadores

Arquivos em `packages/channels-whatsapp/src` no commit citado.

| Arquivo deles                               | O que resolve                                                                                                                                                  | Método no nosso contrato (especificação §4.2) | O que muda no nosso                                                                                                                                                                                                                                                                                                                      |
| ------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `webhook-server.ts`                         | Desafio `hub.mode`/`hub.verify_token`/`hub.challenge`; leitura do corpo bruto; HMAC SHA-256 com `X-Hub-Signature-256` e `timingSafeEqual`; resposta 200 rápida | `verifyInbound`                               | Vira Route Handler por conexão, não servidor próprio. Gravar o evento com chave única **antes** do 200 (deles processa em memória depois do 200 e perde o evento se o processo cair). Limite de tamanho do corpo. Comparar o `verify_token` também em tempo constante. Segredos lidos do cofre pela conexão, não de variável de ambiente |
| `types.ts`, `interaction.ts`                | Formato do webhook e da interação (respostas de botão e lista)                                                                                                 | `normalize`, interações                       | Converter para o `InboundEvent` normalizado do núcleo, com id externo como chave de idempotência                                                                                                                                                                                                                                         |
| `client.ts`                                 | Envio de texto e interativas, recibo de leitura, upload e download de mídia pela Graph API, com versão configurável                                            | `send`, `setTyping`, `fetchMedia`             | Envio com chave de idempotência e retry no job de entrega. Erros sem corpo do provedor nas mensagens (§15)                                                                                                                                                                                                                               |
| `download-files.ts`                         | Download por id de mídia, tipo por MIME, limite por arquivo e por quantidade                                                                                   | `fetchMedia`                                  | Checar o tamanho **durante** o download (deles baixa tudo e só depois compara). Só seguir URLs de host da Meta antes de enviar o token. Verificar o tipo real do arquivo (§19). Guardar em bucket privado                                                                                                                                |
| `render/budget.ts`                          | Limites da Cloud API (4096 caracteres de texto, 3 botões, 20 caracteres por botão, 10 linhas de lista…) e truncamento seguro                                   | `capabilities` e renderização                 | Os limites viram `ChannelCapabilities` e alimentam a divisão de mensagens do plano de resposta                                                                                                                                                                                                                                           |
| `markdown-to-wa.ts`                         | Markdown para o subconjunto de formatação do WhatsApp, preservando código                                                                                      | Renderização de texto                         | Reaproveitável quase como está                                                                                                                                                                                                                                                                                                           |
| `conversation-store.ts`, `history-store.ts` | Reconstrói o histórico a cada turno (WhatsApp não tem histórico legível)                                                                                       | Não se aplica ao adaptador                    | No nosso desenho, o histórico é do módulo consumidor, nas nossas tabelas                                                                                                                                                                                                                                                                 |

### Atribuição

Copiar trechos é permitido pela licença MIT desde que o aviso de copyright e a permissão acompanhem o código copiado:

1. No topo de cada arquivo derivado: `Adaptado de CopilotKit/CopilotKit packages/channels-whatsapp/src/<arquivo> (commit <sha>), MIT, © 2026 CopilotKit`.
2. Registrar a dependência intelectual em `THIRD_PARTY_NOTICES.md` na raiz, com o texto completo da licença MIT.
3. Não importar o pacote só por esses trechos. Copiar o mínimo necessário e adaptá-lo ao nosso contrato e aos testes.

## 4. Requisitos comuns que todo adaptador nosso deve cumprir

Tirados deste estudo e da ADR 0011; entram na especificação como critérios de aceite dos adaptadores.

- Verificação de autenticidade do webhook em tempo constante, sobre o corpo bruto, com limite de tamanho.
- Evento gravado com id externo único antes da resposta ao provedor; reenvio do provedor não gera segundo turno.
- Segredos só pelo cofre, por conexão; nunca em log, erro ou DTO.
- Download de mídia restrito aos hosts do provedor, com limite aplicado durante a transferência e verificação do tipo real.
- Limites do canal declarados em `ChannelCapabilities` e aplicados na renderização.
- **Suíte de conformidade** comum (ideia do `runStateStoreConformance` deles): assinatura válida e inválida, desafio de cadastro, idempotência, mídia acima do limite, normalização de texto, áudio e interação, e renderização dentro dos limites. Cada adaptador novo só entra com a suíte verde.

## 5. Para avaliar depois

- AG-UI como formato de eventos entre o agente e o chat interno, comparado ao stream do AI SDK.
- Frontend MIT do CopilotKit para um copiloto dentro do dashboard, com aprovação humana pelas propostas da §17.4.
- Memória por contato ou workspace (texto + embedding) e aprendizado com revisão humana, como insumos da especificação do Agentes de IA.
