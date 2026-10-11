import type { PrismaClient } from "@prisma/client";
import { z } from "zod";

import {
  Execution,
  Member,
  ModuleStatus,
  PageQuery,
  UsageItem,
  Workspace,
  WorkspaceOverview,
} from "@/core/api/contracts";
import type { ApiCall } from "@/core/api/handler";
import * as resources from "@/core/api/resources";
import { Permissions, type Permission } from "@/core/permissions/catalog";
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
  permission: Permission;
  risk: "read";
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
];
