import type {
  ContextTransaction,
  RequestContext,
} from "@/lib/prisma/with-context";

/**
 * Usage of the module's quotas (F3b), shown on "Consumo & Limites". The
 * limit itself comes from the plan or the manifest default.
 */
export const helloWorldQuotaUsage = {
  "hello-world.records": {
    moduleKey: "hello-world",
    scope: "workspace" as const,
    count: (tx: ContextTransaction, ctx: RequestContext) =>
      tx.helloWorldRecord.count({ where: { workspaceId: ctx.workspaceId } }),
  },
};
