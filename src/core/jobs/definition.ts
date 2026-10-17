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
 *
 * A workspace job may be `detached` (A2b): instead of one transaction for
 * the whole run, it receives a `JobSession` that opens short transactions
 * with the same context, role and membership check. It is for jobs that
 * wait on the network (a model call), which must never hold a transaction
 * open. A detached job has no workspace lock and may run again after a
 * crash, so its effects must be idempotent.
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
  /**
   * Runs of the same group run one at a time in each worker process
   * (pg-boss group). Default: the workspace. A channel's dispatch (A5b)
   * groups by conversation, so two conversations of a workspace are
   * answered side by side and one conversation in order.
   */
  group?: (payload: P) => string;
}>;

/** Short transactions of a detached job, each with the requester's context. */
export type JobSession = Readonly<{
  /** The run of `job_runs`; stable across the attempts of one run. */
  jobRunId: string;
  transaction<T>(operation: (tx: ContextTransaction) => Promise<T>): Promise<T>;
}>;

export type WorkspaceJobDefinition<P = unknown> = JobCommon<P> &
  (
    | Readonly<{
        scope: "workspace";
        detached?: false;
        run(
          tx: ContextTransaction,
          ctx: RequestContext,
          payload: P,
        ): Promise<JobResult | void>;
      }>
    | Readonly<{
        scope: "workspace";
        detached: true;
        run(
          session: JobSession,
          ctx: RequestContext,
          payload: P,
        ): Promise<JobResult | void>;
      }>
  );

/**
 * Short transactions of a detached platform job (WS1), each as app_worker.
 * For work that calls the network (another provider's API) and must never
 * hold a transaction open; its effects must be idempotent.
 */
export type PlatformJobSession = Readonly<{
  /** The run of `job_runs`; stable across the attempts of one run. */
  jobRunId: string;
  transaction<T>(
    operation: (tx: ContextTransaction) => Promise<T>,
    options?: Readonly<{ timeoutMs?: number }>,
  ): Promise<T>;
}>;

export type PlatformTxJobDefinition<P = unknown> = JobCommon<P> &
  Readonly<{
    scope: "platform";
    detached?: false;
    /** Runs as app_worker; `tx` sees only what its policies allow. */
    run(tx: ContextTransaction, payload: P): Promise<JobResult | void>;
  }>;

/**
 * A platform job that opens its own short transactions (WS1). Without the
 * per-kind lock of the single transaction, two runs of the kind may overlap.
 */
export type PlatformDetachedJobDefinition<P = unknown> = JobCommon<P> &
  Readonly<{
    scope: "platform";
    detached: true;
    run(session: PlatformJobSession, payload: P): Promise<JobResult | void>;
  }>;

export type PlatformJobDefinition<P = unknown> =
  PlatformTxJobDefinition<P> | PlatformDetachedJobDefinition<P>;

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
  definition: JobCommon<P> &
    Readonly<{
      run(
        tx: ContextTransaction,
        ctx: RequestContext,
        payload: P,
      ): Promise<JobResult | void>;
    }>,
): WorkspaceJobDefinition<P> {
  validate(definition as JobCommon<unknown>);
  return Object.freeze({
    ...definition,
    scope: "workspace" as const,
    detached: false as const,
  });
}

/** A workspace job that opens its own short transactions (see above). */
export function defineDetachedJob<P>(
  definition: JobCommon<P> &
    Readonly<{
      run(
        session: JobSession,
        ctx: RequestContext,
        payload: P,
      ): Promise<JobResult | void>;
    }>,
): WorkspaceJobDefinition<P> {
  validate(definition as JobCommon<unknown>);
  return Object.freeze({
    ...definition,
    scope: "workspace" as const,
    detached: true as const,
  });
}

export function definePlatformJob<P>(
  definition: Omit<PlatformTxJobDefinition<P>, "scope" | "detached">,
): PlatformTxJobDefinition<P> {
  validate(definition as JobCommon<unknown>);
  return Object.freeze({
    ...definition,
    scope: "platform" as const,
    detached: false as const,
  });
}

/** A platform job with short transactions of its own (see above). */
export function defineDetachedPlatformJob<P>(
  definition: Omit<PlatformDetachedJobDefinition<P>, "scope" | "detached">,
): PlatformDetachedJobDefinition<P> {
  validate(definition as JobCommon<unknown>);
  return Object.freeze({
    ...definition,
    scope: "platform" as const,
    detached: true as const,
  });
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
