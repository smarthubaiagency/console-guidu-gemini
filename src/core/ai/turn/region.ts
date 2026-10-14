import { effectiveSettings } from "@/core/settings/read";
import type { ContextTransaction } from "@/lib/prisma/with-context";

import type { AgentConfig } from "../config/schema";

/**
 * An agent without its own time zone uses the context's (CF1: workspace,
 * else partner, else platform), for business hours and the date variables.
 */
export async function withRegionTimeZone<T extends AgentConfig>(
  tx: ContextTransaction,
  config: T,
): Promise<T> {
  if (config.scope.timezone) return config;
  const timezone = (await effectiveSettings(tx)).values["region.timezone"];
  return { ...config, scope: { ...config.scope, timezone } };
}
