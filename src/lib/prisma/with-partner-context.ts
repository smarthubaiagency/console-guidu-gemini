import { PrismaClient } from "@prisma/client";

import type { ContextTransaction } from "./with-context";

/**
 * Partner-scoped transaction without an identity (ADR 0012): reads public
 * data of the request host's partner, such as its brand, before sign-in.
 * Policies that need `app.user_id` find none and deny.
 */
export async function withPartnerContext<T>(
  prisma: PrismaClient,
  partnerId: string,
  operation: (tx: ContextTransaction) => Promise<T>,
): Promise<T> {
  return prisma.$transaction(async (tx) => {
    await tx.$executeRaw`select set_config('app.partner_id', ${partnerId}, true)`;
    return operation(tx);
  });
}
