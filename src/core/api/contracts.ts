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
  method: "GET";
  /** OpenAPI path, with `{id}` for the workspace. */
  path: string;
  summary: string;
  /** Scope an API key needs; sessions use the role permissions only. */
  scope: WorkspaceScopeType;
  workspaceScoped: boolean;
  query?: z.ZodObject;
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
} as const satisfies Record<string, ApiRoute>;

export type ApiRouteId = keyof typeof API_ROUTES;
