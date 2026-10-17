import { NextResponse, type NextRequest } from "next/server";

import { readSessionClaims } from "@/core/auth/identity";
import { matrixEnabled, requestDeviceLogout } from "@/core/matrix";
import { getRequestOrigin } from "@/core/partners/resolve";
import { prisma } from "@/lib/prisma/client";
import { withIdentityContext } from "@/lib/prisma/with-identity-context";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { appLog } from "@/lib/telemetry/log";

/**
 * Logout.
 *
 * POST only — a GET would let any third-party page sign users out with an
 * `<img>` tag. The Origin check keeps a cross-site form from doing the same.
 * A missing Origin header is rejected too, not treated as same-origin:
 * browsers attach Origin to every same-origin POST, so its absence means the
 * request did not come from this app's own form.
 *
 * The trusted origin is the one of the request host (F6a): APP_URL on
 * platform hosts, the partner domain once it matched an active partner
 * (ADR 0012). Unknown hosts have none, so they are refused. The person stays
 * on the host they signed out from.
 *
 * With the Inbox (IN3), the person's Matrix sessions end too: the worker
 * deletes their devices on Synapse. Best effort: sign-out never waits on it.
 */
export async function POST(request: NextRequest) {
  const trustedOrigin = await getRequestOrigin();
  const origin = request.headers.get("origin");
  if (!trustedOrigin || origin !== trustedOrigin) {
    return NextResponse.json({ error: { code: "forbidden" } }, { status: 403 });
  }

  if (matrixEnabled()) await endMatrixSessions();

  const supabase = await createSupabaseServerClient();
  await supabase.auth.signOut();

  return NextResponse.redirect(trustedOrigin + "/login?notice=signed-out", {
    status: 303,
  });
}

async function endMatrixSessions(): Promise<void> {
  try {
    const claims = await readSessionClaims();
    if (!claims?.sub) return;
    const userId = claims.sub;
    await withIdentityContext(prisma, userId, (tx) =>
      requestDeviceLogout(tx, userId),
    );
  } catch (error) {
    appLog.error("matrix.logout.not_queued", {
      error: String(error).slice(0, 200),
    });
  }
}
