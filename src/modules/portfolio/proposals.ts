import "server-only";

import { z } from "zod";

import { requireWorkspacePermission } from "@/core/permissions/guard";
import type { ProposalOperation } from "@/core/proposals/operation";
import type {
  ContextTransaction,
  RequestContext,
} from "@/lib/prisma/with-context";
import { AppError } from "@/shared/errors";

import { PortfolioPermissions } from "./manifest";
import {
  createItem,
  getItem,
  invalid,
  ItemCreateInput,
  ItemUpdateInput,
  type ItemView,
  updateItem,
  updateVariant,
  VariantUpdateInput,
} from "./server/services/items";

/**
 * Operations of the Portfolio that an agent may propose through the MCP
 * (F5d): create and edit items, and change the price and availability of
 * a variant. A person approves in the GUIDU; the approved proposal runs
 * the same services as the screens and the REST API, so module state,
 * permission, quota and the vertical rules apply again.
 */

const ITEM_FIELDS = [
  { key: "title", label: "Título" },
  { key: "item_type", label: "Categoria" },
  { key: "vertical", label: "Vertical" },
  { key: "description", label: "Descrição" },
  { key: "price_display", label: "Exibição do preço" },
  { key: "status", label: "Situação" },
  { key: "visibility", label: "Visibilidade" },
  { key: "categories", label: "Categorias" },
  { key: "tags", label: "Tags" },
  { key: "url", label: "Página" },
  { key: "media", label: "Imagens" },
  { key: "fulfillment_methods", label: "Entrega ou atendimento" },
  { key: "location_ids", label: "Lojas" },
  { key: "details", label: "Dados da vertical" },
  { key: "variants", label: "Variantes" },
  { key: "ai_keywords", label: "Palavras-chave para a IA" },
  { key: "ai_aliases", label: "Sinônimos" },
  { key: "ai_do_not_say", label: "A IA nunca deve dizer" },
  { key: "ai_safety_rules", label: "Regras de segurança para a IA" },
  { key: "ai_discovery_enabled", label: "A IA pode sugerir" },
] as const;

const VARIANT_FIELDS = [
  { key: "price", label: "Preço" },
  { key: "list_price", label: "Preço cheio" },
  { key: "availability_status", label: "Disponibilidade" },
  { key: "stock_quantity", label: "Estoque" },
] as const;

/** Price and availability of a variant; nothing else by proposal. */
export const VariantPriceInput = VariantUpdateInput.pick({
  price: true,
  list_price: true,
  availability_status: true,
  stock_quantity: true,
})
  .strict()
  .refine((v) => Object.keys(v).length > 0, "Nada para alterar.");

function parseWith(schema: z.ZodType, input: unknown) {
  const parsed = schema.safeParse(input);
  if (!parsed.success) throw invalid(parsed.error, "payload");
  return Object.fromEntries(
    Object.entries(parsed.data as Record<string, unknown>).filter(
      ([, v]) => v !== undefined,
    ),
  );
}

const itemNotFound = () =>
  new AppError({
    code: "not_found",
    safeMessage: "Item não encontrado.",
    messageKey: "portfolio.errors.notFound.item",
  });
const variantNotFound = () =>
  new AppError({
    code: "not_found",
    safeMessage: "Variante não encontrada.",
    messageKey: "apiErrors.variantNotFound",
  });

async function rowVersion(
  tx: ContextTransaction,
  ctx: RequestContext,
  table: "portfolio_items" | "portfolio_variants",
  targetId: string,
): Promise<string | null> {
  await requireWorkspacePermission(tx, ctx, PortfolioPermissions.ITEMS_READ);
  if (!z.string().uuid().safeParse(targetId).success) return null;
  // The text form keeps the microseconds a JavaScript Date would drop.
  const rows =
    table === "portfolio_items"
      ? await tx.$queryRaw<{ v: string }[]>`
          select updated_at::text as v from public.portfolio_items
          where id = ${targetId}::uuid and workspace_id = ${ctx.workspaceId}::uuid`
      : await tx.$queryRaw<{ v: string }[]>`
          select updated_at::text as v from public.portfolio_variants
          where id = ${targetId}::uuid and workspace_id = ${ctx.workspaceId}::uuid`;
  return rows[0]?.v ?? null;
}

/** The item in the names of the payload, for the approval screen. */
function itemSnapshot(item: ItemView): Record<string, unknown> {
  return {
    title: item.title,
    item_type: item.itemType,
    vertical: item.vertical,
    description: item.description,
    price_display: item.priceDisplay,
    status: item.status,
    visibility: item.visibility,
    categories: item.categories,
    tags: item.tags,
    url: item.url,
    media: item.media,
    fulfillment_methods: item.fulfillmentMethods,
    location_ids: item.locationIds,
    details: item.details,
    ai_keywords: item.aiKeywords,
    ai_aliases: item.aiAliases,
    ai_do_not_say: item.aiDoNotSay,
    ai_safety_rules: item.aiSafetyRules,
    ai_discovery_enabled: item.aiDiscoveryEnabled,
  };
}

async function variantItem(
  tx: ContextTransaction,
  ctx: RequestContext,
  variantId: string,
): Promise<ItemView> {
  if (!z.string().uuid().safeParse(variantId).success) throw variantNotFound();
  const row = await tx.portfolioVariant.findFirst({
    where: { id: variantId, workspaceId: ctx.workspaceId },
    select: { itemId: true },
  });
  if (!row) throw variantNotFound();
  return getItem(tx, ctx, row.itemId);
}

export const portfolioProposalOperations: readonly ProposalOperation[] = [
  {
    key: "portfolio.items.create",
    moduleKey: "portfolio",
    label: "Adicionar item ao portfólio",
    permission: PortfolioPermissions.ITEMS_WRITE,
    needsTarget: false,
    fields: ITEM_FIELDS,
    resourcePath: (id) => `portfolio/${id}`,
    parse: (input) => parseWith(ItemCreateInput, input),
    version: async () => "",
    current: async () => ({}),
    async execute(tx, ctx, payload) {
      const item = await createItem(tx, ctx, payload);
      return { resourceId: item.id };
    },
  },
  {
    key: "portfolio.items.update",
    moduleKey: "portfolio",
    label: "Editar item do portfólio",
    permission: PortfolioPermissions.ITEMS_WRITE,
    needsTarget: true,
    fields: ITEM_FIELDS,
    resourcePath: (id) => `portfolio/${id}`,
    parse: (input) => parseWith(ItemUpdateInput, input),
    async version(tx, ctx, targetId) {
      const v = await rowVersion(tx, ctx, "portfolio_items", targetId);
      if (v === null) throw itemNotFound();
      return v;
    },
    current: async (tx, ctx, targetId) =>
      itemSnapshot(await getItem(tx, ctx, targetId)),
    async execute(tx, ctx, payload, targetId) {
      if (!targetId) throw itemNotFound();
      const item = await updateItem(tx, ctx, targetId, payload);
      return { resourceId: item.id };
    },
  },
  {
    key: "portfolio.variants.update",
    moduleKey: "portfolio",
    label: "Mudar preço ou disponibilidade",
    permission: PortfolioPermissions.ITEMS_WRITE,
    needsTarget: true,
    fields: VARIANT_FIELDS,
    resourcePath: (id) => `portfolio/${id}`,
    parse: (input) => parseWith(VariantPriceInput, input),
    async version(tx, ctx, targetId) {
      const v = await rowVersion(tx, ctx, "portfolio_variants", targetId);
      if (v === null) throw variantNotFound();
      return v;
    },
    async current(tx, ctx, targetId) {
      const item = await variantItem(tx, ctx, targetId);
      const v = item.variants.find((x) => x.id === targetId)!;
      return {
        price:
          v.priceAmount === null
            ? null
            : { amount: v.priceAmount, currency: v.currency },
        list_price:
          v.listPriceAmount === null
            ? null
            : { amount: v.listPriceAmount, currency: v.currency },
        availability_status: v.availabilityStatus,
        stock_quantity: v.stockQuantity,
      };
    },
    async execute(tx, ctx, payload, targetId) {
      if (!targetId) throw variantNotFound();
      const item = await variantItem(tx, ctx, targetId);
      await updateVariant(tx, ctx, item.id, targetId, payload);
      // The screen of the variant is its item's.
      return { resourceId: item.id };
    },
  },
];
