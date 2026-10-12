# ADR 0017 — AI SDK como motor dos agentes de IA

- **Status:** Proposto (etapa A0); vira aceito com a aprovação do Marcelo no PR
- **Data:** 12/10/2026
- **Aprovador:** Marcelo
- **Decisão de origem:** D-AG-02 da [especificação do módulo Agentes de IA](../modules/ai-agents/especificacao.md)
- **Relaciona-se com:** [ADR 0001](0001-prisma-como-caminho-unico.md), [ADR 0002](0002-jobs-e-hospedagem.md), [ADR 0011](0011-camada-de-canais-no-nucleo.md); Especificação §16 e §17

## Contexto

No legado, o motor do agente era o **n8n**. O app só configurava; o n8n recebia a conversa, renderizava o prompt (uma segunda cópia do render do app), chamava o modelo por um sub-workflow clonado por cliente e por provedor, e aplicava a allowlist de ferramentas num Code node. Isso trouxe os problemas listados no handoff: provisionamento frágil, prompt de teste divergindo do de produção e uma ferramenta nova exigindo mudança em dois lugares.

No GUIDU, o motor roda dentro da plataforma (especificação, seção 7) e precisa de:

- **vários provedores com a chave de cada dono**: cliente, parceiro e a chave de backup da plataforma (OpenAI, Anthropic, Gemini e OpenRouter);
- laço de ferramentas com allowlist e aprovação, saída estruturada com Zod e streaming para o Assistente na gaveta;
- transcrição e voz para os GUIDS e embeddings para a base de conhecimento;
- estado e durabilidade nas nossas tabelas e no pg-boss, não num runtime de terceiros.

## Decisão

1. **O motor usa o AI SDK** (pacote `ai`, licença Apache-2.0, versão 7), com os provedores oficiais `@ai-sdk/openai`, `@ai-sdk/anthropic` e `@ai-sdk/google`, e o provedor do OpenRouter para o AI SDK. As versões exatas entram na etapa A2, com pelo menos duas semanas de publicação, como toda dependência do projeto.
2. **Provedor por chamada.** O provedor é criado a cada turno com a chave decifrada no servidor pela política de chaves (especificação, seção 9), e descartado no fim. Não há gateway intermediário nem chave em variável de ambiente, exceto a chave de backup da plataforma, que fica no cofre da plataforma.
3. **O SDK é biblioteca, não runtime.** Conversas, turnos, consumo e retomada ficam nas tabelas do GUIDU e nos jobs do pg-boss (ADR 0002). O turno dos GUIDS roda no worker; o do Assistente roda na requisição, com streaming.
4. **O SDK fica atrás do motor.** Só `src/core/ai/` importa `ai` e os provedores. Módulos e telas usam a interface do motor, então trocar o SDK no futuro não mexe nos módulos.
5. **O `@anthropic-ai/sdk` continua** só na tradução automática (I6), que já funciona e não precisa de vários provedores.

## Alternativas avaliadas

| Alternativa               | Por que não                                                                                           |
| ------------------------- | ----------------------------------------------------------------------------------------------------- |
| **n8n** (legado)          | Motor fora da plataforma, provisionamento por cliente, render duplicado; é o que estamos substituindo |
| **SDKs de cada provedor** | Quatro integrações para manter, sem laço de ferramentas comum                                         |
| **eve**                   | Runtime e estado próprios, em beta ([spike](../spikes/eve.md))                                        |
| **Deep Agents JS**        | Voltado a tarefas longas com subagentes; sem áudio                                                    |
| **AI SDK Harnesses**      | Experimental e voltado a agentes de código em sandbox                                                 |

## Consequências

- O protótipo congelado, que faz HTTP direto aos provedores dentro da transação (`src/core/agents/providers/executor.ts`), sai na A2.
- Ferramentas, renderizador de prompt e pontuação de leads viram código do motor, num lugar só, com testes.
- Atualizações do SDK seguem o processo normal de dependências; uma versão maior nova exige revisar esta ADR.
