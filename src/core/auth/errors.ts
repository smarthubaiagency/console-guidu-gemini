import type { DenialReason } from "./access";

/** Where the browser should be sent when a page denies access. */
const DENIAL_ROUTE: Readonly<Record<DenialReason, string>> = {
  unauthenticated: "/login",
  identity_blocked: "/auth/suspended",
  mfa_required: "/auth/mfa",
};

/**
 * Raised by the server-side guards. Carries the HTTP status so Route Handlers
 * answer 401/403 and the redirect target so pages can show the matching state,
 * without either of them re-deriving the rule.
 */
export class AccessDeniedError extends Error {
  readonly reason: DenialReason;
  readonly status: 401 | 403;

  constructor(reason: DenialReason, status: 401 | 403) {
    super(`Acesso negado: ${reason}`);
    this.name = "AccessDeniedError";
    this.reason = reason;
    this.status = status;
  }

  /**
   * Internal path that renders the user-facing state for this denial.
   *
   * `next` is carried along for the two denials the visitor can resolve —
   * signing in and presenting a second factor — so they come back to the page
   * they asked for. A blocked identity has nowhere to come back to.
   */
  route(next?: string): string {
    const base = DENIAL_ROUTE[this.reason];
    if (next && this.reason !== "identity_blocked") {
      return `${base}?next=${encodeURIComponent(next)}`;
    }
    return base;
  }
}

export function isAccessDeniedError(
  error: unknown,
): error is AccessDeniedError {
  return error instanceof AccessDeniedError;
}
