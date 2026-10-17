import type { PrismaClient } from "@prisma/client";

import type { AllowlistArea } from "./ip-gate";

/**
 * `security.ip_blocked` (AJ1, CF5a): when the IP gate of /platform or of a
 * partner's /admin refuses an address, the request queues the job
 * `security.ip-blocked` and the worker records the event (only it holds
 * the seal's key, as with the access requests of the H2).
 *
 * The gate runs in the Node server (page guards and console actors), with
 * no transaction and often before any context, so the queueing is a single
 * statement with no person in it. The database accepts it only for an
 * address the area's list really refuses, in the current hour (UTC), with
 * the key `ip_blocked:<area>[:<partner>]:<ip>:<hour>`
 * (`private.ip_blocked_job_allowed`); `job_runs (kind, idempotency_key)`
 * is unique, so an address and area leave at most one event per hour. Only
 * the address and the area are kept. A failure here never changes the
 * refusal.
 */

export const IP_BLOCKED_JOB_KIND = "security.ip-blocked";

/** The hour bucket of the key (UTC), as the database writes it. */
export function ipBlockedHour(now: Date): string {
  return now.toISOString().slice(0, 13);
}

/** The event (and job) key of an address refused in an area this hour. */
export function ipBlockedKey(
  area: AllowlistArea,
  partnerId: string | null,
  ip: string | null,
  hour: string,
): string {
  const partner = area === "admin" && partnerId ? `${partnerId}:` : "";
  return `ip_blocked:${area}:${partner}${ip ?? "unknown"}:${hour}`;
}

/** Queues the record of a refused address; never throws. */
export async function recordIpBlocked(
  prisma: PrismaClient,
  area: AllowlistArea,
  partnerId: string | null,
  ip: string | null,
): Promise<boolean> {
  const partner = area === "admin" ? partnerId : null;
  if (area === "admin" && !partner) return false;
  try {
    // The address in its host form and the hour come from the database,
    // so the key matches what the policy recomputes. A second refusal in
    // the hour hits the unique key and ends here (no `on conflict`: the
    // table has no reads for app_runtime, which that clause would need).
    const inserted = await prisma.$executeRaw`
      insert into public.job_runs (kind, scope, payload, idempotency_key, max_attempts)
      select ${IP_BLOCKED_JOB_KIND}, 'platform',
             jsonb_build_object('area', x.area, 'partnerId', x.partner, 'ip', x.ip, 'hour', x.hour),
             'ip_blocked:' || x.area || ':' || coalesce(x.partner || ':', '')
               || coalesce(x.ip, 'unknown') || ':' || x.hour,
             3
      from (
        select ${area}::text as area,
               ${partner}::uuid::text as partner,
               host(${ip}::inet) as ip,
               to_char(date_trunc('hour', now() at time zone 'UTC'), 'YYYY-MM-DD"T"HH24') as hour
      ) x
    `;
    return inserted > 0;
  } catch {
    return false;
  }
}
