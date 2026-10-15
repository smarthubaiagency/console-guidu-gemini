import { describe, expect, it, vi } from "vitest";

import {
  createFakeGoogleProvider,
  createGoogleProvider,
  fakeCode,
  googleRedirectUri,
  idTokenClaims,
  scopeParameter,
  tokensFromResponse,
} from "./provider";
import { narrowGoogleScopes, scopesFromGrant } from "./scopes";
import {
  createPkce,
  openFlowCookie,
  sealFlowCookie,
  signGoogleState,
  verifyGoogleState,
} from "./state";

const STATE = {
  workspaceId: "a0000000-0000-4000-8000-000000000011",
  organizationId: "a0000000-0000-4000-8000-000000000010",
  userId: "a0000000-0000-4000-8000-000000000031",
  workspaceSlug: "workspace-a",
  returnOrigin: "https://painel.parceiro.test",
  appId: "b0000000-0000-4000-8000-000000000001",
  nonce: "nonce-1",
  expiresAt: Date.now() + 60_000,
};

describe("Google connection (CF6b)", () => {
  it("signs the state and refuses a tampered or expired one", () => {
    const signed = signGoogleState(STATE);
    expect(verifyGoogleState(signed)).toEqual(STATE);
    const [payload, signature] = signed.split(".");
    const forged = Buffer.from(
      JSON.stringify({
        ...JSON.parse(Buffer.from(payload!, "base64url").toString()),
        r: "https://evil.test",
      }),
    ).toString("base64url");
    expect(verifyGoogleState(`${forged}.${signature}`)).toBeNull();
    expect(verifyGoogleState(signed, STATE.expiresAt + 1)).toBeNull();
    expect(verifyGoogleState("garbage")).toBeNull();
    expect(verifyGoogleState(null)).toBeNull();
  });

  it("keeps the PKCE verifier in an encrypted cookie", () => {
    const pkce = createPkce();
    expect(pkce.verifier.length).toBeGreaterThanOrEqual(43);
    expect(pkce.challenge).not.toBe(pkce.verifier);
    const sealed = sealFlowCookie("nonce-1", pkce.verifier);
    expect(sealed).not.toContain(pkce.verifier);
    expect(openFlowCookie(sealed)).toEqual({
      nonce: "nonce-1",
      verifier: pkce.verifier,
    });
    expect(openFlowCookie(`${sealed}x`)).toBeNull();
  });

  it("derives the redirect URI from APP_URL", () => {
    expect(googleRedirectUri({ APP_URL: "https://app.guidu.test/" })).toBe(
      "https://app.guidu.test/api/integrations/google/callback",
    );
    expect(googleRedirectUri({})).toBeNull();
  });

  it("asks the identity and the offered scopes, with PKCE and offline access", () => {
    const url = new URL(
      createGoogleProvider().authorizeUrl({
        clientId: "client.apps.googleusercontent.com",
        redirectUri: "https://app.guidu.test/api/integrations/google/callback",
        scopes: ["spreadsheets"],
        state: "s",
        codeChallenge: "c",
      }),
    );
    expect(url.origin).toBe("https://accounts.google.com");
    expect(url.searchParams.get("scope")).toBe(
      "openid email https://www.googleapis.com/auth/spreadsheets",
    );
    expect(url.searchParams.get("code_challenge_method")).toBe("S256");
    expect(url.searchParams.get("access_type")).toBe("offline");
  });

  it("exchanges the code with the verifier and reads the e-mail of the id_token", async () => {
    const idToken = `x.${Buffer.from(JSON.stringify({ email: "dono@loja.test", sub: "123" })).toString("base64url")}.y`;
    const fetcher = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          access_token: "at",
          refresh_token: "rt",
          expires_in: 3600,
          scope: "openid https://www.googleapis.com/auth/calendar.events",
          id_token: idToken,
        }),
        { status: 200 },
      ),
    );
    const tokens = await createGoogleProvider(fetcher).exchangeCode({
      code: "code",
      codeVerifier: "verifier",
      clientId: "id",
      clientSecret: "secret",
      redirectUri: "https://app.guidu.test/cb",
    });
    expect(tokens.email).toBe("dono@loja.test");
    expect(tokens.refreshToken).toBe("rt");
    expect(scopesFromGrant(tokens.grantedScope)).toEqual(["calendar.events"]);
    const body = new URLSearchParams(fetcher.mock.calls[0]![1].body as string);
    expect(body.get("code_verifier")).toBe("verifier");
    expect(body.get("grant_type")).toBe("authorization_code");
  });

  it("fails without an e-mail or on an HTTP error", async () => {
    expect(() => tokensFromResponse({ access_token: "at" })).toThrow();
    const fetcher = vi
      .fn()
      .mockResolvedValue(new Response("{}", { status: 400 }));
    await expect(
      createGoogleProvider(fetcher).exchangeCode({
        code: "c",
        codeVerifier: "v",
        clientId: "i",
        clientSecret: "s",
        redirectUri: "r",
      }),
    ).rejects.toThrow();
    expect(idTokenClaims("not-a-token")).toEqual({
      email: null,
      subject: null,
    });
  });

  it("fakes the consent and the exchange without leaving the process", async () => {
    const fake = createFakeGoogleProvider("http://localhost:3100");
    expect(
      fake.authorizeUrl({
        clientId: "c",
        redirectUri: "r",
        scopes: ["drive.file"],
        state: "s",
        codeChallenge: "x",
      }),
    ).toMatch(
      /^http:\/\/localhost:3100\/api\/integrations\/google\/fake-consent\?/,
    );
    const tokens = await fake.exchangeCode({
      code: fakeCode(scopeParameter(["drive.file", "spreadsheets"])),
      codeVerifier: "v",
      clientId: "c",
      clientSecret: "s",
      redirectUri: "r",
    });
    expect(scopesFromGrant(tokens.grantedScope)).toEqual([
      "drive.file",
      "spreadsheets",
    ]);
    expect(tokens.email).toBe("conta.google@example.com");
  });

  it("lets the partner only narrow the platform's scopes", () => {
    expect(
      narrowGoogleScopes(
        ["drive.file", "spreadsheets"],
        ["spreadsheets", "calendar.events"],
      ),
    ).toEqual(["spreadsheets"]);
  });
});
