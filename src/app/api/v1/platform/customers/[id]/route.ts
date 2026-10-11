import { apiDeps } from "@/core/api/runtime";
import {
  handlePlatformApiRoute,
  PLATFORM_API_ROUTES,
} from "@/core/platform-api/handler";
import { getCustomer } from "@/core/platform-api/resources";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

export async function GET(request: Request, { params }: Params) {
  const deps = apiDeps();
  const { id } = await params;
  return handlePlatformApiRoute(
    request,
    PLATFORM_API_ROUTES.getCustomer,
    deps,
    (call) => getCustomer(deps.prisma, call.actor, id),
  );
}
