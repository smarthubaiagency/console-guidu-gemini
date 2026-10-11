import { apiDeps } from "@/core/api/runtime";
import {
  handlePlatformApiRoute,
  PLATFORM_API_ROUTES,
} from "@/core/platform-api/handler";
import { listCustomers } from "@/core/platform-api/resources";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const deps = apiDeps();
  return handlePlatformApiRoute(
    request,
    PLATFORM_API_ROUTES.listCustomers,
    deps,
    (call) => listCustomers(deps.prisma, call.actor, call.query),
  );
}
