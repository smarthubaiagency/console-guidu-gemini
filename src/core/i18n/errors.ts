import "server-only";

import { getTranslations } from "next-intl/server";

import { type SafeErrorResult, toSafeError } from "@/shared/errors";

/**
 * Safe error in the request language (I2). Errors with a `messageKey` (a
 * full key, such as `errors.permissionDenied`) are translated; the others
 * keep their Portuguese `safeMessage` until their service gives them a key.
 */
export async function localizeError(
  err: unknown,
  requestId?: string,
): Promise<SafeErrorResult> {
  const safe = toSafeError(err, requestId);
  if (!safe.messageKey) return safe;
  try {
    const t = await getTranslations();
    if (!t.has(safe.messageKey)) return safe;
    return {
      ...safe,
      safeMessage: t(safe.messageKey, safe.messageValues ?? {}),
    };
  } catch {
    return safe;
  }
}

/** Form state of a failed server action, in the request language. */
export async function actionFailure(err: unknown): Promise<{
  error: string;
  code: SafeErrorResult["code"];
  requestId: string;
}> {
  const safe = await localizeError(err);
  return {
    error: safe.safeMessage,
    code: safe.code,
    requestId: safe.requestId,
  };
}
