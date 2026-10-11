import { API_ROUTES } from "@/core/api/contracts";
import { createCrmContact, listCrmContacts } from "@/core/api/crm";
import { handleApiRoute } from "@/core/api/handler";
import { apiDeps } from "@/core/api/runtime";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

export async function GET(request: Request, { params }: Params) {
  const deps = apiDeps();
  return handleApiRoute(
    request,
    API_ROUTES.listCrmContacts,
    await params,
    deps,
    (call) => listCrmContacts(deps.prisma, call),
  );
}

export async function POST(request: Request, { params }: Params) {
  const deps = apiDeps();
  return handleApiRoute(
    request,
    API_ROUTES.createCrmContact,
    await params,
    deps,
    (call) => createCrmContact(deps.prisma, call),
  );
}
