import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const {
  readSessionClaims,
  readProfile,
  updateUser,
  signOut,
  createSupabaseServerClient,
  redirect,
} = vi.hoisted(() => ({
  readSessionClaims: vi.fn(),
  readProfile: vi.fn(),
  updateUser: vi.fn(),
  signOut: vi.fn(),
  createSupabaseServerClient: vi.fn(),
  redirect: vi.fn((to: string) => {
    throw new Error(`NEXT_REDIRECT:${to}`);
  }),
}));

vi.mock("@/core/auth/identity", () => ({ readSessionClaims }));
vi.mock("@/core/auth/profiles", () => ({ readProfile }));
vi.mock("@/lib/supabase/server", () => ({ createSupabaseServerClient }));
vi.mock("next/navigation", () => ({ redirect }));

createSupabaseServerClient.mockResolvedValue({
  auth: { updateUser, signOut },
});

import { completePasswordReset } from "./actions";

function formData(fields: Record<string, string>): FormData {
  const data = new FormData();
  for (const [key, value] of Object.entries(fields)) data.set(key, value);
  return data;
}

const validInput = formData({
  password: "a-strong-password",
  confirmation: "a-strong-password",
});

describe("completePasswordReset", () => {
  it("denies a blocked identity even with a valid recovery session, before touching Auth", async () => {
    readSessionClaims.mockResolvedValueOnce({ sub: "user-1" });
    readProfile.mockResolvedValueOnce({
      id: "user-1",
      fullName: null,
      status: "blocked",
      statusReason: null,
      lastSignInAt: null,
    });

    await expect(completePasswordReset({}, validInput)).rejects.toThrow(
      "NEXT_REDIRECT:/auth/suspended",
    );

    expect(redirect).toHaveBeenCalledWith("/auth/suspended");
    expect(updateUser).not.toHaveBeenCalled();
  });

  it("denies a suspended identity before touching Auth", async () => {
    readSessionClaims.mockResolvedValueOnce({ sub: "user-1" });
    readProfile.mockResolvedValueOnce({
      id: "user-1",
      fullName: null,
      status: "suspended",
      statusReason: null,
      lastSignInAt: null,
    });

    await expect(completePasswordReset({}, validInput)).rejects.toThrow(
      "NEXT_REDIRECT:/auth/suspended",
    );

    expect(redirect).toHaveBeenCalledWith("/auth/suspended");
    expect(updateUser).not.toHaveBeenCalled();
  });

  it("denies when the profile row is missing", async () => {
    readSessionClaims.mockResolvedValueOnce({ sub: "user-1" });
    readProfile.mockResolvedValueOnce(null);

    await expect(completePasswordReset({}, validInput)).rejects.toThrow(
      "NEXT_REDIRECT:/auth/suspended",
    );

    expect(redirect).toHaveBeenCalledWith("/auth/suspended");
    expect(updateUser).not.toHaveBeenCalled();
  });

  it("updates the password for an active identity", async () => {
    readSessionClaims.mockResolvedValueOnce({ sub: "user-1" });
    readProfile.mockResolvedValueOnce({
      id: "user-1",
      fullName: null,
      status: "active",
      statusReason: null,
      lastSignInAt: null,
    });
    updateUser.mockResolvedValueOnce({ error: null });
    signOut.mockResolvedValueOnce({ error: null });

    await expect(completePasswordReset({}, validInput)).rejects.toThrow(
      "NEXT_REDIRECT:/login?notice=password-updated",
    );

    expect(updateUser).toHaveBeenCalledWith({ password: "a-strong-password" });
    expect(signOut).toHaveBeenCalled();
    expect(redirect).toHaveBeenCalledWith("/login?notice=password-updated");
  });
});
