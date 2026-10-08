/** Assurance levels Supabase reports in the `aal` claim. */
export type AssuranceLevel = "aal1" | "aal2" | "aal3";

/** The claims this platform reads from a validated Supabase access token. */
export type SessionClaims = Readonly<{
  sub?: string;
  email?: string;
  aal?: string;
  session_id?: string;
  exp?: number;
}>;

const SATISFIES_MFA: ReadonlySet<string> = new Set<AssuranceLevel>([
  "aal2",
  "aal3",
]);

/** True when the session was established with a second factor. */
export function hasMfaAssurance(claims: SessionClaims | null): boolean {
  return claims?.aal !== undefined && SATISFIES_MFA.has(claims.aal);
}
