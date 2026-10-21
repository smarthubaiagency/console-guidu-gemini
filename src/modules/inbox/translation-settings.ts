import { z } from "zod";

import { ModelIdSchema } from "@/core/ai/models";
import {
  MAX_GLOSSARY_LINES,
  MAX_GLOSSARY_TERM,
} from "@/core/translation/glossary";
import { TRANSLATION_ENGINES } from "@/core/translation/types";

/**
 * The block "Tradução" of the Inbox settings (TR2, traducao.md §3), kept in
 * `workspace_modules.config.translation`, without secrets: the switch, the
 * main engine and the fallback (the AI engine with a key of the vault and
 * its model, or Google Translate with the workspace's key in the vault) and
 * the glossary. The team's language is the workspace's
 * (`workspaces.default_locale`), not kept here. The database reads
 * `translation.enabled` (`private.inbox_translation_enqueue`), so its key
 * and place must not change.
 */

export const TranslationEngineSchema = z.enum(TRANSLATION_ENGINES);

export const GlossaryEntrySchema = z.object({
  term: z.string().trim().min(1).max(MAX_GLOSSARY_TERM),
  translation: z.string().trim().min(1).max(MAX_GLOSSARY_TERM).nullable(),
});

export const TranslationSettings = z.object({
  enabled: z.boolean().default(false),
  primary: TranslationEngineSchema.nullable().default(null),
  fallback: TranslationEngineSchema.nullable().default(null),
  ai: z
    .object({
      credential_id: z.uuid().nullable().default(null),
      model: ModelIdSchema.nullable().default(null),
    })
    .default({ credential_id: null, model: null }),
  glossary: z.array(GlossaryEntrySchema).max(MAX_GLOSSARY_LINES).default([]),
});
export type TranslationSettings = z.infer<typeof TranslationSettings>;

export const TRANSLATION_DEFAULTS: TranslationSettings = {
  enabled: false,
  primary: null,
  fallback: null,
  ai: { credential_id: null, model: null },
  glossary: [],
};

/** The block as stored, tolerant of old or broken rows. */
export function translationSettingsOf(config: unknown): TranslationSettings {
  const raw =
    config && typeof config === "object"
      ? (config as Record<string, unknown>).translation
      : undefined;
  const parsed = TranslationSettings.safeParse(raw ?? {});
  return parsed.success ? parsed.data : TRANSLATION_DEFAULTS;
}

/** The engines in use, main first; the fallback only when it differs. */
export function enginesInUse(
  settings: TranslationSettings,
): readonly (typeof TRANSLATION_ENGINES)[number][] {
  if (!settings.primary) return [];
  return settings.fallback && settings.fallback !== settings.primary
    ? [settings.primary, settings.fallback]
    : [settings.primary];
}

/** A fast and cheap model per provider, when the catalog leaves it free. */
const FAST_MODELS: Record<string, string> = {
  openai: "gpt-5-nano",
  anthropic: "claude-haiku-5-5",
  gemini: "gemini-2.5-flash-lite",
  openrouter: "openai/gpt-4o-mini",
};

const FAST = /(nano|mini|haiku|flash-lite|flash|lite)/iu;

/**
 * The model the screen suggests for the translation: a fast and cheap one
 * of the catalog (nano, mini, haiku, flash), else the provider's first.
 */
export function suggestFastModel(
  provider: string,
  models: readonly string[] | null,
): string | null {
  if (!models || models.length === 0) return FAST_MODELS[provider] ?? null;
  const ranked = ["nano", "flash-lite", "haiku", "mini", "flash", "lite"];
  for (const mark of ranked) {
    const found = models.find((model) => model.toLowerCase().includes(mark));
    if (found) return found;
  }
  return models.find((model) => FAST.test(model)) ?? models[0] ?? null;
}
