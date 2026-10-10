import { API_ROUTES } from "@/core/api/contracts";
import { handleApiRoute } from "@/core/api/handler";
import { getWorkspaceUsage } from "@/core/api/resources";
import { apiDeps } from "@/core/api/runtime";

export const dynamic = "force-dynamic";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const deps = apiDeps();
  return handleApiRoute(
    request,
    API_ROUTES.getWorkspaceUsage,
    await params,
    deps,
    (call) => getWorkspaceUsage(deps.prisma, call),
  );
}
