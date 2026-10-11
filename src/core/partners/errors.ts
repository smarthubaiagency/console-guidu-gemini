import type { z } from "zod";

import { AppError } from "@/shared/errors";

type MessageValues = Record<string, string | number>;

export function partnerNotFound(): AppError {
  return new AppError({
    code: "not_found",
    safeMessage: "Parceiro não encontrado.",
    messageKey: "partnerConsole.errors.partnerNotFound",
  });
}

/**
 * Invalid input with its Portuguese text; `key` (in `partnerConsole.errors`)
 * translates it in the request language (I3).
 */
export function invalidPartnerInput(
  message: string,
  key?: string,
  messageValues?: MessageValues,
): AppError {
  return new AppError({
    code: "invalid_input",
    safeMessage: message,
    ...(key ? { messageKey: `partnerConsole.errors.${key}` } : {}),
    ...(messageValues ? { messageValues } : {}),
  });
}

/** Key (and values) of each known validation message of a schema. */
export type PartnerIssueKeys = Readonly<
  Record<string, string | readonly [string, MessageValues]>
>;

/** First issue of a failed parse; known messages carry their key. */
export function invalidPartnerParse(
  error: z.ZodError,
  keys: PartnerIssueKeys,
): AppError {
  const message = error.issues[0]?.message;
  if (!message) return invalidPartnerInput("Dados inválidos.", "invalidData");
  const entry = keys[message];
  if (entry === undefined) return invalidPartnerInput(message);
  return typeof entry === "string"
    ? invalidPartnerInput(message, entry)
    : invalidPartnerInput(message, entry[0], entry[1]);
}
