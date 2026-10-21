import "server-only";

import {
  ChannelHttpError,
  type ChannelFetch,
  providerJson,
} from "@/core/channels/http";
import type { ContactLocale } from "@/core/matrix/locale";

import { plainFromHtml, protectForHtml } from "./glossary";
import {
  TranslationError,
  type TranslationErrorCode,
  type Translator,
} from "./types";

/**
 * Google Cloud Translation Basic (v2) with the customer's API key (TR2,
 * traducao.md §6). The text goes in the HTML format, with the glossary's
 * terms marked as not translatable (`translate="no"`); the call goes
 * through the guard of the channels' external calls (`providerJson`:
 * https, public address pinned on the socket, no redirects, bounded
 * answer). The key goes in a header, never in the address.
 * `GOOGLE_TRANSLATE_API_BASE` points the e2e rig at its double.
 */

export const GOOGLE_TRANSLATE_DEFAULT_BASE =
  "https://translation.googleapis.com";

/** Codes of Google for the three languages of the pilot. */
const GOOGLE_CODES: Record<ContactLocale, string> = {
  "pt-BR": "pt",
  en: "en",
  es: "es",
};

export function googleTranslateBase(): string {
  return (
    process.env.GOOGLE_TRANSLATE_API_BASE?.trim() ||
    GOOGLE_TRANSLATE_DEFAULT_BASE
  ).replace(/\/+$/u, "");
}

export function googleErrorCode(error: unknown): TranslationErrorCode {
  if (error instanceof TranslationError) return error.code;
  if (error instanceof ChannelHttpError) {
    if (error.code === "unauthorized") return "key";
    if (error.code === "timeout") return "timeout";
    // Google answers 400 to a key it does not know, 429 to a quota over.
    if (error.status === 400) return "key";
    if (error.status === 429) return "quota";
    return "error";
  }
  if (
    error instanceof Error &&
    (error.name === "TimeoutError" || error.name === "AbortError")
  ) {
    return "timeout";
  }
  return "error";
}

type GoogleAnswer = {
  data?: { translations?: { translatedText?: unknown }[] };
};

export function createGoogleTranslator(
  apiKey: string,
  deps: Readonly<{ fetch?: ChannelFetch; baseUrl?: string }> = {},
): Translator {
  const base = (deps.baseUrl ?? googleTranslateBase()).replace(/\/+$/u, "");
  return {
    engine: "google",
    model: null,
    async translate(input, options) {
      let answer: unknown;
      try {
        answer = await providerJson(
          `${base}/language/translate/v2`,
          {
            method: "POST",
            headers: {
              "content-type": "application/json; charset=utf-8",
              "x-goog-api-key": apiKey,
            },
            body: JSON.stringify({
              q: [protectForHtml(input.text, input.glossary)],
              target: GOOGLE_CODES[input.target],
              ...(input.source ? { source: GOOGLE_CODES[input.source] } : {}),
              format: "html",
            }),
          },
          {
            ...(deps.fetch ? { fetch: deps.fetch } : {}),
            timeoutMs: options.timeoutMs,
          },
        );
      } catch (error) {
        throw new TranslationError(googleErrorCode(error));
      }
      const first = (answer as GoogleAnswer | null)?.data?.translations?.[0];
      const html =
        typeof first?.translatedText === "string" ? first.translatedText : "";
      const text = plainFromHtml(html);
      if (!text) throw new TranslationError("refusal");
      return { text, engine: "google", model: null };
    },
  };
}
