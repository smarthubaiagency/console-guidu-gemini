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
      "Itens por página (1 a 100, padrão 25).",
    ),
    cursor: PageQuery.shape.cursor.describe(
      "Cursor devolvido pela página anterior.",
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
  .describe("Metadados do UCP, por exemplo meta['ucp-agent'].profile.");

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
    description:
      "Dados do workspace desta chave: nome, slug, situação e empresa.",
    scope: "workspace:read",
    permission: Permissions.WORKSPACE_READ,
    risk: "read",
    input: NoInput,
    output: Workspace,
    run: (prisma, call) => dataOf(resources.getWorkspace(prisma, call)),
  },
  {
    name: "get_workspace_overview",
    title: "Resumo do workspace",
    description:
      "Resumo do workspace: membros ativos, módulos habilitados, execuções das últimas 24 horas e contrato.",
    scope: "workspace:read",
    permission: Permissions.WORKSPACE_READ,
    risk: "read",
    input: NoInput,
    output: WorkspaceOverview,
    run: (prisma, call) => dataOf(resources.getWorkspaceOverview(prisma, call)),
  },
  {
    name: "list_enabled_modules",
    title: "Módulos do workspace",
    description: "Módulos visíveis no workspace e o estado de cada um.",
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
    title: "Estado de um módulo",
    description: "Estado de um módulo no workspace, pela chave do módulo.",
    scope: "modules:read",
    permission: Permissions.WORKSPACE_READ,
    risk: "read",
    input: z
      .object({
        moduleKey: z
          .string()
          .regex(/^[a-z][a-z0-9-]{0,47}$/)
          .describe("Chave do módulo, por exemplo hello-world."),
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
        });
      }
      return found;
    },
  },
  {
    name: "get_usage_summary",
    title: "Consumo e limites",
    description: "Consumo medido contra os limites do plano, sem conteúdo.",
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
    title: "Execuções",
    description:
      "Execuções em segundo plano, das mais recentes para as antigas.",
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
    title: "Situação de uma execução",
    description: "Situação, tentativas e erro seguro de uma execução, pelo id.",
    scope: "executions:read",
    permission: Permissions.WORKSPACE_READ,
    risk: "read",
    input: z
      .object({ executionId: z.string().uuid().describe("Id da execução.") })
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
    title: "Membros",
    description:
      "Membros do workspace com dados mínimos (id, papel, situação, entrada).",
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
    title: "Contatos do CRM",
    description:
      "Contatos do módulo CRM, dos mais recentes; busca opcional por nome, e-mail ou empresa.",
    scope: "crm:read",
    permission: "crm.contacts.read",
    moduleKey: "crm",
    risk: "read",
    input: z
      .object({
        search: z.string().max(100).optional().describe("Texto a buscar."),
        limit: PageQuery.shape.limit.describe(
          "Itens por página (1 a 100, padrão 25).",
        ),
        cursor: PageQuery.shape.cursor.describe(
          "Cursor devolvido pela página anterior.",
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
    title: "Contato do CRM",
    description: "Um contato do módulo CRM, pelo id.",
    scope: "crm:read",
    permission: "crm.contacts.read",
    moduleKey: "crm",
    risk: "read",
    input: z
      .object({ contactId: z.string().uuid().describe("Id do contato.") })
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
    title: "Buscar no catálogo (UCP)",
    description:
      "UCP search_catalog: busca no Portfólio por texto, categorias e faixa de preço (centavos), com paginação por cursor. " +
      "Devolve produtos no formato UCP; só itens ativos, públicos e com preço.",
    scope: "portfolio:read",
    permission: "portfolio.items.read",
    moduleKey: "portfolio",
    risk: "read",
    input: z
      .object({
        meta: UcpMeta,
        catalog: z
          .looseObject({
            query: z.string().max(200).optional().describe("Texto livre."),
            filters: z
              .looseObject({})
              .optional()
              .describe(
                "categories (lista de valores) e price { min, max } em centavos.",
              ),
            pagination: z
              .looseObject({})
              .optional()
              .describe("cursor e limit (até 50)."),
          })
          .optional()
          .describe("Pedido de busca do UCP."),
      })
      .strict(),
    output: UcpSearchResponse,
    run: (prisma, call, input) =>
      catalogTool(call, prisma, searchCatalog, input.catalog),
  },
  {
    name: "lookup_catalog",
    title: "Consultar itens do catálogo (UCP)",
    description:
      "UCP lookup_catalog: até 50 ids de produto, variante, SKU ou handle. Cada variante traz inputs com o id do pedido e o tipo (exact ou featured); os não encontrados voltam em messages.",
    scope: "portfolio:read",
    permission: "portfolio.items.read",
    moduleKey: "portfolio",
    risk: "read",
    input: z
      .object({
        meta: UcpMeta,
        catalog: z
          .looseObject({
            ids: z.array(z.string()).min(1).describe("Ids a consultar."),
            filters: z.looseObject({}).optional(),
          })
          .describe("Pedido de consulta do UCP."),
      })
      .strict(),
    output: UcpLookupResponse,
    run: (prisma, call, input) =>
      catalogTool(call, prisma, lookupCatalog, input.catalog),
  },
  {
    name: "get_product",
    title: "Produto do catálogo (UCP)",
    description:
      "UCP get_product: um produto por id de produto ou de variante, com seleção de opções (selected, preferences) e sinais de disponibilidade. Não encontrado volta com ucp.status = error.",
    scope: "portfolio:read",
    permission: "portfolio.items.read",
    moduleKey: "portfolio",
    risk: "read",
    input: z
      .object({
        meta: UcpMeta,
        catalog: z
          .looseObject({
            id: z.string().describe("Id do produto ou da variante."),
            selected: z
              .array(z.looseObject({ name: z.string(), label: z.string() }))
              .optional()
              .describe(
                "Opções já escolhidas, ex.: [{name: 'Cor', label: 'Azul'}].",
              ),
            preferences: z
              .array(z.string())
              .optional()
              .describe("Ordem de prioridade das opções ao relaxar."),
            filters: z.looseObject({}).optional(),
          })
          .describe("Pedido de produto do UCP."),
      })
      .strict(),
    output: UcpProductResponse,
    run: (prisma, call, input) =>
      catalogTool(call, prisma, getCatalogProduct, input.catalog),
  },
  {
    name: "search_portfolio",
    title: "Portfólio para o atendimento",
    description:
      "Visão do agente de atendimento: itens liberados para a IA, inclusive sob consulta (ofereça sem preço e encaminhe a uma pessoa), " +
      "com as regras da IA de cada item (palavras-chave, sinônimos, o que nunca dizer e regras de segurança). Respeite sempre essas regras.",
    scope: "portfolio:agent",
    permission: "portfolio.items.read",
    moduleKey: "portfolio",
    risk: "read",
    input: z
      .object({
        query: z.string().max(200).optional().describe("Texto a buscar."),
        item_type: z
          .enum(["product", "service", "real_estate", "lodging", "event"])
          .optional()
          .describe("Categoria."),
        limit: z
          .number()
          .int()
          .min(1)
          .max(50)
          .optional()
          .describe("Itens por página (1 a 50, padrão 10)."),
        cursor: z
          .string()
          .max(200)
          .optional()
          .describe("Cursor da página anterior."),
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
    title: "Item para o atendimento",
    description:
      "Um item na visão do agente de atendimento, pelo id, com a saída UCP (quando tem preço) e as regras da IA.",
    scope: "portfolio:agent",
    permission: "portfolio.items.read",
    moduleKey: "portfolio",
    risk: "read",
    input: z
      .object({ itemId: z.string().uuid().describe("Id do item.") })
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
    title: "Propor uma operação",
    description:
      "Propõe uma escrita para uma pessoa aprovar no GUIDU; nada é executado agora. " +
      "Operações: crm.contacts.create (payload com name e, opcionais, email, phone, companyName, jobTitle, notes) " +
      "e crm.contacts.update (targetId do contato e só os campos a mudar); " +
      "portfolio.items.create (payload como na API: item_type, title, variants com price { amount em centavos, currency } e, opcionais, os demais campos do UCP), " +
      "portfolio.items.update (targetId do item e só os campos a mudar) e " +
      "portfolio.variants.update (targetId da variante; só price, list_price, availability_status e stock_quantity). " +
      "Repetir com o mesmo idempotencyKey e o mesmo conteúdo devolve a mesma proposta; com outro conteúdo, conflito. " +
      "Entregue o reviewUrl à pessoa e consulte depois com get_proposal.",
    scope: "proposals:write",
    permission: Permissions.WORKSPACE_READ,
    risk: "propose",
    input: z
      .object({
        operation: z.enum(operationKeys).describe("Operação a propor."),
        targetId: z
          .string()
          .uuid()
          .optional()
          .describe("Id do registro, para operações de edição."),
        payload: z
          .record(z.string(), z.unknown())
          .describe("Campos da operação."),
        idempotencyKey: z
          .string()
          .min(1)
          .max(128)
          .describe("Chave única desta intenção, para reenvios seguros."),
        reason: z
          .string()
          .max(500)
          .optional()
          .describe("Motivo, mostrado a quem aprova."),
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
    title: "Situação de uma proposta",
    description:
      "Situação de uma proposta feita com esta chave: pendente, aprovada, rejeitada, executada, com falha ou vencida.",
    scope: "proposals:write",
    permission: Permissions.WORKSPACE_READ,
    risk: "read",
    input: z
      .object({ proposalId: z.string().uuid().describe("Id da proposta.") })
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
