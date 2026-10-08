import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const {
  requireUser,
  mfaChallenge,
  mfaVerify,
  createSupabaseServerClient,
  redirect,
} = vi.hoisted(() => ({
  requireUser: vi.fn(),
  mfaChallenge: vi.fn(),
  mfaVerify: vi.fn(),
  createSupabaseServerClient: vi.fn(),
  redirect: vi.fn((to: string) => {
    throw new Error(`NEXT_REDIRECT:${to}`);
  }),
}));

vi.mock("@/core/auth/identity", () => ({ requireUser }));
vi.mock("@/lib/supabase/server", () => ({ createSupabaseServerClient }));
vi.mock("next/navigation", () => ({ redirect }));

createSupabaseServerClient.mockResolvedValue({
  auth: { mfa: { challenge: mfaChallenge, verify: mfaVerify } },
});

import { AccessDeniedError } from "@/core/auth/errors";

import { verifyMfaChallenge } from "./actions";

function formData(fields: Record<string, string>): FormData {
  const data = new FormData();
  for (const [key, value] of Object.entries(fields)) data.set(key, value);
  return data;
}

describe("verifyMfaChallenge", () => {
  it("denies a blocked identity before calling the Auth server, even with a well-formed code", async () => {
    requireUser.mockRejectedValueOnce(
      new AccessDeniedError("identity_blocked", 403),
    );

    await expect(
      verifyMfaChallenge({}, formData({ factorId: "factor-1", code: "123456" })),
    ).rejects.toThrow("NEXT_REDIRECT:/auth/suspended");

    expect(redirect).toHaveBeenCalledWith("/auth/suspended");
    expect(mfaChallenge).not.toHaveBeenCalled();
    expect(mfaVerify).not.toHaveBeenCalled();
  });

  it("denies an unauthenticated caller before calling the Auth server", async () => {
    requireUser.mockRejectedValueOnce(
      new AccessDeniedError("unauthenticated", 401),
    );

    await expect(
      verifyMfaChallenge({}, formData({ factorId: "factor-1", code: "123456" })),
    ).rejects.toThrow("NEXT_REDIRECT:/login");

    expect(redirect).toHaveBeenCalledWith("/login");
    expect(mfaChallenge).not.toHaveBeenCalled();
  });

  it("proceeds to the Auth server for an active identity", async () => {
    requireUser.mockResolvedValueOnce({
      userId: "user-1",
      email: "a@example.test",
      mfaSatisfied: false,
      profile: { status: "active" },
    });
    mfaChallenge.mockResolvedValueOnce({
      data: { id: "challenge-1" },
      error: null,
    });
    mfaVerify.mockResolvedValueOnce({ error: null });

    await expect(
      verifyMfaChallenge(
        {},
        formData({ factorId: "factor-1", code: "123456", next: "/app" }),
      ),
    ).rejects.toThrow("NEXT_REDIRECT:/app");

    expect(mfaChallenge).toHaveBeenCalledWith({ factorId: "factor-1" });
    expect(mfaVerify).toHaveBeenCalledWith({
      factorId: "factor-1",
      challengeId: "challenge-1",
      code: "123456",
    });
    expect(redirect).toHaveBeenCalledWith("/app");
  });
});
