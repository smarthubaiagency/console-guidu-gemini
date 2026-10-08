import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

import { readSupabasePublicConfig } from "./config";
import type { SessionClaims } from "@/core/auth/claims";

export type SessionRefresh = Readonly<{
  /** Response carrying the rotated auth cookies; must be the one returned. */
  response: NextResponse;
  /** Validated claims, or `null` when there is no usable session. */
  claims: SessionClaims | null;
}>;

/**
 * Refreshes the Supabase auth cookies for a navigation request and returns the
 * claims that back them.
 *
 * This exists so navigation does not flash protected shells at signed-out
 * visitors. It is **not** an authorization boundary: every protected page,
 * Route Handler and service revalidates identity, status and MFA on the
 * server (`src/core/auth/identity.ts`).
 */
export async function refreshSupabaseSession(
  request: NextRequest,
): Promise<SessionRefresh> {
  let response = NextResponse.next({ request });
  const { url, publishableKey } = readSupabasePublicConfig();

  const supabase = createServerClient(url, publishableKey, {
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll: (cookiesToSet, headers) => {
        for (const { name, value } of cookiesToSet) {
          request.cookies.set(name, value);
        }
        response = NextResponse.next({ request });
        for (const { name, value, options } of cookiesToSet) {
          response.cookies.set(name, value, options);
        }
        for (const [header, value] of Object.entries(headers)) {
          response.headers.set(header, value);
        }
      },
    },
  });

  // getClaims verifies the JWT signature when the project uses asymmetric
  // keys and falls back to a getUser round trip otherwise. Either way the
  // identity is validated, unlike the user object carried by getSession.
  const { data } = await supabase.auth.getClaims();

  return {
    response,
    claims: (data?.claims as SessionClaims | undefined) ?? null,
  };
}
