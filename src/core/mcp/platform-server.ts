import { randomUUID } from "node:crypto";

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import type { PrismaClient } from "@prisma/client";
import { z } from "zod";

import type { ApiDeps } from "@/core/api/handler";
import {
  hitRateLimit,
  type RateDecision,
  rateLimitHeaders,
} from "@/core/api/rate-limit";
import { recordAudit } from "@/core/audit/record";
import {
  platformAuditContext,
  type PlatformActor,
  withPlatformContext,
} from "@/core/platform-api/context";
import { authenticatePlatformRequest } from "@/core/platform-api/handler";
import {
  CustomerListQuery,
  FailedJob,
  FailedJobsQuery,
  getCustomer,
  getPlatformHealth,
  listCustomers,
  listFailedJobs,
  PlatformCustomer,
  PlatformHealth,
} from "@/core/platform-api/resources";
import {
  type PlatformScope,
  roleAllowsScope,
} from "@/core/platform-api/scopes";
import { appLog } from "@/lib/telemetry/log";
import { englishErrorMessage } from "@/core/i18n/english";
import { toSafeError } from "@/shared/errors";

import { originAllowed } from "./server";

/**
 * Platform MCP (F4e, Especificação §17.3) at `/mcp/platform`: the same
 * Streamable HTTP without session as the workspace MCP, on platform hosts
 * only, with administrative keys only. Read tools; no administrative
 * writes in this phase. Each request is authenticated again and served by a
 * fresh server with the tools the key's scopes and the current internal
 * role allow.
 */

const SERVER_INFO = { name: "guidu-platform", version: "1.0.0" } as const;
const INSTRUCTIONS =
  "Read tools of the GUIDU platform: customer companies with minimal commercial data and the health of the operation, without customer content. No tool changes data.";

type PlatformTool = Readonly<{
  name: string;
  title: string;
  description: string;
  scope: PlatformScope;
  input: z.ZodObject;
  output: z.ZodObject;
  run(
    prisma: PrismaClient,
    actor: PlatformActor,
    input: Record<string, unknown>,
  ): Promise<unknown>;
}>;

export const MCP_PLATFORM_TOOLS: readonly PlatformTool[] = [
  {
    name: "list_customers",
    title: "Customer companies",
    description:
      "Customer companies, newest first: status, seats, number of workspaces and plan (plan only for roles that read billing).",
    scope: "admin:customers:read",
    input: z
      .object({
        limit: CustomerListQuery.shape.limit.describe(
          "Items per page (1 to 100, default 25).",
        ),
        cursor: CustomerListQuery.shape.cursor.describe(
          "Cursor returned by the previous page.",
        ),
      })
      .strict(),
    output: z.object({
      items: z.array(PlatformCustomer),
      nextCursor: z.string().nullable(),
    }),
    run: async (prisma, actor, input) => {
      const page = await listCustomers(prisma, actor, input);
      return { items: page.data, nextCursor: page.nextCursor };
    },
  },
  {
    name: "get_customer_summary",
    title: "Company summary",
    description: "Minimal commercial summary of a customer company, by id.",
    scope: "admin:customers:read",
    input: z
      .object({ customerId: z.string().uuid().describe("Company id.") })
      .strict(),
    output: PlatformCustomer,
    run: async (prisma, actor, input) =>
      (await getCustomer(prisma, actor, String(input.customerId))).data,
  },
  {
    name: "get_platform_health",
    title: "Platform health",
    description:
      "Workers, queues and totals of the last 24 hours, with the stale metrics warning.",
    scope: "admin:operations:read",
    input: z.object({}).strict(),
    output: PlatformHealth,
    run: async (prisma, actor) => (await getPlatformHealth(prisma, actor)).data,
  },
  {
    name: "list_failed_jobs",
    title: "Failed jobs",
    description:
      "Failed jobs of the last days, with the safe error recorded by the worker; never the job content.",
    scope: "admin:operations:read",
    input: z
      .object({
        limit: FailedJobsQuery.shape.limit.describe(
          "Items (1 to 100, default 25).",
        ),
        days: FailedJobsQuery.shape.days.describe(
          "Window in days (1 to 30, default 7).",
        ),
      })
      .strict(),
    output: z.object({ items: z.array(FailedJob) }),
    run: async (prisma, actor, input) => ({
      items: (await listFailedJobs(prisma, actor, input)).data,
    }),
  },
];

export function allowedPlatformTools(
  scopes: readonly PlatformScope[],
  role: PlatformActor["role"],
): PlatformTool[] {
  return MCP_PLATFORM_TOOLS.filter(
    (tool) => scopes.includes(tool.scope) && roleAllowsScope(role, tool.scope),
  );
}

function jsonError(
  status: number,
  code: string,
  message: string,
  requestId: string,
  headers: Record<string, string> = {},
): Response {
  return new Response(JSON.stringify({ error: { code, message, requestId } }), {
    status,
    headers: {
      "content-type": "application/json",
      "x-request-id": requestId,
      "cache-control": "no-store",
      ...headers,
    },
  });
}

async function auditCall(
  deps: ApiDeps,
  actor: PlatformActor,
  tool: string,
  result: "success" | "denied" | "error",
  requestId: string,
): Promise<void> {
  try {
    await withPlatformContext(deps.prisma, actor, (tx) =>
      recordAudit(tx, platformAuditContext(actor), {
        action: "mcp.tool.call",
        resourceType: "mcp_tool",
        resourceId: tool,
        result,
        origin: "mcp",
        requestId,
        metadata: { status: result },
      }),
    );
  } catch (error) {
    appLog.error("mcp.audit_failed", { requestId, tool, error });
  }
}

export async function handlePlatformMcpRequest(
  request: Request,
  deps: ApiDeps,
): Promise<Response> {
  const requestId = randomUUID();
  if (request.method !== "POST") {
    return jsonError(
      405,
      "method_not_allowed",
      "Use POST (Streamable HTTP without session).",
      requestId,
      { allow: "POST" },
    );
  }
  if (!originAllowed(request)) {
    return jsonError(403, "forbidden", "Origin not allowed.", requestId);
  }

  let decision: RateDecision | null = null;
  try {
    const principal = await authenticatePlatformRequest(
      request,
      deps,
      requestId,
      { allowSession: false, origin: "mcp" },
    );
    const actor: PlatformActor = {
      userId: principal.userId,
      role: principal.role,
      keyId: principal.keyId,
    };
    decision = await hitRateLimit(
      { redis: deps.redis, prisma: deps.prisma },
      { apiKeyId: actor.keyId, userId: actor.userId, workspaceId: null },
    );
    if (!decision.allowed) {
      return jsonError(
        429,
        "rate_limited",
        "Rate limit reached. Try again shortly.",
        requestId,
        rateLimitHeaders(decision),
      );
    }

    const tools = allowedPlatformTools(principal.scopes ?? [], actor.role);
    const server = new McpServer(SERVER_INFO, {
      capabilities: { tools: {} },
      instructions: INSTRUCTIONS,
    });
    for (const tool of tools) {
      server.registerTool(
        tool.name,
        {
          title: tool.title,
          description: tool.description,
          inputSchema: tool.input,
          outputSchema: tool.output,
          annotations: {
            title: tool.title,
            readOnlyHint: true,
            destructiveHint: false,
            idempotentHint: true,
            openWorldHint: false,
          },
        },
        async (args: Record<string, unknown>) => {
          try {
            const output = tool.output.parse(
              await tool.run(deps.prisma, actor, args ?? {}),
            );
            await auditCall(deps, actor, tool.name, "success", requestId);
            return {
              content: [
                { type: "text" as const, text: JSON.stringify(output) },
              ],
              structuredContent: output as Record<string, unknown>,
            };
          } catch (error) {
            const safe = toSafeError(error, requestId);
            await auditCall(
              deps,
              actor,
              tool.name,
              safe.code === "forbidden" || safe.code === "not_found"
                ? "denied"
                : "error",
              requestId,
            );
            return {
              isError: true,
              content: [
                {
                  type: "text" as const,
                  text: `${englishErrorMessage(safe)} (requestId ${safe.requestId})`,
                },
              ],
            };
          }
        },
      );
    }
    if (tools.length === 0) {
      server.server.setRequestHandler(ListToolsRequestSchema, () => ({
        tools: [],
      }));
    }

    const transport = new WebStandardStreamableHTTPServerTransport({
      enableJsonResponse: true,
    });
    await server.connect(transport);
    try {
      const response = await transport.handleRequest(request);
      const headers = new Headers(response.headers);
      headers.set("x-request-id", requestId);
      headers.set("cache-control", "no-store");
      for (const [name, value] of Object.entries(rateLimitHeaders(decision))) {
        headers.set(name, value);
      }
      return new Response(response.body, { status: response.status, headers });
    } finally {
      await server.close().catch(() => undefined);
    }
  } catch (error) {
    const safe = toSafeError(error, requestId);
    const status =
      safe.code === "unauthenticated"
        ? 401
        : safe.code === "not_found"
          ? 404
          : safe.code === "forbidden"
            ? 403
            : 500;
    return jsonError(
      status,
      safe.code,
      englishErrorMessage(safe),
      safe.requestId,
      status === 401
        ? { "www-authenticate": 'Bearer realm="guidu-platform-mcp"' }
        : {},
    );
  }
}
