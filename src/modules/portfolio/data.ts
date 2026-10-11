import type { ModuleDataContract } from "@/core/privacy/contract";

/** Export and purge of the Portfolio (F3e contract, F5a). */
export const portfolioDataContract: ModuleDataContract = {
  moduleKey: "portfolio",
  async export(tx, ctx) {
    const [items, variants] = await Promise.all([
      tx.portfolioItem.findMany({
        where: { workspaceId: ctx.workspaceId },
        orderBy: { createdAt: "asc" },
      }),
      tx.portfolioVariant.findMany({
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
    };
  },
  async purge(tx, workspaceId) {
    const variants = await tx.portfolioVariant.deleteMany({
      where: { workspaceId },
    });
    const items = await tx.portfolioItem.deleteMany({ where: { workspaceId } });
    return { portfolio_variants: variants.count, portfolio_items: items.count };
  },
};
