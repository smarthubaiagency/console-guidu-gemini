import {
  type TranslateInput,
  TranslationError,
  type TranslationErrorCode,
  type Translation,
  type Translator,
} from "./types";

/**
 * Main engine, then the fallback (TR2, traducao.md §5.4): an error, a
 * refusal, a quota over or more than 4 seconds without an answer go to the
 * fallback, when there is one, and the result says so (`fallback`). With
 * both failing, the caller records the failure and tries again later.
 */

/** The main engine's time; past it, the fallback. */
export const PRIMARY_TIMEOUT_MS = 4_000;
/** The fallback's time (it is the last chance of this attempt). */
export const FALLBACK_TIMEOUT_MS = 10_000;

export type TranslationOutcome =
  | Readonly<{
      ok: true;
      translation: Translation;
      fallback: boolean;
      /** Why the main engine failed, when the fallback answered. */
      primaryError: TranslationErrorCode | null;
    }>
  | Readonly<{
      ok: false;
      primaryError: TranslationErrorCode;
      fallbackError: TranslationErrorCode | null;
    }>;

function codeOf(error: unknown): TranslationErrorCode {
  return error instanceof TranslationError ? error.code : "error";
}

/** One engine, cut at `timeoutMs` whatever the adapter does. */
export async function translateWithin(
  translator: Translator,
  input: TranslateInput,
  timeoutMs: number,
): Promise<Translation> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const expired = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(new TranslationError("timeout"));
    }, timeoutMs);
  });
  try {
    return await Promise.race([
      translator.translate(input, { timeoutMs, signal: controller.signal }),
      expired,
    ]);
  } finally {
    clearTimeout(timer);
  }
}

export async function translateWithFallback(
  engines: Readonly<{ primary: Translator; fallback: Translator | null }>,
  input: TranslateInput,
  timeouts: Readonly<{ primaryMs?: number; fallbackMs?: number }> = {},
): Promise<TranslationOutcome> {
  let primaryError: TranslationErrorCode;
  try {
    const translation = await translateWithin(
      engines.primary,
      input,
      timeouts.primaryMs ?? PRIMARY_TIMEOUT_MS,
    );
    return { ok: true, translation, fallback: false, primaryError: null };
  } catch (error) {
    primaryError = codeOf(error);
  }
  if (!engines.fallback) {
    return { ok: false, primaryError, fallbackError: null };
  }
  try {
    const translation = await translateWithin(
      engines.fallback,
      input,
      timeouts.fallbackMs ?? FALLBACK_TIMEOUT_MS,
    );
    return { ok: true, translation, fallback: true, primaryError };
  } catch (error) {
    return { ok: false, primaryError, fallbackError: codeOf(error) };
  }
}
