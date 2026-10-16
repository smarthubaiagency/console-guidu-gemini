import { z } from "zod";

import type { ContextTransaction } from "@/lib/prisma/with-context";

/**
 * Service mode of a company (ADR 0020, minimum of GB1a). No row means
 * `padrao`: whoever signs up alone. The partner sets the mode when it
 * registers the customer (default `gerenciado`). The request by secure link
 * and the way back to `padrao` come later (especificação §3).
 */

export const SERVICE_MODES = ["padrao", "gerenciado"] as const;
export type ServiceMode = (typeof SERVICE_MODES)[number];
export const ServiceModeSchema = z.enum(SERVICE_MODES);

/** Default for a customer registered by a partner. */
export const PARTNER_REGISTRATION_DEFAULT_MODE: ServiceMode = "gerenciado";

export async function readServiceMode(
  tx: ContextTransaction,
  organizationId: string,
): Promise<ServiceMode> {
  const row = await tx.organizationServiceMode.findUnique({
    where: { organizationId },
    select: { mode: true },
  });
  return row?.mode === "gerenciado" ? "gerenciado" : "padrao";
}

/** Modes of the partner's companies (absent: `padrao`). */
export async function readServiceModes(
  tx: ContextTransaction,
  organizationIds: readonly string[],
): Promise<Map<string, ServiceMode>> {
  if (organizationIds.length === 0) return new Map();
  const rows = await tx.organizationServiceMode.findMany({
    where: { organizationId: { in: [...organizationIds] } },
    select: { organizationId: true, mode: true },
  });
  return new Map(
    rows.map((r) => [
      r.organizationId,
      r.mode === "gerenciado" ? "gerenciado" : "padrao",
    ]),
  );
}

/**
 * Records the mode chosen when the partner registers a customer, in the
 * same transaction. RLS repeats: partner owner or admin of the company's
 * partner, signing the row.
 */
export async function recordRegistrationMode(
  tx: ContextTransaction,
  args: Readonly<{
    organizationId: string;
    partnerId: string;
    mode: ServiceMode;
    userId: string;
  }>,
): Promise<void> {
  await tx.$executeRaw`
    insert into public.organization_service_modes (organization_id, partner_id, mode, set_by)
    values (${args.organizationId}::uuid, ${args.partnerId}::uuid, ${args.mode}, ${args.userId}::uuid)
  `;
}
