import { z } from "zod";

import type { ReviewSummary } from "../../analyses/contract";

import {
  type MapsGridSearch,
  type MapsIntelligenceProvider,
  type MapsPointResult,
  MapsProviderError,
  type MapsSearchItem,
  type PlaceLookup,
  type PlaceProfile,
} from "./types";

/**
 * DataForSEO adapter of the maps port (GB1b, especificação §6.2 and §11).
 *
 * - Google Maps SERP by coordinate (`location_coordinate`), never Places:
 *   Places drops businesses without a physical address (documento técnico,
 *   §7.7). Endpoints and fields as documented by DataForSEO and summarised
 *   in `AgriciDaniel/claude-seo` (MIT,
 *   `skills/seo/references/maps-api-endpoints.md`).
 * - Standard queue (cheapest): `task_post` with up to 100 tasks per call,
 *   then `task_get` until every task is ready or the wait limit passes
 *   (`maxWaitMs`, 5 minutes by default, the queue's documented turnaround).
 * - HTTP Basic auth from `DATAFORSEO_LOGIN` / `DATAFORSEO_PASSWORD`, read by
 *   the caller from the environment; the credentials never reach a log or
 *   an error message.
 * - Responses are parsed defensively (Zod, unknown fields ignored): field
 *   names still need to be checked against the GUIDU account
 *   (docs/pendencias.md).
 */

export const DATAFORSEO_BASE_URL = "https://api.dataforseo.com/v3";
const TASKS_PER_POST = 100;
const STATUS_OK = 20000;
const STATUS_TASK_CREATED = 20100;
/** "Task Handed" / "Task in Queue": not ready yet. */
const STATUS_PENDING = new Set([40601, 40602]);

export type DataForSeoOptions = Readonly<{
  login: string;
  password: string;
  fetch?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
  /** Bounded wait for the standard queue. */
  maxWaitMs?: number;
  pollIntervalMs?: number;
  /** Zoom of the coordinate searches (DataForSEO accepts 3z–21z). */
  zoom?: number;
  baseUrl?: string;
}>;

/** DataForSEO location codes of the countries GUIDU serves first. */
const LOCATION_CODES: Record<string, number> = {
  BR: 2076,
  PT: 2620,
  US: 2840,
  ES: 2724,
  MX: 2484,
  AR: 2032,
  CO: 2170,
  CL: 2152,
};

function locationCode(countryCode: string | null): number {
  return LOCATION_CODES[countryCode?.toUpperCase() ?? ""] ?? LOCATION_CODES.BR!;
}

const Envelope = z.object({
  status_code: z.number(),
  status_message: z.string().optional(),
  tasks: z
    .array(
      z.object({
        id: z.string(),
        status_code: z.number(),
        status_message: z.string().optional(),
        data: z.record(z.string(), z.unknown()).optional(),
        result: z.array(z.unknown()).nullable().optional(),
      }),
    )
    .nullable()
    .optional(),
});

type EnvelopeTask = NonNullable<z.infer<typeof Envelope>["tasks"]>[number];

const MapsItem = z.object({
  type: z.string().optional(),
  rank_group: z.number().optional(),
  rank_absolute: z.number().optional(),
  title: z.string().nullable().optional(),
  place_id: z.string().nullable().optional(),
  cid: z.union([z.string(), z.number()]).nullable().optional(),
  category: z.string().nullable().optional(),
  additional_categories: z.array(z.string()).nullable().optional(),
  rating: z
    .object({
      value: z.number().nullable().optional(),
      votes_count: z.number().nullable().optional(),
    })
    .nullable()
    .optional(),
  address_info: z
    .object({ borough: z.string().nullable().optional() })
    .nullable()
    .optional(),
});

const MapsResult = z.object({
  items: z.array(z.unknown()).nullable().optional(),
});

const ProfileItem = z.object({
  title: z.string().nullable().optional(),
  place_id: z.string().nullable().optional(),
  category: z.string().nullable().optional(),
  additional_categories: z.array(z.string()).nullable().optional(),
  latitude: z.number().nullable().optional(),
  longitude: z.number().nullable().optional(),
  rating: z
    .object({
      value: z.number().nullable().optional(),
      votes_count: z.number().nullable().optional(),
    })
    .nullable()
    .optional(),
});

const ReviewItem = z.object({
  review_id: z.string().nullable().optional(),
  rating: z
    .object({ value: z.number().nullable().optional() })
    .nullable()
    .optional(),
  timestamp: z.string().nullable().optional(),
  review_text: z.string().nullable().optional(),
  profile_name: z.string().nullable().optional(),
  owner_answer: z.string().nullable().optional(),
});

/** "2026-09-01 10:00:00 +00:00" (DataForSEO) or ISO, as a Date. */
export function parseTimestamp(value: string | null | undefined): Date | null {
  if (!value) return null;
  const match =
    /^(\d{4}-\d{2}-\d{2}) (\d{2}:\d{2}:\d{2}) ([+-]\d{2}:\d{2})$/.exec(
      value.trim(),
    );
  const date = new Date(match ? `${match[1]}T${match[2]}${match[3]}` : value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function asError(
  status: number,
  message: string | undefined,
): MapsProviderError {
  // 401xx: authentication; 402xx: payment/funds; 40202/40209: limits.
  if (status === 40100 || status === 40101 || status === 40104) {
    return new MapsProviderError(
      "auth",
      `DataForSEO refused the credentials (${status})`,
    );
  }
  if (status === 40200 || status === 40210) {
    return new MapsProviderError(
      "funds",
      `DataForSEO account without funds (${status})`,
    );
  }
  if (status === 40202 || status === 40209) {
    return new MapsProviderError(
      "rate_limited",
      `DataForSEO rate limit (${status})`,
    );
  }
  return new MapsProviderError(
    "bad_response",
    `DataForSEO error ${status}${message ? `: ${message.slice(0, 120)}` : ""}`,
  );
}

export function createDataForSeoProvider(
  options: DataForSeoOptions,
): MapsIntelligenceProvider {
  const doFetch = options.fetch ?? fetch;
  const sleep =
    options.sleep ?? ((ms: number) => new Promise((r) => setTimeout(r, ms)));
  const now = options.now ?? Date.now;
  const maxWaitMs = options.maxWaitMs ?? 5 * 60 * 1000;
  const pollIntervalMs = options.pollIntervalMs ?? 5000;
  const zoom = options.zoom ?? 14;
  const baseUrl = options.baseUrl ?? DATAFORSEO_BASE_URL;
  const authorization = `Basic ${Buffer.from(`${options.login}:${options.password}`).toString("base64")}`;

  async function call(
    path: string,
    body?: unknown,
  ): Promise<z.infer<typeof Envelope>> {
    let response: Response;
    try {
      response = await doFetch(`${baseUrl}${path}`, {
        method: body === undefined ? "GET" : "POST",
        headers: {
          authorization,
          ...(body === undefined ? {} : { "content-type": "application/json" }),
        },
        body: body === undefined ? null : JSON.stringify(body),
        signal: AbortSignal.timeout(30_000),
      });
    } catch {
      throw new MapsProviderError(
        "network",
        `DataForSEO request failed (${path.split("/").slice(0, 4).join("/")})`,
      );
    }
    if (response.status === 401) {
      throw new MapsProviderError(
        "auth",
        "DataForSEO refused the credentials (401)",
      );
    }
    if (response.status === 402) {
      throw new MapsProviderError(
        "funds",
        "DataForSEO account without funds (402)",
      );
    }
    if (response.status === 429) {
      throw new MapsProviderError(
        "rate_limited",
        "DataForSEO rate limit (429)",
      );
    }
    if (!response.ok) {
      throw new MapsProviderError(
        "bad_response",
        `DataForSEO HTTP ${response.status}`,
      );
    }
    const parsed = Envelope.safeParse(await response.json().catch(() => null));
    if (!parsed.success) {
      throw new MapsProviderError(
        "bad_response",
        "DataForSEO answer in an unexpected shape",
      );
    }
    if (parsed.data.status_code !== STATUS_OK) {
      throw asError(parsed.data.status_code, parsed.data.status_message);
    }
    return parsed.data;
  }

  /** Posts the tasks (chunks of 100) and returns their ids in order. */
  async function postTasks(
    path: string,
    tasks: readonly Record<string, unknown>[],
  ): Promise<string[]> {
    const ids: string[] = [];
    for (let start = 0; start < tasks.length; start += TASKS_PER_POST) {
      const chunk = tasks.slice(start, start + TASKS_PER_POST);
      const envelope = await call(path, chunk);
      const created = envelope.tasks ?? [];
      if (created.length !== chunk.length) {
        throw new MapsProviderError(
          "bad_response",
          "DataForSEO created fewer tasks than sent",
        );
      }
      for (const task of created) {
        if (task.status_code !== STATUS_TASK_CREATED) {
          throw asError(task.status_code, task.status_message);
        }
        ids.push(task.id);
      }
    }
    return ids;
  }

  /** Waits for every task, within the bounded wait, and returns them by id. */
  async function collect(
    path: (id: string) => string,
    ids: readonly string[],
  ): Promise<Map<string, EnvelopeTask>> {
    const done = new Map<string, EnvelopeTask>();
    const deadline = now() + maxWaitMs;
    let pending = [...ids];
    while (pending.length > 0) {
      const still: string[] = [];
      // A few at a time, well under the 2,000 calls per minute.
      for (let start = 0; start < pending.length; start += 10) {
        const batch = pending.slice(start, start + 10);
        const answers = await Promise.all(
          batch.map(async (id) => {
            const envelope = await call(path(id));
            return { id, task: envelope.tasks?.[0] ?? null };
          }),
        );
        for (const { id, task } of answers) {
          if (!task || STATUS_PENDING.has(task.status_code)) {
            still.push(id);
          } else if (task.status_code === STATUS_OK) {
            done.set(id, task);
          } else {
            throw asError(task.status_code, task.status_message);
          }
        }
      }
      pending = still;
      if (pending.length === 0) break;
      if (now() + pollIntervalMs > deadline) {
        throw new MapsProviderError(
          "timeout",
          `DataForSEO queue did not finish ${pending.length} of ${ids.length} tasks in time`,
        );
      }
      await sleep(pollIntervalMs);
    }
    return done;
  }

  function firstResult(task: EnvelopeTask): unknown {
    return task.result?.[0] ?? null;
  }

  return {
    id: "dataforseo",

    async searchGrid(request: MapsGridSearch): Promise<MapsPointResult[]> {
      const tasks = request.points.map((point) => ({
        keyword: request.keyword,
        location_coordinate: `${point.latitude},${point.longitude},${zoom}z`,
        language_code: request.languageCode,
        device: "mobile",
        os: "android",
        depth: 20,
        tag: `${point.row}:${point.column}`,
      }));
      const ids = await postTasks("/serp/google/maps/task_post", tasks);
      const done = await collect(
        (id) => `/serp/google/maps/task_get/advanced/${id}`,
        ids,
      );
      return request.points.map((point, index) => {
        const task = done.get(ids[index]!);
        const result = MapsResult.safeParse(task ? firstResult(task) : null);
        const items: MapsSearchItem[] = [];
        for (const raw of result.success ? (result.data.items ?? []) : []) {
          const item = MapsItem.safeParse(raw);
          if (!item.success) continue;
          const data = item.data;
          if (data.type && data.type !== "maps_search") continue;
          const rank = data.rank_group ?? data.rank_absolute;
          if (!rank || !data.title) continue;
          items.push({
            rank,
            placeId: data.place_id ?? null,
            cid:
              data.cid === null || data.cid === undefined
                ? null
                : String(data.cid),
            name: data.title.slice(0, 200),
            rating: data.rating?.value ?? null,
            reviews: data.rating?.votes_count ?? null,
            categories: [data.category, ...(data.additional_categories ?? [])]
              .filter((c): c is string => typeof c === "string" && c.length > 0)
              .slice(0, 10),
            neighborhood: data.address_info?.borough?.slice(0, 80) ?? null,
          });
        }
        items.sort((a, b) => a.rank - b.rank);
        return { row: point.row, column: point.column, items };
      });
    },

    async placeProfile(lookup: PlaceLookup): Promise<PlaceProfile | null> {
      const [id] = await postTasks(
        "/business_data/google/my_business_info/task_post",
        [
          {
            keyword: `place_id:${lookup.placeId}`,
            language_code: lookup.languageCode,
            location_code: locationCode(lookup.countryCode),
          },
        ],
      );
      const done = await collect(
        (taskId) => `/business_data/google/my_business_info/task_get/${taskId}`,
        [id!],
      );
      const result = MapsResult.safeParse(firstResult(done.get(id!)!));
      const raw = result.success ? result.data.items?.[0] : undefined;
      const item = ProfileItem.safeParse(raw);
      if (!item.success || !item.data.title) return null;
      const data = item.data;
      return {
        placeId: data.place_id ?? lookup.placeId,
        name: data.title!.slice(0, 200),
        location:
          typeof data.latitude === "number" &&
          typeof data.longitude === "number"
            ? { latitude: data.latitude, longitude: data.longitude }
            : null,
        primaryCategory: data.category ?? null,
        additionalCategories: data.additional_categories ?? [],
        rating: data.rating?.value ?? null,
        reviewCount: data.rating?.votes_count ?? null,
      };
    },

    async placeReviews(
      lookup: PlaceLookup & Readonly<{ depth: number }>,
    ): Promise<ReviewSummary[]> {
      const [id] = await postTasks("/business_data/google/reviews/task_post", [
        {
          place_id: lookup.placeId,
          depth: Math.min(Math.max(lookup.depth, 10), 200),
          sort_by: "newest",
          language_code: lookup.languageCode,
          location_code: locationCode(lookup.countryCode),
        },
      ]);
      const done = await collect(
        (taskId) => `/business_data/google/reviews/task_get/${taskId}`,
        [id!],
      );
      const result = MapsResult.safeParse(firstResult(done.get(id!)!));
      const reviews: ReviewSummary[] = [];
      for (const raw of result.success ? (result.data.items ?? []) : []) {
        const item = ReviewItem.safeParse(raw);
        if (!item.success) continue;
        const rating = Math.round(item.data.rating?.value ?? 0);
        const createdAt = parseTimestamp(item.data.timestamp);
        if (rating < 1 || rating > 5 || !createdAt) continue;
        reviews.push({
          externalId: item.data.review_id ?? `dataforseo-${reviews.length + 1}`,
          rating: rating as ReviewSummary["rating"],
          text: item.data.review_text ?? null,
          authorName: item.data.profile_name ?? null,
          createdAt: createdAt.toISOString(),
          replied: Boolean(item.data.owner_answer),
          replyText: item.data.owner_answer ?? null,
        });
      }
      return reviews;
    },
  };
}
