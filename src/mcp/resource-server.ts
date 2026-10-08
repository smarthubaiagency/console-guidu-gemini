/**
 * MCP resource server for the SMA-93 spike: two surfaces (`/mcp/workspace` and
 * `/mcp/admin`) protected by tokens from the Supabase OAuth 2.1 Server.
 *
 * It exists to answer one question with running code: can an MCP server meet
 * MCP 2026-07-28 §"Token Handling" ("MCP servers MUST validate that access
 * tokens were issued specifically for them as the intended audience, according
 * to RFC 8707 Section 2") using Supabase-issued tokens?
 *
 * `AudienceBinding` makes the answer executable:
 *  - `rfc8707` is the behaviour the spec asks for and the one Supabase cannot
 *    satisfy today, because its access tokens carry `aud: "authenticated"`;
 *  - `grant-table` is the compensating control this spike recommends: the
 *    resource server derives the surface and the application scopes from its
 *    own `mcp_grants` row, keyed by the token's `sub` and `client_id` claims.
 */

import {
  type AccessTokenClaims,
  type JsonWebKeySet,
  JwtError,
  verifyEs256,
} from "./jwt.js";

/** Canonical URI of one MCP surface (RFC 8707 §2: absolute URI, no fragment). */
export type ResourceUri = string;

export type AudienceBinding = "rfc8707" | "grant-table";

/**
 * The application-owned grant. Supabase stores consent in
 * `auth.oauth_consents` but only for OIDC scopes and without a resource, so it
 * cannot be the authority for either surface or application scope.
 */
export type McpGrant = Readonly<{
  userId: string;
  clientId: string;
  resource: ResourceUri;
  scopes: readonly string[];
  revokedAt: Date | null;
}>;

export type GrantStore = Readonly<{
  find: (
    userId: string,
    clientId: string,
    resource: ResourceUri,
  ) => McpGrant | undefined;
}>;

export type SurfaceConfig = Readonly<{
  resource: ResourceUri;
  /** Advertised in protected resource metadata and in the 401 challenge. */
  scopesSupported: readonly string[];
  requiredScopes: readonly string[];
}>;

export type ResourceServerConfig = Readonly<{
  /** Supabase AS issuer, e.g. `https://<ref>.supabase.co/auth/v1`. */
  issuer: string;
  jwks: JsonWebKeySet;
  audienceBinding: AudienceBinding;
  surfaces: readonly SurfaceConfig[];
  grants: GrantStore;
  now?: () => Date;
}>;

export type AuthorizedRequest = Readonly<{
  claims: AccessTokenClaims;
  grant: McpGrant | null;
  surface: SurfaceConfig;
}>;

export type AuthorizationFailure = Readonly<{
  status: 401 | 403 | 404;
  /** Verbatim `WWW-Authenticate` value, absent for 404. */
  wwwAuthenticate?: string;
  error?: "invalid_token" | "insufficient_scope";
  reason: string;
}>;

export type AuthorizationResult =
  | Readonly<{ ok: true; request: AuthorizedRequest }>
  | Readonly<{ ok: false; failure: AuthorizationFailure }>;

/** RFC 9728 document the MCP client fetches to discover the AS. */
export function protectedResourceMetadata(
  config: ResourceServerConfig,
  resource: ResourceUri,
): Record<string, unknown> {
  const surface = config.surfaces.find((item) => item.resource === resource);
  if (surface === undefined) throw new Error(`unknown surface: ${resource}`);
  return {
    resource: surface.resource,
    authorization_servers: [config.issuer],
    scopes_supported: [...surface.scopesSupported],
    bearer_methods_supported: ["header"],
  };
}

export function metadataUrl(resource: ResourceUri): string {
  const url = new URL(resource);
  const path = url.pathname === "/" ? "" : url.pathname;
  return `${url.origin}/.well-known/oauth-protected-resource${path}`;
}

function challenge(
  resource: ResourceUri,
  parts: Readonly<{ error?: string; scope?: readonly string[]; description?: string }>,
): string {
  const fields = [`resource_metadata="${metadataUrl(resource)}"`];
  if (parts.error !== undefined) fields.unshift(`error="${parts.error}"`);
  if (parts.scope !== undefined && parts.scope.length > 0) {
    fields.push(`scope="${parts.scope.join(" ")}"`);
  }
  if (parts.description !== undefined) {
    fields.push(`error_description="${parts.description}"`);
  }
  return `Bearer ${fields.join(", ")}`;
}

function audienceValues(claims: AccessTokenClaims): readonly string[] {
  const { aud } = claims;
  if (aud === undefined) return [];
  return typeof aud === "string" ? [aud] : [...aud];
}

/**
 * Applies the MCP 2026-07-28 token rules to one request.
 * `bearer` is the raw `Authorization` header value, or `undefined` when absent.
 */
export async function authorize(
  config: ResourceServerConfig,
  resource: ResourceUri,
  bearer: string | undefined,
): Promise<AuthorizationResult> {
  const surface = config.surfaces.find((item) => item.resource === resource);
  if (surface === undefined) {
    return { ok: false, failure: { status: 404, reason: "unknown surface" } };
  }

  const token = bearer?.replace(/^Bearer /i, "").trim();
  if (token === undefined || token === "") {
    return {
      ok: false,
      failure: {
        status: 401,
        wwwAuthenticate: challenge(resource, { scope: surface.requiredScopes }),
        reason: "no bearer token",
      },
    };
  }

  let claims: AccessTokenClaims;
  try {
    claims = await verifyEs256(token, config.jwks, config.now?.() ?? new Date());
  } catch (error) {
    if (!(error instanceof JwtError)) throw error;
    return {
      ok: false,
      failure: {
        status: 401,
        error: "invalid_token",
        wwwAuthenticate: challenge(resource, {
          error: "invalid_token",
          description: error.message,
        }),
        reason: error.message,
      },
    };
  }

  if (claims.iss !== config.issuer) {
    return {
      ok: false,
      failure: {
        status: 401,
        error: "invalid_token",
        wwwAuthenticate: challenge(resource, { error: "invalid_token" }),
        reason: `issuer mismatch: ${String(claims.iss)}`,
      },
    };
  }

  if (claims.sub === undefined || claims.client_id === undefined) {
    return {
      ok: false,
      failure: {
        status: 401,
        error: "invalid_token",
        wwwAuthenticate: challenge(resource, { error: "invalid_token" }),
        reason: "token has no sub or no client_id claim",
      },
    };
  }

  if (config.audienceBinding === "rfc8707") {
    // The branch Supabase fails today: `aud` is `authenticated` and there is no
    // `resource` claim, so nothing ties the token to this surface.
    const bound =
      audienceValues(claims).includes(resource) || claims.resource === resource;
    if (!bound) {
      return {
        ok: false,
        failure: {
          status: 401,
          error: "invalid_token",
          wwwAuthenticate: challenge(resource, { error: "invalid_token" }),
          reason: `token audience ${JSON.stringify(
            audienceValues(claims),
          )} is not ${resource}`,
        },
      };
    }
    return { ok: true, request: { claims, grant: null, surface } };
  }

  const grant = config.grants.find(claims.sub, claims.client_id, resource);
  if (grant === undefined) {
    return {
      ok: false,
      failure: {
        status: 401,
        error: "invalid_token",
        wwwAuthenticate: challenge(resource, { error: "invalid_token" }),
        reason: "no mcp_grants row for this user, client and surface",
      },
    };
  }

  // Supabase access tokens are stateless JWTs valid until `exp`, so consent
  // revocation only takes effect if the resource server rechecks every request.
  if (grant.revokedAt !== null) {
    return {
      ok: false,
      failure: {
        status: 401,
        error: "invalid_token",
        wwwAuthenticate: challenge(resource, { error: "invalid_token" }),
        reason: "grant revoked",
      },
    };
  }

  const missing = surface.requiredScopes.filter(
    (scope) => !grant.scopes.includes(scope),
  );
  if (missing.length > 0) {
    return {
      ok: false,
      failure: {
        status: 403,
        error: "insufficient_scope",
        wwwAuthenticate: challenge(resource, {
          error: "insufficient_scope",
          scope: missing,
        }),
        reason: `missing scopes: ${missing.join(" ")}`,
      },
    };
  }

  return { ok: true, request: { claims, grant, surface } };
}

export type WorkspaceRecord = Readonly<{
  id: string;
  name: string;
  surface: ResourceUri;
  grantedScopes: readonly string[];
}>;

/** The fictional `get_workspace` tool the issue asks for. */
export function getWorkspaceTool(request: AuthorizedRequest): WorkspaceRecord {
  return {
    id: `ws-${request.claims.sub ?? "unknown"}`,
    name: "Workspace de demonstração SMA-93",
    surface: request.surface.resource,
    grantedScopes: request.grant?.scopes ?? [],
  };
}

export const GET_WORKSPACE_TOOL_DEFINITION = {
  name: "get_workspace",
  description: "Returns the workspace the caller's grant points at.",
  inputSchema: { type: "object", properties: {}, additionalProperties: false },
} as const;
