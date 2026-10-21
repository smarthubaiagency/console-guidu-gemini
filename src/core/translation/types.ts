/**
 * Contract of a translator of the chat (TR2, docs/modules/inbox/traducao.md
 * §6): the AI engine with the customer's key and Google Translate Basic
 * (v2, API key). Pure types, shared by the core, the job and the settings.
 */

import type { ContactLocale } from "@/core/matrix/locale";

export const TRANSLATION_ENGINES = ["ai", "google"] as const;
export type TranslationEngineId = (typeof TRANSLATION_ENGINES)[number];

export function isTranslationEngine(
  value: unknown,
): value is TranslationEngineId {
  return value === "ai" || value === "google";
}

/**
 * A line of the glossary: a term kept as it is (`translation` null: names
 * of places, of the store, of products) or a term with a fixed translation
 * in the team's language.
 */
export type GlossaryEntry = Readonly<{
  term: string;
  translation: string | null;
}>;

/** A message said before, given to the AI engine as context (data). */
export type TranslationContextLine = Readonly<{
  side: "contact" | "team" | "agent";
  text: string;
}>;

export type TranslateInput = Readonly<{
  text: string;
  /** The language of the message, when known. */
  source: ContactLocale | null;
  target: ContactLocale;
  glossary: readonly GlossaryEntry[];
  /** The latest messages before this one (only the AI engine reads them). */
  context: readonly TranslationContextLine[];
}>;

export type Translation = Readonly<{
  text: string;
  engine: TranslationEngineId;
  /** The model of the AI engine; null for Google. */
  model: string | null;
}>;

export type Translator = Readonly<{
  engine: TranslationEngineId;
  model: string | null;
  translate(
    input: TranslateInput,
    options: Readonly<{ timeoutMs: number; signal?: AbortSignal }>,
  ): Promise<Translation>;
}>;

/**
 * Why an engine failed: the key was refused, the quota is over, no answer
 * in time, the model refused or answered nothing usable, anything else.
 */
export const TRANSLATION_ERRORS = [
  "key",
  "quota",
  "timeout",
  "refusal",
  "error",
] as const;
export type TranslationErrorCode = (typeof TRANSLATION_ERRORS)[number];

export class TranslationError extends Error {
  constructor(readonly code: TranslationErrorCode) {
    super(`translation: ${code}`);
    this.name = "TranslationError";
  }
}
