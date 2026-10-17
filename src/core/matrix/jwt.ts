import { randomBytes, randomUUID, sign } from "node:crypto";

import type { MatrixConfig } from "./config";

/**
 * Login of an attendant on Synapse (`org.matrix.login.jwt`, ADR 0023 rule 9
 * as revised by the proof of concept): a short RS256 token signed with the
 * console's private key; Synapse holds only the public one. Whoever has
 * this key can enter as any user (Synapse does not restrict the subject),
 * so the console signs only opaque attendant localparts and always sets a
 * short expiry.
 */

/** `u_` and 24 base32 characters: opaque, never the internal user id. */
export const ATTENDANT_LOCALPART = /^u_[a-z2-7]{24}$/;

const BASE32 = "abcdefghijklmnopqrstuvwxyz234567";

export function newAttendantLocalpart(): string {
  const bytes = randomBytes(24);
  let out = "u_";
  for (const byte of bytes) out += BASE32[byte & 31];
  return out;
}

export const LOGIN_TTL_SECONDS = 60;

const b64 = (value: unknown) =>
  Buffer.from(JSON.stringify(value)).toString("base64url");

export function signLoginToken(
  config: MatrixConfig,
  input: Readonly<{ localpart: string; displayName: string; now?: Date }>,
): { token: string; expiresAt: Date } {
  if (!ATTENDANT_LOCALPART.test(input.localpart)) {
    throw new Error("matrix: the login token is only for attendant accounts");
  }
  const now = Math.floor((input.now ?? new Date()).getTime() / 1000);
  const exp = now + LOGIN_TTL_SECONDS;
  const header = b64({ alg: "RS256", typ: "JWT" });
  const payload = b64({
    sub: input.localpart,
    name: input.displayName.slice(0, 120),
    iss: config.jwtIssuer,
    aud: config.jwtAudience,
    iat: now,
    nbf: now,
    exp,
    jti: randomUUID(),
  });
  const signature = sign(
    "sha256",
    Buffer.from(`${header}.${payload}`),
    config.jwtPrivateKey,
  ).toString("base64url");
  return {
    token: `${header}.${payload}.${signature}`,
    expiresAt: new Date(exp * 1000),
  };
}
