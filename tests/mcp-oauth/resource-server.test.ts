import { beforeAll, describe, expect, it } from "vitest";

import {
  authorize,
  getWorkspaceTool,
  metadataUrl,
  protectedResourceMetadata,
  type ResourceServerConfig,
} from "../../src/mcp/resource-server.js";
import {
  ADMIN_SURFACE,
  createSigner,
  grantStore,
  type Signer,
  SUPABASE_ISSUER,
  supabaseAccessTokenClaims,
  WORKSPACE_SURFACE,
} from "./fixtures.js";

const USER = "11111111-1111-4111-8111-111111111111";
const CLIENT = "33333333-3333-4333-8333-333333333333";

const SURFACES = [
  {
    resource: WORKSPACE_SURFACE,
    scopesSupported: ["workspace:read"],
    requiredScopes: ["workspace:read"],
  },
  {
    resource: ADMIN_SURFACE,
    scopesSupported: ["admin:read"],
    requiredScopes: ["admin:read"],
  },
] as const;

const GRANTS = grantStore([
  {
    userId: USER,
    clientId: CLIENT,
    resource: WORKSPACE_SURFACE,
    scopes: ["workspace:read"],
    revokedAt: null,
  },
  {
    userId: USER,
    clientId: CLIENT,
    resource: ADMIN_SURFACE,
    scopes: [],
    revokedAt: null,
  },
]);

let signer: Signer;

function config(
  binding: ResourceServerConfig["audienceBinding"],
  grants = GRANTS,
): ResourceServerConfig {
  return {
    issuer: SUPABASE_ISSUER,
    jwks: signer.jwks,
    audienceBinding: binding,
    surfaces: SURFACES,
    grants,
  };
}

beforeAll(async () => {
  signer = await createSigner();
});

describe("protected resource metadata (RFC 9728)", () => {
  it("places the metadata path after the well-known segment", () => {
    expect(metadataUrl(WORKSPACE_SURFACE)).toBe(
      "https://console.guidu.test/.well-known/oauth-protected-resource/mcp/workspace",
    );
  });

  it("points each surface at the Supabase authorization server", () => {
    expect(protectedResourceMetadata(config("grant-table"), ADMIN_SURFACE)).toEqual(
      {
        resource: ADMIN_SURFACE,
        authorization_servers: [SUPABASE_ISSUER],
        scopes_supported: ["admin:read"],
        bearer_methods_supported: ["header"],
      },
    );
  });
});

describe("unauthenticated request", () => {
  it("answers 401 with a challenge that advertises the metadata and scope", async () => {
    const result = await authorize(
      config("grant-table"),
      WORKSPACE_SURFACE,
      undefined,
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.failure.status).toBe(401);
    expect(result.failure.wwwAuthenticate).toBe(
      'Bearer resource_metadata="https://console.guidu.test/.well-known/oauth-protected-resource/mcp/workspace", scope="workspace:read"',
    );
  });
});

describe("RFC 8707 audience validation against a Supabase-shaped token", () => {
  it("rejects the token because aud is `authenticated`, not the surface URI", async () => {
    const token = await signer.sign(supabaseAccessTokenClaims());
    const result = await authorize(
      config("rfc8707"),
      WORKSPACE_SURFACE,
      `Bearer ${token}`,
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.failure.status).toBe(401);
    expect(result.failure.error).toBe("invalid_token");
    expect(result.failure.reason).toContain('["authenticated"]');
  });

  it("rejects the same token on the admin surface, so the two are indistinguishable", async () => {
    const token = await signer.sign(supabaseAccessTokenClaims());
    const workspace = await authorize(
      config("rfc8707"),
      WORKSPACE_SURFACE,
      `Bearer ${token}`,
    );
    const admin = await authorize(
      config("rfc8707"),
      ADMIN_SURFACE,
      `Bearer ${token}`,
    );
    expect(workspace.ok).toBe(false);
    expect(admin.ok).toBe(false);
    if (workspace.ok || admin.ok) return;
    // Same verdict for both surfaces: nothing in the token separates them.
    expect(admin.failure.reason.replace(ADMIN_SURFACE, "")).toBe(
      workspace.failure.reason.replace(WORKSPACE_SURFACE, ""),
    );
  });
});

describe("grant-table binding, the compensating control", () => {
  it("accepts the token on the surface its grant covers", async () => {
    const token = await signer.sign(supabaseAccessTokenClaims());
    const result = await authorize(
      config("grant-table"),
      WORKSPACE_SURFACE,
      `Bearer ${token}`,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(getWorkspaceTool(result.request)).toEqual({
      id: `ws-${USER}`,
      name: "Workspace de demonstração SMA-93",
      surface: WORKSPACE_SURFACE,
      grantedScopes: ["workspace:read"],
    });
  });

  it("answers 403 insufficient_scope on the admin surface for the same token", async () => {
    const token = await signer.sign(supabaseAccessTokenClaims());
    const result = await authorize(
      config("grant-table"),
      ADMIN_SURFACE,
      `Bearer ${token}`,
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.failure.status).toBe(403);
    expect(result.failure.error).toBe("insufficient_scope");
    expect(result.failure.wwwAuthenticate).toContain('scope="admin:read"');
  });

  it("refuses a client that has no grant row at all", async () => {
    const token = await signer.sign(
      supabaseAccessTokenClaims({
        clientId: "44444444-4444-4444-8444-444444444444",
      }),
    );
    const result = await authorize(
      config("grant-table"),
      WORKSPACE_SURFACE,
      `Bearer ${token}`,
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.failure.reason).toContain("no mcp_grants row");
  });

  it("stops an unexpired token once the grant is revoked", async () => {
    const revoked = grantStore([
      {
        userId: USER,
        clientId: CLIENT,
        resource: WORKSPACE_SURFACE,
        scopes: ["workspace:read"],
        revokedAt: new Date("2026-10-08T00:00:00Z"),
      },
    ]);
    const token = await signer.sign(supabaseAccessTokenClaims());
    const result = await authorize(
      config("grant-table", revoked),
      WORKSPACE_SURFACE,
      `Bearer ${token}`,
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.failure.reason).toBe("grant revoked");
  });
});

describe("token hygiene", () => {
  it("rejects an expired token", async () => {
    const token = await signer.sign(
      supabaseAccessTokenClaims({ expiresInSeconds: -1 }),
    );
    const result = await authorize(
      config("grant-table"),
      WORKSPACE_SURFACE,
      `Bearer ${token}`,
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.failure.reason).toBe("token is expired");
  });

  it("rejects a token signed by another key", async () => {
    const other = await createSigner();
    const token = await other.sign(supabaseAccessTokenClaims());
    const result = await authorize(
      config("grant-table"),
      WORKSPACE_SURFACE,
      `Bearer ${token}`,
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.failure.reason).toBe("signature does not verify");
  });

  it("rejects a token from another issuer", async () => {
    const token = await signer.sign({
      ...supabaseAccessTokenClaims(),
      iss: "https://attacker.test/auth/v1",
    });
    const result = await authorize(
      config("grant-table"),
      WORKSPACE_SURFACE,
      `Bearer ${token}`,
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.failure.reason).toContain("issuer mismatch");
  });

  it("does not serve an unknown surface", async () => {
    const token = await signer.sign(supabaseAccessTokenClaims());
    const result = await authorize(
      config("grant-table"),
      "https://console.guidu.test/mcp/unknown",
      `Bearer ${token}`,
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.failure.status).toBe(404);
  });
});
