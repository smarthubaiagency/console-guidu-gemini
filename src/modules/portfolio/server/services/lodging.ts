import "server-only";

import { z } from "zod";

import type {
  ContextTransaction,
  RequestContext,
} from "@/lib/prisma/with-context";
import { AppError } from "@/shared/errors";

import {
  AccommodationTypeInput,
  AccommodationTypeUpdateInput,
  RatePlanInput,
  RatePlanUpdateInput,
} from "../../lodging";
import {
  accommodationTypeData,
  assertLodgingReady,
  audit,
  getItem,
  invalid,
  type ItemView,
  type LodgingView,
  lockWorkspace,
  notFound,
  ratePlanData,
  writable,
} from "./items";

/**
 * Accommodation types and rate plans of a lodging item (F5c). Same checks
 * as the items: module state, permission, RLS, audit. A type or plan that
 * prices a variant cannot be removed, and an active item must stay
 * complete (property, capacity, a plan, every variant bound).
 */

const MAX_TYPES = 50;
const MAX_PLANS = 20;

async function lodgingItem(
  tx: ContextTransaction,
  ctx: RequestContext,
  itemId: string,
): Promise<ItemView & { lodging: LodgingView }> {
  await writable(tx, ctx);
  const item = await getItem(tx, ctx, itemId);
  if (!item.lodging) {
    throw new AppError({
      code: "invalid_input",
      safeMessage: "Acomodação e tarifa existem só na hospedagem.",
    });
  }
  return item as ItemView & { lodging: LodgingView };
}

function uuidOrNotFound(id: string, what: string): void {
  if (!z.string().uuid().safeParse(id).success) throw notFound(what);
}

export async function addAccommodationType(
  tx: ContextTransaction,
  ctx: RequestContext,
  itemId: string,
  input: unknown,
): Promise<ItemView> {
  const parsed = AccommodationTypeInput.safeParse(input);
  const item = await lodgingItem(tx, ctx, itemId);
  if (!parsed.success) throw invalid(parsed.error);
  await lockWorkspace(tx, ctx);
  if (item.lodging.accommodationTypes.length >= MAX_TYPES) {
    throw new AppError({
      code: "conflict",
      safeMessage: `Limite de ${MAX_TYPES} acomodações por hospedagem.`,
    });
  }
  const position =
    Math.max(-1, ...item.lodging.accommodationTypes.map((t) => t.position)) + 1;
  const created = await tx.portfolioAccommodationType.create({
    data: {
      ...accommodationTypeData(parsed.data),
      position,
      itemId: item.id,
      organizationId: ctx.organizationId,
      workspaceId: ctx.workspaceId,
      createdBy: ctx.userId,
    },
  });
  await audit(
    tx,
    ctx,
    "portfolio.accommodation_type.create",
    "portfolio_accommodation_type",
    created.id,
  );
  return getItem(tx, ctx, item.id);
}

export async function updateAccommodationType(
  tx: ContextTransaction,
  ctx: RequestContext,
  itemId: string,
  typeId: string,
  input: unknown,
): Promise<ItemView> {
  const parsed = AccommodationTypeUpdateInput.safeParse(input);
  const item = await lodgingItem(tx, ctx, itemId);
  uuidOrNotFound(typeId, "Acomodação");
  if (!item.lodging.accommodationTypes.some((t) => t.id === typeId)) {
    throw notFound("Acomodação");
  }
  if (!parsed.success) throw invalid(parsed.error);
  await tx.portfolioAccommodationType.updateMany({
    where: { id: typeId, itemId: item.id, workspaceId: ctx.workspaceId },
    data: { ...accommodationTypeData(parsed.data), updatedBy: ctx.userId },
  });
  await audit(
    tx,
    ctx,
    "portfolio.accommodation_type.update",
    "portfolio_accommodation_type",
    typeId,
  );
  return assertLodgingReady(await getItem(tx, ctx, item.id));
}

export async function removeAccommodationType(
  tx: ContextTransaction,
  ctx: RequestContext,
  itemId: string,
  typeId: string,
): Promise<ItemView> {
  const item = await lodgingItem(tx, ctx, itemId);
  uuidOrNotFound(typeId, "Acomodação");
  if (!item.lodging.accommodationTypes.some((t) => t.id === typeId)) {
    throw notFound("Acomodação");
  }
  if (item.variants.some((v) => v.accommodationTypeId === typeId)) {
    throw new AppError({
      code: "conflict",
      safeMessage:
        "Esta acomodação tem preços. Remova ou troque esses preços antes.",
    });
  }
  await tx.portfolioAccommodationType.deleteMany({
    where: { id: typeId, itemId: item.id, workspaceId: ctx.workspaceId },
  });
  await audit(
    tx,
    ctx,
    "portfolio.accommodation_type.delete",
    "portfolio_accommodation_type",
    typeId,
  );
  return assertLodgingReady(await getItem(tx, ctx, item.id));
}

export async function addRatePlan(
  tx: ContextTransaction,
  ctx: RequestContext,
  itemId: string,
  input: unknown,
): Promise<ItemView> {
  const parsed = RatePlanInput.safeParse(input);
  const item = await lodgingItem(tx, ctx, itemId);
  if (!parsed.success) throw invalid(parsed.error);
  await lockWorkspace(tx, ctx);
  if (item.lodging.ratePlans.length >= MAX_PLANS) {
    throw new AppError({
      code: "conflict",
      safeMessage: `Limite de ${MAX_PLANS} tarifas por hospedagem.`,
    });
  }
  const position =
    Math.max(-1, ...item.lodging.ratePlans.map((p) => p.position)) + 1;
  const created = await tx.portfolioRatePlan.create({
    data: {
      ...ratePlanData(parsed.data),
      position,
      itemId: item.id,
      organizationId: ctx.organizationId,
      workspaceId: ctx.workspaceId,
      createdBy: ctx.userId,
    },
  });
  await audit(
    tx,
    ctx,
    "portfolio.rate_plan.create",
    "portfolio_rate_plan",
    created.id,
  );
  return getItem(tx, ctx, item.id);
}

export async function updateRatePlan(
  tx: ContextTransaction,
  ctx: RequestContext,
  itemId: string,
  planId: string,
  input: unknown,
): Promise<ItemView> {
  const parsed = RatePlanUpdateInput.safeParse(input);
  const item = await lodgingItem(tx, ctx, itemId);
  uuidOrNotFound(planId, "Tarifa");
  if (!item.lodging.ratePlans.some((p) => p.id === planId)) {
    throw notFound("Tarifa");
  }
  if (!parsed.success) throw invalid(parsed.error);
  await tx.portfolioRatePlan.updateMany({
    where: { id: planId, itemId: item.id, workspaceId: ctx.workspaceId },
    data: { ...ratePlanData(parsed.data), updatedBy: ctx.userId },
  });
  await audit(
    tx,
    ctx,
    "portfolio.rate_plan.update",
    "portfolio_rate_plan",
    planId,
  );
  return getItem(tx, ctx, item.id);
}

export async function removeRatePlan(
  tx: ContextTransaction,
  ctx: RequestContext,
  itemId: string,
  planId: string,
): Promise<ItemView> {
  const item = await lodgingItem(tx, ctx, itemId);
  uuidOrNotFound(planId, "Tarifa");
  if (!item.lodging.ratePlans.some((p) => p.id === planId)) {
    throw notFound("Tarifa");
  }
  if (item.variants.some((v) => v.ratePlanId === planId)) {
    throw new AppError({
      code: "conflict",
      safeMessage:
        "Esta tarifa tem preços. Remova ou troque esses preços antes.",
    });
  }
  await tx.portfolioRatePlan.deleteMany({
    where: { id: planId, itemId: item.id, workspaceId: ctx.workspaceId },
  });
  await audit(
    tx,
    ctx,
    "portfolio.rate_plan.delete",
    "portfolio_rate_plan",
    planId,
  );
  return assertLodgingReady(await getItem(tx, ctx, item.id));
}
