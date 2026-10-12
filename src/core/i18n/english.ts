import { createTranslator } from "use-intl/core";

import { MESSAGE_FILES } from "@/i18n/messages";
import type { AppErrorCode, SafeErrorResult } from "@/shared/errors/app-error";

/**
 * English of the machine surfaces (I5, ADR 0013): the REST API and both MCP
 * servers always answer in English, whatever the dashboard language. Texts
 * come from the shipped `en` messages (platform edits of Plataforma ›
 * Idiomas apply only to the dashboard). Not server-only, so route handlers
 * and unit tests can use it.
 */

export type EnglishTranslator = {
  (key: string, values?: Record<string, string | number>): string;
  has(key: string): boolean;
};

const translators = new Map<string, EnglishTranslator>();

/** Translator of the shipped English messages, optionally of a namespace. */
export function englishTranslator(namespace?: string): EnglishTranslator {
  const cacheKey = namespace ?? "";
  let t = translators.get(cacheKey);
  if (!t) {
    const base = createTranslator({
      locale: "en",
      messages: MESSAGE_FILES.en as unknown as Record<string, unknown>,
      ...(namespace ? { namespace } : {}),
      // A missing key or value falls back below; never throw or log.
      onError: () => undefined,
    } as Parameters<
      typeof createTranslator
    >[0]) as unknown as EnglishTranslator;
    t = base;
    translators.set(cacheKey, t);
  }
  return t;
}

/** Generic English sentence of each error code, never Portuguese. */
const GENERIC: Readonly<Record<AppErrorCode, string>> = {
  unauthenticated: "Authentication required.",
  forbidden: "Access denied.",
  not_found: "Resource not found.",
  conflict: "The request conflicts with the current state of the resource.",
  invalid_input: "Invalid input.",
  rate_limited: "Rate limit reached. Try again shortly.",
  unavailable: "Service temporarily unavailable.",
  provider_error: "Failed to reach the provider.",
  internal: "The operation could not be completed.",
};

export function genericEnglishMessage(code: AppErrorCode): string {
  return GENERIC[code] ?? GENERIC.internal;
}

/** English text of a full message key, or null when it has none. */
export function englishText(
  key: string,
  values?: Record<string, string | number>,
): string | null {
  const t = englishTranslator();
  if (!t.has(key)) return null;
  try {
    const text = t(key, values ?? {});
    // next-intl answers the key itself when formatting fails.
    return text && text !== key ? text : null;
  } catch {
    return null;
  }
}

const keyOf = (value: string) => value.replace(/[.-]/g, "_");

/**
 * English description of a module quota (`crm.contacts` → "contacts per
 * workspace"), from the module catalog, else the quota key itself.
 */
export function englishQuotaLabel(quotaKey: string): string {
  const moduleKey = quotaKey.split(".")[0] ?? quotaKey;
  const text = englishText(
    `moduleCatalog.${keyOf(moduleKey)}.quotas.${keyOf(quotaKey)}`,
  );
  if (!text) return quotaKey;
  const plain = text.replace(/\.$/, "");
  return plain.charAt(0).toLowerCase() + plain.slice(1);
}

/**
 * Values of an error message in English: a `quotaKey` value replaces the
 * Portuguese `quota` label given by the service.
 */
function englishValues(
  values: Record<string, string | number> | undefined,
): Record<string, string | number> | undefined {
  if (!values || typeof values.quotaKey !== "string") return values;
  return { ...values, quota: englishQuotaLabel(values.quotaKey) };
}

/** Message of a safe error in English, for API and MCP responses. */
export function englishErrorMessage(safe: SafeErrorResult): string {
  return (
    (safe.messageKey
      ? englishText(safe.messageKey, englishValues(safe.messageValues))
      : null) ?? genericEnglishMessage(safe.code)
  );
}
