"use server";

import { revalidatePath } from "next/cache";
import { getTranslations } from "next-intl/server";
import { z } from "zod";

import { getPlatformAdminMember } from "@/core/admin/platform";
import { requireMfa, requireUser } from "@/core/auth/identity";
import { actionFailure } from "@/core/i18n/errors";
import { savePlatformModuleConfig } from "@/core/module-runtime/settings";
import type { PartnerActionState } from "@/core/partners/actions";
import { resolveRequestWorkspaceContext } from "@/core/partners/request-context";
import { prisma } from "@/lib/prisma/client";
import { withContext } from "@/lib/prisma/with-context";
import { withIdentityContext } from "@/lib/prisma/with-identity-context";
import { AppError } from "@/shared/errors";

import { NIGHT_UNIT } from "../lodging";
import { PortfolioQuotas } from "../manifest";
import { SALE_UNITS } from "../ucp";
import { detailsFromForm } from "../verticals";
import {
  addVariant,
  createItem,
  removeVariant,
  updateItem,
  updateVariant,
} from "./services/items";
import {
  addAccommodationType,
  addRatePlan,
  removeAccommodationType,
  removeRatePlan,
  updateAccommodationType,
  updateRatePlan,
} from "./services/lodging";

/** Server actions of the Portfolio screens (F5a). */

type State = PartnerActionState;

function str(formData: FormData, name: string): string | undefined {
  const value = formData.get(name);
  const text = typeof value === "string" ? value.trim() : "";
  return text.length ? text : undefined;
}

function bool(formData: FormData, name: string): boolean {
  return formData.get(name) === "on";
}

/** "49,90" or "1.234,56" -> minor units (cents); empty -> null. */
function cents(formData: FormData, name: string): number | null {
  const raw = str(formData, name);
  if (raw === undefined) return null;
  const normalized = raw
    .replace(/[R$\s]/g, "")
    .replace(/\./g, "")
    .replace(",", ".");
  const value = Number(normalized);
  if (!Number.isFinite(value) || value < 0) {
    throw new AppError({
      code: "invalid_input",
      safeMessage: `Valor inválido em ${name}: use, por exemplo, 49,90.`,
      messageKey: "portfolio.errors.invalidAmount",
      messageValues: { field: name },
    });
  }
  return Math.round(value * 100);
}

function int(formData: FormData, name: string): number | null {
  const raw = str(formData, name);
  return raw === undefined ? null : Number.parseInt(raw, 10);
}

/** Comma or line separated list, without empty entries. */
function list(formData: FormData, name: string): string[] {
  return (str(formData, name) ?? "")
    .split(/[\n,]/)
    .map((s) => s.trim())
    .filter(Boolean);
}

/** Lines "a | b" -> pairs. */
function pairs(
  formData: FormData,
  name: string,
): [string, string | undefined][] {
  return (str(formData, name) ?? "")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const [a, b] = line.split("|").map((s) => s.trim());
      return [a ?? "", b || undefined];
    });
}

function price(formData: FormData, name: string) {
  const amount = cents(formData, name);
  return amount === null ? null : { amount, currency: "BRL" };
}

function variantFromForm(formData: FormData) {
  const unit = SALE_UNITS.find((u) => u.unit === str(formData, "unit"));
  // Lodging (F5c): the nightly price of an accommodation type and a plan.
  const lodging =
    formData.get("lodging") === "1"
      ? {
          accommodation_type_id: str(formData, "accommodation_type_id") ?? null,
          rate_plan_id: str(formData, "rate_plan_id") ?? null,
        }
      : null;
  return {
    ...lodging,
    title: str(formData, "variant_title") ?? "Padrão",
    sku: str(formData, "sku") ?? null,
    barcodes: pairs(formData, "barcodes").map(([type, value]) =>
      value
        ? { type: type.toUpperCase(), value }
        : { type: "GTIN", value: type },
    ),
    price: price(formData, "price"),
    list_price: price(formData, "list_price"),
    quantity_unit: lodging
      ? { ...NIGHT_UNIT }
      : unit && unit.unit !== "C62"
        ? { unit: unit.unit, display_text: unit.display_text }
        : null,
    options: (str(formData, "options") ?? "")
      .split(/[;\n]/)
      .map((s) => s.trim())
      .filter(Boolean)
      .map((pair) => {
        const [name, label] = pair.split(":").map((s) => s.trim());
        return { name: name ?? "", label: label ?? "" };
      }),
    availability_status: str(formData, "availability_status") ?? "in_stock",
    track_inventory: bool(formData, "track_inventory"),
    stock_quantity: int(formData, "stock_quantity"),
    min_stock_alert: int(formData, "min_stock_alert"),
    allow_backorder: bool(formData, "allow_backorder"),
  };
}

async function context(formData: FormData) {
  const identity = await requireUser();
  const workspaceSlug = z
    .string()
    .min(1)
    .max(64)
    .parse(formData.get("workspaceSlug"));
  const ctx = await resolveRequestWorkspaceContext(
    prisma,
    identity.userId,
    workspaceSlug,
  );
  return { workspaceSlug, ctx };
}

const uuid = (formData: FormData, name: string) =>
  z.string().uuid().parse(formData.get(name));

export async function createPortfolioItemAction(
  _prev: State,
  formData: FormData,
): Promise<State> {
  try {
    const { workspaceSlug, ctx } = await context(formData);
    const priceDisplay = str(formData, "price_display") ?? "price";
    const [itemType, vertical] = (
      str(formData, "kind") ?? "product:general"
    ).split(":");
    const item = await withContext(prisma, ctx, (tx) =>
      createItem(tx, ctx, {
        item_type: itemType,
        vertical: vertical ?? "general",
        title: str(formData, "title") ?? "",
        description: { plain: str(formData, "description_plain") },
        price_display: priceDisplay,
        status: str(formData, "status") ?? "draft",
        variants: [variantFromForm(formData)],
      }),
    );
    revalidatePath(`/app/${workspaceSlug}/portfolio`);
    const t = await getTranslations("portfolio");
    return {
      success: true,
      message: t("actions.itemCreated"),
      redirectTo: `/app/${workspaceSlug}/portfolio/${item.id}`,
    };
  } catch (err) {
    return actionFailure(err);
  }
}

export async function updatePortfolioItemAction(
  _prev: State,
  formData: FormData,
): Promise<State> {
  try {
    const { workspaceSlug, ctx } = await context(formData);
    const itemId = uuid(formData, "itemId");
    await withContext(prisma, ctx, (tx) =>
      updateItem(tx, ctx, itemId, {
        title: str(formData, "title") ?? "",
        handle: str(formData, "handle") ?? "",
        description: {
          ...(str(formData, "description_plain")
            ? { plain: str(formData, "description_plain") }
            : {}),
          ...(str(formData, "description_markdown")
            ? { markdown: str(formData, "description_markdown") }
            : {}),
        },
        categories: pairs(formData, "categories").map(([value, taxonomy]) => ({
          value,
          taxonomy: taxonomy ?? "merchant",
        })),
        media: pairs(formData, "media").map(([url, alt]) => ({
          type: "image",
          url,
          ...(alt ? { alt_text: alt } : {}),
        })),
        tags: list(formData, "tags"),
        url: str(formData, "url") ?? null,
        fulfillment_methods: formData.getAll("fulfillment_methods"),
        location_ids: formData.getAll("location_ids").filter(Boolean),
        price_display: str(formData, "price_display") ?? "price",
        status: str(formData, "status") ?? "draft",
        visibility: str(formData, "visibility") ?? "public",
        priority: int(formData, "priority") ?? 0,
        is_featured: bool(formData, "is_featured"),
        featured_rank: int(formData, "featured_rank") ?? 0,
        ai_discovery_enabled: bool(formData, "ai_discovery_enabled"),
        ai_keywords: list(formData, "ai_keywords"),
        ai_aliases: list(formData, "ai_aliases"),
        ai_do_not_say: list(formData, "ai_do_not_say"),
        ai_safety_rules: str(formData, "ai_safety_rules") ?? null,
        details: detailsFromForm(
          str(formData, "item_type") ?? "",
          str(formData, "vertical") ?? "",
          formData,
        ),
      }),
    );
    revalidatePath(`/app/${workspaceSlug}/portfolio`);
    const t = await getTranslations("portfolio");
    return { success: true, message: t("actions.itemSaved") };
  } catch (err) {
    return actionFailure(err);
  }
}

export async function addPortfolioVariantAction(
  _prev: State,
  formData: FormData,
): Promise<State> {
  try {
    const { workspaceSlug, ctx } = await context(formData);
    const itemId = uuid(formData, "itemId");
    await withContext(prisma, ctx, (tx) =>
      addVariant(tx, ctx, itemId, variantFromForm(formData)),
    );
    revalidatePath(`/app/${workspaceSlug}/portfolio/${itemId}`);
    const t = await getTranslations("portfolio");
    return { success: true, message: t("actions.variantAdded") };
  } catch (err) {
    return actionFailure(err);
  }
}

export async function updatePortfolioVariantAction(
  _prev: State,
  formData: FormData,
): Promise<State> {
  try {
    const { workspaceSlug, ctx } = await context(formData);
    const itemId = uuid(formData, "itemId");
    const variantId = uuid(formData, "variantId");
    await withContext(prisma, ctx, (tx) =>
      formData.get("remove") === "1"
        ? removeVariant(tx, ctx, itemId, variantId)
        : updateVariant(tx, ctx, itemId, variantId, variantFromForm(formData)),
    );
    revalidatePath(`/app/${workspaceSlug}/portfolio/${itemId}`);
    const t = await getTranslations("portfolio");
    return {
      success: true,
      message: t(
        formData.get("remove") === "1"
          ? "actions.variantRemoved"
          : "actions.variantSaved",
      ),
    };
  } catch (err) {
    return actionFailure(err);
  }
}

function accommodationTypeFromForm(formData: FormData) {
  const capacity = {
    ...(int(formData, "capacity_adults") !== null
      ? { adults: int(formData, "capacity_adults") }
      : {}),
    ...(int(formData, "capacity_children") !== null
      ? { children: int(formData, "capacity_children") }
      : {}),
    ...(int(formData, "capacity_total") !== null
      ? { total: int(formData, "capacity_total") }
      : {}),
  };
  const ranges = pairs(formData, "child_age_ranges").map(([range, limit]) => {
    const [min, max] = range.split("-").map((n) => Number.parseInt(n, 10));
    return {
      ages: { min, max: max ?? min },
      ...(limit ? { limit: Number.parseInt(limit, 10) } : {}),
    };
  });
  return {
    title: str(formData, "type_title") ?? "",
    description: str(formData, "type_description") ?? null,
    accommodation_kind: str(formData, "accommodation_kind") ?? null,
    capacity: ranges.length
      ? { ...capacity, child_age_ranges: ranges }
      : capacity,
    bedrooms: int(formData, "bedrooms"),
    beds_count: int(formData, "beds_count"),
    bathrooms: int(formData, "bathrooms"),
    amenities: formData.getAll("type_amenities").map(String),
    media: pairs(formData, "type_media").map(([url, alt]) => ({
      type: "image",
      url,
      ...(alt ? { alt_text: alt } : {}),
    })),
  };
}

function ratePlanFromForm(formData: FormData) {
  return {
    title: str(formData, "plan_title") ?? "",
    description: str(formData, "plan_description") ?? null,
    refundability: str(formData, "refundability") ?? "refundable",
    cancellation_policy: str(formData, "cancellation_policy") ?? null,
    free_cancellation_hours: int(formData, "free_cancellation_hours"),
    board: str(formData, "board") ?? "room_only",
  };
}

/** Adds, edits (`typeId`) or removes (`remove=1`) an accommodation type. */
export async function saveAccommodationTypeAction(
  _prev: State,
  formData: FormData,
): Promise<State> {
  try {
    const { workspaceSlug, ctx } = await context(formData);
    const itemId = uuid(formData, "itemId");
    const typeId = str(formData, "typeId");
    const remove = formData.get("remove") === "1";
    await withContext(prisma, ctx, (tx) =>
      typeId === undefined
        ? addAccommodationType(
            tx,
            ctx,
            itemId,
            accommodationTypeFromForm(formData),
          )
        : remove
          ? removeAccommodationType(tx, ctx, itemId, typeId)
          : updateAccommodationType(
              tx,
              ctx,
              itemId,
              typeId,
              accommodationTypeFromForm(formData),
            ),
    );
    revalidatePath(`/app/${workspaceSlug}/portfolio/${itemId}`);
    const t = await getTranslations("portfolio");
    return {
      success: true,
      message: t(
        typeId === undefined
          ? "actions.typeAdded"
          : remove
            ? "actions.typeRemoved"
            : "actions.typeSaved",
      ),
    };
  } catch (err) {
    return actionFailure(err);
  }
}

/** Adds, edits (`planId`) or removes (`remove=1`) a rate plan. */
export async function saveRatePlanAction(
  _prev: State,
  formData: FormData,
): Promise<State> {
  try {
    const { workspaceSlug, ctx } = await context(formData);
    const itemId = uuid(formData, "itemId");
    const planId = str(formData, "planId");
    const remove = formData.get("remove") === "1";
    await withContext(prisma, ctx, (tx) =>
      planId === undefined
        ? addRatePlan(tx, ctx, itemId, ratePlanFromForm(formData))
        : remove
          ? removeRatePlan(tx, ctx, itemId, planId)
          : updateRatePlan(tx, ctx, itemId, planId, ratePlanFromForm(formData)),
    );
    revalidatePath(`/app/${workspaceSlug}/portfolio/${itemId}`);
    const t = await getTranslations("portfolio");
    return {
      success: true,
      message: t(
        planId === undefined
          ? "actions.planAdded"
          : remove
            ? "actions.planRemoved"
            : "actions.planSaved",
      ),
    };
  } catch (err) {
    return actionFailure(err);
  }
}

/** Plataforma › Configurações de módulos › Portfólio: default quotas. */
export async function savePortfolioAdminSettingsAction(
  _prev: State,
  formData: FormData,
): Promise<State> {
  try {
    const identity = await requireMfa();
    const admin = await getPlatformAdminMember(prisma, identity.userId);
    const quotaDefaults = Object.fromEntries(
      [PortfolioQuotas.ITEMS, PortfolioQuotas.VARIANTS].flatMap((key) => {
        const value = int(formData, key);
        return value === null ? [] : [[key, value]];
      }),
    );
    await withIdentityContext(prisma, identity.userId, (tx) =>
      savePlatformModuleConfig(
        tx,
        identity.userId,
        admin?.role ?? null,
        "portfolio",
        Object.keys(quotaDefaults).length ? { quotaDefaults } : {},
      ),
    );
    revalidatePath("/platform/settings/modules/portfolio");
    const t = await getTranslations("portfolio");
    return { success: true, message: t("actions.adminSaved") };
  } catch (err) {
    return actionFailure(err);
  }
}
