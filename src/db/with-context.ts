import { Prisma, PrismaClient } from "@prisma/client";

export type RequestContext = Readonly<{
  userId: string;
  workspaceId: string;
  organizationId: string;
  principalType?: "user" | "service";
  grantId?: string | null;
}>;

export type ContextTransaction = Prisma.TransactionClient;

/** Runs all domain access in one transaction with transaction-local RLS context. */
export async function withContext<T>(
  prisma: PrismaClient,
  context: RequestContext,
  operation: (tx: ContextTransaction) => Promise<T>,
): Promise<T> {
  return prisma.$transaction(
    async (tx) => {
      await tx.$executeRaw`
        select
          set_config('app.user_id', ${context.userId}, true),
          set_config('app.workspace_id', ${context.workspaceId}, true),
          set_config('app.organization_id', ${context.organizationId}, true),
          set_config('app.principal_type', ${context.principalType ?? "user"}, true),
          set_config('app.grant_id', ${context.grantId ?? ""}, true)
      `;

      return operation(tx);
    },
    // The transaction-pool URL intentionally uses connection_limit=1. Under a
    // concurrent burst, requests must be allowed to queue for that connection.
    { maxWait: 30_000 },
  );
}

