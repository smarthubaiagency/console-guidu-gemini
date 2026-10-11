import { API_ROUTES } from "@/core/api/contracts";
import { handleApiRoute } from "@/core/api/handler";
import { getPortfolioItemForAgent } from "@/core/api/portfolio";
import { apiDeps } from "@/core/api/runtime";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string; itemId: string }> };

export async function GET(request: Request, { params }: Params) {
  const deps = apiDeps();
  return handleApiRoute(
    request,
    API_ROUTES.getPortfolioItemForAgent,
    await params,
    deps,
    (call) => getPortfolioItemForAgent(deps.prisma, call),
  );
}
