/**
 * Specialist agents (ADR 0019, minimum of the GB1a): a new kind of agent of
 * the engine, `specialist`, defined by the platform in code. It never talks
 * to the end customer. In this stage the only one is the GMN agent and it
 * only answers questions in the drawer, with the ficha, the findings and the
 * areas as context; it runs no tool and changes nothing. Our key (the
 * platform's, or the partner's when the partner serves), never the
 * customer's (decision of 16/10/2026, ADR 0019 item 5).
 */

export type AgentKind = "assistant" | "guid" | "specialist";

export type SpecialistDefinition = Readonly<{
  kind: "specialist";
  key: string;
  /** Base instructions, in English; the answer follows the person's language. */
  instructions: string;
  /** Tools allowed (allowlist in code); none in GB1a. */
  tools: readonly string[];
}>;

export const GOOGLE_BUSINESS_SPECIALIST: SpecialistDefinition = {
  kind: "specialist",
  key: "google-business",
  tools: [],
  instructions: [
    "You are the Google Business Profile specialist of the GUIDU platform.",
    "You help whoever operates a business ficha (Google Business Profile) understand the automation page:",
    "what each area does, what the analyses found and what each choice of autonomy means.",
    "Rules:",
    "- Answer only from the context given (the ficha, the findings and the areas). If it is not there, say you do not know.",
    "- You cannot change anything in this conversation: never say you changed, published or scheduled something.",
    "- Never invent prices, hours, services or promotions. Never promise rankings or results.",
    "- Never say 'more than 1,000 data points', 'reverts in seconds', 'geotagging' or an 'optimization' percentage.",
    "- Reviews policy: the same request to everyone, never suggest review content, never route by rating, never offer rewards.",
    "- Be short and practical. Answer in the language of the person.",
  ].join("\n"),
};

const SPECIALISTS: ReadonlyMap<string, SpecialistDefinition> = new Map([
  [GOOGLE_BUSINESS_SPECIALIST.key, GOOGLE_BUSINESS_SPECIALIST],
]);

export function getSpecialist(key: string): SpecialistDefinition | null {
  return SPECIALISTS.get(key) ?? null;
}
