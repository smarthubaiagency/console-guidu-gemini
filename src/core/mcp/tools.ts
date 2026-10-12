import type { PrismaClient } from "@prisma/client";
import { z } from "zod";

import {
  AgentPortfolioItem,
  Contact,
  Execution,
  Member,
  ModuleStatus,
  PageQuery,
  UcpLookupResponse,
  UcpProductResponse,
  UcpSearchResponse,
  UsageItem,
  Workspace,
  WorkspaceOverview,
} from "@/core/api/contracts";
import type { ApiCall } from "@/core/api/handler";
import * as resources from "@/core/api/resources";
import { Permissions, type PermissionKey } from "@/core/permissions/catalog";
import { withContext } from "@/lib/prisma/with-context";
import { listProposalOperations } from "@/core/proposals/registry";
import {
  createProposal,
  getProposal,
  type ProposalView,
} from "@/core/proposals/service";
import { getContact, listContacts } from "@/modules/crm/server";
import {
  agentGetItem,
  agentSearch,
  getCatalogProduct,
  lookupCatalog,
  searchCatalog,
} from "@/modules/portfolio/server";
import { AppError } from "@/shared/errors";

import type { WorkspaceScopeType } from "./scopes";

/**
 * Tools of the workspace MCP (F4b, Especificação §17.3). Each tool has its
 * input and output schemas, the key scope and the role permission it
 * needs, and a risk class. The workspace never comes from the input: it is
 * the key's, so no argument can move the call to another workspace
 * (AC10). Inputs are strict: unknown fields are refused. The run functions
 * are the services of the REST API, which re-check permissions.
 */

export type McpToolDefinition = Readonly<{
  name: string;
  title: string;
  description: string;
  scope: WorkspaceScopeType;
  permission: PermissionKey;
  /** Module the tool belongs to; listed only while the module is usable. */
  moduleKey?: string;
  /** `read` changes nothing; `propose` only records a proposal. */
  risk: "read" | "propose";
  input: z.ZodObject;
  output: z.ZodObject;
  run(
    prisma: PrismaClient,
    call: ApiCall,
    input: Record<string, unknown>,
  ): Promise<unknown>;
}>;

const NoInput = z.object({}).strict();
const PageInput = z
  .object({
    limit: PageQuery.shape.limit.describe(
      "Items per page (1 to 100, default 25).",
    ),
    cursor: PageQuery.shape.cursor.describe(
      "Cursor returned by the previous page.",
    ),
  })
  .strict();

const items = <T extends z.ZodType>(item: T) =>
  z.object({ items: z.array(item), nextCursor: z.string().nullable() });

async function dataOf(promise: Promise<unknown>): Promise<unknown> {
  return ((await promise) as { data: unknown }).data;
}

async function pageOf(promise: Promise<unknown>) {
  const result = (await promise) as {
    data: unknown[];
    nextCursor: string | null;
  };
  return { items: result.data, nextCursor: result.nextCursor };
}

const ProposalSummary = z.object({
  proposalId: z.string().uuid(),
  operation: z.string(),
  targetId: z.string().uuid().nullable(),
  payload: z.record(z.string(), z.unknown()),
  status: z.enum([
    "pending",
    "approved",
    "rejected",
    "executed",
    "failed",
    "expired",
  ]),
  created: z.boolean().optional(),
  expiresAt: z.string().datetime(),
  reviewUrl: z.string().nullable(),
  resourceId: z.string().uuid().nullable(),
  errorCode: z.string().nullable(),
});

async function summarize(
  prisma: PrismaClient,
  call: ApiCall,
  proposal: ProposalView,
  created?: boolean,
) {
  const ctx = call.context!;
  const workspace = await withContext(prisma, ctx, (tx) =>
    tx.workspace.findUnique({
      where: { id: ctx.workspaceId },
      select: { slug: true },
    }),
  );
  return {
    proposalId: proposal.id,
    operation: proposal.operation,
    targetId: proposal.targetId,
    payload: proposal.payload,
    status: proposal.status,
    ...(created === undefined ? {} : { created }),
    expiresAt: proposal.expiresAt.toISOString(),
    reviewUrl:
      call.origin && workspace
        ? `${call.origin}/app/${workspace.slug}/proposals/${proposal.id}`
        : null,
    resourceId: proposal.resourceId,
    errorCode: proposal.errorCode,
  };
}

/**
 * UCP MCP binding of the catalog (F5d): `meta` carries the agent profile
 * (`ucp-agent`) and `catalog` the request of the capability.
 */
const UcpMeta = z
  .looseObject({ "ucp-agent": z.looseObject({}).optional() })
  .optional()
  .describe("UCP metadata, for example meta['ucp-agent'].profile.");

function catalogTool(
  ctxCall: ApiCall,
  prisma: PrismaClient,
  fn: typeof searchCatalog,
  catalog: unknown,
) {
  const ctx = ctxCall.context!;
  return withContext(prisma, ctx, (tx) => fn(tx, ctx, catalog ?? {}));
}

const operationKeys = listProposalOperations().map((op) => op.key) as [
  string,
  ...string[],
];

const withQuery = (call: ApiCall, query: Record<string, unknown>): ApiCall => ({
  ...call,
  query: PageQuery.parse(query),
});

export const MCP_WORKSPACE_TOOLS: readonly McpToolDefinition[] = [
  {
    name: "get_workspace",
    title: "Workspace",
    description: "The workspace of this key: name, slug, status and company.",
    scope: "workspace:read",
    permission: Permissions.WORKSPACE_READ,
    risk: "read",
    input: NoInput,
    output: Workspace,
    run: (prisma, call) => dataOf(resources.getWorkspace(prisma, call)),
  },
  {
    name: "get_workspace_overview",
    title: "Workspace overview",
    description:
      "Workspace overview: active members, enabled modules, executions of the last 24 hours and contract.",
    scope: "workspace:read",
    permission: Permissions.WORKSPACE_READ,
    risk: "read",
    input: NoInput,
    output: WorkspaceOverview,
    run: (prisma, call) => dataOf(resources.getWorkspaceOverview(prisma, call)),
  },
  {
    name: "list_enabled_modules",
    title: "Workspace modules",
    description: "Modules visible in the workspace and the state of each one.",
    scope: "modules:read",
    permission: Permissions.WORKSPACE_READ,
    risk: "read",
    input: NoInput,
    output: z.object({ items: z.array(ModuleStatus) }),
    run: async (prisma, call) => ({
      items: await dataOf(resources.listWorkspaceModules(prisma, call)),
    }),
  },
  {
    name: "get_module_status",
    title: "Module status",
    description: "State of one module in the workspace, by module key.",
    scope: "modules:read",
    permission: Permissions.WORKSPACE_READ,
    risk: "read",
    input: z
      .object({
        moduleKey: z
          .string()
          .regex(/^[a-z][a-z0-9-]{0,47}$/)
          .describe("Module key, for example hello-world."),
      })
      .strict(),
    output: ModuleStatus,
    run: async (prisma, call, input) => {
      const modules = (await dataOf(
        resources.listWorkspaceModules(prisma, call),
      )) as Array<{
        moduleKey: string;
      }>;
      const found = modules.find((m) => m.moduleKey === input.moduleKey);
      if (!found) {
        throw new AppError({
          code: "not_found",
          safeMessage: "Módulo não encontrado.",
          messageKey: "modules.errors.notFound",
        });
      }
      return found;
    },
  },
  {
    name: "get_usage_summary",
    title: "Usage and limits",
    description: "Measured usage against the plan limits, without content.",
    scope: "usage:read",
    permission: Permissions.WORKSPACE_READ,
    risk: "read",
    input: NoInput,
    output: z.object({ items: z.array(UsageItem) }),
    run: async (prisma, call) => ({
      items: await dataOf(resources.getWorkspaceUsage(prisma, call)),
    }),
  },
  {
    name: "list_executions",
    title: "Executions",
    description: "Background executions, newest first.",
    scope: "executions:read",
    permission: Permissions.WORKSPACE_READ,
    risk: "read",
    input: PageInput,
    output: items(Execution),
    run: (prisma, call, input) =>
      pageOf(resources.listWorkspaceExecutions(prisma, withQuery(call, input))),
  },
  {
    name: "get_execution_status",
    title: "Execution status",
    description: "Status, attempts and safe error of one execution, by id.",
    scope: "executions:read",
    permission: Permissions.WORKSPACE_READ,
    risk: "read",
    input: z
      .object({ executionId: z.string().uuid().describe("Execution id.") })
      .strict(),
    output: Execution,
    run: (prisma, call, input) =>
      dataOf(
        resources.getWorkspaceExecution(
          prisma,
          call,
          String(input.executionId),
        ),
      ),
  },
  {
    name: "list_workspace_members",
    title: "Members",
    description:
      "Workspace members with minimal data (id, role, status, joined at).",
    scope: "members:read",
    permission: Permissions.WORKSPACE_MEMBERS_READ,
    risk: "read",
    input: PageInput,
    output: items(Member),
    run: (prisma, call, input) =>
      pageOf(resources.listWorkspaceMembers(prisma, withQuery(call, input))),
  },
  {
    name: "list_contacts",
    title: "CRM contacts",
    description:
      "Contacts of the CRM module, newest first; optional search by name, email or company.",
    scope: "crm:read",
    permission: "crm.contacts.read",
    moduleKey: "crm",
    risk: "read",
    input: z
      .object({
        search: z.string().max(100).optional().describe("Text to search for."),
        limit: PageQuery.shape.limit.describe(
          "Items per page (1 to 100, default 25).",
        ),
        cursor: PageQuery.shape.cursor.describe(
          "Cursor returned by the previous page.",
        ),
      })
      .strict(),
    output: items(Contact),
    run: async (prisma, call, input) => {
      const ctx = call.context!;
      const page = await withContext(prisma, ctx, (tx) =>
        listContacts(tx, ctx, input),
      );
      return { items: page.items, nextCursor: page.nextCursor };
    },
  },
  {
    name: "get_contact",
    title: "CRM contact",
    description: "One contact of the CRM module, by id.",
    scope: "crm:read",
    permission: "crm.contacts.read",
    moduleKey: "crm",
    risk: "read",
    input: z
      .object({ contactId: z.string().uuid().describe("Contact id.") })
      .strict(),
    output: Contact,
    run: (prisma, call, input) => {
      const ctx = call.context!;
      return withContext(prisma, ctx, (tx) =>
        getContact(tx, ctx, String(input.contactId)),
      );
    },
  },
  {
    name: "search_catalog",
    title: "Search the catalog (UCP)",
    description:
      "UCP search_catalog: searches the Portfolio by text, categories and price range (minor units, e.g. cents), with cursor pagination. " +
      "Returns products in the UCP format; only active, public items with a price.",
    scope: "portfolio:read",
    permission: "portfolio.items.read",
    moduleKey: "portfolio",
    risk: "read",
    input: z
      .object({
        meta: UcpMeta,
        catalog: z
          .looseObject({
            query: z.string().max(200).optional().describe("Free text."),
            filters: z
              .looseObject({})
              .optional()
              .describe(
                "categories (list of values) and price { min, max } in minor units (cents).",
              ),
            pagination: z
              .looseObject({})
              .optional()
              .describe("cursor and limit (up to 50)."),
          })
          .optional()
          .describe("UCP search request."),
      })
      .strict(),
    output: UcpSearchResponse,
    run: (prisma, call, input) =>
      catalogTool(call, prisma, searchCatalog, input.catalog),
  },
  {
    name: "lookup_catalog",
    title: "Look up catalog items (UCP)",
    description:
      "UCP lookup_catalog: up to 50 product, variant, SKU or handle ids. Each variant carries inputs with the requested id and the match type (exact or featured); the ones not found come back in messages.",
    scope: "portfolio:read",
    permission: "portfolio.items.read",
    moduleKey: "portfolio",
    risk: "read",
    input: z
      .object({
        meta: UcpMeta,
        catalog: z
          .looseObject({
            ids: z.array(z.string()).min(1).describe("Ids to look up."),
            filters: z.looseObject({}).optional(),
          })
          .describe("UCP lookup request."),
      })
      .strict(),
    output: UcpLookupResponse,
    run: (prisma, call, input) =>
      catalogTool(call, prisma, lookupCatalog, input.catalog),
  },
  {
    name: "get_product",
    title: "Catalog product (UCP)",
    description:
      "UCP get_product: one product by product or variant id, with option selection (selected, preferences) and availability signals. Not found comes back with ucp.status = error.",
    scope: "portfolio:read",
    permission: "portfolio.items.read",
    moduleKey: "portfolio",
    risk: "read",
    input: z
      .object({
        meta: UcpMeta,
        catalog: z
          .looseObject({
            id: z.string().describe("Product or variant id."),
            selected: z
              .array(z.looseObject({ name: z.string(), label: z.string() }))
              .optional()
              .describe(
                "Options already chosen, e.g. [{name: 'Color', label: 'Blue'}].",
              ),
            preferences: z
              .array(z.string())
              .optional()
              .describe(
                "Priority order of the options when relaxing the selection.",
              ),
            filters: z.looseObject({}).optional(),
          })
          .describe("UCP product request."),
      })
      .strict(),
    output: UcpProductResponse,
    run: (prisma, call, input) =>
      catalogTool(call, prisma, getCatalogProduct, input.catalog),
  },
  {
    name: "search_portfolio",
    title: "Portfolio for customer service",
    description:
      "Customer service agent view: items released to AI, including price-on-request ones (offer them without a price and hand over to a person), " +
      "with the AI rules of each item (keywords, synonyms, what never to say and safety rules). Always follow these rules.",
    scope: "portfolio:agent",
    permission: "portfolio.items.read",
    moduleKey: "portfolio",
    risk: "read",
    input: z
      .object({
        query: z.string().max(200).optional().describe("Text to search for."),
        item_type: z
          .enum(["product", "service", "real_estate", "lodging", "event"])
          .optional()
          .describe("Category."),
        limit: z
          .number()
          .int()
          .min(1)
          .max(50)
          .optional()
          .describe("Items per page (1 to 50, default 10)."),
        cursor: z
          .string()
          .max(200)
          .optional()
          .describe("Cursor of the previous page."),
      })
      .strict(),
    output: items(AgentPortfolioItem),
    run: async (prisma, call, input) => {
      const ctx = call.context!;
      return withContext(prisma, ctx, (tx) => agentSearch(tx, ctx, input));
    },
  },
  {
    name: "get_portfolio_item",
    title: "Item for customer service",
    description:
      "One item in the customer service agent view, by id, with the UCP output (when it has a price) and the AI rules.",
    scope: "portfolio:agent",
    permission: "portfolio.items.read",
    moduleKey: "portfolio",
    risk: "read",
    input: z
      .object({ itemId: z.string().uuid().describe("Item id.") })
      .strict(),
    output: AgentPortfolioItem,
    run: (prisma, call, input) => {
      const ctx = call.context!;
      return withContext(prisma, ctx, (tx) =>
        agentGetItem(tx, ctx, String(input.itemId)),
      );
    },
  },
  {
    name: "propose_operation",
    title: "Propose an operation",
    description:
      "Proposes a write for a person to approve in GUIDU; nothing runs now. " +
      "Operations: crm.contacts.create (payload with name and, optionally, email, phone, companyName, jobTitle, notes) " +
      "and crm.contacts.update (targetId of the contact and only the fields to change); " +
      "portfolio.items.create (payload as in the API: item_type, title, variants with price { amount in minor units (cents), currency } and, optionally, the other UCP fields), " +
      "portfolio.items.update (targetId of the item and only the fields to change) and " +
      "portfolio.variants.update (targetId of the variant; only price, list_price, availability_status and stock_quantity). " +
      "Repeating with the same idempotencyKey and the same content returns the same proposal; with other content, a conflict. " +
      "Give the reviewUrl to the person and check it later with get_proposal.",
    scope: "proposals:write",
    permission: Permissions.WORKSPACE_READ,
    risk: "propose",
    input: z
      .object({
        operation: z.enum(operationKeys).describe("Operation to propose."),
        targetId: z
          .string()
          .uuid()
          .optional()
          .describe("Record id, for update operations."),
        payload: z
          .record(z.string(), z.unknown())
          .describe("Fields of the operation."),
        idempotencyKey: z
          .string()
          .min(1)
          .max(128)
          .describe("Unique key of this intent, for safe retries."),
        reason: z
          .string()
          .max(500)
          .optional()
          .describe("Reason, shown to the approver."),
      })
      .strict(),
    output: ProposalSummary,
    run: async (prisma, call, input) => {
      const ctx = call.context!;
      const { proposal, created } = await withContext(prisma, ctx, (tx) =>
        createProposal(tx, ctx, input),
      );
      return summarize(prisma, call, proposal, created);
    },
  },
  {
    name: "get_proposal",
    title: "Proposal status",
    description:
      "Status of a proposal made with this key: pending, approved, rejected, executed, failed or expired.",
    scope: "proposals:write",
    permission: Permissions.WORKSPACE_READ,
    risk: "read",
    input: z
      .object({ proposalId: z.string().uuid().describe("Proposal id.") })
      .strict(),
    output: ProposalSummary,
    run: async (prisma, call, input) => {
      const ctx = call.context!;
      const proposal = await withContext(prisma, ctx, (tx) =>
        getProposal(tx, ctx, String(input.proposalId)),
      );
      return summarize(prisma, call, proposal);
    },
  },
];
