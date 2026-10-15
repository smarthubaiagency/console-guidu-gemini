import { z } from "zod";

/**
 * Providers and models the panel offers (CF6a, ADR 0018). Pure and shared
 * by the settings catalog, the services and the editor (no server import).
 *
 * The cascade: the platform turns providers on and keeps a catalog of
 * models per provider (the first one is the default); a partner may only
 * narrow both for its customers; the customer sees what is left. An empty
 * list on the platform leaves the model free for that provider.
 *
 * Nothing here stops an agent already configured: a model outside the
 * catalog, or a provider turned off, keeps answering and shows a warning.
 * Only a change of provider or model to something not allowed is refused.
 */

export const AI_PROVIDERS = [
  "openai",
  "anthropic",
  "gemini",
  "openrouter",
] as const;

export type AiProviderId = (typeof AI_PROVIDERS)[number];

export function isAiProvider(value: unknown): value is AiProviderId {
  return (
    typeof value === "string" &&
    (AI_PROVIDERS as readonly string[]).includes(value)
  );
}

/** Models per provider; the first one of a list is the default. */
export type ModelCatalog = Partial<Record<AiProviderId, string[]>>;

export const MAX_MODELS_PER_PROVIDER = 40;

/** A model id as the providers write them (`gpt-5`, `openai/gpt-4o-mini`). */
export const ModelIdSchema = z
  .string()
  .trim()
  .min(1)
  .max(120)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._:/@+-]*$/, "invalid model id");

const ProviderSchema = z.enum(AI_PROVIDERS);

export const ProvidersSchema = z
  .array(ProviderSchema)
  .max(AI_PROVIDERS.length)
  .refine((list) => new Set(list).size === list.length, "repeated provider");

export const ModelCatalogSchema = z
  .partialRecord(
    ProviderSchema,
    z
      .array(ModelIdSchema)
      .max(MAX_MODELS_PER_PROVIDER)
      .refine((list) => new Set(list).size === list.length, "repeated model"),
  )
  // A settings value holds at most 8 KB (CF1).
  .refine((value) => JSON.stringify(value).length <= 7_500, "catalog too big");

/** Base URL of an OpenAI-compatible gateway: https, no user, no query. */
export const BaseUrlSchema = z
  .url({ protocol: /^https$/ })
  .max(300)
  .refine((raw) => {
    const url = new URL(raw);
    return !url.username && !url.password && !url.search && !url.hash;
  }, "invalid base url");

export const BaseUrlsSchema = z.partialRecord(ProviderSchema, BaseUrlSchema);

export type BaseUrls = Partial<Record<AiProviderId, string>>;

/**
 * Catalog the platform starts with (editable in IA › Provedores e
 * modelos). The OpenRouter list keeps the model the e2e uses.
 */
export const DEFAULT_MODEL_CATALOG: ModelCatalog = {
  openai: ["gpt-5-mini", "gpt-5", "gpt-5-nano", "gpt-4.1-mini", "gpt-4o-mini"],
  anthropic: ["claude-sonnet-5-5", "claude-opus-5-5", "claude-haiku-5-5"],
  gemini: ["gemini-2.5-flash", "gemini-2.5-pro", "gemini-2.5-flash-lite"],
  openrouter: [
    "openai/gpt-4o-mini",
    "openai/gpt-5-mini",
    "anthropic/claude-sonnet-5-5",
    "google/gemini-2.5-flash",
  ],
};

/** Providers narrowed by a level below: only the ones on above stay. */
export function narrowProviders(
  above: readonly AiProviderId[],
  below: readonly AiProviderId[],
): AiProviderId[] {
  return below.filter((provider) => above.includes(provider));
}

/**
 * Catalog narrowed by a level below: a provider the level below lists
 * keeps only the models also above, in the order below (its first is the
 * new default); a provider it does not list inherits. An empty list above
 * (free model) accepts the list below as it is.
 */
export function narrowCatalog(
  above: ModelCatalog,
  below: ModelCatalog,
): ModelCatalog {
  const result: ModelCatalog = {};
  for (const provider of AI_PROVIDERS) {
    const top = above[provider];
    const mine = below[provider];
    if (top === undefined) {
      if (mine !== undefined) result[provider] = [...mine];
      continue;
    }
    if (mine === undefined) {
      result[provider] = [...top];
      continue;
    }
    result[provider] =
      top.length === 0
        ? [...mine]
        : mine.filter((model) => top.includes(model));
  }
  return result;
}

/** What a level may choose from: providers on and their models. */
export type AiPolicy = Readonly<{
  providers: readonly AiProviderId[];
  models: ModelCatalog;
}>;

/** The models offered for a provider; null leaves the model free. */
export function modelsOf(
  policy: AiPolicy,
  provider: string | null | undefined,
): readonly string[] | null {
  if (!isAiProvider(provider)) return null;
  const list = policy.models[provider];
  return list && list.length > 0 ? list : null;
}

export function providerAllowed(
  policy: AiPolicy,
  provider: string | null | undefined,
): boolean {
  return isAiProvider(provider) && policy.providers.includes(provider);
}

export function modelAllowed(
  policy: AiPolicy,
  provider: string | null | undefined,
  model: string | null | undefined,
): boolean {
  if (!model) return true;
  const list = modelsOf(policy, provider);
  return list === null || list.includes(model);
}

/** A model connection: provider and model, either possibly unset. */
export type ModelChoice = Readonly<{
  provider?: string | null | undefined;
  model?: string | null | undefined;
}>;

/** Why a saved choice is out of the policy, for the warning on screen. */
export type ModelWarning = "provider_off" | "model_off" | null;

export function modelWarning(
  policy: AiPolicy,
  provider: string | null | undefined,
  model: string | null | undefined,
): ModelWarning {
  if (!provider) return null;
  if (!providerAllowed(policy, provider)) return "provider_off";
  if (!modelAllowed(policy, provider, model)) return "model_off";
  return null;
}

/**
 * Field errors of a change of model connection: only what changed is
 * checked, so a choice saved before the catalog keeps working.
 */
export function modelChoiceErrors(
  policy: AiPolicy,
  before: ModelChoice,
  after: ModelChoice,
  /** Where the provider comes from: the key, or its own field (templates). */
  providerField = "model.credential_id",
): Record<string, "provider_off" | "model_off"> {
  const errors: Record<string, "provider_off" | "model_off"> = {};
  const providerChanged =
    (after.provider ?? null) !== (before.provider ?? null);
  const modelChanged = (after.model ?? null) !== (before.model ?? null);
  if (
    providerChanged &&
    after.provider &&
    !providerAllowed(policy, after.provider)
  ) {
    errors[providerField] = "provider_off";
  }
  if (
    (providerChanged || modelChanged) &&
    after.model &&
    !modelAllowed(policy, after.provider, after.model)
  ) {
    errors["model.model_name"] = "model_off";
  }
  return errors;
}
