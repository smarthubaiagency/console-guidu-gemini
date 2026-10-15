import "server-only";

import type { SqlExecutor } from "@/core/i18n/messages-loader";
import { resolveSettings, type SettingRow } from "@/core/settings/resolve";
import { prisma } from "@/lib/prisma/client";
import { appLog } from "@/lib/telemetry/log";

import { analyticsConnectOrigin, type AnalyticsValues } from "./config";

/**
 * Reader of the analytics settings (CF7) for the root layout and the proxy
 * (which imports only this file),
 * before sign-in: `private.analytics_settings(partner)` returns only the
 * `analytics.*` rows of the platform and of the host's partner. The values
 * are kept 30 seconds per partner (a navigation must not cost a query), and
 * a save clears them at once in this process. Any failure sends nothing.
 */

const TTL_MS = 30_000;
const FAILURE_TTL_MS = 5_000;

type Entry = { at: number; ttl: number; values: AnalyticsValues | null };

const CACHE_KEY = Symbol.for("guidu.analytics.settings");
const store = globalThis as unknown as Record<
  symbol,
  Map<string, Entry> | undefined
>;

function entries(): Map<string, Entry> {
  let map = store[CACHE_KEY];
  if (!map) {
    map = new Map();
    store[CACHE_KEY] = map;
  }
  return map;
}

/** Forgets the cached values (after a save). */
export function clearAnalyticsCache(): void {
  entries().clear();
}

export async function readAnalyticsRows(
  db: SqlExecutor,
  partnerId: string | null,
): Promise<SettingRow[]> {
  return db.$queryRaw<SettingRow[]>`
    select scope, key, value, locked
    from private.analytics_settings(${partnerId}::uuid)
  `;
}

export function analyticsValues(rows: readonly SettingRow[]): AnalyticsValues {
  const { values } = resolveSettings(rows);
  return {
    enabled: values["analytics.enabled"],
    provider: values["analytics.provider"],
    siteId: values["analytics.site_id"],
    posthogRegion: values["analytics.posthog_region"],
    partnerEnabled: values["analytics.partner_enabled"],
    partnerSiteId: values["analytics.partner_site_id"],
  };
}

/** Values of one partner's hosts (null: the platform's alone). */
export async function cachedAnalyticsValues(
  partnerId: string | null,
  db: SqlExecutor = prisma,
  now: number = Date.now(),
): Promise<AnalyticsValues | null> {
  const key = partnerId ?? "platform";
  const hit = entries().get(key);
  if (hit && now - hit.at < hit.ttl) return hit.values;
  try {
    const values = analyticsValues(await readAnalyticsRows(db, partnerId));
    entries().set(key, { at: now, ttl: TTL_MS, values });
    return values;
  } catch (err) {
    appLog.warn("analytics.settings_unavailable", {
      error: err instanceof Error ? err.name : "unknown",
    });
    entries().set(key, { at: now, ttl: FAILURE_TTL_MS, values: null });
    return null;
  }
}

/** Origin the CSP of every page opens for analytics (null: none). */
export async function analyticsCspOrigin(): Promise<string | null> {
  const values = await cachedAnalyticsValues(null);
  return values ? analyticsConnectOrigin(values) : null;
}
