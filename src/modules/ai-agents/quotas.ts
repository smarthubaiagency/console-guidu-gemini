import type {
  ContextTransaction,
  RequestContext,
} from "@/lib/prisma/with-context";

/** Usage of the AI agents quota (A1), shown on "Consumo & Limites". */
export const aiAgentsQuotaUsage = {
  "ai-agents.max": {
    moduleKey: "ai-agents",
    scope: "workspace" as const,
    count: (tx: ContextTransaction, ctx: RequestContext) =>
      tx.aiAgent.count({
        where: { workspaceId: ctx.workspaceId, kind: "guid" },
      }),
  },
};
