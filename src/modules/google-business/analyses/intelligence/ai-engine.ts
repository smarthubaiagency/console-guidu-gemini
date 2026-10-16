import "server-only";

import { withBaseUrl } from "@/core/ai/catalog";
import { parseAgentConfig } from "@/core/ai/config/schema";
import {
  type ChatModelKey,
  createChatModel,
  type ModelFactory,
} from "@/core/ai/providers";
import { generateStructured } from "@/core/ai/structured";
import { decryptSecret } from "@/core/credentials/crypto";
import type { AIProvider } from "@/core/credentials/vault";
import type { ContextTransaction } from "@/lib/prisma/with-context";

import { fakeSuggestions } from "./ai-fake";
import { type SuggestionsInput, AiSuggestionsSchema } from "./ai-schema";

/**
 * The AI of the suggestions (GB1b). Decision of Marcelo: every intelligence
 * and service of ours runs on OUR key, never the customer's, also in the
 * standard mode. "Our key" is the admin key of the partner that serves the
 * company, the same key and model of its GUIDU Assistant (the agent GMN is
 * a subagent of the Assistant, ADR 0019); for direct customers that partner
 * is the house (partner zero), so it is the platform's key. The key and the
 * model come from the security definer functions of the engine
 * (`private.ai_assistant_runtime`, `private.ai_admin_key`), which answer
 * only for the partner of the context. No model id lives in the code.
 *
 * `GB_SUGGESTIONS_PROVIDER=fake` swaps in the deterministic fake (tests and
 * e2e); production refuses it at startup.
 */

export type SuggestionsAi = Readonly<{
  id: "engine" | "fake";
  /** Raw answer; the caller validates it with `AiSuggestionsSchema`. */
  suggest(
    input: SuggestionsInput,
    loadKey: () => Promise<ChatModelKey | null>,
  ): Promise<unknown>;
}>;

export class SuggestionsUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SuggestionsUnavailableError";
  }
}

type RuntimeRow = {
  status: string;
  config: unknown;
  config_version: number;
};

/** Our key and model for the context's company, or null when not set up. */
export async function resolveIntelligenceKey(
  tx: ContextTransaction,
): Promise<ChatModelKey | null> {
  const [runtime] = await tx.$queryRaw<RuntimeRow[]>`
    select status, config, config_version from private.ai_assistant_runtime()
  `;
  if (!runtime) return null;
  const parsed = parseAgentConfig(
    "assistant",
    runtime.config_version,
    runtime.config,
  );
  if (!parsed.success) return null;
  const model = parsed.data.model;
  if (!model.model_name) return null;
  const [credential] = await tx.$queryRaw<
    { provider: string; encrypted_payload: string }[]
  >`
    select provider, encrypted_payload
    from private.ai_admin_key(
      ${model.credential_id ?? null}::uuid,
      ${model.model_provider ?? null}::text
    )
  `;
  if (!credential) return null;
  return withBaseUrl(tx, {
    provider: credential.provider as AIProvider,
    secret: decryptSecret(credential.encrypted_payload),
    model: model.model_name,
  });
}

const LANGUAGE_NAMES = {
  "pt-BR": "Brazilian Portuguese",
  es: "Spanish",
  en: "English",
} as const;

export const SUGGESTIONS_INSTRUCTIONS = [
  "You are the Google Business Profile specialist of GUIDU. You only read and suggest; nothing you write is published without a person's approval.",
  "Return JSON matching the schema. Write every text in the language given in the input.",
  "Description: up to 750 characters, about what the business is and does, true to the data given. No links, no e-mail, no phone, no prices, no promotions, discounts or offers, no keyword stuffing, no claims you cannot see in the data. Return null when the current one is already good.",
  "Name: set hasKeywords to true when the name carries keywords, the city or a slogan beyond the real business name, and suggest the real name; otherwise false and null.",
  "Categories: the most specific primary category and up to 9 additional ones that match the business, as Google category names in the input language; null when the current ones are right.",
  "Replies: one draft per review given, short and in a warm, professional tone. Never confirm that the person is a customer of anything sensitive (health treatments or exams, legal or financial matters): thank them for the visit, not for the treatment. Never name an employee, never mention amounts paid or details the person did not write, never argue or call the review false. For 1 to 3 stars: acknowledge, apologise without admitting fault in detail, and invite the person to a private channel. You may greet the author by the first name given.",
].join("\n");

export function createEngineSuggestionsAi(
  createModel: ModelFactory = createChatModel,
): SuggestionsAi {
  return {
    id: "engine",
    async suggest(input, loadKey) {
      const key = await loadKey();
      if (!key) {
        throw new SuggestionsUnavailableError(
          "No AI key and model configured for the partner of this company",
        );
      }
      return generateStructured({
        key,
        createModel,
        instructions: SUGGESTIONS_INSTRUCTIONS,
        prompt: JSON.stringify({
          language: LANGUAGE_NAMES[input.language],
          business: input.business,
          reviews: input.reviews,
        }),
        schema: AiSuggestionsSchema,
        maxOutputTokens: 6000,
        timeoutMs: 120_000,
      });
    },
  };
}

export function createFakeSuggestionsAi(): SuggestionsAi {
  return { id: "fake", suggest: async (input) => fakeSuggestions(input) };
}

type Env = Readonly<Record<string, string | undefined>>;

/** The AI of this process: the fake when asked, else the engine. */
export function getSuggestionsAi(env: Env = process.env): SuggestionsAi {
  return env.GB_SUGGESTIONS_PROVIDER?.trim() === "fake"
    ? createFakeSuggestionsAi()
    : createEngineSuggestionsAi();
}
