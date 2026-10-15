import { NextResponse, type NextRequest } from "next/server";

import { verifyGoogleState } from "@/core/integrations/google/state";

/**
 * Return point of Google's consent (CF6b), the fixed redirect URI of the
 * app (APP_URL). It needs no session: it checks the signed state and sends
 * the browser back to the host where the connection started (signed in the
 * state, never taken from a parameter), whose own route ends the flow under
 * the person's session. An invalid or expired state goes nowhere.
 */
export async function GET(request: NextRequest) {
  const url = request.nextUrl;
  const state = verifyGoogleState(url.searchParams.get("state"));
  if (!state) {
    return new NextResponse("Invalid or expired state.", {
      status: 400,
      headers: { "cache-control": "no-store" },
    });
  }
  const target = new URL(
    `/app/${encodeURIComponent(state.workspaceSlug)}/settings/integrations/google/finish`,
    state.returnOrigin,
  );
  target.searchParams.set("state", url.searchParams.get("state") ?? "");
  const code = url.searchParams.get("code");
  if (code) target.searchParams.set("code", code);
  const error = url.searchParams.get("error");
  if (error) target.searchParams.set("error", error.slice(0, 64));
  return NextResponse.redirect(target, {
    status: 303,
    headers: { "cache-control": "no-store", "referrer-policy": "no-referrer" },
  });
}
