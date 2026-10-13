import { NextRequest } from "next/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const { signOut, createSupabaseServerClient, getRequestOrigin } = vi.hoisted(
  () => ({
    signOut: vi.fn(),
    createSupabaseServerClient: vi.fn(),
    getRequestOrigin: vi.fn(),
  }),
);

// Origin of the request host: APP_URL on platform hosts, the partner domain
// on partner hosts, null on unknown hosts.
vi.mock("@/core/partners/resolve", () => ({ getRequestOrigin }));
getRequestOrigin.mockResolvedValue("https://console.guidu.co");
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

  it("accepts a partner domain and keeps the person on it", async () => {
    getRequestOrigin.mockResolvedValueOnce("https://painel.agencia.com.br");
    const response = await POST(postRequest("https://painel.agencia.com.br"));

    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe(
      "https://painel.agencia.com.br/login?notice=signed-out",
    );
  });

  it("rejects an unknown host even when Origin matches it", async () => {
    signOut.mockClear();
    getRequestOrigin.mockResolvedValueOnce(null);
    const response = await POST(postRequest("https://desconhecido.example"));

    expect(response.status).toBe(403);
    expect(signOut).not.toHaveBeenCalled();
  });
});
