import { apiDeps } from "@/core/api/runtime";
import { handleMcpWorkspaceRequest } from "@/core/mcp/server";

/**
 * Workspace MCP endpoint (F4b, ADR 0009): Streamable HTTP without
 * sessions, authenticated by an API key on every request.
 */
export const dynamic = "force-dynamic";

function handle(request: Request): Promise<Response> {
  return handleMcpWorkspaceRequest(request, apiDeps());
}

export const POST = handle;
export const GET = handle;
export const DELETE = handle;
