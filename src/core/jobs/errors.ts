import { toSafeError } from "@/shared/errors";

/**
 * How a job failure is handled (F3a):
 * - `skip`: access is gone (permission, membership, resource); no effect,
 *   no retry.
 * - `fail`: the input or state makes the job impossible; no retry.
 * - `retry`: anything else, including a module in maintenance; retried with
 *   backoff until the attempts run out, then dead-lettered.
 */
export type FailureOutcome = Readonly<{
  action: "skip" | "fail" | "retry";
  /** Safe message for the Executions page; never internal details. */
  message: string;
}>;

export class SkipJobError extends Error {
  constructor(readonly safeMessage: string) {
    super(safeMessage);
    this.name = "SkipJobError";
  }
}

export function classifyJobFailure(error: unknown): FailureOutcome {
  if (error instanceof SkipJobError) {
    return { action: "skip", message: error.safeMessage };
  }
  const safe = toSafeError(error);
  const message = safe.safeMessage.slice(0, 500);
  switch (safe.code) {
    case "forbidden":
    case "unauthenticated":
    case "not_found":
      return { action: "skip", message };
    case "invalid_input":
    case "conflict":
      return { action: "fail", message };
    default:
      return { action: "retry", message };
  }
}
