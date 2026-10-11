import { API_ROUTES } from "@/core/api/contracts";
import { handleApiRoute } from "@/core/api/handler";
import { searchPortfolioForAgent } from "@/core/api/portfolio";
import { apiDeps } from "@/core/api/runtime";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

export async function GET(request: Request, { params }: Params) {
  const deps = apiDeps();
  return handleApiRoute(
    request,
    API_ROUTES.searchPortfolioForAgent,
    await params,
    deps,
    (call) => searchPortfolioForAgent(deps.prisma, call),
  );
}
