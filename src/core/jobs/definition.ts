import type { z } from "zod";

import type {
  ContextTransaction,
  RequestContext,
} from "@/lib/prisma/with-context";

/**
 * Contract of a background job (ADR 0002, F3a). A job runs in the worker,
 * inside one transaction with the requester's context and the app_runtime
 * role, so every RLS policy and service check applies as in the web. The
 * run function must use the same services as the web, which re-check
 * module state and permissions: a permission revoked after the job was
 * queued stops the effect.
 */
export type JobDefinition<P = unknown> = Readonly<{
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
  run(
    tx: ContextTransaction,
    ctx: RequestContext,
    payload: P,
  ): Promise<JobResult | void>;
}>;

/** Small summary kept with the run (shown on the Executions page). */
export type JobResult = Readonly<
  Record<string, string | number | boolean | null>
>;

export const JOB_KIND =
  /^[a-z][a-z0-9]*(-[a-z0-9]+)*(\.[a-z][a-z0-9]*(-[a-z0-9]+)*)+$/;

export function defineJob<P>(definition: JobDefinition<P>): JobDefinition<P> {
  if (!JOB_KIND.test(definition.kind) || definition.kind.length > 96) {
    throw new Error(`Invalid job kind: ${definition.kind}`);
  }
  const attempts = definition.maxAttempts ?? 3;
  if (!Number.isInteger(attempts) || attempts < 1 || attempts > 20) {
    throw new Error(`Invalid maxAttempts for ${definition.kind}`);
  }
  return Object.freeze({ ...definition });
}

/** pg-boss queue of a job kind; one queue per kind. */
export function queueName(kind: string): string {
  return `job/${kind}`;
}

/** Shared dead-letter queue for runs that exhausted their attempts. */
export const DEAD_LETTER_QUEUE = "job/dead-letter";
