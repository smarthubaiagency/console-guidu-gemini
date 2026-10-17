import { handleAppServiceRequest } from "@/core/matrix/appservice";
import { prisma } from "@/lib/prisma/client";

/**
 * Application Service of the Matrix core (IN3, ADR 0023). The registration
 * points at `<app>/api/matrix/as`; Synapse calls `.../_matrix/app/v1/...`
 * with the hs_token. 404 while Matrix is not configured.
 */
export const dynamic = "force-dynamic";

type Context = { params: Promise<{ path: string[] }> };

async function handle(
  request: Request,
  { params }: Context,
): Promise<Response> {
  const { path } = await params;
  return handleAppServiceRequest(request, path, { prisma });
}

export const GET = handle;
export const POST = handle;
export const PUT = handle;
