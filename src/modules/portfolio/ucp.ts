import { z } from "zod";

/**
 * Field shapes of the Universal Commerce Protocol used by the Portfolio
 * (docs/modules/portfolio/ucp-campos.md, commit ad9950b), and the
 * serializer of an item to a UCP Product. Names and enum values are the
 * protocol's (snake_case, lowercase). Internal management and AI
 * governance never enter the UCP output.
 */

/** UCP release the catalog responses declare (`ucp.version`, F5d). */
export const UCP_VERSION = "2026-08-25";

/** Namespace of the GUIDU extensions (decision 6; GUIDU is provisional). */
export const EXTENSION_NAMESPACE = "co.guidu";

/** Key of the vertical details in the UCP `metadata` of a product (F5b). */
export function extensionKey(itemType: string, vertical: string): string {
  return vertical === "general"
    ? `${EXTENSION_NAMESPACE}.portfolio.${itemType}`
    : `${EXTENSION_NAMESPACE}.portfolio.${itemType}.${vertical}`;
}

const reverseDomain = z
  .string()
  .regex(/^[a-z][a-z0-9-]*(\.[a-z0-9_-]+)+$/, "Use um identificador reverso.");
const httpsUrl = z
  .string()
  .trim()
  .max(2000)
  .url("URL inválida.")
  .refine((u) => /^https?:\/\//.test(u), "Use http ou https.");

export const UcpDescription = z
  .object({
    plain: z.string().trim().max(10000).optional(),
    markdown: z.string().trim().max(10000).optional(),
  })
  .strict();

export const UcpCategory = z
  .object({
    value: z.string().trim().min(1).max(200),
    taxonomy: z.string().trim().min(1).max(64).optional(),
  })
  .strict();

export const UcpMedia = z
  .object({
    type: z.enum(["image", "video", "external_video", "model_3d"]),
    url: httpsUrl,
    alt_text: z.string().trim().max(300).optional(),
    name: z.string().trim().max(120).optional(),
  })
  .strict();

export const UcpPolicy = z
  .object({
    type: reverseDomain,
    description: z
      .object({ plain: z.string().trim().min(1).max(2000) })
      .strict(),
    url: httpsUrl.optional(),
  })
  .strict();

export const UcpLink = z
  .object({
    type: z.string().trim().min(1).max(64),
    url: httpsUrl,
    title: z.string().trim().max(120).optional(),
  })
  .strict();

export const UcpRating = z
  .object({
    value: z.number().min(0),
    scale_min: z.number().optional(),
    scale_max: z.number().positive(),
    count: z.number().int().min(0).optional(),
  })
  .strict();

export const UcpBarcode = z
  .object({
    type: z.string().trim().min(2).max(16),
    value: z.string().trim().min(1).max(64),
  })
  .strict();

export const UcpPrice = z
  .object({
    amount: z.number().int().min(0).max(100_000_000_000),
    currency: z.string().regex(/^[A-Z]{3}$/),
  })
  .strict();

/** UN/CEFACT Rec 20 sale basis (C62 unidade, KGM kg, HUR hora…). */
export const UcpQuantityUnit = z
  .object({
    unit: z.string().regex(/^[A-Z0-9]{2,3}$/),
    scale: z.number().int().min(0).max(15).optional(),
    display_text: z.string().trim().min(1).max(40),
    increment: z.number().int().min(1).optional(),
  })
  .strict();

export const UcpSelectedOption = z
  .object({
    name: z.string().trim().min(1).max(60),
    label: z.string().trim().min(1).max(60),
    id: z.string().trim().max(60).optional(),
  })
  .strict();

export const AVAILABILITY_STATUSES = [
  "in_stock",
  "backorder",
  "preorder",
  "out_of_stock",
  "discontinued",
] as const;

export const FULFILLMENT_METHODS = [
  "shipping",
  "pickup",
  "digital",
  "on_site",
] as const;

/** Sale bases offered on the forms (UN/CEFACT codes, decision 4). */
export const SALE_UNITS = [
  { unit: "C62", display_text: "unidade" },
  { unit: "KGM", display_text: "kg" },
  { unit: "LTR", display_text: "litro" },
  { unit: "MTK", display_text: "m²" },
  { unit: "HUR", display_text: "hora" },
  { unit: "DAY", display_text: "dia" },
  { unit: "IE", display_text: "pessoa" },
  { unit: "MON", display_text: "mês" },
] as const;

// ---------------------------------------------------------------------------
// Serializer: item + variants -> UCP Product
// ---------------------------------------------------------------------------

export type SerializableVariant = Readonly<{
  id: string;
  title: string;
  sku: string | null;
  barcodes: z.infer<typeof UcpBarcode>[];
  priceAmount: number | null;
  listPriceAmount: number | null;
  currency: string;
  quantityUnit: z.infer<typeof UcpQuantityUnit> | null;
  options: z.infer<typeof UcpSelectedOption>[];
  media: z.infer<typeof UcpMedia>[];
  availabilityStatus: (typeof AVAILABILITY_STATUSES)[number];
  trackInventory: boolean;
  stockQuantity: number | null;
  allowBackorder: boolean;
}>;

export type SerializableItem = Readonly<{
  id: string;
  title: string;
  handle: string;
  description: z.infer<typeof UcpDescription>;
  categories: z.infer<typeof UcpCategory>[];
  media: z.infer<typeof UcpMedia>[];
  tags: string[];
  url: string | null;
  rating: z.infer<typeof UcpRating> | null;
  priceDisplay: "price" | "from" | "quote";
  /** Kind and vertical extension (F5b); out through `metadata`. */
  itemType?: string;
  vertical?: string;
  details?: Record<string, unknown>;
  status: string;
  visibility: string;
  aiDiscoveryEnabled: boolean;
}>;

/** UCP availability of a variant, from its status and internal stock. */
export function variantAvailability(v: SerializableVariant): {
  available: boolean;
  status: (typeof AVAILABILITY_STATUSES)[number];
} {
  if (v.availabilityStatus === "discontinued") {
    return { available: false, status: "discontinued" };
  }
  if (v.trackInventory) {
    if ((v.stockQuantity ?? 0) > 0)
      return { available: true, status: "in_stock" };
    return v.allowBackorder
      ? { available: true, status: "backorder" }
      : { available: false, status: "out_of_stock" };
  }
  return {
    available: v.availabilityStatus !== "out_of_stock",
    status: v.availabilityStatus,
  };
}

/**
 * Whether the item may leave through UCP (decisions 1 and 3): active,
 * public, open to AI discovery and with a price (quote items are offered
 * only by our own agent).
 */
export function isUcpVisible(item: SerializableItem): boolean {
  return (
    item.status === "active" &&
    item.visibility === "public" &&
    item.aiDiscoveryEnabled &&
    item.priceDisplay !== "quote"
  );
}

function ucpDescription(d: SerializableItem["description"], title: string) {
  const out: { plain?: string; markdown?: string } = {};
  if (d.plain) out.plain = d.plain;
  if (d.markdown) out.markdown = d.markdown;
  return Object.keys(out).length ? out : { plain: title };
}

function price(amount: number, currency: string) {
  return { amount, currency };
}

/**
 * UCP Product of an item. Returns null when no variant has a price (quote
 * items), since UCP requires `price_range` and a price on every variant.
 */
export function toUcpProduct(
  item: SerializableItem,
  variants: readonly SerializableVariant[],
): Record<string, unknown> | null {
  const priced = variants.filter((v) => v.priceAmount !== null);
  if (priced.length === 0 || priced.length !== variants.length) return null;
  const currency = priced[0]!.currency;
  const amounts = priced.map((v) => v.priceAmount!);
  const lists = priced.map((v) => v.listPriceAmount ?? v.priceAmount!);
  const description = ucpDescription(item.description, item.title);

  const optionNames: string[] = [];
  const optionValues = new Map<string, string[]>();
  for (const v of variants) {
    for (const o of v.options) {
      if (!optionValues.has(o.name)) {
        optionNames.push(o.name);
        optionValues.set(o.name, []);
      }
      const values = optionValues.get(o.name)!;
      if (!values.includes(o.label)) values.push(o.label);
    }
  }

  const product: Record<string, unknown> = {
    id: item.id,
    handle: item.handle,
    title: item.title,
    description,
    price_range: {
      min: price(Math.min(...amounts), currency),
      max: price(Math.max(...amounts), currency),
    },
    variants: variants.map((v) => {
      const variant: Record<string, unknown> = {
        id: v.id,
        title: v.title,
        description,
        price: price(v.priceAmount!, v.currency),
        availability: variantAvailability(v),
      };
      if (v.sku) variant.sku = v.sku;
      if (v.barcodes.length) variant.barcodes = v.barcodes;
      if (v.listPriceAmount !== null && v.listPriceAmount > v.priceAmount!) {
        variant.list_price = price(v.listPriceAmount, v.currency);
      }
      if (v.quantityUnit) variant.quantity_unit = v.quantityUnit;
      if (v.options.length) variant.options = v.options;
      if (v.media.length) variant.media = v.media;
      return variant;
    }),
  };
  if (lists.some((l, i) => l > amounts[i]!)) {
    product.list_price_range = {
      min: price(Math.min(...lists), currency),
      max: price(Math.max(...lists), currency),
    };
  }
  if (item.url) product.url = item.url;
  if (item.categories.length) product.categories = item.categories;
  if (item.media.length) product.media = item.media;
  if (optionNames.length) {
    product.options = optionNames.map((name) => ({
      name,
      values: optionValues.get(name)!.map((label) => ({ label })),
    }));
  }
  if (item.rating) product.rating = item.rating;
  if (item.tags.length) product.tags = item.tags;
  if (item.itemType && item.details && Object.keys(item.details).length) {
    product.metadata = {
      [extensionKey(item.itemType, item.vertical ?? "general")]: item.details,
    };
  }
  return product;
}
