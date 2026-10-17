import type { HookOutcome } from "./contract";

/**
 * Runs one phase of the lifecycle hooks of a workspace deletion (WS1) and
 * keeps the result of each hook in the deletion record:
 *
 * - every hook runs, in the registry's order, even after another one
 *   failed; a failure never stops the others;
 * - a hook already recorded as `ok` in this phase is not run again, so a
 *   retried run only repeats what failed;
 * - the phase is `ok` only when every hook is.
 *
 * Pure orchestration: the caller says how a hook runs (a transaction, or
 * the network for the external purge) and where the results live.
 */

export type LifecyclePhase = "scheduled" | "canceled" | "external";

export type HookRecord = Readonly<{
  status: "ok" | "failed";
  at: string;
  attempts: number;
  result?: Readonly<Record<string, string | number | boolean | null>>;
  error?: string;
}>;

export type PhaseRecords = Readonly<Record<string, HookRecord>>;

export type PhaseStore = Readonly<{
  /** Results of this phase recorded so far. */
  read(): Promise<PhaseRecords>;
  write(key: string, record: HookRecord): Promise<void>;
}>;

export type PhaseHook = Readonly<{
  key: string;
  run(): Promise<HookOutcome>;
}>;

export type PhaseResult = Readonly<{
  ok: boolean;
  /** Keys of the hooks that failed in this run. */
  failed: readonly string[];
  /** Hooks run now (not skipped as already done). */
  ran: number;
  records: PhaseRecords;
}>;

/** A short, safe description of a hook's failure for the record. */
export function hookError(error: unknown): string {
  if (error instanceof Error) {
    return `${error.name}: ${error.message}`.slice(0, 200);
  }
  return "unknown";
}

export async function runLifecyclePhase(
  hooks: readonly PhaseHook[],
  store: PhaseStore,
  now: () => Date = () => new Date(),
): Promise<PhaseResult> {
  const previous = await store.read();
  const records: Record<string, HookRecord> = { ...previous };
  const failed: string[] = [];
  let ran = 0;
  for (const hook of hooks) {
    const before = previous[hook.key];
    if (before?.status === "ok") continue;
    const attempts = (before?.attempts ?? 0) + 1;
    ran += 1;
    let record: HookRecord;
    try {
      const outcome = await hook.run();
      record = {
        status: "ok",
        at: now().toISOString(),
        attempts,
        ...(outcome ? { result: outcome } : {}),
      };
    } catch (error) {
      failed.push(hook.key);
      record = {
        status: "failed",
        at: now().toISOString(),
        attempts,
        error: hookError(error),
      };
    }
    records[hook.key] = record;
    await store.write(hook.key, record);
  }
  return { ok: failed.length === 0, failed, ran, records };
}

/** The external hooks still pending: none means the database may purge. */
export function pendingHooks(
  hooks: readonly Readonly<{ key: string }>[],
  records: PhaseRecords,
): string[] {
  return hooks
    .filter((hook) => records[hook.key]?.status !== "ok")
    .map((hook) => hook.key);
}
