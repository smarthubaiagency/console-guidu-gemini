import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const {
  getRequestOrigin,
  provisionIdentity,
  recordAuthEvent,
  exchangeCodeForSession,
  verifyOtp,
  getAuthenticatorAssuranceLevel,
  signOut,
} = vi.hoisted(() => ({
  getRequestOrigin: vi.fn(),
  provisionIdentity: vi.fn(),
  recordAuthEvent: vi.fn(),
  exchangeCodeForSession: vi.fn(),
  verifyOtp: vi.fn(),
  getAuthenticatorAssuranceLevel: vi.fn(),
  signOut: vi.fn(),
}));

vi.mock("@/core/partners/resolve", () => ({ getRequestOrigin }));
vi.mock("@/core/auth/identity", () => ({ provisionIdentity }));
vi.mock("@/core/security/auth-events", () => ({ recordAuthEvent }));
vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: async () => ({
    auth: {
      exchangeCodeForSession,
      verifyOtp,
      signOut,
      mfa: { getAuthenticatorAssuranceLevel },
    },
  }),
}));

import { GET } from "./route";

const APP = "https://console.guidu.test";
const PARTNER = "https://painel.agencia.test";

function callback(query: string, host = PARTNER): NextRequest {
  return new NextRequest(`${host}/auth/callback?${query}`);
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("APP_URL", APP);
  exchangeCodeForSession.mockResolvedValue({ error: null });
  verifyOtp.mockResolvedValue({ error: null });
  provisionIdentity.mockResolvedValue({
    decision: { allowed: true, userId: "user-1" },
  });
  getAuthenticatorAssuranceLevel.mockResolvedValue({
    data: { currentLevel: "aal1", nextLevel: "aal1" },
  });
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("/auth/callback (CF5b)", () => {
  it("keeps the browser on the partner host it came back to", async () => {
    getRequestOrigin.mockResolvedValue(PARTNER);
    const response = await GET(callback("code=abc&next=%2Fadmin"));
    expect(exchangeCodeForSession).toHaveBeenCalledWith("abc");
    expect(response.headers.get("location")).toBe(`${PARTNER}/admin`);
    expect(recordAuthEvent).toHaveBeenCalledWith(
      "user-1",
      "auth.sign_in",
      "success",
      "callback",
    );
  });

  it("uses APP_URL for a host that is not a known domain", async () => {
    getRequestOrigin.mockResolvedValue(null);
    const response = await GET(
      callback("token_hash=t&type=magiclink&next=%2Fapp", "https://evil.test"),
    );
    expect(verifyOtp).toHaveBeenCalledWith({
      type: "magiclink",
      token_hash: "t",
    });
    expect(response.headers.get("location")).toBe(`${APP}/app`);
  });

  it("sends a session that needs the second factor through /auth/mfa", async () => {
    getRequestOrigin.mockResolvedValue(APP);
    getAuthenticatorAssuranceLevel.mockResolvedValue({
      data: { currentLevel: "aal1", nextLevel: "aal2" },
    });
    const response = await GET(callback("code=abc&next=%2Fplatform", APP));
    expect(response.headers.get("location")).toBe(
      `${APP}/auth/mfa?next=%2Fplatform`,
    );
  });

  it("goes straight on when the session already has the second factor", async () => {
    getRequestOrigin.mockResolvedValue(APP);
    getAuthenticatorAssuranceLevel.mockResolvedValue({
      data: { currentLevel: "aal2", nextLevel: "aal2" },
    });
    const response = await GET(callback("code=abc&next=%2Fplatform", APP));
    expect(response.headers.get("location")).toBe(`${APP}/platform`);
  });

  it("reports a provider failure on the login page of the same host", async () => {
    getRequestOrigin.mockResolvedValue(PARTNER);
    const response = await GET(callback("error=access_denied"));
    expect(response.headers.get("location")).toBe(
      `${PARTNER}/login?error=callback`,
    );
    expect(exchangeCodeForSession).not.toHaveBeenCalled();
  });

  it("refuses an external next", async () => {
    getRequestOrigin.mockResolvedValue(PARTNER);
    const response = await GET(
      callback("code=abc&next=https%3A%2F%2Fevil.test"),
    );
    expect(response.headers.get("location")).toMatch(
      new RegExp(`^${PARTNER}/`),
    );
    expect(response.headers.get("location")).not.toContain("evil");
  });
});
