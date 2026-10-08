import { NextResponse, type NextRequest } from "next/server";

import { appOrigin } from "@/core/auth/origin";
import { createSupabaseServerClient } from "@/lib/supabase/server";

/**
 * Logout.
 *
 * POST only — a GET would let any third-party page sign users out with an
 * `<img>` tag. The Origin check keeps a cross-site form from doing the same.
 * A missing Origin header is rejected too, not treated as same-origin:
 * browsers attach Origin to every same-origin POST, so its absence means the
 * request did not come from this app's own form.
 */
export async function POST(request: NextRequest) {
  const trustedOrigin = appOrigin();
  const origin = request.headers.get("origin");
  if (origin !== trustedOrigin) {
    return NextResponse.json({ error: { code: "forbidden" } }, { status: 403 });
  }

  const supabase = await createSupabaseServerClient();
  await supabase.auth.signOut();

  return NextResponse.redirect(trustedOrigin + "/login?notice=signed-out", {
    status: 303,
  });
}
