import { z } from "zod";

import type {
  LocationSnapshot,
  RegularHours,
  ReviewSummary,
  SpecialHours,
} from "../analyses/contract";
import { MEDIA_PHOTOS_UNKNOWN } from "../analyses/deterministic/photos";
import {
  type ConnectedLocation,
  type GoogleBusinessProvider,
  GoogleBusinessProviderError,
  type LocationOption,
} from "./port";
import {
  ZERNIO_BASE_URL,
  ZERNIO_DETAILS_READ_MASK,
  ZERNIO_ENDPOINTS,
  ZERNIO_MISSING_PERMISSIONS_ERROR,
} from "./zernio-endpoints";

/**
 * Zernio adapter of the Google Business port (GB1a). Uses only what the
 * Zernio API reference confirms (paths in `zernio-endpoints.ts`); nothing
 * the reference does not show is guessed: the address of the details and
 * the number of photos are left unknown. The key comes from the environment
 * (`ZERNIO_API_KEY`) and the Zernio profile of the connections from
 * `ZERNIO_PROFILE_ID`; tests never call Zernio (they use the fake).
 */

const TIMEOUT_MS = 10_000;

export type ZernioConfig = Readonly<{
  apiKey: string;
  profileId: string;
  baseUrl?: string;
}>;

const LocationsResponse = z.object({
  locations: z
    .array(
      z.object({
        id: z.string(),
        name: z.string().nullish(),
        accountId: z.string().nullish(),
        address: z.string().nullish(),
        category: z.string().nullish(),
      }),
    )
    .default([]),
});

const SelectResponse = z.object({
  account: z
    .object({
      accountId: z.string(),
      selectedLocationId: z.string().nullish(),
    })
    .nullish(),
});

const Category = z.object({ displayName: z.string().nullish() });
const DateParts = z.object({
  year: z.number().int(),
  month: z.number().int(),
  day: z.number().int(),
});

const DetailsResponse = z.object({
  title: z.string().nullish(),
  websiteUri: z.string().nullish(),
  profile: z.object({ description: z.string().nullish() }).nullish(),
  phoneNumbers: z.object({ primaryPhone: z.string().nullish() }).nullish(),
  categories: z
    .object({
      primaryCategory: Category.nullish(),
      additionalCategories: z.array(Category).nullish(),
    })
    .nullish(),
  regularHours: z
    .object({
      periods: z
        .array(
          z.object({
            openDay: z.string().nullish(),
            openTime: z.string().nullish(),
            closeTime: z.string().nullish(),
          }),
        )
        .nullish(),
    })
    .nullish(),
  specialHours: z
    .object({
      specialHourPeriods: z
        .array(
          z.object({
            startDate: DateParts.nullish(),
            openTime: z.string().nullish(),
            closeTime: z.string().nullish(),
            closed: z.boolean().nullish(),
          }),
        )
        .nullish(),
    })
    .nullish(),
  location: z.object({ placeId: z.string().nullish() }).nullish(),
});

const ReviewsResponse = z.object({
  reviews: z
    .array(
      z.object({
        id: z.string(),
        reviewer: z.object({ displayName: z.string().nullish() }).nullish(),
        rating: z.number().int().nullish(),
        comment: z.string().nullish(),
        createTime: z.string().nullish(),
        reviewReply: z.object({ comment: z.string().nullish() }).nullish(),
      }),
    )
    .default([]),
  averageRating: z.number().nullish(),
  totalReviewCount: z.number().int().nullish(),
});

const WEEKDAYS: Readonly<Record<string, RegularHours["day"]>> = {
  SUNDAY: 0,
  MONDAY: 1,
  TUESDAY: 2,
  WEDNESDAY: 3,
  THURSDAY: 4,
  FRIDAY: 5,
  SATURDAY: 6,
};

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;

/** Pending data of the connection, kept encrypted by the caller. */
const Pending = z.object({ t: z.string().min(1).max(2048) });

function pad(value: number): string {
  return String(value).padStart(2, "0");
}

export function snapshotFromDetails(
  raw: unknown,
  location: ConnectedLocation,
  rating: Readonly<{ average: number | null; count: number }>,
  now: Date,
): LocationSnapshot {
  const parsed = DetailsResponse.safeParse(raw);
  if (!parsed.success)
    throw new GoogleBusinessProviderError("zernio_details_shape");
  const d = parsed.data;
  const regularHours: RegularHours[] = (d.regularHours?.periods ?? []).flatMap(
    (p) => {
      const day = p.openDay ? WEEKDAYS[p.openDay] : undefined;
      if (
        day === undefined ||
        !p.openTime ||
        !p.closeTime ||
        !HHMM.test(p.openTime) ||
        !HHMM.test(p.closeTime)
      ) {
        return [];
      }
      return [{ day, open: p.openTime, close: p.closeTime }];
    },
  );
  const specialHours: SpecialHours[] = (
    d.specialHours?.specialHourPeriods ?? []
  ).flatMap((p) =>
    p.startDate
      ? [
          {
            date: `${p.startDate.year}-${pad(p.startDate.month)}-${pad(p.startDate.day)}`,
            closed: Boolean(p.closed),
            open: p.openTime ?? null,
            close: p.closeTime ?? null,
          },
        ]
      : [],
  );
  return {
    provider: "zernio",
    externalId: location.externalId,
    placeId: d.location?.placeId ?? null,
    name: d.title ?? "",
    primaryCategory: d.categories?.primaryCategory?.displayName ?? null,
    additionalCategories: (d.categories?.additionalCategories ?? [])
      .map((c) => c.displayName)
      .filter((name): name is string => Boolean(name)),
    description: d.profile?.description ?? null,
    phone: d.phoneNumbers?.primaryPhone ?? null,
    website: d.websiteUri ?? null,
    // Not in the confirmed response: the onboarding uses the address of
    // the location list.
    address: null,
    latitude: null,
    longitude: null,
    timeZone: null,
    regularHours,
    specialHours,
    rating: rating.average,
    reviewCount: rating.count,
    photoCount: 0,
    attributes: { [MEDIA_PHOTOS_UNKNOWN]: true },
    readAt: now.toISOString(),
  };
}

export function reviewsFromResponse(raw: unknown): {
  reviews: ReviewSummary[];
  average: number | null;
  count: number;
} {
  const parsed = ReviewsResponse.safeParse(raw);
  if (!parsed.success)
    throw new GoogleBusinessProviderError("zernio_reviews_shape");
  const reviews = parsed.data.reviews.flatMap((r): ReviewSummary[] => {
    const rating = r.rating ?? 0;
    if (rating < 1 || rating > 5 || !r.createTime) return [];
    const replyText = r.reviewReply?.comment ?? null;
    return [
      {
        externalId: r.id,
        rating: rating as ReviewSummary["rating"],
        text: r.comment ?? null,
        authorName: r.reviewer?.displayName ?? null,
        createdAt: r.createTime,
        replied: Boolean(replyText),
        replyText,
      },
    ];
  });
  return {
    reviews,
    average: parsed.data.averageRating ?? null,
    count: parsed.data.totalReviewCount ?? reviews.length,
  };
}

export function createZernioProvider(
  config: ZernioConfig,
  fetcher: typeof fetch = fetch,
  now: () => Date = () => new Date(),
): GoogleBusinessProvider {
  const base = config.baseUrl ?? ZERNIO_BASE_URL;

  async function call(
    path: string,
    init: Readonly<{
      method?: "GET" | "POST";
      query?: Record<string, string>;
      body?: unknown;
    }> = {},
  ): Promise<unknown> {
    const url = new URL(`${base}${path}`);
    for (const [key, value] of Object.entries(init.query ?? {})) {
      url.searchParams.set(key, value);
    }
    let response: Response;
    try {
      response = await fetcher(url, {
        method: init.method ?? "GET",
        headers: {
          authorization: `Bearer ${config.apiKey}`,
          accept: "application/json",
          ...(init.body ? { "content-type": "application/json" } : {}),
        },
        body: init.body ? JSON.stringify(init.body) : null,
        redirect: "error",
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch {
      throw new GoogleBusinessProviderError("zernio_network");
    }
    if (!response.ok) {
      throw new GoogleBusinessProviderError(`zernio_http_${response.status}`);
    }
    try {
      return await response.json();
    } catch {
      throw new GoogleBusinessProviderError("zernio_json");
    }
  }

  function token(pending: string): string {
    let raw: unknown;
    try {
      raw = JSON.parse(pending);
    } catch {
      throw new GoogleBusinessProviderError("zernio_pending");
    }
    const parsed = Pending.safeParse(raw);
    if (!parsed.success)
      throw new GoogleBusinessProviderError("zernio_pending");
    return parsed.data.t;
  }

  return {
    kind: "zernio",
    async connectUrl({ returnUrl }) {
      const body = await call(ZERNIO_ENDPOINTS.connectUrl, {
        query: {
          profileId: config.profileId,
          redirect_url: returnUrl,
          headless: "true",
        },
      });
      const parsed = z.object({ authUrl: z.url() }).safeParse(body);
      if (!parsed.success)
        throw new GoogleBusinessProviderError("zernio_connect_shape");
      return parsed.data.authUrl;
    },
    async completeConnect(params) {
      const error = params.get("error");
      if (error === ZERNIO_MISSING_PERMISSIONS_ERROR) {
        return { status: "missing_permissions", missing: ["manage_profile"] };
      }
      if (error === "oauth_denied") return { status: "denied" };
      if (error) return { status: "failed", reason: error.slice(0, 64) };
      const pendingDataToken = params.get("pendingDataToken");
      if (!pendingDataToken) {
        return { status: "failed", reason: "no_pending_data_token" };
      }
      return {
        status: "connected",
        pending: JSON.stringify({ t: pendingDataToken.slice(0, 2048) }),
      };
    },
    async listLocations(pending) {
      const body = await call(ZERNIO_ENDPOINTS.listLocations, {
        query: {
          profileId: config.profileId,
          pendingDataToken: token(pending),
        },
      });
      const parsed = LocationsResponse.safeParse(body);
      if (!parsed.success)
        throw new GoogleBusinessProviderError("zernio_locations_shape");
      return parsed.data.locations.map((l): LocationOption => ({
        id: l.id,
        name: l.name ?? l.id,
        address: l.address ?? null,
        category: l.category ?? null,
        accountId: l.accountId ?? null,
      }));
    },
    async selectLocation(pending, option) {
      const body = await call(ZERNIO_ENDPOINTS.selectLocation, {
        method: "POST",
        body: {
          profileId: config.profileId,
          pendingDataToken: token(pending),
          locationId: option.id,
          ...(option.accountId ? { accountId: option.accountId } : {}),
        },
      });
      const parsed = SelectResponse.safeParse(body);
      const account = parsed.success ? parsed.data.account : null;
      if (!account)
        throw new GoogleBusinessProviderError("zernio_select_shape");
      return {
        externalId: account.selectedLocationId ?? option.id,
        accountRef: account.accountId,
      };
    },
    async readLocation(location) {
      if (!location.accountRef)
        throw new GoogleBusinessProviderError("zernio_no_account");
      const [details, reviews] = await Promise.all([
        call(ZERNIO_ENDPOINTS.locationDetails(location.accountRef), {
          query: { readMask: ZERNIO_DETAILS_READ_MASK },
        }),
        call(ZERNIO_ENDPOINTS.reviews(location.accountRef), {
          query: { pageSize: "1" },
        }),
      ]);
      const summary = reviewsFromResponse(reviews);
      return snapshotFromDetails(
        details,
        location,
        { average: summary.average, count: summary.count },
        now(),
      );
    },
    async listReviews(location, limit) {
      if (!location.accountRef)
        throw new GoogleBusinessProviderError("zernio_no_account");
      const body = await call(ZERNIO_ENDPOINTS.reviews(location.accountRef), {
        query: { pageSize: String(Math.min(Math.max(limit, 1), 50)) },
      });
      return reviewsFromResponse(body).reviews.slice(0, limit);
    },
  };
}
