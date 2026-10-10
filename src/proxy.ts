import { NextResponse, type NextRequest } from "next/server";

import { safeInternalPath } from "@/core/auth/redirects";
import {
  normalizeHost,
  platformHosts,
  requestHost,
} from "@/core/partners/hosts";
import { refreshSupabaseSession } from "@/lib/supabase/session";

/**
 * Navigation aid only (the `proxy` convention that replaced `middleware` in
 * Next.js 16).
 *
 * It keeps the Supabase cookies fresh and avoids sending signed-out visitors
 * into protected shells, but it decides nothing: identity, status and MFA are
 * revalidated on the server by every page, Route Handler and service. A
 * request that slips past this file still gets 401/403 downstream.
 */

const PROTECTED_PREFIXES = ["/app", "/platform", "/admin"] as const;
const SIGNED_IN_ONLY_PREFIXES = [
  "/auth/mfa",
  "/invite",
  "/partner-invite",
] as const;
const SIGNED_OUT_ONLY_PATHS = ["/login", "/forgot-password"] as const;
/**
 * Served only on platform hosts (ADR 0012); 404 everywhere else. API routes
 * are outside the matcher, so /api/v1/platform checks the host itself.
 */
const PLATFORM_ONLY_PREFIXES = ["/platform"] as const;

function startsWithAny(pathname: string, prefixes: readonly string[]): boolean {
  return prefixes.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  );
}

export default async function proxy(request: NextRequest) {
  const { pathname, search } = request.nextUrl;

  // The page and route guards repeat this check; answering here keeps a
  // partner domain from even redirecting /platform to the login page.
  if (
    startsWithAny(pathname, PLATFORM_ONLY_PREFIXES) &&
    !platformHosts(process.env).has(
      normalizeHost(requestHost((name) => request.headers.get(name))) ?? "",
    )
  ) {
    return new NextResponse(null, { status: 404 });
  }

  const { response, claims } = await refreshSupabaseSession(request);
  const signedIn = Boolean(claims?.sub);

  if (
    !signedIn &&
    startsWithAny(pathname, [...PROTECTED_PREFIXES, ...SIGNED_IN_ONLY_PREFIXES])
  ) {
    const login = request.nextUrl.clone();
    login.pathname = "/login";
    login.search = "";
    login.searchParams.set("next", `${pathname}${search}`);
    return NextResponse.redirect(login);
  }

  if (
    signedIn &&
    (SIGNED_OUT_ONLY_PATHS as readonly string[]).includes(pathname)
  ) {
    const next = safeInternalPath(request.nextUrl.searchParams.get("next"));
    const target = request.nextUrl.clone();
    target.pathname = next.split("?")[0] ?? next;
    target.search = "";
    return NextResponse.redirect(target);
  }

  return response;
}

export const config = {
  // Page navigations only. Static assets do not need cookie rotation, and
  // `/api` routes must reach their own guard so they answer 401/403 instead of
  // being redirected to a login page.
  matcher: [
    "/((?!api/|_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)",
  ],
};
