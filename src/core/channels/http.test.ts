import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  ChannelHttpError,
  isPrivateAddress,
  providerJson,
  providerOrigin,
  readLimited,
} from "./http";

/**
 * The guard of the calls to a provider (A5a): https only, no internal
 * networks, no redirects, a bounded answer and errors without the body.
 */

afterEach(() => vi.unstubAllEnvs());

async function failure(promise: Promise<unknown>) {
  const error = await promise.then(
    () => null,
    (caught: unknown) => caught,
  );
  expect(error).toBeInstanceOf(ChannelHttpError);
  return error as ChannelHttpError;
}

describe("isPrivateAddress", () => {
  it.each([
    "10.1.2.3",
    "127.0.0.1",
    "169.254.169.254",
    "172.20.0.1",
    "192.168.0.10",
    "100.64.0.1",
    "0.0.0.0",
    "::1",
    "fd00::1",
    "fe80::1",
    "::ffff:10.0.0.1",
  ])("refuses %s", (address) => {
    expect(isPrivateAddress(address)).toBe(true);
  });

  it.each(["8.8.8.8", "203.0.113.10", "172.32.0.1", "2001:4860::8888"])(
    "accepts %s",
    (address) => {
      expect(isPrivateAddress(address)).toBe(false);
    },
  );
});

describe("providerOrigin", () => {
  it("keeps only the https origin", () => {
    expect(providerOrigin(" https://chat.example.com/app/accounts/1 ")).toBe(
      "https://chat.example.com",
    );
  });

  it("refuses http, credentials and garbage", () => {
    for (const raw of [
      "http://chat.example.com",
      "https://user:pass@chat.example.com",
      "ftp://chat.example.com",
      "chat",
    ]) {
      expect(() => providerOrigin(raw)).toThrow(ChannelHttpError);
    }
  });

  it("accepts http only when private hosts are allowed outside production", () => {
    vi.stubEnv("GUIDU_CHANNELS_ALLOW_PRIVATE", "true");
    expect(providerOrigin("http://127.0.0.1:4010")).toBe(
      "http://127.0.0.1:4010",
    );
    vi.stubEnv("NODE_ENV", "production");
    expect(() => providerOrigin("http://127.0.0.1:4010")).toThrow(
      ChannelHttpError,
    );
  });
});

describe("providerJson", () => {
  it("refuses an internal address before calling", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>();
    const error = await failure(
      providerJson("https://169.254.169.254/latest", {}, { fetch }),
    );
    expect(error.code).toBe("private_address");
    expect(fetch).not.toHaveBeenCalled();
  });

  it("maps the answers to codes, never to the body", async () => {
    const cases: [Response, string][] = [
      [new Response("secret", { status: 401 }), "unauthorized"],
      [new Response("secret", { status: 404 }), "not_found"],
      [new Response("secret", { status: 500 }), "http_error"],
      [new Response("<html>", { status: 200 }), "invalid_response"],
    ];
    for (const [response, code] of cases) {
      const error = await failure(
        providerJson(
          "https://203.0.113.10/x",
          {},
          { fetch: async () => response },
        ),
      );
      expect(error.code).toBe(code);
      expect(error.message).not.toContain("secret");
    }
    const network = await failure(
      providerJson(
        "https://203.0.113.10/x",
        {},
        {
          fetch: async () => {
            throw new TypeError("redirect");
          },
        },
      ),
    );
    expect(network.code).toBe("network");
  });

  it("reads JSON and an empty answer", async () => {
    await expect(
      providerJson(
        "https://203.0.113.10/x",
        {},
        { fetch: async () => Response.json({ ok: 1 }) },
      ),
    ).resolves.toEqual({ ok: 1 });
    await expect(
      providerJson(
        "https://203.0.113.10/x",
        {},
        { fetch: async () => new Response(null, { status: 204 }) },
      ),
    ).resolves.toBeNull();
  });
});

describe("readLimited", () => {
  it("stops past the limit, declared or streamed", async () => {
    const declared = new Request("https://app.test", {
      method: "POST",
      body: "x",
      headers: { "content-length": "5000" },
    });
    expect((await failure(readLimited(declared, 100))).code).toBe("too_large");
    const streamed = new Request("https://app.test", {
      method: "POST",
      body: "x".repeat(500),
    });
    expect((await failure(readLimited(streamed, 100))).code).toBe("too_large");
    const fits = new Request("https://app.test", {
      method: "POST",
      body: "ok",
    });
    await expect(readLimited(fits, 100)).resolves.toBe("ok");
  });
});
