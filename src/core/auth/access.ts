import { hasMfaAssurance, type SessionClaims } from "./claims";

/** Lifecycle of an identity on this platform, mirroring `profiles.status`. */
export type IdentityStatus = "active" | "suspended" | "blocked";

export const IDENTITY_STATUSES: readonly IdentityStatus[] = [
  "active",
  "suspended",
  "blocked",
];

export function isIdentityStatus(value: unknown): value is IdentityStatus {
  return (
    typeof value === "string" &&
    (IDENTITY_STATUSES as readonly string[]).includes(value)
  );
}

export type DenialReason =
  /** No validated session at all. */
  | "unauthenticated"
  /** Valid token, but the identity is no longer allowed to operate. */
  | "identity_blocked"
  /** Valid, active identity without the second factor the route demands. */
  | "mfa_required";

export type AccessDecision =
  | Readonly<{ allowed: true; userId: string }>
  | Readonly<{ allowed: false; reason: DenialReason; status: 401 | 403 }>;

export type AccessRequest = Readonly<{
  claims: SessionClaims | null;
  /** `null` means "no profile row", which denies by default. */
  status: IdentityStatus | null;
  /** Set for administrative routes and privileged operations. */
  requireMfa?: boolean;
}>;

const DENIAL_STATUS: Readonly<Record<DenialReason, 401 | 403>> = {
  unauthenticated: 401,
  identity_blocked: 403,
  mfa_required: 403,
};

function deny(reason: DenialReason): AccessDecision {
  return { allowed: false, reason, status: DENIAL_STATUS[reason] };
}

/**
 * The single place that turns validated claims plus the server-side identity
 * status into an allow/deny decision. Pure on purpose: the same rules apply to
 * pages, Route Handlers and services, and they are unit tested.
 *
 * Order matters. A revoked identity is rejected before MFA is considered, so a
 * blocked administrator gets "blocked" instead of being nudged to enrol a
 * factor.
 */
export function decideAccess(request: AccessRequest): AccessDecision {
  const userId = request.claims?.sub;
  if (!userId) return deny("unauthenticated");

  // Deny by default: a token whose identity has no profile row — deleted,
  // never provisioned or provisioned in another project — cannot operate.
  if (request.status !== "active") return deny("identity_blocked");

  if (request.requireMfa === true && !hasMfaAssurance(request.claims)) {
    return deny("mfa_required");
  }

  return { allowed: true, userId };
}
