import "server-only";

import { Prisma } from "@prisma/client";
import { z } from "zod";

import { decodeCursor, pageOf } from "@/core/api/pagination";
import { recordAudit } from "@/core/audit/record";
import { assertWithinQuota, resolveQuota } from "@/core/entitlements/quotas";
import { activeLocationIds } from "@/core/locations/service";
import { assertModuleOperational } from "@/core/module-runtime/state";
import { requireWorkspacePermission } from "@/core/permissions/guard";
import type {
  ContextTransaction,
  RequestContext,
} from "@/lib/prisma/with-context";
import { AppError } from "@/shared/errors";

import { PortfolioPermissions, PortfolioQuotas } from "../../manifest";
import {
  AVAILABILITY_STATUSES,
  FULFILLMENT_METHODS,
  type SerializableItem,
  type SerializableVariant,
  toUcpProduct,
  UcpBarcode,
  UcpCategory,
  UcpDescription,
  UcpLink,
  UcpMedia,
  UcpPolicy,
  UcpPrice,
  UcpQuantityUnit,
  UcpRating,
  UcpSelectedOption,
} from "../../ucp";

/**
 * Items and variants of the Portfolio (F5a). The same services serve the
 * screens, and later the REST API, the MCP and the proposals (F5d): each
 * one checks the module state, the permission and the quota, and RLS
 * repeats tenant and role. Input and output use the UCP names.
 *
 * F5a accepts `item_type = product` with the `general` vertical; the other
 * types and verticals arrive with their `details` validation in F5b/F5c.
 */

const MODULE_KEY = "portfolio";

const tagList = (max: number, each = 60) =>
  z.array(z.string().trim().min(1).max(each)).max(max);

const handleSchema = z
  .string()
  .trim()
  .min(1)
  .max(200)
  .regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, "Use letras minúsculas, números e hífen.");

const itemFields = {
  item_type: z.literal("product", {
    error:
      "Nesta etapa o Portfólio cadastra produtos; as demais categorias chegam na F5b.",
  }),
  vertical: z.literal("general"),
  title: z.string().trim().min(1, "Informe o título.").max(200),
  handle: handleSchema,
  description: UcpDescription,
  categories: z.array(UcpCategory).max(20),
  media: z.array(UcpMedia).max(20),
  tags: tagList(20),
  url: z.string().trim().url().max(2000).nullable(),
  rating: UcpRating.nullable(),
  fulfillment_methods: z.array(z.enum(FULFILLMENT_METHODS)).max(4),
  location_ids: z.array(z.string().uuid()).max(50),
  policies: z.array(UcpPolicy).max(20),
  links: z.array(UcpLink).max(20),
  price_display: z.enum(["price", "from", "quote"]),
  status: z.enum(["draft", "active", "inactive", "archived"]),
  visibility: z.enum(["public", "internal"]),
  priority: z.number().int().min(-1000).max(1000),
  is_featured: z.boolean(),
  featured_rank: z.number().int().min(0).max(1000),
  availability_mode: z.enum([
    "always",
    "schedule",
    "stock",
    "calendar",
    "seasonal",
  ]),
  ai_discovery_enabled: z.boolean(),
  ai_keywords: tagList(50),
  ai_aliases: tagList(30),
  ai_do_not_say: tagList(30, 120),
  ai_safety_rules: z.string().trim().max(2000).nullable(),
};

/** Variant fields without defaults (updates change only what is sent). */
const variantShape = {
  title: z.string().trim().min(1, "Informe o nome da variante.").max(200),
  sku: z.string().trim().min(1).max(64).nullable().optional(),
  barcodes: z.array(UcpBarcode).max(10),
  price: UcpPrice.nullable().optional(),
  list_price: UcpPrice.nullable().optional(),
  quantity_unit: UcpQuantityUnit.nullable().optional(),
  options: z.array(UcpSelectedOption).max(10),
  media: z.array(UcpMedia).max(20),
  availability_status: z.enum(AVAILABILITY_STATUSES),
  track_inventory: z.boolean(),
  stock_quantity: z
    .number()
    .int()
    .min(-1_000_000)
    .max(100_000_000)
    .nullable()
    .optional(),
  min_stock_alert: z
    .number()
    .int()
    .min(0)
    .max(100_000_000)
    .nullable()
    .optional(),
  allow_backorder: z.boolean(),
};

const VariantFields = z
  .object({
    ...variantShape,
    barcodes: variantShape.barcodes.default([]),
    options: variantShape.options.default([]),
    media: variantShape.media.default([]),
    availability_status: variantShape.availability_status.default("in_stock"),
    track_inventory: variantShape.track_inventory.default(false),
    allow_backorder: variantShape.allow_backorder.default(false),
  })
  .strict();

export const VariantInput = VariantFields.refine(
  (v) => !v.price || !v.list_price || v.list_price.amount >= v.price.amount,
  "O preço cheio não pode ser menor que o preço atual.",
).refine(
  (v) =>
    !v.price || !v.list_price || v.list_price.currency === v.price.currency,
  "Preço e preço cheio precisam da mesma moeda.",
);

export const VariantUpdateInput = z.object(variantShape).partial().strict();

export const ItemCreateInput = z
  .object({
    ...itemFields,
    handle: handleSchema.optional(),
    vertical: itemFields.vertical.default("general"),
    description: UcpDescription.default({}),
    categories: itemFields.categories.default([]),
    media: itemFields.media.default([]),
    tags: itemFields.tags.default([]),
    url: itemFields.url.optional(),
    rating: itemFields.rating.optional(),
    fulfillment_methods: itemFields.fulfillment_methods.default([]),
    location_ids: itemFields.location_ids.default([]),
    policies: itemFields.policies.default([]),
    links: itemFields.links.default([]),
    price_display: itemFields.price_display.default("price"),
    status: itemFields.status.default("draft"),
    visibility: itemFields.visibility.default("public"),
    priority: itemFields.priority.default(0),
    is_featured: itemFields.is_featured.default(false),
    featured_rank: itemFields.featured_rank.default(0),
    availability_mode: itemFields.availability_mode.default("always"),
    ai_discovery_enabled: itemFields.ai_discovery_enabled.default(true),
    ai_keywords: itemFields.ai_keywords.default([]),
    ai_aliases: itemFields.ai_aliases.default([]),
    ai_do_not_say: itemFields.ai_do_not_say.default([]),
    ai_safety_rules: itemFields.ai_safety_rules.optional(),
    variants: z
      .array(VariantInput)
      .min(1, "Informe ao menos uma variante.")
      .max(100),
  })
  .strict();

export const ItemUpdateInput = z
  .object(itemFields)
  .omit({ item_type: true, vertical: true })
  .partial()
  .strict()
  .refine((v) => Object.keys(v).length > 0, "Nada para alterar.");

export type VariantView = SerializableVariant &
  Readonly<{ position: number; minStockAlert: number | null }>;

export type ItemView = SerializableItem &
  Readonly<{
    itemType: string;
    vertical: string;
    fulfillmentMethods: string[];
    locationIds: string[];
    policies: z.infer<typeof UcpPolicy>[];
    links: z.infer<typeof UcpLink>[];
    priority: number;
    isFeatured: boolean;
    featuredRank: number;
    availabilityMode: string;
    aiKeywords: string[];
    aiAliases: string[];
    aiDoNotSay: string[];
    aiSafetyRules: string | null;
    createdAt: string;
    updatedAt: string;
    variants: VariantView[];
  }>;

type ItemRow = Prisma.PortfolioItemGetPayload<object>;
type VariantRow = Prisma.PortfolioVariantGetPayload<object>;

function json<T>(value: Prisma.JsonValue | null, fallback: T): T {
  return (value ?? fallback) as T;
}

function toVariantView(row: VariantRow): VariantView {
  return {
    id: row.id,
    position: row.position,
    title: row.title,
    sku: row.sku,
    barcodes: json(row.barcodes, []),
    priceAmount: row.priceAmount === null ? null : Number(row.priceAmount),
    listPriceAmount:
      row.listPriceAmount === null ? null : Number(row.listPriceAmount),
    currency: row.currency,
    quantityUnit: json(row.quantityUnit, null),
    options: json(row.options, []),
    media: json(row.media, []),
    availabilityStatus:
      row.availabilityStatus as VariantView["availabilityStatus"],
    trackInventory: row.trackInventory,
    stockQuantity: row.stockQuantity,
    minStockAlert: row.minStockAlert,
    allowBackorder: row.allowBackorder,
  };
}

function toItemView(row: ItemRow, variants: VariantRow[]): ItemView {
  return {
    id: row.id,
    itemType: row.itemType,
    vertical: row.vertical,
    title: row.title,
    handle: row.handle,
    description: json(row.description, {}),
    categories: json(row.categories, []),
    media: json(row.media, []),
    tags: row.tags,
    url: row.url,
    rating: json(row.rating, null),
    fulfillmentMethods: row.fulfillmentMethods,
    locationIds: row.locationIds,
    policies: json(row.policies, []),
    links: json(row.links, []),
    priceDisplay: row.priceDisplay as ItemView["priceDisplay"],
    status: row.status,
    visibility: row.visibility,
    priority: row.priority,
    isFeatured: row.isFeatured,
    featuredRank: row.featuredRank,
    availabilityMode: row.availabilityMode,
    aiDiscoveryEnabled: row.aiDiscoveryEnabled,
    aiKeywords: row.aiKeywords,
    aiAliases: row.aiAliases,
    aiDoNotSay: row.aiDoNotSay,
    aiSafetyRules: row.aiSafetyRules,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    variants: variants
      .sort((a, b) => a.position - b.position || +a.createdAt - +b.createdAt)
      .map(toVariantView),
  };
}

/** UCP Product of an item view (null for quote items). */
export function itemToUcp(item: ItemView): Record<string, unknown> | null {
  return toUcpProduct(item, item.variants);
}

function invalid(error: z.ZodError): AppError {
  const issue = error.issues[0];
  return new AppError({
    code: "invalid_input",
    safeMessage: issue
      ? `${issue.path.join(".") || "item"}: ${issue.message}`
      : "Dados do item inválidos.",
  });
}

function notFound(what = "Item"): AppError {
  return new AppError({
    code: "not_found",
    safeMessage: `${what} não encontrado.`,
  });
}

/** URL-friendly handle from a title ("Camiseta Básica" -> "camiseta-basica"). */
export function handleFromTitle(title: string): string {
  const base = title
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 180);
  return base || "item";
}

async function uniqueHandle(
  tx: ContextTransaction,
  ctx: RequestContext,
  base: string,
): Promise<string> {
  const taken = new Set(
    (
      await tx.portfolioItem.findMany({
        where: { workspaceId: ctx.workspaceId, handle: { startsWith: base } },
        select: { handle: true },
      })
    ).map((r) => r.handle),
  );
  if (!taken.has(base)) return base;
  for (let n = 2; n < 1000; n += 1) {
    if (!taken.has(`${base}-${n}`)) return `${base}-${n}`;
  }
  return `${base}-${Date.now().toString(36)}`;
}

function checkPrices(
  priceDisplay: string,
  variants: readonly Readonly<{
    price?: { currency: string } | null | undefined;
  }>[],
): void {
  if (priceDisplay !== "quote" && variants.some((v) => !v.price)) {
    throw new AppError({
      code: "invalid_input",
      safeMessage:
        "Informe o preço de cada variante, ou marque o item como sob consulta.",
    });
  }
  const currencies = new Set(
    variants.flatMap((v) => (v.price ? [v.price.currency] : [])),
  );
  if (currencies.size > 1) {
    throw new AppError({
      code: "invalid_input",
      safeMessage: "Todas as variantes de um item usam a mesma moeda.",
    });
  }
}

async function checkLocations(
  tx: ContextTransaction,
  ctx: RequestContext,
  ids: readonly string[],
): Promise<void> {
  const unique = [...new Set(ids)];
  const found = await activeLocationIds(tx, ctx, unique);
  if (found.length !== unique.length) {
    throw new AppError({
      code: "invalid_input",
      safeMessage: "Uma das lojas não existe ou está desativada.",
    });
  }
}

async function lockWorkspace(tx: ContextTransaction, ctx: RequestContext) {
  await tx.$executeRaw`select pg_advisory_xact_lock(hashtext(${`portfolio:${ctx.workspaceId}`}))`;
}

async function assertQuotas(
  tx: ContextTransaction,
  ctx: RequestContext,
  addItems: number,
  addVariants: number,
): Promise<void> {
  const [items, variants, itemQuota, variantQuota] = await Promise.all([
    tx.portfolioItem.count({ where: { workspaceId: ctx.workspaceId } }),
    tx.portfolioVariant.count({ where: { workspaceId: ctx.workspaceId } }),
    resolveQuota(tx, ctx.organizationId, PortfolioQuotas.ITEMS),
    resolveQuota(tx, ctx.organizationId, PortfolioQuotas.VARIANTS),
  ]);
  if (addItems)
    assertWithinQuota(itemQuota, items, "itens do portfólio", addItems);
  if (addVariants) {
    assertWithinQuota(
      variantQuota,
      variants,
      "variantes do portfólio",
      addVariants,
    );
  }
}

function variantData(v: z.output<typeof VariantInput>) {
  return {
    title: v.title,
    sku: v.sku ?? null,
    barcodes: v.barcodes,
    priceAmount: v.price ? BigInt(v.price.amount) : null,
    listPriceAmount: v.list_price ? BigInt(v.list_price.amount) : null,
    currency: v.price?.currency ?? v.list_price?.currency ?? "BRL",
    quantityUnit: v.quantity_unit ?? Prisma.DbNull,
    options: v.options,
    media: v.media,
    availabilityStatus: v.availability_status,
    trackInventory: v.track_inventory,
    stockQuantity: v.stock_quantity ?? null,
    minStockAlert: v.min_stock_alert ?? null,
    allowBackorder: v.allow_backorder,
  };
}

function skuConflict(error: unknown): never {
  if (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === "P2002"
  ) {
    throw new AppError({
      code: "conflict",
      safeMessage: "Este SKU ou endereço (handle) já está em uso no workspace.",
    });
  }
  throw error;
}

function audit(
  tx: ContextTransaction,
  ctx: RequestContext,
  action: string,
  resourceType: string,
  resourceId: string,
) {
  return recordAudit(tx, ctx, {
    action,
    resourceType,
    resourceId,
    result: "success",
    origin: ctx.principalType === "api_key" ? "api" : "app",
  });
}

export const ListItemsQuery = z.object({
  search: z.string().trim().max(100).optional(),
  status: z.enum(["draft", "active", "inactive", "archived"]).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(25),
  cursor: z.string().max(200).optional(),
});

/** Items, newest first; archived ones only when asked by status. */
export async function listItems(
  tx: ContextTransaction,
  ctx: RequestContext,
  query: z.input<typeof ListItemsQuery> = {},
): Promise<{ items: ItemView[]; nextCursor: string | null }> {
  await assertModuleOperational(tx, ctx, MODULE_KEY, "read");
  await requireWorkspacePermission(tx, ctx, PortfolioPermissions.ITEMS_READ);
  const q = ListItemsQuery.parse(query);
  const cursor = decodeCursor(q.cursor);
  const pattern = q.search
    ? `%${q.search.replace(/[\\%_]/g, (c) => `\\${c}`)}%`
    : null;
  const ids = await tx.$queryRaw<
    { id: string; cursor_t: string; cursor_id: string }[]
  >`
    select id, created_at::text as cursor_t, id::text as cursor_id
    from public.portfolio_items
    where workspace_id = ${ctx.workspaceId}::uuid
      and (${q.status ?? null}::text is null and status <> 'archived'
           or status = ${q.status ?? null}::text)
      and (${pattern}::text is null or title ilike ${pattern} or handle ilike ${pattern})
      and (${cursor === null}::boolean
           or (created_at, id) < (${cursor?.t ?? null}::timestamptz, ${cursor?.id ?? null}::uuid))
    order by created_at desc, id desc
    limit ${q.limit + 1}
  `;
  const { items: page, nextCursor } = pageOf(ids, q.limit);
  if (page.length === 0) return { items: [], nextCursor: null };
  const rows = await tx.portfolioItem.findMany({
    where: { workspaceId: ctx.workspaceId, id: { in: page.map((r) => r.id) } },
    include: { variants: true },
  });
  const byId = new Map(rows.map((r) => [r.id, r]));
  return {
    items: page.flatMap((p) => {
      const row = byId.get(p.id);
      return row ? [toItemView(row, row.variants)] : [];
    }),
    nextCursor,
  };
}

export async function getItem(
  tx: ContextTransaction,
  ctx: RequestContext,
  itemId: string,
): Promise<ItemView> {
  await assertModuleOperational(tx, ctx, MODULE_KEY, "read");
  await requireWorkspacePermission(tx, ctx, PortfolioPermissions.ITEMS_READ);
  if (!z.string().uuid().safeParse(itemId).success) throw notFound();
  const row = await tx.portfolioItem.findFirst({
    where: { id: itemId, workspaceId: ctx.workspaceId },
    include: { variants: true },
  });
  if (!row) throw notFound();
  return toItemView(row, row.variants);
}

async function writable(tx: ContextTransaction, ctx: RequestContext) {
  await assertModuleOperational(tx, ctx, MODULE_KEY, "write");
  await requireWorkspacePermission(tx, ctx, PortfolioPermissions.ITEMS_WRITE);
}

/** Creates an item with its variants (at least one), under the quotas. */
export async function createItem(
  tx: ContextTransaction,
  ctx: RequestContext,
  input: unknown,
): Promise<ItemView> {
  await writable(tx, ctx);
  const parsed = ItemCreateInput.safeParse(input);
  if (!parsed.success) throw invalid(parsed.error);
  const d = parsed.data;
  checkPrices(d.price_display, d.variants);
  await checkLocations(tx, ctx, d.location_ids);
  await lockWorkspace(tx, ctx);
  await assertQuotas(tx, ctx, 1, d.variants.length);
  const handle =
    d.handle ?? (await uniqueHandle(tx, ctx, handleFromTitle(d.title)));

  let itemId: string;
  try {
    const item = await tx.portfolioItem.create({
      data: {
        organizationId: ctx.organizationId,
        workspaceId: ctx.workspaceId,
        itemType: d.item_type,
        vertical: d.vertical,
        title: d.title,
        handle,
        description: d.description,
        categories: d.categories,
        media: d.media,
        tags: d.tags,
        url: d.url ?? null,
        rating: d.rating ?? Prisma.DbNull,
        fulfillmentMethods: d.fulfillment_methods,
        locationIds: [...new Set(d.location_ids)],
        policies: d.policies,
        links: d.links,
        priceDisplay: d.price_display,
        status: d.status,
        visibility: d.visibility,
        priority: d.priority,
        isFeatured: d.is_featured,
        featuredRank: d.featured_rank,
        availabilityMode: d.availability_mode,
        aiDiscoveryEnabled: d.ai_discovery_enabled,
        aiKeywords: d.ai_keywords,
        aiAliases: d.ai_aliases,
        aiDoNotSay: d.ai_do_not_say,
        aiSafetyRules: d.ai_safety_rules ?? null,
        createdBy: ctx.userId,
      },
    });
    itemId = item.id;
    for (const [position, v] of d.variants.entries()) {
      await tx.portfolioVariant.create({
        data: {
          ...variantData(v),
          position,
          itemId,
          organizationId: ctx.organizationId,
          workspaceId: ctx.workspaceId,
          createdBy: ctx.userId,
        },
      });
    }
  } catch (error) {
    skuConflict(error);
  }
  await audit(tx, ctx, "portfolio.item.create", "portfolio_item", itemId);
  return getItem(tx, ctx, itemId);
}

/** Changes only the fields sent; variants have their own services. */
export async function updateItem(
  tx: ContextTransaction,
  ctx: RequestContext,
  itemId: string,
  input: unknown,
): Promise<ItemView> {
  await writable(tx, ctx);
  const parsed = ItemUpdateInput.safeParse(input);
  if (!parsed.success) throw invalid(parsed.error);
  const current = await getItem(tx, ctx, itemId);
  const d = parsed.data;
  if (d.price_display !== undefined) {
    checkPrices(
      d.price_display,
      current.variants.map((v) => ({
        price: v.priceAmount === null ? null : { currency: v.currency },
      })),
    );
  }
  if (d.location_ids) await checkLocations(tx, ctx, d.location_ids);
  const data: Prisma.PortfolioItemUpdateManyMutationInput = {
    ...(d.title !== undefined ? { title: d.title } : {}),
    ...(d.handle !== undefined ? { handle: d.handle } : {}),
    ...(d.description !== undefined ? { description: d.description } : {}),
    ...(d.categories !== undefined ? { categories: d.categories } : {}),
    ...(d.media !== undefined ? { media: d.media } : {}),
    ...(d.tags !== undefined ? { tags: d.tags } : {}),
    ...(d.url !== undefined ? { url: d.url } : {}),
    ...(d.rating !== undefined ? { rating: d.rating ?? Prisma.DbNull } : {}),
    ...(d.fulfillment_methods !== undefined
      ? { fulfillmentMethods: d.fulfillment_methods }
      : {}),
    ...(d.location_ids !== undefined
      ? { locationIds: [...new Set(d.location_ids)] }
      : {}),
    ...(d.policies !== undefined ? { policies: d.policies } : {}),
    ...(d.links !== undefined ? { links: d.links } : {}),
    ...(d.price_display !== undefined ? { priceDisplay: d.price_display } : {}),
    ...(d.status !== undefined ? { status: d.status } : {}),
    ...(d.visibility !== undefined ? { visibility: d.visibility } : {}),
    ...(d.priority !== undefined ? { priority: d.priority } : {}),
    ...(d.is_featured !== undefined ? { isFeatured: d.is_featured } : {}),
    ...(d.featured_rank !== undefined ? { featuredRank: d.featured_rank } : {}),
    ...(d.availability_mode !== undefined
      ? { availabilityMode: d.availability_mode }
      : {}),
    ...(d.ai_discovery_enabled !== undefined
      ? { aiDiscoveryEnabled: d.ai_discovery_enabled }
      : {}),
    ...(d.ai_keywords !== undefined ? { aiKeywords: d.ai_keywords } : {}),
    ...(d.ai_aliases !== undefined ? { aiAliases: d.ai_aliases } : {}),
    ...(d.ai_do_not_say !== undefined ? { aiDoNotSay: d.ai_do_not_say } : {}),
    ...(d.ai_safety_rules !== undefined
      ? { aiSafetyRules: d.ai_safety_rules }
      : {}),
    updatedBy: ctx.userId,
  };
  try {
    await tx.portfolioItem.updateMany({
      where: { id: current.id, workspaceId: ctx.workspaceId },
      data,
    });
  } catch (error) {
    skuConflict(error);
  }
  await audit(tx, ctx, "portfolio.item.update", "portfolio_item", current.id);
  return getItem(tx, ctx, current.id);
}

export async function addVariant(
  tx: ContextTransaction,
  ctx: RequestContext,
  itemId: string,
  input: unknown,
): Promise<ItemView> {
  await writable(tx, ctx);
  const parsed = VariantInput.safeParse(input);
  if (!parsed.success) throw invalid(parsed.error);
  const item = await getItem(tx, ctx, itemId);
  checkPrices(item.priceDisplay, [
    ...item.variants.map((v) => ({
      price: v.priceAmount === null ? null : { currency: v.currency },
    })),
    parsed.data,
  ]);
  await lockWorkspace(tx, ctx);
  await assertQuotas(tx, ctx, 0, 1);
  const position = Math.max(-1, ...item.variants.map((v) => v.position)) + 1;
  let variantId: string;
  try {
    const created = await tx.portfolioVariant.create({
      data: {
        ...variantData(parsed.data),
        position,
        itemId: item.id,
        organizationId: ctx.organizationId,
        workspaceId: ctx.workspaceId,
        createdBy: ctx.userId,
      },
    });
    variantId = created.id;
  } catch (error) {
    skuConflict(error);
  }
  await audit(
    tx,
    ctx,
    "portfolio.variant.create",
    "portfolio_variant",
    variantId,
  );
  return getItem(tx, ctx, item.id);
}

export async function updateVariant(
  tx: ContextTransaction,
  ctx: RequestContext,
  itemId: string,
  variantId: string,
  input: unknown,
): Promise<ItemView> {
  await writable(tx, ctx);
  const parsed = VariantUpdateInput.safeParse(input);
  if (!parsed.success) throw invalid(parsed.error);
  const item = await getItem(tx, ctx, itemId);
  const current = item.variants.find((v) => v.id === variantId);
  if (!current) throw notFound("Variante");
  const d = parsed.data;
  const merged = VariantInput.safeParse({
    title: d.title ?? current.title,
    sku: d.sku !== undefined ? d.sku : current.sku,
    price:
      d.price !== undefined
        ? d.price
        : current.priceAmount === null
          ? null
          : { amount: current.priceAmount, currency: current.currency },
    list_price:
      d.list_price !== undefined
        ? d.list_price
        : current.listPriceAmount === null
          ? null
          : { amount: current.listPriceAmount, currency: current.currency },
  });
  if (!merged.success) throw invalid(merged.error);
  checkPrices(
    item.priceDisplay,
    item.variants.map((v) =>
      v.id === variantId
        ? { price: merged.data.price ?? null }
        : { price: v.priceAmount === null ? null : { currency: v.currency } },
    ),
  );
  const data: Prisma.PortfolioVariantUpdateManyMutationInput = {
    ...(d.title !== undefined ? { title: d.title } : {}),
    ...(d.sku !== undefined ? { sku: d.sku } : {}),
    ...(d.barcodes !== undefined ? { barcodes: d.barcodes } : {}),
    ...(d.price !== undefined
      ? {
          priceAmount: d.price ? BigInt(d.price.amount) : null,
          ...(d.price ? { currency: d.price.currency } : {}),
        }
      : {}),
    ...(d.list_price !== undefined
      ? { listPriceAmount: d.list_price ? BigInt(d.list_price.amount) : null }
      : {}),
    ...(d.quantity_unit !== undefined
      ? { quantityUnit: d.quantity_unit ?? Prisma.DbNull }
      : {}),
    ...(d.options !== undefined ? { options: d.options } : {}),
    ...(d.media !== undefined ? { media: d.media } : {}),
    ...(d.availability_status !== undefined
      ? { availabilityStatus: d.availability_status }
      : {}),
    ...(d.track_inventory !== undefined
      ? { trackInventory: d.track_inventory }
      : {}),
    ...(d.stock_quantity !== undefined
      ? { stockQuantity: d.stock_quantity }
      : {}),
    ...(d.min_stock_alert !== undefined
      ? { minStockAlert: d.min_stock_alert }
      : {}),
    ...(d.allow_backorder !== undefined
      ? { allowBackorder: d.allow_backorder }
      : {}),
    updatedBy: ctx.userId,
  };
  try {
    await tx.portfolioVariant.updateMany({
      where: { id: variantId, itemId: item.id, workspaceId: ctx.workspaceId },
      data,
    });
  } catch (error) {
    skuConflict(error);
  }
  await audit(
    tx,
    ctx,
    "portfolio.variant.update",
    "portfolio_variant",
    variantId,
  );
  return getItem(tx, ctx, item.id);
}

/** Removes a variant; the last one of an item stays (UCP needs one). */
export async function removeVariant(
  tx: ContextTransaction,
  ctx: RequestContext,
  itemId: string,
  variantId: string,
): Promise<ItemView> {
  await writable(tx, ctx);
  const item = await getItem(tx, ctx, itemId);
  if (!item.variants.some((v) => v.id === variantId))
    throw notFound("Variante");
  await lockWorkspace(tx, ctx);
  const remaining = await tx.portfolioVariant.count({
    where: { itemId: item.id, workspaceId: ctx.workspaceId },
  });
  if (remaining <= 1) {
    throw new AppError({
      code: "conflict",
      safeMessage: "Todo item precisa de ao menos uma variante.",
    });
  }
  await tx.portfolioVariant.deleteMany({
    where: { id: variantId, itemId: item.id, workspaceId: ctx.workspaceId },
  });
  await audit(
    tx,
    ctx,
    "portfolio.variant.delete",
    "portfolio_variant",
    variantId,
  );
  return getItem(tx, ctx, item.id);
}
