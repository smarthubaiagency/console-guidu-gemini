import "server-only";

import { prisma } from "@/lib/prisma/client";
import { appLog } from "@/lib/telemetry/log";

import {
  createMaintenanceReader,
  type MaintenanceReader,
  queryMaintenanceWindow,
} from "./read";
import type { MaintenanceStatus } from "./state";

/**
 * The web's reader of the maintenance window (CF5c): one per process, kept
 * on `globalThis` so pages, actions and route handlers share it (and its
 * cache) whatever bundle imports it.
 */

const globalForMaintenance = globalThis as unknown as {
  guiduMaintenanceReader?: MaintenanceReader;
};

function reader(): MaintenanceReader {
  globalForMaintenance.guiduMaintenanceReader ??= createMaintenanceReader({
    load: () => queryMaintenanceWindow(prisma),
    onError: (error) =>
      appLog.warn("maintenance.read_failed", {
        errorName: error instanceof Error ? error.name : "unknown",
      }),
  });
  return globalForMaintenance.guiduMaintenanceReader;
}

/** The window's meaning now (5 s cache per process, fails open). */
export function maintenanceStatus(): Promise<MaintenanceStatus> {
  return reader().status();
}

/** After a save: this process reads the new window at once. */
export function invalidateMaintenance(): void {
  reader().invalidate();
}
