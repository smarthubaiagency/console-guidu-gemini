import "server-only";

import { generateText, Output } from "ai";
import type { z } from "zod";

import {
  type ChatModelKey,
  createChatModel,
  type ModelFactory,
} from "./providers";

/**
 * One call with a structured answer, for engine users outside the turns
 * (the intelligence analyses of the agent GMN, GB1b). The caller resolves
 * the key (ADR 0017: only src/core/ai talks to the SDK) and validates the
 * answer again; this returns what the SDK parsed.
 */
export async function generateStructured<T>(
  input: Readonly<{
    key: ChatModelKey;
    instructions: string;
    prompt: string;
    schema: z.ZodType<T>;
    maxOutputTokens: number;
    timeoutMs: number;
    createModel?: ModelFactory;
  }>,
): Promise<unknown> {
  const result = await generateText({
    model: (input.createModel ?? createChatModel)(input.key),
    instructions: input.instructions,
    prompt: input.prompt,
    output: Output.object({ schema: input.schema }),
    maxOutputTokens: input.maxOutputTokens,
    timeout: { totalMs: input.timeoutMs },
    maxRetries: 1,
  });
  return result.output;
}
