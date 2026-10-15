import { randomBytes } from "node:crypto";

import { AppError } from "@/shared/errors";

import {
  GOOGLE_IDENTITY_SCOPES,
  GOOGLE_SCOPE_URLS,
  type GoogleScope,
} from "./scopes";

/**
 * Google OAuth for the workspace's account (CF6b): the authorization URL,
 * the exchange of the code (with PKCE) and the revocation, straight on
 * Google's endpoints with `fetch`, no SDK. The account's e-mail comes from
 * the `id_token` the token endpoint returns (`openid email`), read without
 * a signature check because it comes straight from Google over TLS.
 *
 * Tests and e2e use the fake (`GOOGLE_OAUTH_PROVIDER=fake`): consent is a
 * route of our own that answers at once and the exchange never leaves the
 * process. Production refuses to start with the fake (`src/core/config/env.ts`).
 */

export type GoogleTokens = Readonly<{
  accessToken: string;
  refreshToken: string | null;
  expiresAt: Date | null;
  /** Scopes granted, space separated, as Google answers them. */
  grantedScope: string;
  email: string;
  subject: string | null;
}>;

export type GoogleAuthorizeInput = Readonly<{
  clientId: string;
  redirectUri: string;
  scopes: readonly GoogleScope[];
  state: string;
  codeChallenge: string;
}>;

export type GoogleExchangeInput = Readonly<{
  code: string;
  codeVerifier: string;
  clientId: string;
  clientSecret: string;
  redirectUri: string;
}>;

export type GoogleOAuthProvider = Readonly<{
  kind: "google" | "fake";
  authorizeUrl(input: GoogleAuthorizeInput): string;
  exchangeCode(input: GoogleExchangeInput): Promise<GoogleTokens>;
  revoke(token: string): Promise<void>;
}>;

const AUTHORIZE_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const REVOKE_URL = "https://oauth2.googleapis.com/revoke";
const TIMEOUT_MS = 10_000;

/** Path of the callback; the redirect URI is APP_URL plus this path. */
export const GOOGLE_CALLBACK_PATH = "/api/integrations/google/callback";
/** Consent of the fake provider (tests and e2e only). */
export const GOOGLE_FAKE_CONSENT_PATH = "/api/integrations/google/fake-consent";

/** The redirect URI registered in the Google app, from APP_URL. */
export function googleRedirectUri(
  env: Readonly<Record<string, string | undefined>> = process.env,
): string | null {
  const raw = env.APP_URL?.trim();
  if (!raw) return null;
  try {
    return `${new URL(raw).origin}${GOOGLE_CALLBACK_PATH}`;
  } catch {
    return null;
  }
}

export function scopeParameter(scopes: readonly GoogleScope[]): string {
  return [
    ...GOOGLE_IDENTITY_SCOPES,
    ...scopes.map((scope) => GOOGLE_SCOPE_URLS[scope]),
  ].join(" ");
}

function authorizeParams(input: GoogleAuthorizeInput): URLSearchParams {
  return new URLSearchParams({
    client_id: input.clientId,
    redirect_uri: input.redirectUri,
    response_type: "code",
    scope: scopeParameter(input.scopes),
    state: input.state,
    code_challenge: input.codeChallenge,
    code_challenge_method: "S256",
    access_type: "offline",
    prompt: "consent",
    include_granted_scopes: "true",
  });
}

export class GoogleOAuthError extends AppError {
  constructor(reason: string) {
    super({
      code: "invalid_input",
      safeMessage: "O Google não concluiu a conexão. Tente de novo.",
      messageKey: "integrations.google.errors.exchange",
    });
    this.name = "GoogleOAuthError";
    this.reason = reason;
  }
  readonly reason: string;
}

/** Claims of the id_token's payload (no signature check, see above). */
export function idTokenClaims(idToken: string | undefined): {
  email: string | null;
  subject: string | null;
} {
  const payload = idToken?.split(".")[1];
  if (!payload) return { email: null, subject: null };
  try {
    const claims = JSON.parse(
      Buffer.from(payload, "base64url").toString("utf8"),
    ) as { email?: unknown; sub?: unknown };
    return {
      email: typeof claims.email === "string" ? claims.email : null,
      subject: typeof claims.sub === "string" ? claims.sub : null,
    };
  } catch {
    return { email: null, subject: null };
  }
}

type TokenResponse = {
  access_token?: unknown;
  refresh_token?: unknown;
  expires_in?: unknown;
  scope?: unknown;
  id_token?: unknown;
};

export function tokensFromResponse(
  body: TokenResponse,
  now: Date = new Date(),
): GoogleTokens {
  if (typeof body.access_token !== "string" || !body.access_token) {
    throw new GoogleOAuthError("no_access_token");
  }
  const claims = idTokenClaims(
    typeof body.id_token === "string" ? body.id_token : undefined,
  );
  if (!claims.email) throw new GoogleOAuthError("no_email");
  const expiresIn =
    typeof body.expires_in === "number" && body.expires_in > 0
      ? body.expires_in
      : null;
  return {
    accessToken: body.access_token,
    refreshToken:
      typeof body.refresh_token === "string" && body.refresh_token
        ? body.refresh_token
        : null,
    expiresAt: expiresIn ? new Date(now.getTime() + expiresIn * 1000) : null,
    grantedScope: typeof body.scope === "string" ? body.scope : "",
    email: claims.email,
    subject: claims.subject,
  };
}

export function createGoogleProvider(
  fetcher: typeof fetch = fetch,
): GoogleOAuthProvider {
  return {
    kind: "google",
    authorizeUrl: (input) =>
      `${AUTHORIZE_URL}?${authorizeParams(input).toString()}`,
    async exchangeCode(input) {
      let response: Response;
      try {
        response = await fetcher(TOKEN_URL, {
          method: "POST",
          headers: { "content-type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams({
            code: input.code,
            client_id: input.clientId,
            client_secret: input.clientSecret,
            redirect_uri: input.redirectUri,
            grant_type: "authorization_code",
            code_verifier: input.codeVerifier,
          }).toString(),
          redirect: "error",
          signal: AbortSignal.timeout(TIMEOUT_MS),
        });
      } catch {
        throw new GoogleOAuthError("network");
      }
      if (!response.ok) throw new GoogleOAuthError(`http_${response.status}`);
      return tokensFromResponse((await response.json()) as TokenResponse);
    },
    async revoke(token) {
      try {
        await fetcher(REVOKE_URL, {
          method: "POST",
          headers: { "content-type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams({ token }).toString(),
          redirect: "error",
          signal: AbortSignal.timeout(TIMEOUT_MS),
        });
      } catch {
        // Best effort: the connection is gone on our side either way.
      }
    },
  };
}

function fakeIdToken(email: string, subject: string): string {
  const part = (value: object) =>
    Buffer.from(JSON.stringify(value)).toString("base64url");
  return `${part({ alg: "none", typ: "JWT" })}.${part({ email, sub: subject })}.`;
}

/** E-mail of the fake account (tests and e2e). */
export const FAKE_GOOGLE_EMAIL = "conta.google@example.com";

/**
 * The fake's code carries the scopes the fake consent granted:
 * `fake.<base64url of the scope parameter>`.
 */
export function fakeCode(scope: string): string {
  return `fake.${Buffer.from(scope).toString("base64url")}`;
}

export function createFakeGoogleProvider(appUrl: string): GoogleOAuthProvider {
  return {
    kind: "fake",
    authorizeUrl: (input) =>
      `${new URL(appUrl).origin}${GOOGLE_FAKE_CONSENT_PATH}?${authorizeParams(input).toString()}`,
    async exchangeCode(input) {
      if (!input.code.startsWith("fake.") || !input.codeVerifier) {
        throw new GoogleOAuthError("fake_code");
      }
      const scope = Buffer.from(input.code.slice(5), "base64url").toString(
        "utf8",
      );
      return tokensFromResponse({
        access_token: `fake-access-${randomBytes(8).toString("hex")}`,
        refresh_token: `fake-refresh-${randomBytes(8).toString("hex")}`,
        expires_in: 3600,
        scope,
        id_token: fakeIdToken(FAKE_GOOGLE_EMAIL, "fake-google-account"),
      });
    },
    async revoke() {
      // Nothing leaves the process.
    },
  };
}

export function isFakeGoogleProvider(
  env: Readonly<Record<string, string | undefined>> = process.env,
): boolean {
  return env.GOOGLE_OAUTH_PROVIDER?.trim() === "fake";
}

/** The provider of the environment (the fake in tests and e2e). */
export function googleProvider(
  env: Readonly<Record<string, string | undefined>> = process.env,
): GoogleOAuthProvider {
  if (isFakeGoogleProvider(env)) {
    return createFakeGoogleProvider(env.APP_URL?.trim() || "http://localhost");
  }
  return createGoogleProvider();
}
