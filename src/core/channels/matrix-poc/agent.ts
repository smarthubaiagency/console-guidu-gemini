import "server-only";

import { generateText } from "ai";
import { MockLanguageModelV4 } from "ai/test";

/**
 * PROVA DE CONCEITO (IN1). O "agente" da sala: uma chamada `generateText`
 * do AI SDK com o modelo falso que os testes usam (`MockLanguageModelV4`),
 * sem chave e sem rede. Não passa pelo `runGuidTurn`: o serviço público
 * `runTurn` para hubs (canais.md §3.5) ainda não existe e nasce na IN6.
 * A resposta é fixa e repete o texto do contato; pedir "atendente" ou
 * "humano" faz a transferência.
 */

const usage = {
  inputTokens: { total: 1, noCache: 1, cacheRead: undefined, cacheWrite: undefined },
  outputTokens: { total: 1, text: 1, reasoning: undefined },
};

export type PocAgentAnswer = Readonly<{ text: string; handoff: boolean }>;

export async function answerAsPocAgent(
  agentName: string,
  contactText: string,
): Promise<PocAgentAnswer> {
  const handoff = /atendente|humano/i.test(contactText);
  const reply = handoff
    ? `Certo, vou chamar um atendente da equipe. Aguarde um momento.`
    : `[${agentName}, modelo falso] Recebi: "${contactText.slice(0, 200)}". Posso ajudar em algo mais?`;
  const model = new MockLanguageModelV4({
    doGenerate: async () => ({
      content: [{ type: "text" as const, text: reply }],
      finishReason: { unified: "stop" as const, raw: undefined },
      usage,
      warnings: [],
    }),
  });
  const { text } = await generateText({
    model,
    system: `Você é ${agentName}, o agente de atendimento do workspace.`,
    prompt: contactText,
  });
  return { text, handoff };
}
