import { API_ROUTES } from "@/core/api/contracts";
import { handleApiRoute } from "@/core/api/handler";
import { listMyWorkspaces } from "@/core/api/resources";
import { apiDeps } from "@/core/api/runtime";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const deps = apiDeps();
  return handleApiRoute(
    request,
    API_ROUTES.listMyWorkspaces,
    {},
    deps,
    (call) => listMyWorkspaces(deps.prisma, call),
  );
}
