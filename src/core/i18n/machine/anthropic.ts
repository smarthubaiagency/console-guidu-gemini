import Anthropic from "@anthropic-ai/sdk";

import { createLogger } from "@/lib/telemetry/log";
import { AppError } from "@/shared/errors";

import {
  DOCUMENT_SCHEMA,
  documentUserMessage,
  SYSTEM_PROMPT,
  TEXTS_SCHEMA,
  textsUserMessage,
} from "./prompt";
import {
  type LanguageRef,
  type LegalDocumentInput,
  type MachineTranslator,
  type TextEntry,
  TranslationIncompleteError,
} from "./types";

/**
 * Machine translation with Claude (I6), through the official SDK on the
 * beta Messages API (needed for the server-side refusal fallback).
 *
 * - Model `claude-opus-5-5`: thinking is always on for it (adaptive), so the
 *   request sends no `thinking`; depth is set by `output_config.effort`.
 * - Structured outputs (`output_config.format`, JSON schema): the answer is
 *   `{translations: [{key, text}]}` for a chunk of texts and `{title, body}`
 *   for a legal document. The schema is passed as plain JSON schema, so the
 *   SDK does not parse it before `stop_reason` is checked; it is parsed here
 *   afterwards (a refusal or a cut answer is not JSON).
 * - Every call streams and waits for `finalMessage()` (a legal document may
 *   take minutes).
 * - `fallbacks: "default"` (beta `server-side-fallback-2026-07-01`): a
 *   request declined by the model's safety classifiers is re-run server-side
 *   on the model Anthropic recommends for that category; a `refusal` on the
 *   final message means the whole chain declined.
 * - The stable system prompt is first and marked for prompt caching.
 * - The API key comes from `TRANSLATION_ANTHROPIC_API_KEY` only; it is never
 *   logged, stored or sent to the dashboard, and errors are mapped to safe
 *   messages without provider details.
 */

export const ANTHROPIC_MODEL = "claude-opus-5-5";
export const ANTHROPIC_EFFORT = "medium" as const;
const FALLBACK_BETA = "server-side-fallback-2026-07-01";
/** Room for adaptive thinking plus the answer. */
const TEXTS_MAX_TOKENS = 32_000;
const DOCUMENT_MAX_TOKENS = 96_000;

const log = createLogger("worker");

type Params = Parameters<Anthropic["beta"]["messages"]["stream"]>[0];

export function createAnthropicTranslator(apiKey: string): MachineTranslator {
  const client = new Anthropic({
    apiKey,
    // The SDK retries 408/409/429/5xx and connection errors with backoff;
    // after that the job fails the attempt and pg-boss retries it.
    maxRetries: 3,
    timeout: 15 * 60 * 1000,
  });

  async function call(
    kind: "texts" | "document",
    maxTokens: number,
    schema: Record<string, unknown>,
    content: string,
  ): Promise<unknown> {
    const params: Params = {
      model: ANTHROPIC_MODEL,
      max_tokens: maxTokens,
      betas: [FALLBACK_BETA],
      fallbacks: "default",
      output_config: {
        effort: ANTHROPIC_EFFORT,
        format: { type: "json_schema", schema },
      },
      system: [
        {
          type: "text",
          text: SYSTEM_PROMPT,
          cache_control: { type: "ephemeral" },
        },
      ],
      messages: [{ role: "user", content }],
    };
    let message;
    try {
      message = await client.beta.messages.stream(params).finalMessage();
    } catch (error) {
      throw providerError(error);
    }
    const fallbackRan = (message.usage.iterations ?? []).some(
      (entry) => entry.type === "fallback_message",
    );
    log.info("i18n.machine.call", {
      kind,
      model: message.model,
      stopReason: message.stop_reason,
      fallback: fallbackRan,
      inputTokens: message.usage.input_tokens,
      outputTokens: message.usage.output_tokens,
      cacheReadTokens: message.usage.cache_read_input_tokens ?? 0,
      cacheWriteTokens: message.usage.cache_creation_input_tokens ?? 0,
    });
    // Check why it stopped before reading the content.
    if (message.stop_reason === "refusal") {
      throw new TranslationIncompleteError("refusal");
    }
    if (
      message.stop_reason === "max_tokens" ||
      message.stop_reason === "model_context_window_exceeded"
    ) {
      throw new TranslationIncompleteError("max_tokens");
    }
    // After a mid-answer fallback the text continues in the next block.
    const text = message.content
      .filter((block) => block.type === "text")
      .map((block) => block.text)
      .join("");
    try {
      return JSON.parse(text) as unknown;
    } catch {
      throw new TranslationIncompleteError("invalid_output");
    }
  }

  return {
    provider: "anthropic",
    async translateTexts(
      source: LanguageRef,
      target: LanguageRef,
      entries: readonly TextEntry[],
    ) {
      if (entries.length === 0) return {};
      const answer = await call(
        "texts",
        TEXTS_MAX_TOKENS,
        TEXTS_SCHEMA,
        textsUserMessage(source, target, entries),
      );
      const wanted = new Set(entries.map((e) => e.key));
      const out: Record<string, string> = {};
      const list =
        answer && typeof answer === "object" && "translations" in answer
          ? (answer as { translations: unknown }).translations
          : null;
      if (!Array.isArray(list)) {
        throw new TranslationIncompleteError("invalid_output");
      }
      for (const item of list) {
        if (
          item &&
          typeof item === "object" &&
          typeof (item as { key?: unknown }).key === "string" &&
          typeof (item as { text?: unknown }).text === "string"
        ) {
          const { key, text } = item as { key: string; text: string };
          // Only keys that were asked, first answer wins.
          if (wanted.has(key) && !(key in out)) out[key] = text;
        }
      }
      return out;
    },
    async translateDocument(
      source: LanguageRef,
      target: LanguageRef,
      document: LegalDocumentInput,
    ) {
      const answer = await call(
        "document",
        DOCUMENT_MAX_TOKENS,
        DOCUMENT_SCHEMA,
        documentUserMessage(source, target, document),
      );
      if (!answer || typeof answer !== "object") {
        throw new TranslationIncompleteError("invalid_output");
      }
      const { title, body } = answer as { title?: unknown; body?: unknown };
      if (typeof title !== "string" || typeof body !== "string") {
        throw new TranslationIncompleteError("invalid_output");
      }
      return { title, body };
    },
  };
}

/**
 * Safe error for the job (`job_runs.last_error`, at most 500 characters,
 * no provider message, no key): auth and bad requests fail the run for
 * good; rate limits, overload and connection problems are retried.
 */
export function providerError(error: unknown): AppError {
  if (
    error instanceof Anthropic.AuthenticationError ||
    error instanceof Anthropic.PermissionDeniedError
  ) {
    return new AppError({
      code: "invalid_input",
      safeMessage: `Provedor de tradução recusou a chave configurada (HTTP ${error.status}).`,
    });
  }
  if (
    error instanceof Anthropic.BadRequestError ||
    error instanceof Anthropic.NotFoundError ||
    error instanceof Anthropic.UnprocessableEntityError
  ) {
    return new AppError({
      code: "invalid_input",
      safeMessage: `Provedor de tradução recusou o pedido (HTTP ${error.status}).`,
    });
  }
  if (error instanceof Anthropic.RateLimitError) {
    return new AppError({
      code: "rate_limited",
      safeMessage:
        "Provedor de tradução limitou as chamadas (HTTP 429); nova tentativa em seguida.",
    });
  }
  if (
    error instanceof Anthropic.InternalServerError ||
    error instanceof Anthropic.APIConnectionError
  ) {
    return new AppError({
      code: "unavailable",
      safeMessage:
        "Provedor de tradução indisponível no momento; nova tentativa em seguida.",
    });
  }
  if (error instanceof Anthropic.APIError) {
    return new AppError({
      code: "provider_error",
      safeMessage: `Falha no provedor de tradução (HTTP ${error.status ?? "?"}); nova tentativa em seguida.`,
    });
  }
  return new AppError({
    code: "provider_error",
    safeMessage: "Falha no provedor de tradução; nova tentativa em seguida.",
  });
}
