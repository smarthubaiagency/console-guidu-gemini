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
  role: z.enum(["owner", "admin", "editor", "viewer"]),
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
  role: z.enum(["owner", "admin", "editor", "viewer"]),
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
  /** OpenAPI path, with `{id}` for the workspace and `{contactId}`. */
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
      "Workspaces da pessoa no parceiro do host; com chave de API, só o workspace da chave.",
    scope: "workspace:read",
    workspaceScoped: false,
    response: list(WorkspaceSummary),
  },
  getWorkspace: {
    operationId: "getWorkspace",
    method: "GET",
    path: "/workspaces/{id}",
    summary: "Dados do workspace.",
    scope: "workspace:read",
    workspaceScoped: true,
    response: one(Workspace),
  },
  getWorkspaceOverview: {
    operationId: "getWorkspaceOverview",
    method: "GET",
    path: "/workspaces/{id}/overview",
    summary: "Resumo do workspace: membros, módulos, execuções e contrato.",
    scope: "workspace:read",
    workspaceScoped: true,
    response: one(WorkspaceOverview),
  },
  listWorkspaceModules: {
    operationId: "listWorkspaceModules",
    method: "GET",
    path: "/workspaces/{id}/modules",
    summary: "Módulos visíveis no workspace e o estado de cada um.",
    scope: "modules:read",
    workspaceScoped: true,
    response: list(ModuleStatus),
  },
  getWorkspaceUsage: {
    operationId: "getWorkspaceUsage",
    method: "GET",
    path: "/workspaces/{id}/usage",
    summary: "Consumo medido contra os limites do plano.",
    scope: "usage:read",
    workspaceScoped: true,
    response: list(UsageItem),
  },
  listWorkspaceExecutions: {
    operationId: "listWorkspaceExecutions",
    method: "GET",
    path: "/workspaces/{id}/executions",
    summary: "Execuções em segundo plano, das mais recentes para as antigas.",
    scope: "executions:read",
    workspaceScoped: true,
    query: PageQuery,
    response: page(Execution),
  },
  listWorkspaceMembers: {
    operationId: "listWorkspaceMembers",
    method: "GET",
    path: "/workspaces/{id}/members",
    summary: "Membros do workspace com dados mínimos.",
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
      "Contatos do módulo CRM, dos mais recentes; busca por nome, e-mail ou empresa.",
    scope: "crm:read",
    workspaceScoped: true,
    query: ContactListQuery,
    response: page(Contact),
  },
  createCrmContact: {
    operationId: "createCrmContact",
    method: "POST",
    path: "/workspaces/{id}/crm/contacts",
    summary: "Cria um contato (respeita a cota de contatos do plano).",
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
    summary: "Um contato do módulo CRM.",
    scope: "crm:read",
    workspaceScoped: true,
    response: one(Contact),
  },
  updateCrmContact: {
    operationId: "updateCrmContact",
    method: "PATCH",
    path: "/workspaces/{id}/crm/contacts/{contactId}",
    summary: "Altera os campos enviados de um contato.",
    scope: "crm:write",
    workspaceScoped: true,
    body: ContactUpdateBody,
    response: one(Contact),
  },
} as const satisfies Record<string, ApiRoute>;

export type ApiRouteId = keyof typeof API_ROUTES;
