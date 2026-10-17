import { z } from "zod";

import type { WorkspaceScopeType } from "@/core/mcp/scopes";

/**
 * Contract of the REST API v1 (F4a, Especificação §15). One entry per
 * route: path, scope an API key needs, query and response schemas. The
 * route handlers and the OpenAPI document are built from these entries,
 * so they cannot drift apart. Changes to `v1` are additive only.
 */

const id = z.string().uuid();
const timestamp = z.string().datetime();

export const PageQuery = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(25),
  cursor: z.string().max(200).optional(),
});

export const WorkspaceSummary = z.object({
  id,
  name: z.string(),
  slug: z.string(),
  role: z.enum(["owner", "admin", "editor", "viewer", "attendant"]),
  organization: z.object({ id, name: z.string() }),
});

export const Workspace = z.object({
  id,
  name: z.string(),
  slug: z.string(),
  status: z.string(),
  organizationId: id,
  createdAt: timestamp,
});

export const WorkspaceOverview = z.object({
  workspaceId: id,
  members: z.number().int(),
  enabledModules: z.number().int(),
  executionsLast24h: z.object({
    succeeded: z.number().int(),
    failed: z.number().int(),
    waiting: z.number().int(),
  }),
  contract: z.object({
    kind: z.enum(["legacy", "subscribed"]),
    status: z.string().nullable(),
    planName: z.string().nullable(),
  }),
});

export const ModuleStatus = z.object({
  moduleKey: z.string(),
  displayName: z.string(),
  releaseStatus: z.string(),
  state: z.enum([
    "coming_soon",
    "maintenance",
    "not_contracted",
    "not_enabled",
    "suspended",
    "enabled",
  ]),
  stateLabel: z.string(),
});

export const UsageItem = z.object({
  key: z.string(),
  label: z.string(),
  scope: z.enum(["organization", "workspace"]),
  used: z.number().int().nullable(),
  limit: z.number().int().nullable(),
  source: z.enum(["plan", "default", "none"]),
});

export const Execution = z.object({
  id,
  kind: z.string(),
  status: z.string(),
  attempts: z.number().int(),
  maxAttempts: z.number().int(),
  lastError: z.string().nullable(),
  createdAt: timestamp,
  startedAt: timestamp.nullable(),
  finishedAt: timestamp.nullable(),
});

export const Member = z.object({
  userId: id,
  role: z.enum(["owner", "admin", "editor", "viewer", "attendant"]),
  status: z.string(),
  joinedAt: timestamp,
});

export const Contact = z.object({
  id,
  name: z.string(),
  email: z.string().nullable(),
  phone: z.string().nullable(),
  companyName: z.string().nullable(),
  jobTitle: z.string().nullable(),
  notes: z.string().nullable(),
  createdBy: id,
  createdAt: timestamp,
  updatedAt: timestamp,
});

const contactFields = {
  name: z.string().min(1).max(160),
  email: z.string().max(254).nullable(),
  phone: z.string().max(40).nullable(),
  companyName: z.string().max(160).nullable(),
  jobTitle: z.string().max(120).nullable(),
  notes: z.string().max(5000).nullable(),
};

/** Documentation shapes; the CRM services hold the full validation. */
export const ContactCreateBody = z
  .object(contactFields)
  .partial()
  .required({ name: true })
  .strict();
export const ContactUpdateBody = z.object(contactFields).partial().strict();

export const ContactListQuery = z.object({
  search: z.string().max(100).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(25),
  cursor: z.string().max(200).optional(),
});

// ---------------------------------------------------------------------------
// Portfolio (F5d): UCP catalog, our agent's view and item writes
// ---------------------------------------------------------------------------

const ucpObject = z.looseObject({});
const UcpEnvelope = z.looseObject({
  version: z.string(),
  status: z.enum(["success", "error"]).optional(),
  capabilities: z.record(z.string(), z.array(ucpObject)).optional(),
});
const ucpFilters = z
  .looseObject({
    categories: z.array(z.string()).optional(),
    price: z
      .looseObject({
        min: z.number().int().optional(),
        max: z.number().int().optional(),
      })
      .optional(),
  })
  .optional();

/** Documentation shapes of the UCP catalog; the services validate. */
export const UcpSearchBody = z.looseObject({
  query: z.string().max(200).optional(),
  filters: ucpFilters,
  pagination: z
    .looseObject({
      cursor: z.string().optional(),
      limit: z.number().int().min(1).optional(),
    })
    .optional(),
  context: ucpObject.optional(),
});
export const UcpLookupBody = z.looseObject({
  ids: z.array(z.string()).min(1).max(50),
  filters: ucpFilters,
});
export const UcpGetProductBody = z.looseObject({
  id: z.string(),
  selected: z
    .array(z.looseObject({ name: z.string(), label: z.string() }))
    .optional(),
  preferences: z.array(z.string()).optional(),
  filters: ucpFilters,
});

/** UCP responses: the envelope, products and messages, as the protocol says. */
export const UcpSearchResponse = z.looseObject({
  ucp: UcpEnvelope,
  products: z.array(ucpObject),
  pagination: z
    .looseObject({
      has_next_page: z.boolean(),
      cursor: z.string().optional(),
      total_count: z.number().int().optional(),
    })
    .optional(),
  messages: z.array(ucpObject).optional(),
});
export const UcpLookupResponse = z.looseObject({
  ucp: UcpEnvelope,
  products: z.array(ucpObject),
  messages: z.array(ucpObject).optional(),
});
export const UcpProductResponse = z.looseObject({
  ucp: UcpEnvelope,
  product: ucpObject.optional(),
  messages: z.array(ucpObject).optional(),
});

const jsonRecord = z.record(z.string(), z.unknown());

export const AgentPortfolioItem = z.object({
  id,
  handle: z.string(),
  title: z.string(),
  item_type: z.string(),
  vertical: z.string(),
  description: jsonRecord,
  price_display: z.enum(["price", "from", "quote"]),
  ucp_visible: z.boolean(),
  product: jsonRecord.nullable(),
  quote_variants: z.array(
    z.object({
      id,
      title: z.string(),
      options: z.array(z.object({ name: z.string(), label: z.string() })),
    }),
  ),
  details: jsonRecord,
  location_ids: z.array(id),
  governance: z.object({
    keywords: z.array(z.string()),
    aliases: z.array(z.string()),
    do_not_say: z.array(z.string()),
    safety_rules: z.string().nullable(),
  }),
});

export const AgentPortfolioQuery = z.object({
  query: z.string().max(200).optional(),
  item_type: z
    .enum(["product", "service", "real_estate", "lodging", "event"])
    .optional(),
  limit: z.coerce.number().int().min(1).max(50).default(10),
  cursor: z.string().max(200).optional(),
});

export const PortfolioVariant = z.object({
  id,
  position: z.number().int(),
  title: z.string(),
  sku: z.string().nullable(),
  barcodes: z.array(jsonRecord),
  priceAmount: z.number().int().nullable(),
  listPriceAmount: z.number().int().nullable(),
  currency: z.string(),
  quantityUnit: jsonRecord.nullable(),
  options: z.array(jsonRecord),
  media: z.array(jsonRecord),
  availabilityStatus: z.string(),
  trackInventory: z.boolean(),
  stockQuantity: z.number().int().nullable(),
  minStockAlert: z.number().int().nullable(),
  allowBackorder: z.boolean(),
  accommodationTypeId: id.nullable(),
  ratePlanId: id.nullable(),
});

/** An item as its owner manages it (internal fields included). */
export const PortfolioItem = z.object({
  id,
  itemType: z.string(),
  vertical: z.string(),
  title: z.string(),
  handle: z.string(),
  description: jsonRecord,
  categories: z.array(jsonRecord),
  media: z.array(jsonRecord),
  tags: z.array(z.string()),
  url: z.string().nullable(),
  rating: jsonRecord.nullable(),
  fulfillmentMethods: z.array(z.string()),
  locationIds: z.array(id),
  policies: z.array(jsonRecord),
  links: z.array(jsonRecord),
  priceDisplay: z.string(),
  status: z.string(),
  visibility: z.string(),
  priority: z.number().int(),
  isFeatured: z.boolean(),
  featuredRank: z.number().int(),
  availabilityMode: z.string(),
  aiDiscoveryEnabled: z.boolean(),
  aiKeywords: z.array(z.string()),
  aiAliases: z.array(z.string()),
  aiDoNotSay: z.array(z.string()),
  aiSafetyRules: z.string().nullable(),
  details: jsonRecord,
  variants: z.array(PortfolioVariant),
  lodging: jsonRecord.nullable(),
  createdAt: timestamp,
  updatedAt: timestamp,
});

/** Documentation shapes of the writes; the Portfolio services validate. */
export const PortfolioItemCreateBody = z.looseObject({
  item_type: z.enum(["product", "service", "real_estate", "lodging", "event"]),
  vertical: z.string().optional(),
  title: z.string().min(1).max(200),
  variants: z.array(z.looseObject({ title: z.string() })).min(1),
});
export const PortfolioItemUpdateBody = z.looseObject({});
export const PortfolioVariantUpdateBody = z.looseObject({});

export const ErrorBody = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
    requestId: z.string(),
  }),
});

export const one = <T extends z.ZodType>(data: T) => z.object({ data });
export const page = <T extends z.ZodType>(item: T) =>
  z.object({ data: z.array(item), nextCursor: z.string().nullable() });
export const list = <T extends z.ZodType>(item: T) =>
  z.object({ data: z.array(item) });

export type ApiRoute = Readonly<{
  operationId: string;
  method: "GET" | "POST" | "PATCH";
  /** OpenAPI path, with `{id}` for the workspace and the record ids. */
  path: string;
  summary: string;
  /** Scope an API key needs; sessions use the role permissions only. */
  scope: WorkspaceScopeType;
  workspaceScoped: boolean;
  query?: z.ZodObject;
  /** JSON body of POST and PATCH, validated by the service. */
  body?: z.ZodType;
  /** 200 by default; 201 for creations. */
  successStatus?: 200 | 201;
  response: z.ZodType;
}>;

export const API_ROUTES = {
  listMyWorkspaces: {
    operationId: "listMyWorkspaces",
    method: "GET",
    path: "/me/workspaces",
    summary:
      "Workspaces of the person on the host's partner; with an API key, only the key's workspace.",
    scope: "workspace:read",
    workspaceScoped: false,
    response: list(WorkspaceSummary),
  },
  getWorkspace: {
    operationId: "getWorkspace",
    method: "GET",
    path: "/workspaces/{id}",
    summary: "The workspace.",
    scope: "workspace:read",
    workspaceScoped: true,
    response: one(Workspace),
  },
  getWorkspaceOverview: {
    operationId: "getWorkspaceOverview",
    method: "GET",
    path: "/workspaces/{id}/overview",
    summary: "Workspace overview: members, modules, executions and contract.",
    scope: "workspace:read",
    workspaceScoped: true,
    response: one(WorkspaceOverview),
  },
  listWorkspaceModules: {
    operationId: "listWorkspaceModules",
    method: "GET",
    path: "/workspaces/{id}/modules",
    summary: "Modules visible in the workspace and the state of each one.",
    scope: "modules:read",
    workspaceScoped: true,
    response: list(ModuleStatus),
  },
  getWorkspaceUsage: {
    operationId: "getWorkspaceUsage",
    method: "GET",
    path: "/workspaces/{id}/usage",
    summary: "Measured usage against the plan limits.",
    scope: "usage:read",
    workspaceScoped: true,
    response: list(UsageItem),
  },
  listWorkspaceExecutions: {
    operationId: "listWorkspaceExecutions",
    method: "GET",
    path: "/workspaces/{id}/executions",
    summary: "Background executions, newest first.",
    scope: "executions:read",
    workspaceScoped: true,
    query: PageQuery,
    response: page(Execution),
  },
  listWorkspaceMembers: {
    operationId: "listWorkspaceMembers",
    method: "GET",
    path: "/workspaces/{id}/members",
    summary: "Workspace members with minimal data.",
    scope: "members:read",
    workspaceScoped: true,
    query: PageQuery,
    response: page(Member),
  },
  listCrmContacts: {
    operationId: "listCrmContacts",
    method: "GET",
    path: "/workspaces/{id}/crm/contacts",
    summary:
      "Contacts of the CRM module, newest first; search by name, email or company.",
    scope: "crm:read",
    workspaceScoped: true,
    query: ContactListQuery,
    response: page(Contact),
  },
  createCrmContact: {
    operationId: "createCrmContact",
    method: "POST",
    path: "/workspaces/{id}/crm/contacts",
    summary: "Creates a contact (within the plan's contact quota).",
    scope: "crm:write",
    workspaceScoped: true,
    body: ContactCreateBody,
    successStatus: 201,
    response: one(Contact),
  },
  getCrmContact: {
    operationId: "getCrmContact",
    method: "GET",
    path: "/workspaces/{id}/crm/contacts/{contactId}",
    summary: "A contact of the CRM module.",
    scope: "crm:read",
    workspaceScoped: true,
    response: one(Contact),
  },
  updateCrmContact: {
    operationId: "updateCrmContact",
    method: "PATCH",
    path: "/workspaces/{id}/crm/contacts/{contactId}",
    summary: "Updates the fields sent for a contact.",
    scope: "crm:write",
    workspaceScoped: true,
    body: ContactUpdateBody,
    response: one(Contact),
  },
  searchPortfolioCatalog: {
    operationId: "searchPortfolioCatalog",
    method: "POST",
    path: "/workspaces/{id}/portfolio/catalog/search",
    summary:
      "UCP search_catalog: searches the Portfolio (text, categories, price range, pagination). Only active, public items with a price.",
    scope: "portfolio:read",
    workspaceScoped: true,
    body: UcpSearchBody,
    response: UcpSearchResponse,
  },
  lookupPortfolioCatalog: {
    operationId: "lookupPortfolioCatalog",
    method: "POST",
    path: "/workspaces/{id}/portfolio/catalog/lookup",
    summary:
      "UCP lookup_catalog: up to 50 product, variant, SKU or handle ids; the ones not found come back in messages.",
    scope: "portfolio:read",
    workspaceScoped: true,
    body: UcpLookupBody,
    response: UcpLookupResponse,
  },
  getPortfolioCatalogProduct: {
    operationId: "getPortfolioCatalogProduct",
    method: "POST",
    path: "/workspaces/{id}/portfolio/catalog/product",
    summary:
      "UCP get_product: one product, with option selection and availability; not found comes back with ucp.status = error.",
    scope: "portfolio:read",
    workspaceScoped: true,
    body: UcpGetProductBody,
    response: UcpProductResponse,
  },
  searchPortfolioForAgent: {
    operationId: "searchPortfolioForAgent",
    method: "GET",
    path: "/workspaces/{id}/portfolio/agent/items",
    summary:
      "Customer service agent view: items released to AI, including price-on-request ones, with the AI rules.",
    scope: "portfolio:agent",
    workspaceScoped: true,
    query: AgentPortfolioQuery,
    response: page(AgentPortfolioItem),
  },
  getPortfolioItemForAgent: {
    operationId: "getPortfolioItemForAgent",
    method: "GET",
    path: "/workspaces/{id}/portfolio/agent/items/{itemId}",
    summary: "One item in the customer service agent view.",
    scope: "portfolio:agent",
    workspaceScoped: true,
    response: one(AgentPortfolioItem),
  },
  createPortfolioItem: {
    operationId: "createPortfolioItem",
    method: "POST",
    path: "/workspaces/{id}/portfolio/items",
    summary:
      "Creates an item with its variants (UCP fields; within the quotas and the vertical rules).",
    scope: "portfolio:write",
    workspaceScoped: true,
    body: PortfolioItemCreateBody,
    successStatus: 201,
    response: one(PortfolioItem),
  },
  updatePortfolioItem: {
    operationId: "updatePortfolioItem",
    method: "PATCH",
    path: "/workspaces/{id}/portfolio/items/{itemId}",
    summary: "Updates the fields sent for an item.",
    scope: "portfolio:write",
    workspaceScoped: true,
    body: PortfolioItemUpdateBody,
    response: one(PortfolioItem),
  },
  updatePortfolioVariant: {
    operationId: "updatePortfolioVariant",
    method: "PATCH",
    path: "/workspaces/{id}/portfolio/items/{itemId}/variants/{variantId}",
    summary:
      "Updates the fields sent for a variant (price, availability, stock…).",
    scope: "portfolio:write",
    workspaceScoped: true,
    body: PortfolioVariantUpdateBody,
    response: one(PortfolioItem),
  },
} as const satisfies Record<string, ApiRoute>;

export type ApiRouteId = keyof typeof API_ROUTES;
