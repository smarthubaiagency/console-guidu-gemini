/**
 * Origin of the homeserver for the CSP `connect-src` (IN3): the browser of
 * the attendant talks to Synapse with matrix-js-sdk (ADR 0023). Kept apart
 * from `config.ts` (no key parsing) because the proxy runs it on every
 * request. Null when Matrix is not configured.
 */
export function matrixCspOrigin(
  env: Readonly<Record<string, string | undefined>> = process.env,
): string | null {
  const required = [
    "MATRIX_HOMESERVER_URL",
    "MATRIX_SERVER_NAME",
    "MATRIX_AS_TOKEN",
    "MATRIX_HS_TOKEN",
    "MATRIX_JWT_PRIVATE_KEY",
  ];
  if (required.some((name) => !env[name]?.trim())) return null;
  try {
    const url = new URL(env.MATRIX_HOMESERVER_URL!.trim());
    if (url.protocol !== "https:" && url.protocol !== "http:") return null;
    return url.origin;
  } catch {
    return null;
  }
}
