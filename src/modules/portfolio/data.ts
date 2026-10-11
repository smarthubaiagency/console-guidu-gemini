import type { ModuleDataContract } from "@/core/privacy/contract";

/** Export and purge of the Portfolio (F3e contract, F5a; lodging F5c). */
export const portfolioDataContract: ModuleDataContract = {
  moduleKey: "portfolio",
  async export(tx, ctx) {
    const [items, variants, accommodationTypes, ratePlans] = await Promise.all([
      tx.portfolioItem.findMany({
        where: { workspaceId: ctx.workspaceId },
        orderBy: { createdAt: "asc" },
      }),
      tx.portfolioVariant.findMany({
        where: { workspaceId: ctx.workspaceId },
        orderBy: [{ itemId: "asc" }, { position: "asc" }],
      }),
      tx.portfolioAccommodationType.findMany({
        where: { workspaceId: ctx.workspaceId },
        orderBy: [{ itemId: "asc" }, { position: "asc" }],
      }),
      tx.portfolioRatePlan.findMany({
        where: { workspaceId: ctx.workspaceId },
        orderBy: [{ itemId: "asc" }, { position: "asc" }],
      }),
    ]);
    return {
      items,
      variants: variants.map((v) => ({
        ...v,
        priceAmount: v.priceAmount === null ? null : Number(v.priceAmount),
        listPriceAmount:
          v.listPriceAmount === null ? null : Number(v.listPriceAmount),
      })),
      accommodation_types: accommodationTypes,
      rate_plans: ratePlans,
    };
  },
  async purge(tx, workspaceId) {
    const variants = await tx.portfolioVariant.deleteMany({
      where: { workspaceId },
    });
    const types = await tx.portfolioAccommodationType.deleteMany({
      where: { workspaceId },
    });
    const plans = await tx.portfolioRatePlan.deleteMany({
      where: { workspaceId },
    });
    const items = await tx.portfolioItem.deleteMany({ where: { workspaceId } });
    return {
      portfolio_variants: variants.count,
      portfolio_accommodation_types: types.count,
      portfolio_rate_plans: plans.count,
      portfolio_items: items.count,
    };
  },
};
