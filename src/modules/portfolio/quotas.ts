import type {
  ContextTransaction,
  RequestContext,
} from "@/lib/prisma/with-context";

/** Usage of the Portfolio quotas (F5a), shown on "Consumo & Limites". */
export const portfolioQuotaUsage = {
  "portfolio.items": {
    moduleKey: "portfolio",
    scope: "workspace" as const,
    count: (tx: ContextTransaction, ctx: RequestContext) =>
      tx.portfolioItem.count({ where: { workspaceId: ctx.workspaceId } }),
  },
  "portfolio.variants": {
    moduleKey: "portfolio",
    scope: "workspace" as const,
    count: (tx: ContextTransaction, ctx: RequestContext) =>
      tx.portfolioVariant.count({ where: { workspaceId: ctx.workspaceId } }),
  },
};
