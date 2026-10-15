import "server-only";

import { effectiveSettings } from "@/core/settings/read";
import type { ContextTransaction } from "@/lib/prisma/with-context";
import { AppError } from "@/shared/errors";

import {
  type AiPolicy,
  type AiProviderId,
  type BaseUrls,
  type ModelChoice,
  modelChoiceErrors,
  providerAllowed,
} from "./models";

/**
 * The providers and models of the request's context (CF6a), read from the
 * settings cascade: the platform's, narrowed by the partner of the context
 * (the /admin partner or the workspace's). Worker-safe: no page imports.
 */

export async function aiPolicy(tx: ContextTransaction): Promise<AiPolicy> {
  const { values } = await effectiveSettings(tx);
  return { providers: values["ai.providers"], models: values["ai.models"] };
}

/** The platform's gateways per provider (`ai.base_urls`). */
export async function aiBaseUrls(tx: ContextTransaction): Promise<BaseUrls> {
  return (await effectiveSettings(tx)).values["ai.base_urls"];
}

/** The key with the platform's gateway of its provider, when one is set. */
export async function withBaseUrl<T extends Readonly<{ provider: string }>>(
  tx: ContextTransaction,
  key: T,
): Promise<T & Readonly<{ baseURL?: string }>> {
  const baseURL = (await aiBaseUrls(tx))[key.provider as AiProviderId];
  return baseURL ? { ...key, baseURL } : key;
}

const MESSAGES = {
  provider_off:
    "Este provedor não está liberado. Escolha uma chave de outro provedor.",
  model_off: "Escolha um modelo da lista.",
} as const;

/**
 * Field errors (in the editor's format) of a change of model connection
 * outside the context's policy; empty when nothing that changed is out.
 */
export async function modelChoiceFieldErrors(
  tx: ContextTransaction,
  before: ModelChoice,
  after: ModelChoice,
  providerField?: string,
): Promise<Record<string, string>> {
  const changed =
    (before.provider ?? null) !== (after.provider ?? null) ||
    (before.model ?? null) !== (after.model ?? null);
  if (!changed) return {};
  const errors = modelChoiceErrors(
    await aiPolicy(tx),
    before,
    after,
    providerField,
  );
  return Object.fromEntries(
    Object.entries(errors).map(([path, code]) => [path, MESSAGES[code]]),
  );
}

/** A new AI key of a provider the context does not offer is refused. */
export async function assertProviderOffered(
  tx: ContextTransaction,
  provider: AiProviderId | string,
): Promise<void> {
  if (!providerAllowed(await aiPolicy(tx), provider)) {
    throw new AppError({
      code: "invalid_input",
      safeMessage: "Este provedor de IA não está liberado.",
      messageKey: "aiConsole.errors.providerOff",
    });
  }
}
