import { createHmac } from "node:crypto";

/**
 * Minimal HS256 signer for the Auth test double. Symmetric on purpose: with an
 * `HS*` algorithm and no `kid`, `getClaims()` validates the token by calling
 * `GET /user`, which is the code path we want the tests to exercise.
 */

function base64url(input: Buffer | string): string {
  return Buffer.from(input)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

export function signAccessToken(
  payload: Record<string, unknown>,
  secret: string,
): string {
  const header = base64url(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const body = base64url(JSON.stringify(payload));
  const signature = base64url(
    createHmac("sha256", secret).update(`${header}.${body}`).digest(),
  );
  return `${header}.${body}.${signature}`;
}
