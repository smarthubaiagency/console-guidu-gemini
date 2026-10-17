import "server-only";

import { z } from "zod";

import { emitEvent, WORKER_ACTOR } from "@/core/events/emit";
import { definePlatformJob } from "@/core/jobs/definition";
import type { ContextTransaction } from "@/lib/prisma/with-context";

import { IP_BLOCKED_JOB_KIND, ipBlockedKey } from "./ip-blocked";

/**
 * The worker side of `security.ip_blocked` (AJ1): records the event queued
 * by the IP gate. Level platform for /platform, partner for a partner's
 * /admin; the data is the address and the area only. The event key is the
 * job's, so a retry never records it twice.
 */

const payloadSchema = z.strictObject({
  area: z.enum(["platform", "admin"]),
  partnerId: z.uuid().nullable(),
  ip: z.string().min(2).max(64).nullable(),
  hour: z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}$/),
});

export type IpBlockedPayload = z.infer<typeof payloadSchema>;

export async function emitIpBlocked(
  tx: ContextTransaction,
  payload: IpBlockedPayload,
): Promise<string | null> {
  if (payload.area === "admin" && !payload.partnerId) return null;
  const partnerId = payload.area === "admin" ? payload.partnerId : null;
  const emitted = await emitEvent(tx, {
    type: "security.ip_blocked",
    actor: WORKER_ACTOR,
    partnerId,
    data: { ip: payload.ip, area: payload.area },
    idempotencyKey: ipBlockedKey(
      payload.area,
      partnerId,
      payload.ip,
      payload.hour,
    ),
  });
  return emitted.id;
}

export const ipBlockedJob = definePlatformJob<IpBlockedPayload>({
  kind: IP_BLOCKED_JOB_KIND,
  description:
    "Registra na Central de Eventos o endereço recusado pela lista de IPs de /platform ou /admin.",
  payload: payloadSchema,
  maxAttempts: 3,
  retryDelaySeconds: 30,
  async run(tx, payload) {
    const id = await emitIpBlocked(tx, payload);
    return { status: id ? "emitted" : "skipped" };
  },
});
