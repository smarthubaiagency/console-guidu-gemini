import { API_ROUTES } from "@/core/api/contracts";
import { handleApiRoute } from "@/core/api/handler";
import { updatePortfolioVariant } from "@/core/api/portfolio";
import { apiDeps } from "@/core/api/runtime";

export const dynamic = "force-dynamic";

type Params = {
  params: Promise<{ id: string; itemId: string; variantId: string }>;
};

export async function PATCH(request: Request, { params }: Params) {
  const deps = apiDeps();
  return handleApiRoute(
    request,
    API_ROUTES.updatePortfolioVariant,
    await params,
    deps,
    (call) => updatePortfolioVariant(deps.prisma, call),
  );
}
