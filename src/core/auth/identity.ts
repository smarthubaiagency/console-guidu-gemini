import "server-only";

import { createSupabaseServerClient } from "@/lib/supabase/server";

import { decideAccess, type AccessDecision } from "./access";
import { hasMfaAssurance, type SessionClaims } from "./claims";
import { AccessDeniedError } from "./errors";
import { ensureProfile, readProfile, type ProfileRecord } from "./profiles";

import type { SupabaseClient } from "@supabase/supabase-js";

export type Identity = Readonly<{
  userId: string;
  email: string | undefined;
  emailConfirmedAt?: string | null;
  mfaSatisfied: boolean;
  profile: ProfileRecord;
}>;

async function resolveEmailConfirmedAt(
  supabase: SupabaseClient,
  claims: SessionClaims | null,
): Promise<string | null> {
  if (claims?.email_confirmed_at) {
    return claims.email_confirmed_at;
  }
  try {
    const { data } = await supabase.auth.getUser();
    return data?.user?.email_confirmed_at ?? null;
  } catch {
    return null;
  }
}

/**
 * Validates the session against the Auth server and returns its claims.
 *
 * `getClaims` verifies the signature locally for asymmetric signing keys and
 * falls back to a `getUser` round trip otherwise. The user object from
 * `getSession` is never used: it comes from cookies the browser can edit.
 */
export async function readSessionClaims(): Promise<SessionClaims | null> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.auth.getClaims();
  if (error || !data?.claims) return null;
  return data.claims as SessionClaims;
}

/**
 * Current identity with its server-side status, or `null` when there is no
 * usable session. Never throws, so pages can branch on it.
 */
export async function readIdentity(): Promise<Identity | null> {
  const supabase = await createSupabaseServerClient();
  const claims = await readSessionClaims();
  if (!claims?.sub) return null;

  const profile = await readProfile(claims.sub);
  if (!profile) return null;

  const emailConfirmedAt = await resolveEmailConfirmedAt(supabase, claims);

  return {
    userId: claims.sub,
    email: claims.email,
    emailConfirmedAt,
    mfaSatisfied: hasMfaAssurance(claims),
    profile,
  };
}

/**
 * Provisions the profile for the identity that just signed in and returns the
 * resulting decision. Used by the sign-in action and the auth callback — the
 * two places where "first login" can happen.
 */
export async function provisionIdentity(): Promise<
  Readonly<{ decision: AccessDecision; profile: ProfileRecord | null }>
> {
  const claims = await readSessionClaims();
  if (!claims?.sub) {
    return {
      decision: decideAccess({ claims: null, status: null }),
      profile: null,
    };
  }

  const profile = await ensureProfile({
    userId: claims.sub,
    ...(claims.email === undefined ? {} : { email: claims.email }),
  });

  return {
    decision: decideAccess({ claims, status: profile.status }),
    profile,
  };
}

async function guard(requireMfaFactor: boolean): Promise<Identity> {
  const claims = await readSessionClaims();
  const profile = claims?.sub ? await readProfile(claims.sub) : null;

  const decision = decideAccess({
    claims,
    status: profile?.status ?? null,
    requireMfa: requireMfaFactor,
  });

  if (!decision.allowed) {
    throw new AccessDeniedError(decision.reason, decision.status);
  }

  // `decision.allowed` implies both of these; the assertions keep the types
  // honest without widening Identity.
  if (!claims || !profile) {
    throw new AccessDeniedError("unauthenticated", 401);
  }

  const supabase = await createSupabaseServerClient();
  const emailConfirmedAt = await resolveEmailConfirmedAt(supabase, claims);

  return {
    userId: decision.userId,
    email: claims.email,
    emailConfirmedAt,
    mfaSatisfied: hasMfaAssurance(claims),
    profile,
  };
}

/**
 * Requires an authenticated, non-blocked identity. Every protected page,
 * Route Handler and service calls this on the server, regardless of what the
 * middleware already allowed through.
 */
export function requireUser(): Promise<Identity> {
  return guard(false);
}

/**
 * Requires an authenticated, non-blocked identity that also presented a second
 * factor. Mandatory for internal administration (`/admin`) and privileged
 * operations.
 */
export function requireMfa(): Promise<Identity> {
  return guard(true);
}
