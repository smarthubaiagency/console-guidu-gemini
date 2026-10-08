/**
 * Live probes against the Supabase OAuth 2.1 Server of the dev project `guidu`.
 *
 * Opt in with `GUIDU_OAUTH_LIVE=1`: the suite reaches the network and registers
 * one throwaway OAuth client per run through dynamic client registration, which
 * is itself one of the things the spike has to prove. Every other probe is a
 * read or an error path that leaves no row behind. Registered clients are named
 * `SMA-93 live probe` so they can be soft-deleted afterwards.
 */
import { beforeAll, describe, expect, it } from "vitest";

import { SUPABASE_ISSUER } from "./fixtures.js";

const AUTHORIZE = `${SUPABASE_ISSUER}/oauth/authorize`;
const REGISTER = `${SUPABASE_ISSUER}/oauth/clients/register`;
const TOKEN = `${SUPABASE_ISSUER}/oauth/token`;
const REDIRECT_URI = "http://127.0.0.1:33418/callback";
const S256_CHALLENGE = "-FMzw0mn6T0BPGthAO15-qHzU7j91NMHEZWnAG__0T4";
const PROBE_CLIENT_NAME = "SMA-93 live probe";

const describeLive =
  process.env.GUIDU_OAUTH_LIVE === "1" ? describe : describe.skip;

/** Public PKCE-only client, registered in `beforeAll`. */
let spikeClientId = "";

type Metadata = Readonly<{
  issuer: string;
  authorization_endpoint: string;
  token_endpoint: string;
  registration_endpoint?: string;
  revocation_endpoint?: string;
  introspection_endpoint?: string;
  scopes_supported?: readonly string[];
  code_challenge_methods_supported?: readonly string[];
  grant_types_supported?: readonly string[];
  response_types_supported?: readonly string[];
  token_endpoint_auth_methods_supported?: readonly string[];
  authorization_response_iss_parameter_supported?: boolean;
}>;

async function metadata(): Promise<Metadata> {
  const response = await fetch(
    `${SUPABASE_ISSUER}/.well-known/oauth-authorization-server`,
  );
  expect(response.status).toBe(200);
  return (await response.json()) as Metadata;
}

async function register(body: Record<string, unknown>): Promise<Response> {
  return fetch(REGISTER, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

/** Follows no redirect, so the `Location` header is the observable result. */
async function authorizeRaw(query: Record<string, string>): Promise<Response> {
  const url = new URL(AUTHORIZE);
  for (const [key, value] of Object.entries(query)) {
    url.searchParams.set(key, value);
  }
  return fetch(url, { redirect: "manual" });
}

function authorizeError(response: Response): URLSearchParams {
  const location = response.headers.get("location");
  expect(location, "authorize must redirect").not.toBeNull();
  return new URL(location ?? "").searchParams;
}

function baseQuery(): Record<string, string> {
  return {
    response_type: "code",
    client_id: spikeClientId,
    redirect_uri: REDIRECT_URI,
    code_challenge: S256_CHALLENGE,
    code_challenge_method: "S256",
  };
}

beforeAll(async () => {
  if (process.env.GUIDU_OAUTH_LIVE !== "1") return;
  const response = await register({
    client_name: PROBE_CLIENT_NAME,
    redirect_uris: [REDIRECT_URI],
    grant_types: ["authorization_code", "refresh_token"],
    response_types: ["code"],
    token_endpoint_auth_method: "none",
  });
  expect(response.status).toBe(201);
  const client = (await response.json()) as { client_id?: string };
  expect(client.client_id).toBeTruthy();
  spikeClientId = client.client_id ?? "";
});

describeLive("authorization server metadata (RFC 8414)", () => {
  it("is served and advertises authorization code with PKCE S256", async () => {
    const document = await metadata();
    expect(document.issuer).toBe(SUPABASE_ISSUER);
    expect(document.grant_types_supported).toEqual([
      "authorization_code",
      "refresh_token",
    ]);
    expect(document.response_types_supported).toEqual(["code"]);
    expect(document.code_challenge_methods_supported).toContain("S256");
  });

  it("still advertises the plain PKCE method, which OAuth 2.1 forbids", async () => {
    const document = await metadata();
    expect(document.code_challenge_methods_supported).toContain("plain");
  });

  it("advertises only OIDC scopes, so no application scope can be requested", async () => {
    const document = await metadata();
    expect([...(document.scopes_supported ?? [])].sort()).toEqual([
      "email",
      "offline_access",
      "openid",
      "phone",
      "profile",
    ]);
  });

  it("advertises no revocation and no introspection endpoint", async () => {
    const document = await metadata();
    expect(document.revocation_endpoint).toBeUndefined();
    expect(document.introspection_endpoint).toBeUndefined();
  });

  it("does not advertise the RFC 9207 iss parameter", async () => {
    const document = await metadata();
    expect(
      document.authorization_response_iss_parameter_supported,
    ).toBeUndefined();
  });

  it("offers no private_key_jwt or mTLS client authentication", async () => {
    const document = await metadata();
    expect(document.token_endpoint_auth_methods_supported).toEqual([
      "client_secret_basic",
      "client_secret_post",
      "none",
    ]);
  });
});

describeLive("authorization request", () => {
  it("redirects to the application-hosted consent page, not a Supabase page", async () => {
    const response = await authorizeRaw({
      ...baseQuery(),
      scope: "openid",
      state: "t1",
    });
    expect(response.status).toBe(302);
    const location = new URL(response.headers.get("location") ?? "");
    expect(location.pathname).toBe("/oauth/consent");
    expect(location.searchParams.get("authorization_id")).toBeTruthy();
    expect(location.origin).not.toContain("supabase.co");
  });

  it("requires PKCE for a public client", async () => {
    const { code_challenge, code_challenge_method, ...noPkce } = baseQuery();
    void code_challenge;
    void code_challenge_method;
    const params = authorizeError(
      await authorizeRaw({ ...noPkce, scope: "openid", state: "t2" }),
    );
    expect(params.get("error")).toBe("invalid_request");
    expect(params.get("error_description")).toContain("PKCE flow requires");
  });

  it("rejects an application scope such as workspace:read", async () => {
    const params = authorizeError(
      await authorizeRaw({
        ...baseQuery(),
        scope: "openid workspace:read",
        state: "t3",
      }),
    );
    expect(params.get("error")).toBe("invalid_request");
    expect(params.get("error_description")).toBe(
      "unsupported scope: workspace:read",
    );
  });

  it("accepts a canonical resource indicator and validates it per RFC 8707", async () => {
    const accepted = await authorizeRaw({
      ...baseQuery(),
      scope: "openid",
      state: "t4",
      resource: "https://console.guidu.test/mcp/workspace",
    });
    expect(new URL(accepted.headers.get("location") ?? "").pathname).toBe(
      "/oauth/consent",
    );

    const relative = authorizeError(
      await authorizeRaw({
        ...baseQuery(),
        scope: "openid",
        state: "t5",
        resource: "nao-uri",
      }),
    );
    expect(relative.get("error_description")).toBe(
      "resource must be an absolute URI",
    );

    const fragment = authorizeError(
      await authorizeRaw({
        ...baseQuery(),
        scope: "openid",
        state: "t6",
        resource: "https://console.guidu.test/mcp#frag",
      }),
    );
    expect(fragment.get("error_description")).toBe(
      "resource must not include a fragment component",
    );
  });

  it("omits the RFC 9207 iss parameter from error redirects", async () => {
    const params = authorizeError(
      await authorizeRaw({
        ...baseQuery(),
        scope: "openid bad:scope",
        state: "t7",
      }),
    );
    expect(params.get("iss")).toBeNull();
  });

  it("rejects the implicit flow", async () => {
    const params = authorizeError(
      await authorizeRaw({
        ...baseQuery(),
        response_type: "token",
        scope: "openid",
        state: "t8",
      }),
    );
    expect(params.get("error_description")).toBe(
      "only response_type=code is supported",
    );
  });

  it("rejects a redirect_uri that was not registered", async () => {
    const response = await authorizeRaw({
      ...baseQuery(),
      redirect_uri: "http://evil.test/cb",
      scope: "openid",
      state: "t9",
    });
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({
      error_code: "validation_failed",
    });
  });

  it("does not resolve an HTTPS client_id metadata document", async () => {
    const response = await authorizeRaw({
      ...baseQuery(),
      client_id: "https://console.guidu.test/mcp/client.json",
      scope: "openid",
      state: "t10",
    });
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({
      error_code: "oauth_client_not_found",
    });
  });
});

describeLive("token endpoint", () => {
  it("supports no client_credentials grant", async () => {
    const response = await fetch(TOKEN, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "client_credentials",
        client_id: spikeClientId,
      }),
    });
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({
      error: "unsupported_grant_type",
    });
  });

  it("ignores a malformed resource parameter instead of rejecting it", async () => {
    const response = await fetch(TOKEN, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        code: "does-not-exist",
        client_id: spikeClientId,
        redirect_uri: REDIRECT_URI,
        code_verifier: "x".repeat(64),
        resource: "nao-uri",
      }),
    });
    // The authorize endpoint answers `resource must be an absolute URI`; the
    // token endpoint never looks at the parameter.
    expect(await response.json()).toMatchObject({ error: "invalid_grant" });
  });
});

describeLive("signing keys", () => {
  it("publishes an asymmetric key, so clients can verify without the secret", async () => {
    const response = await fetch(`${SUPABASE_ISSUER}/.well-known/jwks.json`);
    expect(response.status).toBe(200);
    const jwks = (await response.json()) as {
      keys: readonly { alg?: string }[];
    };
    expect(jwks.keys.length).toBeGreaterThan(0);
    expect(jwks.keys.map((key) => key.alg)).toContain("ES256");
  });
});

describeLive("protected surfaces of the authorization server", () => {
  it("leaves userinfo open to the network but demands a bearer token", async () => {
    const response = await fetch(`${SUPABASE_ISSUER}/oauth/userinfo`);
    expect(response.status).toBe(401);
    expect(await response.json()).toMatchObject({
      error_code: "no_authorization",
    });
  });

  it("gates the consent API behind the project apikey", async () => {
    const response = await fetch(
      `${SUPABASE_ISSUER}/oauth/authorizations/does-not-exist`,
    );
    expect(response.status).toBe(401);
    expect(await response.json()).toMatchObject({
      message: "No API key found in request",
    });
  });
});

describeLive("dynamic client registration (RFC 7591)", () => {
  it("accepted an unauthenticated registration with no project credential", () => {
    // `beforeAll` registered the probe client with no apikey and no bearer.
    expect(spikeClientId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
    );
  });

  it("drops the requested scope and issues no registration access token", async () => {
    const response = await register({
      client_name: PROBE_CLIENT_NAME,
      redirect_uris: [REDIRECT_URI],
      grant_types: ["authorization_code"],
      response_types: ["code"],
      token_endpoint_auth_method: "none",
      scope: "openid workspace:read",
      policy_uri: "https://example.invalid/privacy",
    });
    expect(response.status).toBe(201);
    const client = (await response.json()) as Record<string, unknown>;
    expect(client.client_type).toBe("public");
    // RFC 7591 §3.2.1 asks the server to echo the registered metadata; scope,
    // policy_uri and the RFC 7592 management pair are all absent.
    expect(client.scope).toBeUndefined();
    expect(client.policy_uri).toBeUndefined();
    expect(client.registration_access_token).toBeUndefined();
    expect(client.registration_client_uri).toBeUndefined();
  });

  it("refuses asymmetric client authentication", async () => {
    const response = await register({
      client_name: PROBE_CLIENT_NAME,
      redirect_uris: [REDIRECT_URI],
      grant_types: ["authorization_code"],
      response_types: ["code"],
      token_endpoint_auth_method: "private_key_jwt",
      jwks_uri: "https://example.invalid/jwks",
    });
    expect(response.status).toBe(400);
    expect(JSON.stringify(await response.json())).toContain(
      "token_endpoint_auth_method must be one of",
    );
  });
});
