import type { PrismaClient } from "@prisma/client";

import { withContext, type RequestContext } from "@/lib/prisma/with-context";
import {
  agentGetItem,
  agentSearch,
  createItem,
  getCatalogProduct,
  lookupCatalog,
  searchCatalog,
  updateItem,
  updateVariant,
} from "@/modules/portfolio/server";

import type { ApiCall } from "./handler";

/**
 * REST routes of the Portfolio module (F5d): the UCP catalog (the body and
 * the response are the protocol's, without the `data` wrapper), our
 * agent's view and the item writes. All run the module services in the
 * caller's context, so module state, permission and quota apply as in the
 * screens.
 */

function ctxOf(call: ApiCall): RequestContext {
  if (!call.context) throw new Error("workspace route without context");
  return call.context;
}

function run<T>(
  prisma: PrismaClient,
  call: ApiCall,
  fn: (
    tx: Parameters<Parameters<typeof withContext<T>>[2]>[0],
    ctx: RequestContext,
  ) => Promise<T>,
): Promise<T> {
  const ctx = ctxOf(call);
  return withContext(prisma, ctx, (tx) => fn(tx, ctx));
}

export const searchPortfolioCatalog = (prisma: PrismaClient, call: ApiCall) =>
  run(prisma, call, (tx, ctx) => searchCatalog(tx, ctx, call.body));

export const lookupPortfolioCatalog = (prisma: PrismaClient, call: ApiCall) =>
  run(prisma, call, (tx, ctx) => lookupCatalog(tx, ctx, call.body));

export const getPortfolioCatalogProduct = (
  prisma: PrismaClient,
  call: ApiCall,
) => run(prisma, call, (tx, ctx) => getCatalogProduct(tx, ctx, call.body));

export async function searchPortfolioForAgent(
  prisma: PrismaClient,
  call: ApiCall,
) {
  const page = await run(prisma, call, (tx, ctx) =>
    agentSearch(tx, ctx, call.query),
  );
  return { data: page.items, nextCursor: page.nextCursor };
}

export async function getPortfolioItemForAgent(
  prisma: PrismaClient,
  call: ApiCall,
) {
  return {
    data: await run(prisma, call, (tx, ctx) =>
      agentGetItem(tx, ctx, call.params.itemId ?? ""),
    ),
  };
}

export async function createPortfolioItem(prisma: PrismaClient, call: ApiCall) {
  return {
    data: await run(prisma, call, (tx, ctx) => createItem(tx, ctx, call.body)),
  };
}

export async function updatePortfolioItem(prisma: PrismaClient, call: ApiCall) {
  return {
    data: await run(prisma, call, (tx, ctx) =>
      updateItem(tx, ctx, call.params.itemId ?? "", call.body),
    ),
  };
}

export async function updatePortfolioVariant(
  prisma: PrismaClient,
  call: ApiCall,
) {
  return {
    data: await run(prisma, call, (tx, ctx) =>
      updateVariant(
        tx,
        ctx,
        call.params.itemId ?? "",
        call.params.variantId ?? "",
        call.body,
      ),
    ),
  };
}
