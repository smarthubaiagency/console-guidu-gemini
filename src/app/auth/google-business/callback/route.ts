import { cookies } from "next/headers";
import { NextResponse, type NextRequest } from "next/server";

import { readIdentity } from "@/core/auth/identity";
import { getRequestOrigin } from "@/core/partners/resolve";
import { appLog } from "@/lib/telemetry/log";
import { googleBusinessProvider } from "@/modules/google-business/provider";
import {
  GB_CONNECT_COOKIE,
  GB_CONNECT_TTL_MS,
  openConnectFlow,
  sameNonce,
  sealConnectFlow,
} from "@/modules/google-business/server/connect-flow";
import { windowPath } from "@/modules/google-business/server/target";

/**
 * Return from Google's consent in the "Adicionar local" onboarding (GB1a),
 * on the host where it started and under the session of who started it:
 * the flow cookie must name this person and its nonce must come back as
 * `state`. The provider's pending data goes into the encrypted cookie (never
 * the URL) and the browser goes back to the onboarding window at the next
 * step: choose the ficha, the permissions that are missing, or refused.
 */
export async function GET(request: NextRequest) {
  const origin = (await getRequestOrigin()) ?? request.nextUrl.origin;
  const store = await cookies();
  const flow = openConnectFlow(store.get(GB_CONNECT_COOKIE)?.value);
  const identity = await readIdentity();
  const state = request.nextUrl.searchParams.get("state") ?? "";
  const headers = {
    "cache-control": "no-store",
    "referrer-policy": "no-referrer",
  };
  if (
    !flow ||
    !identity ||
    flow.userId !== identity.userId ||
    !sameNonce(state, flow.nonce)
  ) {
    store.delete(GB_CONNECT_COOKIE);
    return NextResponse.redirect(new URL("/app", origin), {
      status: 303,
      headers,
    });
  }
  const go = (step: string, extra: Record<string, string> = {}) =>
    NextResponse.redirect(
      new URL(windowPath(flow.target, step, extra), origin),
      { status: 303, headers },
    );

  try {
    const result = await googleBusinessProvider().completeConnect(
      request.nextUrl.searchParams,
    );
    switch (result.status) {
      case "connected":
        store.set(
          GB_CONNECT_COOKIE,
          sealConnectFlow({ ...flow, pending: result.pending }),
          {
            httpOnly: true,
            sameSite: "lax",
            secure: origin.startsWith("https://"),
            path: "/",
            maxAge: GB_CONNECT_TTL_MS / 1000,
          },
        );
        return go("choose");
      case "missing_permissions":
        return go("permissions", { missing: result.missing.join(",") });
      case "denied":
        return go("denied");
      case "failed":
        appLog.warn("google_business.connect_failed", {
          reason: result.reason,
        });
        return go("failed");
    }
  } catch (error) {
    appLog.warn("google_business.connect_failed", {
      errorName: error instanceof Error ? error.name : "unknown",
    });
    return go("failed");
  }
}
