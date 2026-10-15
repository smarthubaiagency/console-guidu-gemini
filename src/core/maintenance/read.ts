import type { PrismaClient } from "@prisma/client";

import {
  evaluateMaintenance,
  isMaintenanceMode,
  type MaintenanceStatus,
  type MaintenanceWindow,
} from "./state";

/**
 * Reading the maintenance window (CF5c). Every request of /app, /admin and
 * the public API, and each dispatch tick of the worker, asks for it, so it
 * is one call to `private.maintenance_state()` behind a cache per process:
 *
 * - a fresh answer is kept `ttlMs` (5 s by default), so a change reaches
 *   every process within that time; the process that saves drops its own
 *   cache at once;
 * - **fails open**: when the database does not answer, the last answer
 *   read in the past 5 minutes stands, and without one the platform is
 *   taken as open. A store that is down never locks everybody out, and a
 *   database that is down fails the requests on its own anyway. The
 *   failure is logged, at most once per `ttlMs`.
 *
 * The window itself is evaluated at each call, so a scheduled start or end
 * takes effect on time even while the row is cached.
 */

type Row = {
  mode: string;
  starts_at: Date | null;
  ends_at: Date | null;
  message_pt_br: string | null;
  message_en: string | null;
  message_es: string | null;
};

export const MAINTENANCE_CACHE_MS = 5_000;
/** How long a last good answer stands in for a failed read. */
export const MAINTENANCE_STALE_MS = 5 * 60_000;

export async function queryMaintenanceWindow(
  client: Pick<PrismaClient, "$queryRaw">,
): Promise<MaintenanceWindow | null> {
  const rows = await client.$queryRaw<Row[]>`
    select mode, starts_at, ends_at, message_pt_br, message_en, message_es
    from private.maintenance_state()
  `;
  const row = rows[0];
  if (!row || !isMaintenanceMode(row.mode)) return null;
  return {
    mode: row.mode,
    startsAt: row.starts_at,
    endsAt: row.ends_at,
    messages: {
      ...(row.message_pt_br ? { "pt-BR": row.message_pt_br } : {}),
      ...(row.message_en ? { en: row.message_en } : {}),
      ...(row.message_es ? { es: row.message_es } : {}),
    },
  };
}

export type MaintenanceReader = Readonly<{
  /** The window's meaning now (cached read, fails open). */
  status(): Promise<MaintenanceStatus>;
  /** Drops the cache: the next call reads the database. */
  invalidate(): void;
}>;

export function createMaintenanceReader(
  options: Readonly<{
    load: () => Promise<MaintenanceWindow | null>;
    ttlMs?: number;
    now?: () => Date;
    onError?: (error: unknown) => void;
  }>,
): MaintenanceReader {
  const ttl = options.ttlMs ?? MAINTENANCE_CACHE_MS;
  const clock = options.now ?? (() => new Date());
  let cached: { window: MaintenanceWindow | null; at: number } | null = null;
  let lastGood: { window: MaintenanceWindow | null; at: number } | null = null;
  let retryAt = 0;
  let inFlight: Promise<MaintenanceWindow | null> | null = null;

  async function load(): Promise<MaintenanceWindow | null> {
    const now = Date.now();
    if (cached && now - cached.at < ttl) return cached.window;
    if (now < retryAt) {
      return lastGood && now - lastGood.at < MAINTENANCE_STALE_MS
        ? lastGood.window
        : null;
    }
    if (!inFlight) {
      inFlight = options
        .load()
        .then((window) => {
          const at = Date.now();
          cached = { window, at };
          lastGood = cached;
          return window;
        })
        .catch((error: unknown) => {
          // Fail open: the last good answer, else no window.
          retryAt = Date.now() + ttl;
          options.onError?.(error);
          const at = Date.now();
          return lastGood && at - lastGood.at < MAINTENANCE_STALE_MS
            ? lastGood.window
            : null;
        })
        .finally(() => {
          inFlight = null;
        });
    }
    return inFlight;
  }

  return {
    async status() {
      return evaluateMaintenance(await load(), clock());
    },
    invalidate() {
      cached = null;
      retryAt = 0;
    },
  };
}
