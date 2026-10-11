import { apiDeps } from "@/core/api/runtime";
import { handlePlatformMcpRequest } from "@/core/mcp/platform-server";

/**
 * Platform MCP endpoint (F4e): Streamable HTTP without sessions, on the
 * platform hosts only, authenticated by an administrative key on every
 * request.
 */
export const dynamic = "force-dynamic";

function handle(request: Request): Promise<Response> {
  return handlePlatformMcpRequest(request, apiDeps());
}

export const POST = handle;
export const GET = handle;
export const DELETE = handle;
