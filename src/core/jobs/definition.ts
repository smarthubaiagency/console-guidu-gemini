import type { z } from "zod";

import type {
  ContextTransaction,
  RequestContext,
} from "@/lib/prisma/with-context";

/**
 * Contract of a background job (ADR 0002). Two scopes:
 *
 * - `workspace` (F3a): asked by a user; runs inside one transaction with the
 *   requester's context and the app_runtime role, so every RLS policy and
 *   service check applies as in the web. The run function must use the same
 *   services as the web, which re-check module state and permissions: a
 *   permission revoked after the job was queued stops the effect.
 * - `platform` (F3c): scheduled work of the platform with no user, such as
 *   billing. Runs as app_worker through its own narrow policies.
 */
type JobCommon<P> = Readonly<{
  /** `<namespace>.<name>`, e.g. `hello-world.create-record`. */
  kind: string;
  description: string;
  /** Payload: references and small inputs only, never tokens or secrets. */
  payload: z.ZodType<P>;
  /** Attempts in total, including the first. */
  maxAttempts?: number;
  /** Base delay of the exponential backoff between attempts. */
  retryDelaySeconds?: number;
  /** Time an attempt may run before it is retried or failed. */
  expireInSeconds?: number;
}>;

export type WorkspaceJobDefinition<P = unknown> = JobCommon<P> &
  Readonly<{
    scope: "workspace";
    run(
      tx: ContextTransaction,
      ctx: RequestContext,
      payload: P,
    ): Promise<JobResult | void>;
  }>;

export type PlatformJobDefinition<P = unknown> = JobCommon<P> &
  Readonly<{
    scope: "platform";
    /** Runs as app_worker; `tx` sees only what its policies allow. */
    run(tx: ContextTransaction, payload: P): Promise<JobResult | void>;
  }>;

export type JobDefinition<P = unknown> =
  WorkspaceJobDefinition<P> | PlatformJobDefinition<P>;

/** Small summary kept with the run (shown on the Executions page). */
export type JobResult = Readonly<
  Record<string, string | number | boolean | null>
>;

export const JOB_KIND =
  /^[a-z][a-z0-9]*(-[a-z0-9]+)*(\.[a-z][a-z0-9]*(-[a-z0-9]+)*)+$/;

function validate(definition: JobCommon<unknown>): void {
  if (!JOB_KIND.test(definition.kind) || definition.kind.length > 96) {
    throw new Error(`Invalid job kind: ${definition.kind}`);
  }
  const attempts = definition.maxAttempts ?? 3;
  if (!Number.isInteger(attempts) || attempts < 1 || attempts > 20) {
    throw new Error(`Invalid maxAttempts for ${definition.kind}`);
  }
}

export function defineJob<P>(
  definition: Omit<WorkspaceJobDefinition<P>, "scope">,
): WorkspaceJobDefinition<P> {
  validate(definition as JobCommon<unknown>);
  return Object.freeze({ ...definition, scope: "workspace" as const });
}

export function definePlatformJob<P>(
  definition: Omit<PlatformJobDefinition<P>, "scope">,
): PlatformJobDefinition<P> {
  validate(definition as JobCommon<unknown>);
  return Object.freeze({ ...definition, scope: "platform" as const });
}

/** pg-boss queue of a job kind; one queue per kind. */
export function queueName(kind: string): string {
  return `job/${kind}`;
}

/** Shared dead-letter queue for runs that exhausted their attempts. */
export const DEAD_LETTER_QUEUE = "job/dead-letter";

/**
 * Recurring platform job (F3c). On each tick the worker asks every schedule
 * whether a run is due at `now`; a due run is inserted with its key, so the
 * same key never runs twice, whatever the number of ticks or workers.
 */
export type JobSchedule = Readonly<{
  kind: string;
  description: string;
  due(now: Date): Readonly<{ key: string; payload: unknown }> | null;
}>;
