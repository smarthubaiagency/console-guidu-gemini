import { NextResponse } from "next/server";

import { accessDeniedResponse } from "@/core/auth/api-guard";
import { requireUser } from "@/core/auth/identity";

/**
 * Protected service endpoint for the current identity.
 *
 * It exists so revocation is observable where it matters: a blocked identity
 * holding a still-valid JWT gets 403 here, not a stale 200 (AC03). The
 * middleware is not in this path at all — the guard runs on the server for
 * every request.
 */
export async function GET() {
  try {
    const identity = await requireUser();

    return NextResponse.json({
      userId: identity.userId,
      email: identity.email ?? null,
      status: identity.profile.status,
      mfaSatisfied: identity.mfaSatisfied,
    });
  } catch (error) {
    const denied = accessDeniedResponse(error);
    if (denied) return denied;
    throw error;
  }
}
