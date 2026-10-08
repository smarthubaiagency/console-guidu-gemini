import { NextRequest } from "next/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const { signOut, createSupabaseServerClient } = vi.hoisted(() => ({
  signOut: vi.fn(),
  createSupabaseServerClient: vi.fn(),
}));

vi.mock("@/core/auth/origin", () => ({
  appOrigin: () => "https://console.guidu.co",
}));
vi.mock("@/lib/supabase/server", () => ({ createSupabaseServerClient }));

createSupabaseServerClient.mockResolvedValue({ auth: { signOut } });
signOut.mockResolvedValue({ error: null });

import { POST } from "./route";

function postRequest(origin?: string): NextRequest {
  const headers = new Headers();
  if (origin !== undefined) headers.set("origin", origin);
  return new NextRequest("https://console.guidu.co/auth/signout", {
    method: "POST",
    headers,
  });
}

describe("POST /auth/signout", () => {
  it("rejects a request with no Origin header, instead of treating it as same-origin", async () => {
    const response = await POST(postRequest(undefined));

    expect(response.status).toBe(403);
    expect(signOut).not.toHaveBeenCalled();
  });

  it("rejects a request from a different Origin", async () => {
    const response = await POST(postRequest("https://evil.example"));

    expect(response.status).toBe(403);
    expect(signOut).not.toHaveBeenCalled();
  });

  it("accepts a request from the configured origin", async () => {
    const response = await POST(postRequest("https://console.guidu.co"));

    expect(response.status).toBe(303);
    expect(signOut).toHaveBeenCalled();
  });
});
