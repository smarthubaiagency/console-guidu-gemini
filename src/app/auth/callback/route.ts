import { NextResponse, type NextRequest } from "next/server";
import type { EmailOtpType } from "@supabase/supabase-js";

import { provisionIdentity } from "@/core/auth/identity";
import { appOrigin } from "@/core/auth/origin";
import { safeInternalPath } from "@/core/auth/redirects";
import { createSupabaseServerClient } from "@/lib/supabase/server";

const EMAIL_OTP_TYPES: readonly EmailOtpType[] = [
  "signup",
  "invite",
  "magiclink",
  "recovery",
  "email_change",
  "email",
];

function isEmailOtpType(value: string | null): value is EmailOtpType {
  return (
    value !== null && (EMAIL_OTP_TYPES as readonly string[]).includes(value)
  );
}

/**
 * Authentication return point: turns a one-time code or e-mail token into a
 * cookie session, provisions the profile and sends the browser to an internal
 * path.
 *
 * The token never reaches a redirect target or a log line — it is consumed
 * here and the browser leaves with a clean URL.
 */
export async function GET(request: NextRequest) {
  const url = request.nextUrl;
  const origin = appOrigin();
  const code = url.searchParams.get("code");
  const tokenHash = url.searchParams.get("token_hash");
  const type = url.searchParams.get("type");
  const next = safeInternalPath(url.searchParams.get("next"));

  // The provider reports its own failures through the query string.
  if (url.searchParams.get("error")) {
    return NextResponse.redirect(`${origin}/login?error=callback`);
  }

  const supabase = await createSupabaseServerClient();

  if (code) {
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (error) {
      return NextResponse.redirect(`${origin}/login?error=callback`);
    }
  } else if (tokenHash && isEmailOtpType(type)) {
    const { error } = await supabase.auth.verifyOtp({
      type,
      token_hash: tokenHash,
    });
    if (error) {
      const reason = type === "recovery" ? "recovery" : "callback";
      return NextResponse.redirect(`${origin}/login?error=${reason}`);
    }
  } else {
    return NextResponse.redirect(`${origin}/login?error=callback`);
  }

  const { decision } = await provisionIdentity();

  if (!decision.allowed && decision.reason === "identity_blocked") {
    await supabase.auth.signOut();
    return NextResponse.redirect(`${origin}/auth/suspended`);
  }

  if (!decision.allowed) {
    return NextResponse.redirect(`${origin}/login?error=unavailable`);
  }

  return NextResponse.redirect(`${origin}${next}`);
}
