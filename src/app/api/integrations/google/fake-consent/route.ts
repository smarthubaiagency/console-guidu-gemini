import { NextResponse, type NextRequest } from "next/server";

import {
  fakeCode,
  googleRedirectUri,
  isFakeGoogleProvider,
} from "@/core/integrations/google/provider";

/**
 * Consent of the fake Google provider (CF6b), for tests and e2e only
 * (`GOOGLE_OAUTH_PROVIDER=fake`, refused in production): it grants the
 * scopes asked at once and returns to the configured redirect URI, never
 * to another one. Everywhere else it does not exist (404).
 */
export async function GET(request: NextRequest) {
  const redirectUri = googleRedirectUri();
  const params = request.nextUrl.searchParams;
  if (
    !isFakeGoogleProvider() ||
    !redirectUri ||
    params.get("redirect_uri") !== redirectUri
  ) {
    return new NextResponse(null, { status: 404 });
  }
  const target = new URL(redirectUri);
  target.searchParams.set("state", params.get("state") ?? "");
  if (params.get("deny") === "1") {
    target.searchParams.set("error", "access_denied");
  } else {
    target.searchParams.set("code", fakeCode(params.get("scope") ?? ""));
  }
  return NextResponse.redirect(target, 303);
}
