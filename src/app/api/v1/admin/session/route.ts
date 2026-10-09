import { NextResponse } from "next/server";

import { requireMfa } from "@/core/auth/identity";
import { apiErrorResponse } from "@/shared/errors";

/**
 * Administrative endpoints authorize independently of the customer API
 * (specification section 15) and require a second factor. The internal role
 * matrix lands with F1.4; this route proves the identity half of the gate.
 */
export async function GET() {
  try {
    const identity = await requireMfa();

    return NextResponse.json({
      userId: identity.userId,
      mfaSatisfied: identity.mfaSatisfied,
    });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
