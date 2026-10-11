import { randomUUID } from "node:crypto";

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";

import { recordAudit } from "@/core/audit/record";
import {
  type ApiCall,
  type ApiDeps,
  authenticateRequest,
} from "@/core/api/handler";
import {
  hitRateLimit,
  type RateDecision,
  rateLimitHeaders,
} from "@/core/api/rate-limit";
import { workspaceGrants } from "@/core/module-runtime/loaders";
import { getEffectiveWorkspaceRole } from "@/core/permissions/guard";
import { withContext, type RequestContext } from "@/lib/prisma/with-context";
import { appLog } from "@/lib/telemetry/log";
import { toSafeError } from "@/shared/errors";

import type { Permission } from "@/core/permissions/catalog";

import { MCP_WORKSPACE_TOOLS, type McpToolDefinition } from "./tools";

/**
 * Workspace MCP server (F4b, Especificação §17, ADR 0009) at
 * `/mcp/workspace`: Streamable HTTP in stateless mode with the official SDK.
 *
 * Every HTTP request is authenticated again with the API key (a session is
 * neither identity nor authorization, §17), counted by the rate limit of
 * the API and served by a fresh server holding only the tools the key's
 * scopes and the member's current role allow (`tools/list`). Each
 * `tools/call` runs the REST services, which check the permission again,
 * and is audited with the request id. Requests from a browser Origin other
 * than the host are refused (DNS rebinding).
 */

const SERVER_INFO = { name: "guidu-workspace", version: "1.0.0" } as const;

const INSTRUCTIONS =
  "Ferramentas de leitura de um workspace do GUIDU. O workspace é o da chave usada; nenhuma ferramenta muda dados.";

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

/** Origin of a browser request must be this host (DNS rebinding). */
export function originAllowed(request: Request): boolean {
  const origin = request.headers.get("origin");
  if (!origin) return true;
  try {
    const host =
      request.headers.get("x-forwarded-host")?.split(",")[0]?.trim() ??
      request.headers.get("host");
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}

async function auditCall(
  deps: ApiDeps,
  ctx: RequestContext,
  tool: string,
  result: "success" | "denied" | "error",
  requestId: string,
): Promise<void> {
  try {
    await withContext(deps.prisma, ctx, (tx) =>
      recordAudit(tx, ctx, {
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

function register(
  server: McpServer,
  tool: McpToolDefinition,
  deps: ApiDeps,
  call: ApiCall,
  ctx: RequestContext,
): void {
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
          await tool.run(deps.prisma, call, args ?? {}),
        );
        await auditCall(deps, ctx, tool.name, "success", call.requestId);
        return {
          content: [{ type: "text" as const, text: JSON.stringify(output) }],
          structuredContent: output as Record<string, unknown>,
        };
      } catch (error) {
        const safe = toSafeError(error, call.requestId);
        await auditCall(
          deps,
          ctx,
          tool.name,
          safe.code === "forbidden" || safe.code === "not_found"
            ? "denied"
            : "error",
          call.requestId,
        );
        return {
          isError: true,
          content: [
            {
              type: "text" as const,
              text: `${safe.safeMessage} (requestId ${safe.requestId})`,
            },
          ],
        };
      }
    },
  );
}

/** Tools the key and the member's current role allow. */
export function allowedTools(
  scopes: readonly string[],
  granted: (permission: Permission) => boolean,
): McpToolDefinition[] {
  return MCP_WORKSPACE_TOOLS.filter(
    (tool) => scopes.includes(tool.scope) && granted(tool.permission),
  );
}

export async function handleMcpWorkspaceRequest(
  request: Request,
  deps: ApiDeps,
): Promise<Response> {
  const requestId = randomUUID();
  if (request.method !== "POST") {
    return jsonError(
      405,
      "method_not_allowed",
      "Use POST (Streamable HTTP sem sessão).",
      requestId,
      { allow: "POST" },
    );
  }
  if (!originAllowed(request)) {
    return jsonError(403, "forbidden", "Origem não permitida.", requestId);
  }

  let decision: RateDecision | null = null;
  try {
    const { partner, principal } = await authenticateRequest(
      request,
      deps,
      requestId,
      { allowSession: false, origin: "mcp" },
    );
    if (principal.kind !== "api_key") {
      return jsonError(
        401,
        "unauthenticated",
        "Chave de API exigida.",
        requestId,
      );
    }
    const ctx: RequestContext = {
      userId: principal.userId,
      workspaceId: principal.workspaceId,
      organizationId: principal.organizationId,
      partnerId: partner.partnerId,
      principalType: "api_key",
      grantId: principal.apiKeyId,
    };

    decision = await hitRateLimit(
      { redis: deps.redis, prisma: deps.prisma },
      {
        apiKeyId: principal.apiKeyId,
        userId: principal.userId,
        workspaceId: principal.workspaceId,
      },
    );
    if (!decision.allowed) {
      return jsonError(
        429,
        "rate_limited",
        "Limite de requisições atingido. Tente de novo em instantes.",
        requestId,
        rateLimitHeaders(decision),
      );
    }

    const role = await withContext(deps.prisma, ctx, (tx) =>
      getEffectiveWorkspaceRole(tx, ctx),
    );
    const tools = allowedTools(principal.scopes, workspaceGrants(role));
    const call: ApiCall = {
      requestId,
      partnerId: partner.partnerId,
      principal,
      context: ctx,
      query: {},
    };

    const server = new McpServer(SERVER_INFO, {
      capabilities: { tools: {} },
      instructions: INSTRUCTIONS,
    });
    for (const tool of tools) register(server, tool, deps, call, ctx);

    // No sessionIdGenerator: stateless mode, every request stands alone.
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
      return new Response(response.body, {
        status: response.status,
        headers,
      });
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
          : 500;
    return jsonError(
      status,
      safe.code,
      safe.safeMessage,
      safe.requestId,
      status === 401 ? { "www-authenticate": 'Bearer realm="guidu-mcp"' } : {},
    );
  }
}
