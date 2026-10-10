import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("react", () => ({ cache: <T>(fn: T) => fn }));

const { headers, getRequestPartner } = vi.hoisted(() => ({
  headers: vi.fn(),
  getRequestPartner: vi.fn(),
}));
vi.mock("next/headers", () => ({ headers }));
vi.mock("@/core/partners/resolve", () => ({ getRequestPartner }));
vi.mock("@/lib/prisma/client", () => ({ prisma: {} }));

import { getRequestBrand } from "./resolve";

describe("getRequestBrand", () => {
  afterEach(() => {
    vi.resetAllMocks();
  });

  it("lets the dynamic-rendering signal of headers() propagate", async () => {
    const dynamicUsage = Object.assign(new Error("Dynamic server usage"), {
      digest: "DYNAMIC_SERVER_USAGE",
    });
    headers.mockRejectedValue(dynamicUsage);
    await expect(getRequestBrand()).rejects.toBe(dynamicUsage);
    expect(getRequestPartner).not.toHaveBeenCalled();
  });

  it("falls back to the environment brand when the partner lookup fails", async () => {
    headers.mockResolvedValue(new Headers({ host: "localhost" }));
    getRequestPartner.mockRejectedValue(new Error("database unavailable"));
    vi.spyOn(console, "error").mockImplementation(() => {});

    const brand = await getRequestBrand();
    expect(brand.source).toBe("environment");
    expect(brand.partnerId).toBeNull();
  });

  it("uses the environment brand for unknown hosts", async () => {
    headers.mockResolvedValue(new Headers({ host: "evil.example.com" }));
    getRequestPartner.mockResolvedValue(null);
    await expect(getRequestBrand()).resolves.toMatchObject({
      source: "environment",
      partnerId: null,
    });
  });
});
