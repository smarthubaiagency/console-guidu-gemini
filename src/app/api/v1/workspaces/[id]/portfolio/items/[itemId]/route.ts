import { API_ROUTES } from "@/core/api/contracts";
import { handleApiRoute } from "@/core/api/handler";
import { updatePortfolioItem } from "@/core/api/portfolio";
import { apiDeps } from "@/core/api/runtime";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string; itemId: string }> };

export async function PATCH(request: Request, { params }: Params) {
  const deps = apiDeps();
  return handleApiRoute(
    request,
    API_ROUTES.updatePortfolioItem,
    await params,
    deps,
    (call) => updatePortfolioItem(deps.prisma, call),
  );
}
