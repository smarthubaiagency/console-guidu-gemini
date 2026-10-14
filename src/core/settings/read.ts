import type { ContextTransaction } from "@/lib/prisma/with-context";

import type { SettingLevel } from "./catalog";
import {
  type ResolvedSettings,
  resolveSettings,
  type SettingRow,
} from "./resolve";

/**
 * Reader of the settings cascade (CF1), kept apart from the writer so the
 * worker can load it without the pages' imports. `private.settings_cascade()`
 * returns the rows of the platform, of the context's partner and of the
 * context's workspace.
 */

export async function readCascade(
  tx: ContextTransaction,
): Promise<SettingRow[]> {
  return tx.$queryRaw<
    Array<{ scope: SettingLevel; key: string; value: unknown; locked: boolean }>
  >`select scope, key, value, locked from private.settings_cascade()`;
}

/** Effective settings of the request's context. */
export async function effectiveSettings(
  tx: ContextTransaction,
): Promise<ResolvedSettings> {
  return resolveSettings(await readCascade(tx));
}
