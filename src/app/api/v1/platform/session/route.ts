import { NextResponse } from "next/server";

import { requireMfa } from "@/core/auth/identity";
import { getRequestPartner } from "@/core/partners/resolve";
import { AppError, apiErrorResponse } from "@/shared/errors";

/**
 * Administrative endpoints authorize independently of the customer API
 * (specification section 15) and require a second factor. The internal role
 * matrix lands with F1.4; this route proves the identity half of the gate.
 * Outside the platform hosts it does not exist (ADR 0012).
 */
export async function GET() {
  try {
    const partner = await getRequestPartner();
    if (!partner?.isPlatformHost) {
      throw new AppError({
        code: "not_found",
        safeMessage: "Recurso não encontrado.",
      });
    }

    const identity = await requireMfa();

    return NextResponse.json({
      userId: identity.userId,
      mfaSatisfied: identity.mfaSatisfied,
    });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
