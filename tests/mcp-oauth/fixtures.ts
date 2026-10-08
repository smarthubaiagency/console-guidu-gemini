import type { JsonWebKeySet } from "../../src/mcp/jwt.js";
import type { GrantStore, McpGrant } from "../../src/mcp/resource-server.js";

export const SUPABASE_ISSUER =
  "https://mmwmhlafzewdyqsgfkzk.supabase.co/auth/v1";

export const WORKSPACE_SURFACE = "https://console.guidu.test/mcp/workspace";
export const ADMIN_SURFACE = "https://console.guidu.test/mcp/admin";

function toBase64Url(bytes: Uint8Array): string {
  return Buffer.from(bytes)
    .toString("base64")
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replaceAll("=", "");
}

export type Signer = Readonly<{
  jwks: JsonWebKeySet;
  sign: (claims: Record<string, unknown>) => Promise<string>;
}>;

/**
 * Mints ES256 tokens with a throwaway key so the resource server can be
 * exercised without the Supabase signing key, which agents cannot read.
 */
export async function createSigner(kid = "spike-kid"): Promise<Signer> {
  const pair = await crypto.subtle.generateKey(
    { name: "ECDSA", namedCurve: "P-256" },
    true,
    ["sign", "verify"],
  );
  const publicJwk = await crypto.subtle.exportKey("jwk", pair.publicKey);

  return {
    jwks: { keys: [{ ...publicJwk, kid, alg: "ES256", use: "sig" }] },
    sign: async (claims) => {
      const header = toBase64Url(
        new TextEncoder().encode(
          JSON.stringify({ alg: "ES256", typ: "JWT", kid }),
        ),
      );
      const payload = toBase64Url(
        new TextEncoder().encode(JSON.stringify(claims)),
      );
      const signature = await crypto.subtle.sign(
        { name: "ECDSA", hash: "SHA-256" },
        pair.privateKey,
        new TextEncoder().encode(`${header}.${payload}`),
      );
      return `${header}.${payload}.${toBase64Url(new Uint8Array(signature))}`;
    },
  };
}

/**
 * Claim set of a Supabase OAuth access token, copied from
 * https://supabase.com/docs/guides/auth/oauth-server/oauth-flows
 * "Access token structure": `aud` is the fixed string `authenticated` and the
 * only OAuth-specific claim is `client_id`.
 */
export function supabaseAccessTokenClaims(
  overrides: Readonly<{
    sub?: string;
    clientId?: string;
    expiresInSeconds?: number;
  }> = {},
): Record<string, unknown> {
  const issuedAt = Math.floor(Date.now() / 1000);
  return {
    iss: SUPABASE_ISSUER,
    aud: "authenticated",
    sub: overrides.sub ?? "11111111-1111-4111-8111-111111111111",
    role: "authenticated",
    iat: issuedAt,
    exp: issuedAt + (overrides.expiresInSeconds ?? 3600),
    session_id: "22222222-2222-4222-8222-222222222222",
    client_id: overrides.clientId ?? "33333333-3333-4333-8333-333333333333",
    email: "spike@example.invalid",
    aal: "aal1",
  };
}

export function grantStore(grants: readonly McpGrant[]): GrantStore {
  return {
    find: (userId, clientId, resource) =>
      grants.find(
        (grant) =>
          grant.userId === userId &&
          grant.clientId === clientId &&
          grant.resource === resource,
      ),
  };
}
