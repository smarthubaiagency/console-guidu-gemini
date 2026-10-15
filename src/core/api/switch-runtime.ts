import "server-only";

import { prisma } from "@/lib/prisma/client";
import { appLog } from "@/lib/telemetry/log";

import {
  type ApiSwitches,
  type ApiSwitchReader,
  createApiSwitchReader,
  queryApiSwitches,
} from "./switch";

/**
 * The web's reader of the API switches (CF6b): one per process, kept on
 * `globalThis` so the routes and the settings action share its cache.
 */

const globalForSwitches = globalThis as unknown as {
  guiduApiSwitchReader?: ApiSwitchReader;
};

function reader(): ApiSwitchReader {
  globalForSwitches.guiduApiSwitchReader ??= createApiSwitchReader({
    load: () => queryApiSwitches(prisma),
    onError: (error) =>
      appLog.warn("api.switch_read_failed", {
        errorName: error instanceof Error ? error.name : "unknown",
      }),
  });
  return globalForSwitches.guiduApiSwitchReader;
}

export function apiSwitches(): Promise<ApiSwitches> {
  return reader().switches();
}

/** After a save: this process reads the new switches at once. */
export function invalidateApiSwitches(): void {
  reader().invalidate();
}
