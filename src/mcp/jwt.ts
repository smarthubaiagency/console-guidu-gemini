/**
 * Minimal ES256 JWS verification over the Web Crypto API.
 *
 * The spike deliberately avoids adding a JWT dependency: the point is to prove
 * what the Supabase OAuth Server puts in the token, not to ship a library.
 * Production code should use `jose`.
 */

/** `JsonWebKey` from lib.dom has no `kid`, which JWS needs for key selection. */
export type PublicJwk = JsonWebKey & Readonly<{ kid?: string; use?: string }>;

export type JsonWebKeySet = Readonly<{ keys: readonly PublicJwk[] }>;

export type AccessTokenClaims = Readonly<{
  iss?: string;
  sub?: string;
  /** Supabase emits the fixed string `authenticated`, never the resource URI. */
  aud?: string | readonly string[];
  exp?: number;
  iat?: number;
  role?: string;
  session_id?: string;
  /** Only OAuth-specific claim Supabase adds. */
  client_id?: string;
  /** Never emitted by Supabase; checked so the test states the absence. */
  resource?: string;
  scope?: string;
}>;

export class JwtError extends Error {}

function base64UrlToBytes(value: string): Uint8Array<ArrayBuffer> {
  const decoded = Buffer.from(
    value.replaceAll("-", "+").replaceAll("_", "/"),
    "base64",
  );
  const bytes = new Uint8Array(new ArrayBuffer(decoded.byteLength));
  bytes.set(decoded);
  return bytes;
}

function decodeJsonSegment(segment: string): unknown {
  return JSON.parse(Buffer.from(base64UrlToBytes(segment)).toString("utf8"));
}

/** Reads the header and payload without verifying anything. */
export function decodeAccessToken(token: string): {
  header: Readonly<{ alg?: string; kid?: string; typ?: string }>;
  claims: AccessTokenClaims;
} {
  const parts = token.split(".");
  if (parts.length !== 3) throw new JwtError("token is not a three-part JWS");
  const [header, payload] = parts;
  if (header === undefined || payload === undefined) {
    throw new JwtError("token is not a three-part JWS");
  }
  return {
    header: decodeJsonSegment(header) as { alg?: string; kid?: string },
    claims: decodeJsonSegment(payload) as AccessTokenClaims,
  };
}

async function importEs256(jwk: JsonWebKey): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    "jwk",
    jwk,
    { name: "ECDSA", namedCurve: "P-256" },
    false,
    ["verify"],
  );
}

/**
 * Verifies an ES256 token against a JWKS and returns its claims.
 * Signature and `exp` only — audience and issuer are policy, see `verify.ts`.
 */
export async function verifyEs256(
  token: string,
  jwks: JsonWebKeySet,
  now: Date = new Date(),
): Promise<AccessTokenClaims> {
  const { header, claims } = decodeAccessToken(token);
  if (header.alg !== "ES256") {
    throw new JwtError(`unsupported alg: ${String(header.alg)}`);
  }

  // Supabase always sends `kid`, but a token that omits it must not turn every
  // JWKS entry into a candidate: restrict to ES256 signing keys either way.
  const candidates = jwks.keys.filter((key) => {
    if (key.kty !== "EC" || key.crv !== "P-256") return false;
    if (key.alg !== undefined && key.alg !== "ES256") return false;
    if (key.use !== undefined && key.use !== "sig") return false;
    return header.kid === undefined || key.kid === header.kid;
  });
  if (candidates.length === 0) {
    throw new JwtError("no ES256 signing key in the JWKS matches the header");
  }

  const [headerSegment, payloadSegment, signatureSegment] = token.split(".");
  const signingInput = new TextEncoder().encode(
    `${headerSegment}.${payloadSegment}`,
  );
  const signature = base64UrlToBytes(signatureSegment ?? "");

  let verified = false;
  for (const jwk of candidates) {
    const key = await importEs256(jwk);
    if (
      await crypto.subtle.verify(
        { name: "ECDSA", hash: "SHA-256" },
        key,
        signature,
        signingInput,
      )
    ) {
      verified = true;
      break;
    }
  }
  if (!verified) throw new JwtError("signature does not verify");

  // §17.2 requires expiration to be validated, so a token without `exp` is
  // rejected rather than treated as non-expiring.
  if (claims.exp === undefined) throw new JwtError("token has no exp claim");
  if (claims.exp * 1000 <= now.getTime()) {
    throw new JwtError("token is expired");
  }

  return claims;
}
