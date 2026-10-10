import type { PrismaClient } from "@prisma/client";

/**
 * Readiness of the web (F3d): the database answers a trivial query within
 * the time limit. Liveness needs nothing: answering is enough. Neither
 * depends on the worker, which has probes of its own.
 */
export type ReadinessCheck = Readonly<{
  ready: boolean;
  checks: Readonly<{ database: "ok" | "fail" }>;
  /** Time the database took to answer (or until the failure). */
  latencyMs: number;
}>;

export async function checkReadiness(
  client: Pick<PrismaClient, "$queryRaw">,
  timeoutMs = 2000,
): Promise<ReadinessCheck> {
  const started = Date.now();
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<"timeout">((resolve) => {
    timer = setTimeout(() => resolve("timeout"), timeoutMs);
  });
  try {
    const result = await Promise.race([
      client.$queryRaw<{ ok: number }[]>`select 1 as ok`,
      timeout,
    ]);
    const ok = Array.isArray(result) && result[0]?.ok === 1;
    return {
      ready: ok,
      checks: { database: ok ? "ok" : "fail" },
      latencyMs: Date.now() - started,
    };
  } catch {
    return {
      ready: false,
      checks: { database: "fail" },
      latencyMs: Date.now() - started,
    };
  } finally {
    clearTimeout(timer);
  }
}

export const HEALTH_HEADERS = { "cache-control": "no-store" } as const;
