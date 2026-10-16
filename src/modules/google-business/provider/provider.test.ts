import { describe, expect, it } from "vitest";

import { createFakeGoogleBusinessProvider, FAKE_LOCATIONS } from "./fake";
import { googleBusinessProvider, isGoogleBusinessConfigured } from "./index";
import { createZernioProvider } from "./zernio";
import { ZERNIO_BASE_URL } from "./zernio-endpoints";

type Call = { url: string; method: string; auth: string | null; body: unknown };

/** A Zernio double: never the network (tests never call Zernio). */
function zernioDouble(responses: Record<string, unknown>) {
  const calls: Call[] = [];
  const fetcher = (async (input: URL | string, init?: RequestInit) => {
    const url = new URL(String(input));
    const headers = new Headers(init?.headers);
    calls.push({
      url: url.toString(),
      method: init?.method ?? "GET",
      auth: headers.get("authorization"),
      body: init?.body ? JSON.parse(String(init.body)) : null,
    });
    const body = responses[url.pathname];
    if (body === undefined) return new Response("{}", { status: 404 });
    return new Response(JSON.stringify(body), { status: 200 });
  }) as typeof fetch;
  return { calls, fetcher };
}

describe("fake Google Business provider", () => {
  const fake = createFakeGoogleBusinessProvider("http://localhost:3100", () =>
    Date.parse("2026-10-16T12:00:00Z"),
  );

  it("sends the consent to our own page and reads the permissions back", async () => {
    const url = new URL(
      await fake.connectUrl({
        returnUrl:
          "http://localhost:3100/auth/google-business/callback?state=n",
      }),
    );
    expect(url.pathname).toBe("/api/google-business/fake-consent");
    expect(
      await fake.completeConnect(
        new URLSearchParams("fake_grant=account_identity"),
      ),
    ).toEqual({
      status: "missing_permissions",
      missing: ["manage_profile"],
    });
    expect(
      await fake.completeConnect(new URLSearchParams("error=access_denied")),
    ).toEqual({ status: "denied" });
    const ok = await fake.completeConnect(
      new URLSearchParams("fake_grant=manage_profile,account_identity"),
    );
    expect(ok.status).toBe("connected");
  });

  it("lists, connects and reads one ficha at a time", async () => {
    const options = await fake.listLocations("fake:manage_profile");
    expect(options).toEqual(FAKE_LOCATIONS);
    const connected = await fake.selectLocation("fake:x", options[0]!);
    const snapshot = await fake.readLocation(connected);
    expect(snapshot).toMatchObject({
      provider: "fake",
      name: "Padaria Pão Dourado — Centro",
      readAt: "2026-10-16T12:00:00.000Z",
    });
    expect(await fake.listReviews(connected, 3)).toHaveLength(3);
  });
});

describe("Zernio adapter", () => {
  const config = {
    apiKey: "zk_test",
    profileId: "prof_1",
    baseUrl: "https://zernio.test/api",
  };

  it("asks the headless connect URL with the key in the header, never in the URL", async () => {
    const { calls, fetcher } = zernioDouble({
      "/api/v1/connect/googlebusiness": {
        authUrl: "https://accounts.google.com/o/oauth2/auth?x=1",
      },
    });
    const provider = createZernioProvider(config, fetcher);
    expect(
      await provider.connectUrl({
        returnUrl: "https://app.test/auth/google-business/callback?state=n",
      }),
    ).toBe("https://accounts.google.com/o/oauth2/auth?x=1");
    expect(calls[0]!.auth).toBe("Bearer zk_test");
    expect(calls[0]!.url).toContain("profileId=prof_1");
    expect(calls[0]!.url).toContain("headless=true");
    expect(calls[0]!.url).not.toContain("zk_test");
  });

  it("maps the return of the consent", async () => {
    const provider = createZernioProvider(config, zernioDouble({}).fetcher);
    expect(
      await provider.completeConnect(
        new URLSearchParams(
          "error=missing_google_permissions&missing_scopes=x",
        ),
      ),
    ).toEqual({
      status: "missing_permissions",
      missing: ["manage_profile"],
    });
    expect(
      await provider.completeConnect(new URLSearchParams("error=oauth_denied")),
    ).toEqual({ status: "denied" });
    expect(
      await provider.completeConnect(
        new URLSearchParams("pendingDataToken=tok"),
      ),
    ).toEqual({
      status: "connected",
      pending: JSON.stringify({ t: "tok" }),
    });
  });

  it("lists, selects and reads a location from the confirmed fields only", async () => {
    const { calls, fetcher } = zernioDouble({
      "/api/v1/connect/googlebusiness/locations": {
        locations: [
          {
            id: "loc1",
            name: "Loja",
            accountId: "accounts/9",
            address: "Rua A, 1",
            category: "Padaria",
          },
        ],
      },
      "/api/v1/connect/googlebusiness/select-location": {
        account: { accountId: "acc_z", selectedLocationId: "loc1" },
      },
      "/api/v1/accounts/acc_z/gmb-location-details": {
        title: "Loja",
        websiteUri: "https://loja.test",
        profile: { description: "Pães" },
        phoneNumbers: { primaryPhone: "+5511" },
        categories: {
          primaryCategory: { displayName: "Padaria" },
          additionalCategories: [{ displayName: "Café" }],
        },
        regularHours: {
          periods: [
            {
              openDay: "MONDAY",
              openTime: "08:00",
              closeDay: "MONDAY",
              closeTime: "18:00",
            },
          ],
        },
        specialHours: {
          specialHourPeriods: [
            { startDate: { year: 2026, month: 12, day: 25 }, closed: true },
          ],
        },
        location: { placeId: "pl_1" },
      },
      "/api/v1/accounts/acc_z/gmb-reviews": {
        reviews: [
          {
            id: "r1",
            rating: 2,
            comment: "Ruim",
            createTime: "2026-10-01T00:00:00Z",
            reviewer: { displayName: "Ana" },
          },
        ],
        averageRating: 4.2,
        totalReviewCount: 31,
      },
    });
    const provider = createZernioProvider(
      config,
      fetcher,
      () => new Date("2026-10-16T00:00:00Z"),
    );
    const pending = JSON.stringify({ t: "tok" });
    const [option] = await provider.listLocations(pending);
    const connected = await provider.selectLocation(pending, option!);
    expect(connected).toEqual({ externalId: "loc1", accountRef: "acc_z" });
    expect(calls.find((c) => c.method === "POST")?.body).toEqual({
      profileId: "prof_1",
      pendingDataToken: "tok",
      locationId: "loc1",
      accountId: "accounts/9",
    });
    const snapshot = await provider.readLocation(connected);
    expect(snapshot).toMatchObject({
      provider: "zernio",
      placeId: "pl_1",
      primaryCategory: "Padaria",
      additionalCategories: ["Café"],
      regularHours: [{ day: 1, open: "08:00", close: "18:00" }],
      specialHours: [{ date: "2026-12-25", closed: true }],
      rating: 4.2,
      reviewCount: 31,
      address: null,
      attributes: { "_media.photos_unknown": true },
    });
    expect(await provider.listReviews(connected, 10)).toEqual([
      {
        externalId: "r1",
        rating: 2,
        text: "Ruim",
        authorName: "Ana",
        createdAt: "2026-10-01T00:00:00Z",
        replied: false,
        replyText: null,
      },
    ]);
  });

  it("fails with a provider error on HTTP errors", async () => {
    const provider = createZernioProvider(config, zernioDouble({}).fetcher);
    await expect(
      provider.listLocations(JSON.stringify({ t: "x" })),
    ).rejects.toMatchObject({ reason: "zernio_http_404" });
  });

  it("uses Zernio's base URL by default and the fake only when asked", () => {
    expect(ZERNIO_BASE_URL).toBe("https://zernio.com/api");
    expect(isGoogleBusinessConfigured({})).toBe(false);
    expect(
      isGoogleBusinessConfigured({
        ZERNIO_API_KEY: "k",
        ZERNIO_PROFILE_ID: "p",
      }),
    ).toBe(true);
    expect(
      googleBusinessProvider({ GOOGLE_BUSINESS_PROVIDER: "fake" }).kind,
    ).toBe("fake");
    expect(
      googleBusinessProvider({ ZERNIO_API_KEY: "k", ZERNIO_PROFILE_ID: "p" })
        .kind,
    ).toBe("zernio");
    expect(() => googleBusinessProvider({})).toThrow();
  });
});
