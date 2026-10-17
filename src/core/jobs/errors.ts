import { ModuleUnavailableError } from "@/core/modules/availability";
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
  /**
   * A skip that is not an error (WS1): the run is recorded as `skipped`
   * with this reason in its result and no `last_error`.
   */
  quietReason?: string;
}>;

export class SkipJobError extends Error {
  constructor(readonly safeMessage: string) {
    super(safeMessage);
    this.name = "SkipJobError";
  }
}

/**
 * The workspace of the run is not active (WS1): scheduled for deletion,
 * suspended or inactive. Nothing runs for it; the run is skipped quietly.
 */
export class WorkspaceClosedError extends SkipJobError {
  constructor() {
    super("O workspace não está ativo.");
    this.name = "WorkspaceClosedError";
  }
}

export const WORKSPACE_CLOSED_REASON = "workspace_not_active";

export function classifyJobFailure(error: unknown): FailureOutcome {
  if (error instanceof WorkspaceClosedError) {
    return {
      action: "skip",
      message: error.safeMessage,
      quietReason: WORKSPACE_CLOSED_REASON,
    };
  }
  if (error instanceof SkipJobError) {
    return { action: "skip", message: error.safeMessage };
  }
  const safe = toSafeError(error);
  // A module outside the plan, suspended or disabled stays so until someone
  // changes it; only maintenance is worth retrying (F3b).
  if (
    error instanceof ModuleUnavailableError &&
    error.reason &&
    error.reason !== "maintenance"
  ) {
    return { action: "skip", message: safe.safeMessage.slice(0, 500) };
  }
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
