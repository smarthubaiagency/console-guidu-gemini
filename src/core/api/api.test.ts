import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { API_ROUTES } from "./contracts";
import { buildOpenApiDocument } from "./openapi";
import {
  bucketsFor,
  configuredRateLimits,
  rateLimitHeaders,
} from "./rate-limit";
import { decodeCursor, encodeCursor } from "./resources";

describe("rate limits (F4a)", () => {
  it("uses the provisional defaults and accepts overrides", () => {
    expect(configuredRateLimits({})).toEqual({
      key: 60,
      user: 120,
      workspace: 300,
    });
    expect(
      configuredRateLimits({
        API_RATE_LIMIT_PER_KEY: "10",
        API_RATE_LIMIT_PER_USER: "x",
      }),
    ).toEqual({ key: 10, user: 120, workspace: 300 });
  });

  it("counts a key, its user and its workspace", () => {
    const limits = { key: 1, user: 2, workspace: 3 };
    expect(
      bucketsFor({ apiKeyId: "k", userId: "u", workspaceId: "w" }, limits).map(
        (b) => b.name,
      ),
    ).toEqual(["key:k", "user:u", "workspace:w"]);
    expect(
      bucketsFor(
        { apiKeyId: null, userId: "u", workspaceId: null },
        limits,
      ).map((b) => b.name),
    ).toEqual(["user:u"]);
  });

  it("tells the client when to come back", () => {
    expect(
      rateLimitHeaders({
        allowed: false,
        limit: 60,
        remaining: 0,
        resetSeconds: 12,
        store: "redis",
      }),
    ).toEqual({
      "ratelimit-limit": "60",
      "ratelimit-remaining": "0",
      "ratelimit-reset": "12",
      "retry-after": "12",
    });
  });
});

describe("cursor", () => {
  it("keeps the microseconds and refuses tampering", () => {
    const value = {
      t: "2026-10-18 12:00:00.123456+00",
      id: "00000000-0000-4000-8000-000000000001",
    };
    expect(decodeCursor(encodeCursor(value))).toEqual(value);
    expect(decodeCursor(undefined)).toBeNull();
    expect(() => decodeCursor("nope")).toThrow();
    expect(() =>
      decodeCursor(
        Buffer.from(JSON.stringify({ t: "x'; drop", id: value.id })).toString(
          "base64url",
        ),
      ),
    ).toThrow();
  });
});

describe("OpenAPI", () => {
  it("documents every route with its scope and the error responses", () => {
    const doc = buildOpenApiDocument("https://app.example.com/");
    expect(doc.servers[0]?.url).toBe("https://app.example.com/api/v1");
    for (const route of Object.values(API_ROUTES)) {
      const op = (
        doc.paths[route.path] as Record<string, Record<string, unknown>>
      )[route.method.toLowerCase()];
      expect(op?.operationId).toBe(route.operationId);
      expect(op?.["x-required-scope"]).toBe(route.scope);
      expect(Object.keys(op?.responses as object)).toEqual(
        expect.arrayContaining([
          String("successStatus" in route ? route.successStatus : 200),
          "401",
          "403",
          "404",
          "422",
          "429",
        ]),
      );
    }
  });
});
