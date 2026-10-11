import { API_ROUTES } from "@/core/api/contracts";
import { handleApiRoute } from "@/core/api/handler";
import { lookupPortfolioCatalog } from "@/core/api/portfolio";
import { apiDeps } from "@/core/api/runtime";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

export async function POST(request: Request, { params }: Params) {
  const deps = apiDeps();
  return handleApiRoute(
    request,
    API_ROUTES.lookupPortfolioCatalog,
    await params,
    deps,
    (call) => lookupPortfolioCatalog(deps.prisma, call),
  );
}
