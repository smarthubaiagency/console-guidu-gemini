import { API_ROUTES } from "@/core/api/contracts";
import { handleApiRoute } from "@/core/api/handler";
import { getWorkspaceOverview } from "@/core/api/resources";
import { apiDeps } from "@/core/api/runtime";

export const dynamic = "force-dynamic";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const deps = apiDeps();
  return handleApiRoute(
    request,
    API_ROUTES.getWorkspaceOverview,
    await params,
    deps,
    (call) => getWorkspaceOverview(deps.prisma, call),
  );
}
