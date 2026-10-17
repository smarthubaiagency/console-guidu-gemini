import { appConfig } from "@/core/config/app";
import type { ContextTransaction } from "@/lib/prisma/with-context";

import { HOUSE_PARTNER_ID } from "./constants";
import { partnerHostOrigin } from "./hosts";

/**
 * Origin of the customer's console on the partner's domain (custom first),
 * for links in notices sent by the worker; the platform host for the house
 * or a partner still without a domain. Reads as app_worker (A2c, WS1).
 */
export async function partnerConsoleOrigin(
  tx: ContextTransaction,
  partnerId: string,
): Promise<string> {
  const [partner, domains] = await Promise.all([
    tx.partner.findUnique({
      where: { id: partnerId },
      select: { isHouse: true },
    }),
    tx.partnerDomain.findMany({
      where: { partnerId, status: "active" },
      orderBy: { host: "asc" },
      select: { host: true, kind: true },
    }),
  ]);
  const house = !partner || partner.isHouse || partnerId === HOUSE_PARTNER_ID;
  const domain = domains.find((d) => d.kind === "custom") ?? domains[0] ?? null;
  return house || !domain
    ? appConfig.url
    : partnerHostOrigin(domain.host, process.env);
}
