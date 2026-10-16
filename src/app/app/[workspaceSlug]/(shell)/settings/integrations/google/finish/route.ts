import { cookies } from "next/headers";
import { unstable_rethrow } from "next/navigation";
import { NextResponse, type NextRequest } from "next/server";

import { requireUser } from "@/core/auth/identity";
import { completeGoogleConnection } from "@/core/integrations/google/connection";
import {
  GOOGLE_FLOW_COOKIE,
  openFlowCookie,
  sameValue,
  verifyGoogleState,
} from "@/core/integrations/google/state";
import { resolveRequestWorkspaceContext } from "@/core/partners/request-context";
import { getRequestOrigin } from "@/core/partners/resolve";
import { prisma } from "@/lib/prisma/client";
import { appLog } from "@/lib/telemetry/log";

/**
 * End of the Google connection (CF6b), on the host where it started and
 * under the session of the person who started it: the signed state must
 * name this person and this workspace, and the flow cookie of this browser
 * must hold the state's nonce and the PKCE verifier. Then the code is
 * exchanged and the account saved; the browser goes back to the
 * Integrações page with the result in the query (`google=`).
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ workspaceSlug: string }> },
) {
  const { workspaceSlug } = await params;
  const page = new URL(
    `/app/${encodeURIComponent(workspaceSlug)}/settings/integrations`,
    (await getRequestOrigin()) ?? request.nextUrl.origin,
  );
  const store = await cookies();
  const flow = openFlowCookie(store.get(GOOGLE_FLOW_COOKIE)?.value);
  store.delete(GOOGLE_FLOW_COOKIE);
  const back = (result: string) => {
    page.searchParams.set("google", result);
    return NextResponse.redirect(page, {
      status: 303,
      headers: {
        "cache-control": "no-store",
        "referrer-policy": "no-referrer",
      },
    });
  };

  try {
    const identity = await requireUser();
    const context = await resolveRequestWorkspaceContext(
      prisma,
      identity.userId,
      workspaceSlug,
    );
    const query = request.nextUrl.searchParams;
    const state = verifyGoogleState(query.get("state"));
    if (
      !state ||
      !flow ||
      state.userId !== identity.userId ||
      state.workspaceId !== context.workspaceId ||
      !sameValue(state.nonce, flow.nonce)
    ) {
      return back("invalid");
    }
    if (query.get("error")) return back("denied");
    const code = query.get("code");
    if (!code || code.length > 2048) return back("invalid");
    await completeGoogleConnection(prisma, context, {
      code,
      verifier: flow.verifier,
      appId: state.appId,
    });
    return back("connected");
  } catch (error) {
    unstable_rethrow(error);
    appLog.warn("google.connect_failed", {
      errorName: error instanceof Error ? error.name : "unknown",
    });
    return back("failed");
  }
}
