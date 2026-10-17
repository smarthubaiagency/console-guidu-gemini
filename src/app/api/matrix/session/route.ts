import { NextResponse, type NextRequest } from "next/server";

import { requireUser } from "@/core/auth/identity";
import { matrixConfig } from "@/core/matrix/config";
import { createMatrixSession } from "@/core/matrix/session";
import { getRequestOrigin } from "@/core/partners/resolve";
import { prisma } from "@/lib/prisma/client";
import { apiErrorResponse } from "@/shared/errors";

/**
 * Matrix login of the Inbox (IN3, ADR 0023 rule 9): for the signed-in
 * person with `inbox.view` in an active workspace, a 60-second RS256 token
 * for `org.matrix.login.jwt`. Same-origin POST only; 404 while Matrix is
 * not configured.
 */
export const dynamic = "force-dynamic";

const NO_STORE = { "cache-control": "no-store" };

export async function POST(request: NextRequest) {
  if (!matrixConfig())
    return new NextResponse(null, { status: 404, headers: NO_STORE });
  const trustedOrigin = await getRequestOrigin();
  if (!trustedOrigin || request.headers.get("origin") !== trustedOrigin) {
    return NextResponse.json(
      { error: { code: "forbidden" } },
      { status: 403, headers: NO_STORE },
    );
  }
  try {
    const identity = await requireUser();
    const session = await createMatrixSession(prisma, identity.userId);
    return NextResponse.json(session, { headers: NO_STORE });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
