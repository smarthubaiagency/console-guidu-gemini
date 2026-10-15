import { randomUUID } from "node:crypto";

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";

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
import { apiDisabledResponse } from "@/core/api/switch";
import { recordApiKeyUsage } from "@/core/api/usage";
import {
  loadWorkspaceModuleViews,
  workspaceGrants,
} from "@/core/module-runtime/loaders";
import { maintenanceApiResponse } from "@/core/maintenance/api";
import { activeMode } from "@/core/maintenance/state";
import { getEffectiveWorkspaceRole } from "@/core/permissions/guard";
import { withContext, type RequestContext } from "@/lib/prisma/with-context";
import { appLog } from "@/lib/telemetry/log";
import { englishErrorMessage } from "@/core/i18n/english";
import { toSafeError } from "@/shared/errors";

import type { PermissionKey } from "@/core/permissions/catalog";

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
 *
 * CF6b: the platform's emergency switch closes the MCP (503); the key's
 * scopes and limits follow the company's plan, as in the REST API, and
 * every request counts in the key's usage (an HTTP error or a tool error
 * counts as an error).
 */

const SERVER_INFO = { name: "guidu-workspace", version: "1.0.0" } as const;

const INSTRUCTIONS =
  "Tools of a GUIDU workspace. The workspace is the one of the API key in use. Reads change no data; writes only through propose_operation, which creates a proposal for a person to approve on the platform.";

/** Public origin of the request, as the browser would reach this host. */
function publicOrigin(request: Request): string {
  const url = new URL(request.url);
  const host =
    request.headers.get("x-forwarded-host")?.split(",")[0]?.trim() ||
    request.headers.get("host") ||
    url.host;
  const proto =
    request.headers.get("x-forwarded-proto")?.split(",")[0]?.trim() ||
    url.protocol.replace(":", "");
  return `${proto}://${host}`;
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
  onFailure: () => void = () => undefined,
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
        readOnlyHint: tool.risk === "read",
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
        onFailure();
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
              text: `${englishErrorMessage(safe)} (requestId ${safe.requestId})`,
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
  granted: (permission: PermissionKey) => boolean,
  usableModules: ReadonlySet<string> = new Set(),
): McpToolDefinition[] {
  return MCP_WORKSPACE_TOOLS.filter(
    (tool) =>
      scopes.includes(tool.scope) &&
      granted(tool.permission) &&
      (!tool.moduleKey || usableModules.has(tool.moduleKey)),
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
      "Use POST (Streamable HTTP without session).",
      requestId,
      { allow: "POST" },
    );
  }
  if (!originAllowed(request)) {
    return jsonError(403, "forbidden", "Origin not allowed.", requestId);
  }

  if (deps.apiSwitches) {
    const off = apiDisabledResponse(await deps.apiSwitches(), "mcp", requestId);
    if (off) return off;
  }

  // Maintenance window (CF5c): full maintenance closes the MCP (503 with
  // Retry-After); read-only leaves only the tools that change nothing.
  const maintenance = deps.maintenance ? await deps.maintenance() : null;
  if (maintenance) {
    const closed = maintenanceApiResponse(maintenance, "GET", requestId);
    if (closed) return closed;
  }
  const readOnly =
    maintenance !== null && activeMode(maintenance) === "read_only";

  let decision: RateDecision | null = null;
  let usageKey: Parameters<typeof recordApiKeyUsage>[1] | null = null;
  try {
    const { partner, principal } = await authenticateRequest(
      request,
      deps,
      requestId,
      { allowSession: false, origin: "mcp" },
    );
    if (principal.kind !== "api_key") {
      return jsonError(401, "unauthenticated", "API key required.", requestId);
    }
    usageKey = principal;
    const ctx: RequestContext = {
      userId: principal.userId,
      workspaceId: principal.workspaceId,
      organizationId: principal.organizationId,
      partnerId: partner.partnerId,
      principalType: "api_key",
      grantId: principal.apiKeyId,
    };

    decision = await hitRateLimit(
      { redis: deps.redis, prisma: deps.prisma, limits: principal.limits },
      {
        apiKeyId: principal.apiKeyId,
        userId: principal.userId,
        workspaceId: principal.workspaceId,
      },
    );
    if (!decision.allowed) {
      await recordApiKeyUsage(deps.prisma, principal, "mcp", true);
      return jsonError(
        429,
        "rate_limited",
        "Rate limit reached. Try again shortly.",
        requestId,
        rateLimitHeaders(decision),
      );
    }

    const role = await withContext(deps.prisma, ctx, (tx) =>
      getEffectiveWorkspaceRole(tx, ctx),
    );
    // Module tools only while the module is enabled (or suspended: read).
    const views = await loadWorkspaceModuleViews(deps.prisma, ctx, "");
    const usable = new Set(
      views.modules
        .filter((m) => m.state === "enabled" || m.state === "suspended")
        .map((m) => m.moduleKey),
    );
    const tools = allowedTools(
      principal.scopes,
      workspaceGrants(role),
      usable,
    ).filter((tool) => !readOnly || tool.risk === "read");
    const call: ApiCall = {
      requestId,
      partnerId: partner.partnerId,
      principal,
      context: ctx,
      query: {},
      body: undefined,
      params: {},
      origin: publicOrigin(request),
    };

    const server = new McpServer(SERVER_INFO, {
      capabilities: { tools: {} },
      instructions: INSTRUCTIONS,
    });
    // A tool that fails marks this request's usage as an error.
    const outcome = { failed: false };
    for (const tool of tools)
      register(server, tool, deps, call, ctx, () => {
        outcome.failed = true;
      });
    // The SDK only answers `tools/list` once a tool is registered; a key
    // left with no usable tool gets an empty list, not "Method not found".
    if (tools.length === 0) {
      server.server.setRequestHandler(ListToolsRequestSchema, () => ({
        tools: [],
      }));
    }

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
      // The JSON body is read here so a tool's failure is known before
      // the usage is counted.
      const body = await response.text();
      await recordApiKeyUsage(
        deps.prisma,
        principal,
        "mcp",
        outcome.failed || response.status >= 400 || /"error"\s*:/.test(body),
      );
      return new Response(body, {
        status: response.status,
        headers,
      });
    } finally {
      await server.close().catch(() => undefined);
    }
  } catch (error) {
    const safe = toSafeError(error, requestId);
    if (usageKey) await recordApiKeyUsage(deps.prisma, usageKey, "mcp", true);
    const status =
      safe.code === "unauthenticated"
        ? 401
        : safe.code === "not_found"
          ? 404
          : 500;
    return jsonError(
      status,
      safe.code,
      englishErrorMessage(safe),
      safe.requestId,
      status === 401 ? { "www-authenticate": 'Bearer realm="guidu-mcp"' } : {},
    );
  }
}
