import { describe, expect, it } from "vitest";

import { buildGrid } from "../geo";
import { createDataForSeoProvider, parseTimestamp } from "./dataforseo";
import { createGoogleMapsLocator } from "./google-maps";
import { getMapsProvider, getPlaceLocator, mapsProviderId } from "./index";
import { MapsProviderError } from "./types";

/**
 * The DataForSEO adapter against simulated answers: no request leaves the
 * test (the fetch is a stub that records what it was asked).
 */

type Call = { url: string; method: string; headers: Record<string, string>; body: unknown };

function stubFetch(answer: (call: Call) => unknown, status = 200) {
  const calls: Call[] = [];
  const fetch = (async (input: string, init: RequestInit) => {
    const call: Call = {
      url: input,
      method: init.method ?? "GET",
      headers: init.headers as Record<string, string>,
      body: init.body ? JSON.parse(init.body as string) : null,
    };
    calls.push(call);
    return new Response(JSON.stringify(answer(call)), { status });
  }) as unknown as typeof globalThis.fetch;
  return { fetch, calls };
}

const LOGIN = "login@guidu.test";
const PASSWORD = "segredo-da-conta";

function mapsItem(rank: number, title: string, placeId: string, borough?: string) {
  return {
    type: "maps_search",
    rank_group: rank,
    rank_absolute: rank,
    title,
    place_id: placeId,
    cid: "123",
    category: "Dentista",
    additional_categories: ["Clínica odontológica"],
    rating: { value: 4.7, votes_count: 88 },
    address_info: borough ? { borough } : null,
  };
}

describe("DataForSEO adapter (GB1b)", () => {
  it("posts one task per point and collects them from the standard queue", async () => {
    const points = buildGrid({ latitude: -23.55, longitude: -46.63 }, 3, 2);
    const polled = new Map<string, number>();
    const { fetch, calls } = stubFetch((call) => {
      if (call.url.endsWith("/serp/google/maps/task_post")) {
        const tasks = call.body as { tag: string }[];
        return {
          status_code: 20000,
          tasks: tasks.map((task, index) => ({ id: `task-${index}`, status_code: 20100, data: { tag: task.tag } })),
        };
      }
      const id = call.url.split("/").at(-1)!;
      const seen = (polled.get(id) ?? 0) + 1;
      polled.set(id, seen);
      // Every task is still in the queue on the first poll.
      if (seen === 1) {
        return { status_code: 20000, tasks: [{ id, status_code: 40602, status_message: "Task In Queue" }] };
      }
      const index = Number(id.split("-")[1]);
      return {
        status_code: 20000,
        tasks: [
          {
            id,
            status_code: 20000,
            result: [
              {
                items: [
                  mapsItem(1, "Rival", "rival", "Centro"),
                  { type: "maps_paid_item", title: "Anúncio" },
                  mapsItem(index === 4 ? 2 : 7, "Minha Loja", "me"),
                ],
              },
            ],
          },
        ],
      };
    });
    const slept: number[] = [];
    const provider = createDataForSeoProvider({
      login: LOGIN,
      password: PASSWORD,
      fetch,
      sleep: async (ms) => {
        slept.push(ms);
      },
      pollIntervalMs: 1000,
    });
    const result = await provider.searchGrid({
      keyword: "dentista",
      points,
      languageCode: "pt",
      target: { placeId: "me", name: "Minha Loja" },
    });

    const post = calls[0]!;
    expect(post.method).toBe("POST");
    expect(post.headers.authorization).toBe(
      `Basic ${Buffer.from(`${LOGIN}:${PASSWORD}`).toString("base64")}`,
    );
    const tasks = post.body as Record<string, unknown>[];
    expect(tasks).toHaveLength(9);
    expect(tasks[4]).toMatchObject({
      keyword: "dentista",
      location_coordinate: "-23.55,-46.63,14z",
      language_code: "pt",
      depth: 20,
      tag: "1:1",
    });
    expect(slept).toEqual([1000]);
    expect(result).toHaveLength(9);
    expect(result[4]!.items.map((i) => [i.rank, i.name, i.neighborhood])).toEqual([
      [1, "Rival", "Centro"],
      [2, "Minha Loja", null],
    ]);
    expect(result[0]!.items[0]).toMatchObject({ rating: 4.7, reviews: 88, categories: ["Dentista", "Clínica odontológica"] });
  });

  it("gives up after the bounded wait", async () => {
    let clock = 0;
    const { fetch } = stubFetch((call) =>
      call.url.endsWith("task_post")
        ? { status_code: 20000, tasks: [{ id: "t", status_code: 20100 }] }
        : { status_code: 20000, tasks: [{ id: "t", status_code: 40601 }] },
    );
    const provider = createDataForSeoProvider({
      login: LOGIN,
      password: PASSWORD,
      fetch,
      now: () => clock,
      sleep: async (ms) => {
        clock += ms;
      },
      maxWaitMs: 10_000,
      pollIntervalMs: 4000,
    });
    const error = await provider
      .placeProfile({ placeId: "abc", languageCode: "pt", countryCode: "BR" })
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(MapsProviderError);
    expect((error as MapsProviderError).code).toBe("timeout");
  });

  it("maps account errors without leaking the credentials", async () => {
    for (const [status, body, code] of [
      [401, {}, "auth"],
      [200, { status_code: 40200, status_message: "Payment required" }, "funds"],
      [200, { status_code: 40202, status_message: "Rate limit" }, "rate_limited"],
      [500, {}, "bad_response"],
    ] as const) {
      const { fetch } = stubFetch(() => body, status);
      const provider = createDataForSeoProvider({ login: LOGIN, password: PASSWORD, fetch });
      const error = (await provider
        .placeReviews({ placeId: "abc", languageCode: "pt", countryCode: "BR", depth: 20 })
        .catch((e: unknown) => e)) as MapsProviderError;
      expect(error.code).toBe(code);
      expect(error.message).not.toContain(PASSWORD);
      expect(error.message).not.toContain(LOGIN);
    }
  });

  it("reads the profile and the reviews of a place", async () => {
    const { fetch, calls } = stubFetch((call) => {
      if (call.url.endsWith("task_post")) {
        return { status_code: 20000, tasks: [{ id: "x", status_code: 20100 }] };
      }
      if (call.url.includes("my_business_info")) {
        return {
          status_code: 20000,
          tasks: [{ id: "x", status_code: 20000, result: [{ items: [{ title: "Minha Loja", place_id: "me", category: "Dentista", latitude: -23.5, longitude: -46.6, rating: { value: 4.4, votes_count: 31 } }] }] }],
        };
      }
      return {
        status_code: 20000,
        tasks: [
          {
            id: "x",
            status_code: 20000,
            result: [
              {
                items: [
                  { review_id: "r1", rating: { value: 5 }, timestamp: "2026-09-01 10:00:00 +00:00", review_text: "Ótimo", profile_name: "Ana Souza", owner_answer: "Obrigado!" },
                  { review_id: "r2", rating: { value: 2 }, timestamp: "2026-09-02 10:00:00 -03:00", review_text: null, profile_name: "Bruno" },
                  { review_id: "bad", rating: { value: 0 }, timestamp: "x" },
                ],
              },
            ],
          },
        ],
      };
    });
    const provider = createDataForSeoProvider({ login: LOGIN, password: PASSWORD, fetch, sleep: async () => {} });
    const profile = await provider.placeProfile({ placeId: "me", languageCode: "pt", countryCode: "BR" });
    expect(profile).toMatchObject({ name: "Minha Loja", location: { latitude: -23.5, longitude: -46.6 }, rating: 4.4, reviewCount: 31 });
    expect(calls[0]!.body).toEqual([{ keyword: "place_id:me", language_code: "pt", location_code: 2076 }]);

    const reviews = await provider.placeReviews({ placeId: "me", languageCode: "pt", countryCode: "BR", depth: 20 });
    expect(reviews).toEqual([
      { externalId: "r1", rating: 5, text: "Ótimo", authorName: "Ana Souza", createdAt: "2026-09-01T10:00:00.000Z", replied: true, replyText: "Obrigado!" },
      { externalId: "r2", rating: 2, text: null, authorName: "Bruno", createdAt: "2026-09-02T13:00:00.000Z", replied: false, replyText: null },
    ]);
    expect(parseTimestamp("not a date")).toBeNull();
  });
});

describe("choice of the maps provider and the Places locator (GB1b)", () => {
  it("follows the environment and needs both credentials", () => {
    expect(mapsProviderId({ MAPS_INTELLIGENCE_PROVIDER: "fake" })).toBe("fake");
    expect(mapsProviderId({ DATAFORSEO_LOGIN: "a", DATAFORSEO_PASSWORD: "b" })).toBe("dataforseo");
    expect(mapsProviderId({ DATAFORSEO_LOGIN: "a" })).toBeNull();
    expect(mapsProviderId({})).toBeNull();
    expect(getMapsProvider({ MAPS_INTELLIGENCE_PROVIDER: "fake" })?.id).toBe("fake");
    expect(getMapsProvider({})).toBeNull();
    expect(getPlaceLocator({ GOOGLE_MAPS_API_KEY: "k", MAPS_INTELLIGENCE_PROVIDER: "fake" })).toBeNull();
    expect(getPlaceLocator({ GOOGLE_MAPS_API_KEY: "k" })).not.toBeNull();
  });

  it("asks Places only for the location and keeps the key in the header", async () => {
    const { fetch, calls } = stubFetch(() => ({ location: { latitude: -23.5, longitude: -46.6 } }));
    const locator = createGoogleMapsLocator({ apiKey: "chave-places", fetch });
    expect(await locator.locate("ChIJabc")).toEqual({ latitude: -23.5, longitude: -46.6 });
    expect(calls[0]!.url).toBe("https://places.googleapis.com/v1/places/ChIJabc");
    expect(calls[0]!.url).not.toContain("chave-places");
    expect(calls[0]!.headers).toMatchObject({ "X-Goog-Api-Key": "chave-places", "X-Goog-FieldMask": "location" });
    expect(await locator.locate("bad id!")).toBeNull();
  });
});
