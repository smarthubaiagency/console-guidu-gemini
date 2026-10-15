import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const {
  requestLoginMethods,
  getRequestOrigin,
  signInWithOAuth,
  signInWithOtp,
  createSupabaseServerClient,
  redirect,
} = vi.hoisted(() => ({
  requestLoginMethods: vi.fn(),
  getRequestOrigin: vi.fn(),
  signInWithOAuth: vi.fn(),
  signInWithOtp: vi.fn(),
  createSupabaseServerClient: vi.fn(),
  redirect: vi.fn((to: string) => {
    throw new Error(`NEXT_REDIRECT:${to}`);
  }),
}));

vi.mock("@/core/auth/login-methods", () => ({ requestLoginMethods }));
vi.mock("@/core/partners/resolve", () => ({ getRequestOrigin }));
vi.mock("@/core/auth/identity", () => ({ provisionIdentity: vi.fn() }));
vi.mock("@/core/security/auth-events", () => ({ recordAuthEvent: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createSupabaseServerClient }));
vi.mock("next/navigation", () => ({ redirect }));
vi.mock("next-intl/server", () => ({
  getTranslations: async () => {
    const t = (key: string) => key;
    t.has = () => false;
    return t;
  },
}));

import { requestMagicLink, signInWithGoogle } from "./actions";

function formData(fields: Record<string, string>): FormData {
  const data = new FormData();
  for (const [key, value] of Object.entries(fields)) data.set(key, value);
  return data;
}

beforeEach(() => {
  vi.clearAllMocks();
  createSupabaseServerClient.mockResolvedValue({
    auth: { signInWithOAuth, signInWithOtp },
  });
  getRequestOrigin.mockResolvedValue("https://painel.agencia.test");
});

describe("signInWithGoogle (CF5b)", () => {
  it("refuses when the host does not offer Google, without calling Auth", async () => {
    requestLoginMethods.mockResolvedValue({ google: false, magicLink: true });
    const state = await signInWithGoogle({}, formData({ next: "/app" }));
    expect(state.code).toBe("forbidden");
    expect(createSupabaseServerClient).not.toHaveBeenCalled();
    expect(signInWithOAuth).not.toHaveBeenCalled();
  });

  it("sends the browser to the provider with the host's callback", async () => {
    requestLoginMethods.mockResolvedValue({ google: true, magicLink: false });
    signInWithOAuth.mockResolvedValue({
      data: { url: "https://auth.test/authorize?provider=google" },
      error: null,
    });
    await expect(
      signInWithGoogle({}, formData({ next: "/admin" })),
    ).rejects.toThrow(
      "NEXT_REDIRECT:https://auth.test/authorize?provider=google",
    );
    expect(signInWithOAuth).toHaveBeenCalledWith({
      provider: "google",
      options: {
        redirectTo: "https://painel.agencia.test/auth/callback?next=%2Fadmin",
        skipBrowserRedirect: true,
      },
    });
  });

  it("never carries an external next", async () => {
    requestLoginMethods.mockResolvedValue({ google: true, magicLink: false });
    signInWithOAuth.mockResolvedValue({
      data: { url: "https://a" },
      error: null,
    });
    await expect(
      signInWithGoogle({}, formData({ next: "https://evil.test" })),
    ).rejects.toThrow("NEXT_REDIRECT");
    const options = signInWithOAuth.mock.calls[0]?.[0].options;
    expect(options.redirectTo).not.toContain("evil");
  });

  it("answers unavailable when Auth fails", async () => {
    requestLoginMethods.mockResolvedValue({ google: true, magicLink: false });
    signInWithOAuth.mockResolvedValue({
      data: { url: null },
      error: new Error("provider is not enabled"),
    });
    const state = await signInWithGoogle({}, formData({}));
    expect(state.code).toBe("unavailable");
    expect(redirect).not.toHaveBeenCalled();
  });
});

describe("requestMagicLink (CF5b)", () => {
  it("refuses when the host does not offer it, without calling Auth", async () => {
    requestLoginMethods.mockResolvedValue({ google: true, magicLink: false });
    const state = await requestMagicLink(
      {},
      formData({ email: "a@example.test" }),
    );
    expect(state.code).toBe("forbidden");
    expect(signInWithOtp).not.toHaveBeenCalled();
  });

  it("never creates an account and answers the same for any address", async () => {
    requestLoginMethods.mockResolvedValue({ google: false, magicLink: true });
    signInWithOtp.mockResolvedValueOnce({ data: {}, error: null });
    signInWithOtp.mockResolvedValueOnce({
      data: {},
      error: new Error("Signups not allowed for otp"),
    });

    const known = await requestMagicLink(
      {},
      formData({ email: "a@example.test", next: "/app/acme" }),
    );
    const unknown = await requestMagicLink(
      {},
      formData({ email: "nobody@example.test" }),
    );
    expect(known.message).toBe("messages.magicLinkSent");
    expect(unknown.message).toBe(known.message);
    expect(known.error).toBeUndefined();
    expect(unknown.error).toBeUndefined();
    expect(signInWithOtp).toHaveBeenNthCalledWith(1, {
      email: "a@example.test",
      options: {
        shouldCreateUser: false,
        emailRedirectTo:
          "https://painel.agencia.test/auth/callback?next=%2Fapp%2Facme",
      },
    });
  });

  it("asks for a valid address", async () => {
    requestLoginMethods.mockResolvedValue({ google: false, magicLink: true });
    const state = await requestMagicLink({}, formData({ email: "nope" }));
    expect(state.code).toBe("invalid_input");
    expect(signInWithOtp).not.toHaveBeenCalled();
  });
});
