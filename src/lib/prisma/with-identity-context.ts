import { PrismaClient } from "@prisma/client";

import type { ContextTransaction } from "./with-context";

/**
 * Identity-scoped sibling of `withContext` for the rows that belong to a user
 * rather than to a workspace — today only `profiles`.
 *
 * Sign-in happens before any workspace is resolved, so `app.workspace_id` and
 * `app.organization_id` are deliberately left empty: policies that need them
 * find no context and deny, which is the behaviour we want.
 */
export async function withIdentityContext<T>(
  prisma: PrismaClient,
  userId: string,
  operation: (tx: ContextTransaction) => Promise<T>,
): Promise<T> {
  return prisma.$transaction(async (tx) => {
    await tx.$executeRaw`
      select
        set_config('app.user_id', ${userId}, true),
        set_config('app.principal_type', 'user', true)
    `;

    return operation(tx);
  });
}
