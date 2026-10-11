import { API_ROUTES } from "@/core/api/contracts";
import { getCrmContact, updateCrmContact } from "@/core/api/crm";
import { handleApiRoute } from "@/core/api/handler";
import { apiDeps } from "@/core/api/runtime";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string; contactId: string }> };

export async function GET(request: Request, { params }: Params) {
  const deps = apiDeps();
  return handleApiRoute(
    request,
    API_ROUTES.getCrmContact,
    await params,
    deps,
    (call) => getCrmContact(deps.prisma, call),
  );
}

export async function PATCH(request: Request, { params }: Params) {
  const deps = apiDeps();
  return handleApiRoute(
    request,
    API_ROUTES.updateCrmContact,
    await params,
    deps,
    (call) => updateCrmContact(deps.prisma, call),
  );
}
