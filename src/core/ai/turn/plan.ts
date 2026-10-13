import {
  APICallError,
  NoObjectGeneratedError,
  NoOutputGeneratedError,
  RetryError,
} from "ai";
import { z } from "zod";

/**
 * Response plan of a GUIDS (canais.md §6.1): the answer already split in
 * short messages, validated before anything is written or sent. Handing
 * over to a person is the `handoff` tool, with its reason.
 */
export const ResponsePlan = z.object({
  messages: z
    .array(z.string().trim().min(1).max(4000))
    .min(1)
    .max(10)
    .describe(
      "The answer to the contact, split in short chat messages, in order.",
    ),
});

/** Code of a turn that did not reach an answer, kept on the message. */
export function turnErrorCode(error: unknown): string {
  const cause = RetryError.isInstance(error) ? error.lastError : error;
  if (APICallError.isInstance(cause)) {
    const status = cause.statusCode ?? 0;
    if (status === 401 || status === 403) return "provider_auth";
    if (status === 402 || status === 429) return "provider_limit";
    return "provider_error";
  }
  if (
    NoObjectGeneratedError.isInstance(error) ||
    NoOutputGeneratedError.isInstance(error) ||
    error instanceof z.ZodError
  ) {
    return "invalid_output";
  }
  if (
    error instanceof Error &&
    (error.name === "TimeoutError" || error.name === "AbortError")
  ) {
    return "timeout";
  }
  return "engine_error";
}
