import "server-only";

import { Prisma } from "@prisma/client";
import { z } from "zod";

import { assertModuleOperational } from "@/core/module-runtime/state";
import { requireWorkspacePermission } from "@/core/permissions/guard";
import type {
  ContextTransaction,
  RequestContext,
} from "@/lib/prisma/with-context";
import { AppError } from "@/shared/errors";

import { PortfolioPermissions } from "../../manifest";
import { UCP_VERSION } from "../../ucp";
import { ITEM_TYPES } from "../../verticals";
import { type ItemView, itemToUcp, loadItemViews } from "./items";

/**
 * Catalog of the Portfolio in the UCP format (F5d, decisions 1, 3 and 7):
 * `search_catalog`, `lookup_catalog` and `get_product` of the UCP catalog
 * capabilities (`shopping/catalog_search.json`, `catalog_lookup.json`,
 * release 2026-08-25), served by the REST API and the MCP.
 *
 * Only items that may leave through UCP are found: active, public, open to
 * AI discovery and with a price (quote items are offered only by our own
 * agent). Internal management, AI governance and stock never leave.
 *
 * The agent view (`agentSearch`, `agentGetItem`) is ours: the AI Agents
 * module and external agents with the `portfolio:agent` scope. It adds
 * the quote items and the AI governance, apart from the UCP output.
 */

const SEARCH = "dev.ucp.shopping.catalog.search";
const LOOKUP = "dev.ucp.shopping.catalog.lookup";
const MODULE_KEY = "portfolio";

/** Largest batch of `lookup_catalog`; more is refused, as UCP asks. */
export const MAX_LOOKUP_IDS = 50;
const DEFAULT_PAGE = 10;
const MAX_PAGE = 50;

type Json = Record<string, unknown>;

function envelope(capability: string, status?: "error") {
  return {
    version: UCP_VERSION,
    ...(status ? { status } : {}),
    capabilities: { [capability]: [{ version: UCP_VERSION }] },
  };
}

const Filters = z.looseObject({
  categories: z.array(z.string().max(200)).max(20).optional(),
  price: z
    .looseObject({
      min: z.number().int().min(0).optional(),
      max: z.number().int().min(0).optional(),
    })
    .optional(),
});

/** Context, signals and attribution are accepted and not used yet. */
const Common = {
  filters: Filters.optional(),
  context: z.unknown().optional(),
  signals: z.unknown().optional(),
  attribution: z.unknown().optional(),
};

export const SearchRequest = z.looseObject({
  query: z.string().max(200).optional(),
  pagination: z
    .looseObject({
      cursor: z.string().max(200).optional(),
      limit: z.number().int().min(1).optional(),
    })
    .optional(),
  ...Common,
});

export const LookupRequest = z.looseObject({
  ids: z.array(z.string().min(1).max(200)).min(1),
  ...Common,
});

const Selected = z.looseObject({
  name: z.string().min(1).max(60),
  label: z.string().min(1).max(200),
  id: z.string().max(200).optional(),
});

export const GetProductRequest = z.looseObject({
  id: z.string().min(1).max(200),
  selected: z.array(Selected).max(10).optional(),
  preferences: z.array(z.string().max(60)).max(10).optional(),
  ...Common,
});

type Filter = z.infer<typeof Filters>;

function parse<T extends z.ZodType>(schema: T, input: unknown): z.output<T> {
  const parsed = schema.safeParse(input ?? {});
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    throw new AppError({
      code: "invalid_input",
      safeMessage: issue
        ? `${issue.path.join(".") || "pedido"}: ${issue.message}`
        : "Pedido inválido.",
    });
  }
  return parsed.data;
}

async function access(tx: ContextTransaction, ctx: RequestContext) {
  await assertModuleOperational(tx, ctx, MODULE_KEY, "read");
  await requireWorkspacePermission(tx, ctx, PortfolioPermissions.ITEMS_READ);
}

const isUuid = (v: string) => z.string().uuid().safeParse(v).success;

function encodeOffset(offset: number): string {
  return Buffer.from(JSON.stringify({ o: offset })).toString("base64url");
}

function decodeOffset(cursor: string | undefined): number {
  if (!cursor) return 0;
  try {
    const value = JSON.parse(Buffer.from(cursor, "base64url").toString()) as {
      o?: unknown;
    };
    if (Number.isInteger(value.o) && (value.o as number) >= 0) {
      return value.o as number;
    }
  } catch {
    // fall through
  }
  throw new AppError({
    code: "invalid_input",
    safeMessage: "Cursor inválido.",
  });
}

type Audience = "ucp" | "agent";

/** Items that may leave: UCP (with price) or our agent (quote too). */
function visibleSql(audience: Audience): Prisma.Sql {
  return audience === "ucp"
    ? Prisma.sql`i.status = 'active' and i.visibility = 'public'
        and i.ai_discovery_enabled and i.price_display <> 'quote'`
    : Prisma.sql`i.status = 'active' and i.visibility = 'public'
        and i.ai_discovery_enabled`;
}

function textSql(query: string | undefined, audience: Audience): Prisma.Sql {
  const words = (query ?? "")
    .split(/\s+/)
    .map((w) => w.trim())
    .filter(Boolean)
    .slice(0, 8);
  if (words.length === 0) return Prisma.sql`true`;
  return Prisma.join(
    words.map((word) => {
      const pattern = `%${word.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
      // Keywords and aliases help the search, never leave in the output.
      return Prisma.sql`(i.title ilike ${pattern}
        or i.handle ilike ${pattern}
        or i.description->>'plain' ilike ${pattern}
        or array_to_string(i.tags, ' ') ilike ${pattern}
        or array_to_string(i.ai_keywords, ' ') ilike ${pattern}
        or array_to_string(i.ai_aliases, ' ') ilike ${pattern}
        or exists (select 1 from jsonb_array_elements(i.categories) c
                   where c->>'value' ilike ${pattern})
        ${audience === "agent" ? Prisma.sql`or i.vertical ilike ${pattern}` : Prisma.empty})`;
    }),
    " and ",
  );
}

function filterSql(filters: Filter | undefined): Prisma.Sql {
  const parts: Prisma.Sql[] = [];
  if (filters?.categories?.length) {
    parts.push(Prisma.sql`exists (select 1 from jsonb_array_elements(i.categories) c
      where c->>'value' = any(${filters.categories}::text[]))`);
  }
  const min = filters?.price?.min;
  const max = filters?.price?.max;
  if (min !== undefined || max !== undefined) {
    parts.push(Prisma.sql`exists (select 1 from public.portfolio_variants v
      where v.item_id = i.id and v.workspace_id = i.workspace_id
        and v.price_amount is not null
        and (${min ?? null}::bigint is null or v.price_amount >= ${min ?? null}::bigint)
        and (${max ?? null}::bigint is null or v.price_amount <= ${max ?? null}::bigint))`);
  }
  return parts.length ? Prisma.join(parts, " and ") : Prisma.sql`true`;
}

async function searchIds(
  tx: ContextTransaction,
  ctx: RequestContext,
  audience: Audience,
  where: Prisma.Sql,
  offset: number,
  limit: number,
): Promise<{ ids: string[]; total: number }> {
  const rows = await tx.$queryRaw<{ id: string; total: bigint }[]>`
    select i.id, count(*) over () as total
    from public.portfolio_items i
    where i.workspace_id = ${ctx.workspaceId}::uuid
      and ${visibleSql(audience)}
      and ${where}
    order by i.is_featured desc, i.featured_rank asc, i.priority desc,
             i.created_at desc, i.id desc
    offset ${offset} limit ${limit}
  `;
  if (rows.length === 0 && offset > 0) {
    const [count] = await tx.$queryRaw<{ total: bigint }[]>`
      select count(*) as total from public.portfolio_items i
      where i.workspace_id = ${ctx.workspaceId}::uuid
        and ${visibleSql(audience)} and ${where}
    `;
    return { ids: [], total: Number(count?.total ?? 0) };
  }
  return { ids: rows.map((r) => r.id), total: Number(rows[0]?.total ?? 0) };
}

function inPrice(variant: Json, filters: Filter | undefined): boolean {
  const amount = (variant.price as { amount: number } | undefined)?.amount;
  if (amount === undefined) return false;
  const { min, max } = filters?.price ?? {};
  return (
    (min === undefined || amount >= min) && (max === undefined || amount <= max)
  );
}

/** UCP product of a visible item, with the variants inside the filters. */
function ucpProduct(view: ItemView, filters: Filter | undefined): Json | null {
  const product = itemToUcp(view);
  if (!product) return null;
  const variants = (product.variants as Json[]).filter((v) =>
    inPrice(v, filters),
  );
  if (variants.length === 0) return null;
  return { ...product, variants };
}

/** UCP `search_catalog`. */
export async function searchCatalog(
  tx: ContextTransaction,
  ctx: RequestContext,
  input: unknown,
): Promise<Json> {
  await access(tx, ctx);
  const request = parse(SearchRequest, input);
  const limit = Math.min(request.pagination?.limit ?? DEFAULT_PAGE, MAX_PAGE);
  const offset = decodeOffset(request.pagination?.cursor);
  const where = Prisma.sql`${textSql(request.query, "ucp")} and ${filterSql(request.filters)}`;
  const { ids, total } = await searchIds(tx, ctx, "ucp", where, offset, limit);
  const products = (await loadItemViews(tx, ctx, ids)).flatMap((view) => {
    const product = ucpProduct(view, request.filters);
    return product ? [product] : [];
  });
  const hasNext = offset + ids.length < total;
  return {
    ucp: envelope(SEARCH),
    products,
    pagination: {
      has_next_page: hasNext,
      ...(hasNext ? { cursor: encodeOffset(offset + ids.length) } : {}),
      total_count: total,
    },
  };
}

type Resolved = {
  view: ItemView;
  /** Variant id -> request ids that resolved to it, with the match type. */
  exact: Map<string, string[]>;
  /** Request ids that resolved to the product (id or handle). */
  featured: string[];
};

/** Resolves product ids, variant ids, SKUs and handles to visible items. */
async function resolveIds(
  tx: ContextTransaction,
  ctx: RequestContext,
  ids: readonly string[],
): Promise<{ resolved: Resolved[]; missing: string[] }> {
  const uuids = ids.filter(isUuid).map((id) => id.toLowerCase());
  const others = ids.filter((id) => !isUuid(id));
  const [items, variants] = await Promise.all([
    tx.$queryRaw<{ id: string; handle: string }[]>`
      select i.id, i.handle from public.portfolio_items i
      where i.workspace_id = ${ctx.workspaceId}::uuid and ${visibleSql("ucp")}
        and (i.id = any(${uuids}::uuid[]) or i.handle = any(${others}::text[]))
    `,
    tx.$queryRaw<{ id: string; item_id: string; sku: string | null }[]>`
      select v.id, v.item_id, v.sku from public.portfolio_variants v
      join public.portfolio_items i on i.id = v.item_id and i.workspace_id = v.workspace_id
      where v.workspace_id = ${ctx.workspaceId}::uuid and ${visibleSql("ucp")}
        and (v.id = any(${uuids}::uuid[]) or v.sku = any(${others}::text[]))
    `,
  ]);
  const order: string[] = [];
  const byItem = new Map<
    string,
    { exact: Map<string, string[]>; featured: string[] }
  >();
  const entry = (itemId: string) => {
    let e = byItem.get(itemId);
    if (!e) {
      e = { exact: new Map(), featured: [] };
      byItem.set(itemId, e);
      order.push(itemId);
    }
    return e;
  };
  const found = new Set<string>();
  for (const id of ids) {
    const key = isUuid(id) ? id.toLowerCase() : id;
    const item = items.find((i) => i.id === key || i.handle === key);
    if (item) {
      entry(item.id).featured.push(id);
      found.add(id);
    }
    for (const v of variants.filter((v) => v.id === key || v.sku === key)) {
      const e = entry(v.item_id);
      e.exact.set(v.id, [...(e.exact.get(v.id) ?? []), id]);
      found.add(id);
    }
  }
  const views = await loadItemViews(tx, ctx, order);
  return {
    resolved: views.map((view) => ({ view, ...byItem.get(view.id)! })),
    missing: ids.filter((id) => !found.has(id)),
  };
}

const notFoundInfo = (id: string) => ({
  type: "info",
  code: "not_found",
  content: id,
});

/** UCP `lookup_catalog`: batch by product id, variant id, SKU or handle. */
export async function lookupCatalog(
  tx: ContextTransaction,
  ctx: RequestContext,
  input: unknown,
): Promise<Json> {
  await access(tx, ctx);
  const request = parse(LookupRequest, input);
  const ids = [...new Set(request.ids)];
  if (ids.length > MAX_LOOKUP_IDS) {
    throw new AppError({
      code: "invalid_input",
      safeMessage: `Envie no máximo ${MAX_LOOKUP_IDS} identificadores por consulta.`,
    });
  }
  const { resolved, missing } = await resolveIds(tx, ctx, ids);
  const products: Json[] = [];
  for (const r of resolved) {
    const product = ucpProduct(r.view, request.filters);
    if (!product) continue;
    const variants = product.variants as Json[];
    const featuredId = variants[0]?.id as string | undefined;
    // Only variants a request id resolved to appear, with their inputs.
    const withInputs = variants.flatMap((v) => {
      const inputs = [
        ...(r.exact.get(v.id as string) ?? []).map((id) => ({
          id,
          match: "exact",
        })),
        ...(v.id === featuredId
          ? r.featured.map((id) => ({ id, match: "featured" }))
          : []),
      ];
      return inputs.length ? [{ ...v, inputs }] : [];
    });
    if (withInputs.length) products.push({ ...product, variants: withInputs });
  }
  return {
    ucp: envelope(LOOKUP),
    products,
    ...(missing.length ? { messages: missing.map(notFoundInfo) } : {}),
  };
}

type Option = { name: string; label: string };

function optionsOf(variant: Json): Option[] {
  return (variant.options as Option[] | undefined) ?? [];
}

function matches(variant: Json, selections: readonly Option[]): boolean {
  const options = optionsOf(variant);
  return selections.every((s) =>
    options.some((o) => o.name === s.name && o.label === s.label),
  );
}

const available = (variant: Json) =>
  (variant.availability as { available?: boolean } | undefined)?.available ===
  true;

/**
 * UCP `get_product`: one product with the variants of the effective
 * selection (the requested variant first) and availability signals on
 * the option values. Not found is an application outcome
 * (`ucp.status = error`), not a transport error.
 */
export async function getCatalogProduct(
  tx: ContextTransaction,
  ctx: RequestContext,
  input: unknown,
): Promise<Json> {
  await access(tx, ctx);
  const request = parse(GetProductRequest, input);
  const { resolved } = await resolveIds(tx, ctx, [request.id]);
  const hit = resolved[0];
  const product = hit ? ucpProduct(hit.view, request.filters) : null;
  if (!hit || !product) {
    return {
      ucp: envelope(LOOKUP, "error"),
      messages: [
        {
          type: "error",
          code: "not_found",
          content: `Produto não encontrado: ${request.id}`,
          severity: "unrecoverable",
        },
      ],
    };
  }
  const variants = product.variants as Json[];
  const requestedVariant = variants.find((v) => hit.exact.has(v.id as string));

  let effective: Option[];
  if (requestedVariant) {
    // The variant id fixes the selection; `selected` is ignored.
    effective = optionsOf(requestedVariant);
  } else if (request.selected?.length) {
    const unique = new Map<string, Option>();
    for (const s of request.selected) {
      if (!unique.has(s.name))
        unique.set(s.name, { name: s.name, label: s.label });
    }
    effective = [...unique.values()];
    // Relax from the end of the preferences; unranked options go first.
    const ranked = request.preferences ?? [];
    const dropOrder = [
      ...effective
        .map((s) => s.name)
        .filter((n) => !ranked.includes(n))
        .reverse(),
      ...[...ranked].reverse(),
    ];
    while (effective.length && !variants.some((v) => matches(v, effective))) {
      const next = dropOrder.shift();
      effective = next
        ? effective.filter((s) => s.name !== next)
        : effective.slice(0, -1);
    }
  } else {
    effective = optionsOf(variants.find(available) ?? variants[0]!);
  }

  const subset = variants.filter((v) => matches(v, effective));
  const featured =
    requestedVariant ?? subset.find(available) ?? subset[0] ?? variants[0]!;
  const ordered = [featured, ...subset.filter((v) => v !== featured)];

  const options = (
    product.options as
      { name: string; values: { label: string }[] }[] | undefined
  )?.map((option) => ({
    name: option.name,
    values: option.values.map((value) => {
      const others = effective.filter((s) => s.name !== option.name);
      const candidates = variants.filter((v) =>
        matches(v, [...others, { name: option.name, label: value.label }]),
      );
      return {
        ...value,
        exists: candidates.length > 0,
        available: candidates.some(available),
      };
    }),
  }));

  return {
    ucp: envelope(LOOKUP),
    product: {
      ...product,
      variants: ordered,
      ...(options ? { options, selected: effective } : {}),
    },
  };
}

// ---------------------------------------------------------------------------
// Our agent's view: governance and quote items, apart from the UCP output
// ---------------------------------------------------------------------------

export const AgentSearchQuery = z.object({
  query: z.string().max(200).optional(),
  item_type: z.enum(ITEM_TYPES).optional(),
  limit: z.coerce.number().int().min(1).max(MAX_PAGE).default(DEFAULT_PAGE),
  cursor: z.string().max(200).optional(),
});

export type AgentItem = Readonly<{
  id: string;
  handle: string;
  title: string;
  item_type: string;
  vertical: string;
  description: Json;
  price_display: "price" | "from" | "quote";
  /** Whether UCP agents also see it (false for quote items). */
  ucp_visible: boolean;
  /** UCP Product; null for quote items, which have no price. */
  product: Json | null;
  /** Variants without price, for quote items. */
  quote_variants: { id: string; title: string; options: Option[] }[];
  /** Vertical details (`co.guidu.portfolio.*`). */
  details: Json;
  location_ids: string[];
  /** AI governance: what to call it, what never to say, safety rules. */
  governance: {
    keywords: string[];
    aliases: string[];
    do_not_say: string[];
    safety_rules: string | null;
  };
}>;

export function toAgentItem(view: ItemView): AgentItem {
  const product = itemToUcp(view);
  return {
    id: view.id,
    handle: view.handle,
    title: view.title,
    item_type: view.itemType,
    vertical: view.vertical,
    description: view.description,
    price_display: view.priceDisplay,
    ucp_visible: product !== null && view.priceDisplay !== "quote",
    product,
    quote_variants: product
      ? []
      : view.variants.map((v) => ({
          id: v.id,
          title: v.title,
          options: v.options,
        })),
    details: view.details,
    location_ids: view.locationIds,
    governance: {
      keywords: view.aiKeywords,
      aliases: view.aiAliases,
      do_not_say: view.aiDoNotSay,
      safety_rules: view.aiSafetyRules,
    },
  };
}

/**
 * Search for our agent (the AI Agents module, or `portfolio:agent`):
 * active, public items open to AI discovery, quote items included.
 */
export async function agentSearch(
  tx: ContextTransaction,
  ctx: RequestContext,
  input: unknown = {},
): Promise<{ items: AgentItem[]; nextCursor: string | null }> {
  await access(tx, ctx);
  const q = parse(AgentSearchQuery, input);
  const offset = decodeOffset(q.cursor);
  const where = Prisma.sql`${textSql(q.query, "agent")}
    and (${q.item_type ?? null}::text is null or i.item_type = ${q.item_type ?? null}::text)`;
  const { ids, total } = await searchIds(
    tx,
    ctx,
    "agent",
    where,
    offset,
    q.limit,
  );
  const items = (await loadItemViews(tx, ctx, ids)).map(toAgentItem);
  const next = offset + ids.length;
  return { items, nextCursor: next < total ? encodeOffset(next) : null };
}

/** One item for our agent; hidden from AI discovery means not found. */
export async function agentGetItem(
  tx: ContextTransaction,
  ctx: RequestContext,
  itemId: string,
): Promise<AgentItem> {
  await access(tx, ctx);
  const notFound = new AppError({
    code: "not_found",
    safeMessage: "Item não encontrado.",
  });
  if (!isUuid(itemId)) throw notFound;
  const rows = await tx.$queryRaw<{ id: string }[]>`
    select i.id from public.portfolio_items i
    where i.workspace_id = ${ctx.workspaceId}::uuid and i.id = ${itemId}::uuid
      and ${visibleSql("agent")}
  `;
  const [view] = await loadItemViews(
    tx,
    ctx,
    rows.map((r) => r.id),
  );
  if (!view) throw notFound;
  return toAgentItem(view);
}
