import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";

import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  it,
  vi,
} from "vitest";

vi.mock("server-only", () => ({}));

import {
  ChannelHttpError,
  isPrivateAddress,
  pinnedFetch,
  providerDownload,
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

describe("providerDownload", () => {
  const base = "https://203.0.113.10";

  it("starts only on the provider's origin", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>();
    const error = await failure(
      providerDownload("https://203.0.113.99/file.ogg", base, {
        fetch,
        maxBytes: 100,
      }),
    );
    expect(error.code).toBe("invalid_url");
    expect(fetch).not.toHaveBeenCalled();
  });

  it("follows the storage redirect and returns the type", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(async (input) =>
      String(input).startsWith(base)
        ? new Response(null, {
            status: 302,
            headers: { location: "https://198.51.100.7/blob?sig=1" },
          })
        : new Response("OggS", {
            headers: { "content-type": "audio/ogg; codecs=opus" },
          }),
    );
    const file = await providerDownload(`${base}/rails/blob/1`, base, {
      fetch,
      maxBytes: 100,
    });
    expect(file.mediaType).toBe("audio/ogg");
    expect(file.data.toString()).toBe("OggS");
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("checks every hop and the size", async () => {
    const toPrivate = await failure(
      providerDownload(`${base}/a`, base, {
        fetch: async () =>
          new Response(null, {
            status: 302,
            headers: { location: "https://10.0.0.5/secret" },
          }),
        maxBytes: 100,
      }),
    );
    expect(toPrivate.code).toBe("private_address");
    const loop = await failure(
      providerDownload(`${base}/a`, base, {
        fetch: async () =>
          new Response(null, {
            status: 302,
            headers: { location: `${base}/a` },
          }),
        maxBytes: 100,
      }),
    );
    expect(loop.code).toBe("http_error");
    const big = await failure(
      providerDownload(`${base}/a`, base, {
        fetch: async () => new Response("x".repeat(500)),
        maxBytes: 100,
      }),
    );
    expect(big.code).toBe("too_large");
  });
});

describe("pinnedFetch", () => {
  let server: Server;
  let origin: string;

  beforeAll(async () => {
    server = createServer((request, response) => {
      response.setHeader("content-type", "application/json");
      response.end(JSON.stringify({ method: request.method }));
    });
    await new Promise<void>((resolve) =>
      server.listen(0, "127.0.0.1", resolve),
    );
    origin = `http://localhost:${(server.address() as AddressInfo).port}`;
  });

  afterAll(async () => {
    await new Promise((resolve) => server.close(resolve));
  });

  it("refuses a host that resolves to a private address at connect time", async () => {
    // providerJson's own check is skipped here: only the socket's lookup.
    const error = await pinnedFetch(`${origin}/x`).then(
      () => null,
      (caught: unknown) => caught,
    );
    expect(error).toBeInstanceOf(ChannelHttpError);
    expect((error as ChannelHttpError).code).toBe("private_address");
  });

  it("connects when private hosts are allowed (local tests)", async () => {
    vi.stubEnv("GUIDU_CHANNELS_ALLOW_PRIVATE", "true");
    const response = await pinnedFetch(`${origin}/x`, {
      method: "POST",
      body: "{}",
    });
    expect(await response.json()).toEqual({ method: "POST" });
  });
});
