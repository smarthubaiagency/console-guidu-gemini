import type { LocationSnapshot, ReviewSummary } from "../analyses/contract";
import {
  type ConnectedLocation,
  GOOGLE_BUSINESS_PERMISSIONS,
  type GoogleBusinessPermission,
  type GoogleBusinessProvider,
  GoogleBusinessProviderError,
  type LocationOption,
} from "./port";

/**
 * Fake Google Business provider (tests and e2e, `GOOGLE_BUSINESS_PROVIDER=fake`,
 * refused in production by `src/core/config/env.ts`). The consent is a page
 * of our own (`/api/google-business/fake-consent`) with a checkbox per
 * permission, like the fake of the CF6b; nothing leaves the process.
 */

export const GOOGLE_BUSINESS_FAKE_CONSENT_PATH =
  "/api/google-business/fake-consent";

const DAY = 86_400_000;

/** The fichas of the fake account. */
export const FAKE_LOCATIONS: readonly LocationOption[] = [
  {
    id: "fake-location-centro",
    name: "Padaria Pão Dourado — Centro",
    address: "Rua das Flores, 120, São Paulo - SP, 01001-000",
    category: "Padaria",
    accountId: "accounts/fake-1",
  },
  {
    id: "fake-location-campinas",
    name: "Padaria Pão Dourado — Campinas",
    address: "Avenida Brasil, 500, Campinas - SP, 13010-000",
    category: "Padaria",
    accountId: "accounts/fake-1",
  },
];

type FakeDetail = Omit<LocationSnapshot, "readAt" | "provider" | "externalId">;

const DETAILS: Readonly<Record<string, FakeDetail>> = {
  "fake-location-centro": {
    placeId: "fake-place-centro",
    name: "Padaria Pão Dourado — Centro",
    primaryCategory: "Padaria",
    additionalCategories: [],
    description: "Pães e doces todos os dias.",
    phone: "+551130000000",
    website: null,
    address: {
      lines: ["Rua das Flores, 120"],
      locality: "São Paulo",
      administrativeArea: "SP",
      postalCode: "01001-000",
      countryCode: "BR",
    },
    latitude: -23.55052,
    longitude: -46.633308,
    timeZone: "America/Sao_Paulo",
    regularHours: [1, 2, 3, 4, 5, 6].map((day) => ({
      day: day as 1 | 2 | 3 | 4 | 5 | 6,
      open: "07:00",
      close: "19:00",
    })),
    specialHours: [],
    rating: 4.3,
    reviewCount: 6,
    photoCount: 4,
    attributes: { "_media.logo": true, "_media.cover": false },
  },
  "fake-location-campinas": {
    placeId: "fake-place-campinas",
    name: "Padaria Pão Dourado — Campinas",
    primaryCategory: "Padaria",
    additionalCategories: ["Confeitaria", "Cafeteria"],
    description:
      "Padaria artesanal em Campinas com pães de fermentação natural, bolos, salgados e café da manhã servido todos os dias. Encomendas para festas e eventos com retirada na loja. Ambiente climatizado, acessível e com mesas ao ar livre. Atendimento de segunda a sábado.",
    phone: "+551930000000",
    website: "https://paodourado.example.com",
    address: {
      lines: ["Avenida Brasil, 500"],
      locality: "Campinas",
      administrativeArea: "SP",
      postalCode: "13010-000",
      countryCode: "BR",
    },
    latitude: -22.90556,
    longitude: -47.06083,
    timeZone: "America/Sao_Paulo",
    regularHours: [1, 2, 3, 4, 5, 6].map((day) => ({
      day: day as 1 | 2 | 3 | 4 | 5 | 6,
      open: "06:30",
      close: "20:00",
    })),
    specialHours: [],
    rating: 4.8,
    reviewCount: 2,
    photoCount: 25,
    attributes: {
      wheelchair_accessible_entrance: true,
      "_media.logo": true,
      "_media.cover": true,
    },
  },
};

function fakeReviews(locationId: string, now: number): ReviewSummary[] {
  if (locationId === "fake-location-campinas") {
    return [
      {
        externalId: "rc-1",
        rating: 5,
        text: "Melhor pão da cidade.",
        authorName: "Carla",
        createdAt: new Date(now - 3 * DAY).toISOString(),
        replied: true,
        replyText: "Obrigado, Carla!",
      },
      {
        externalId: "rc-2",
        rating: 4,
        text: null,
        authorName: "Diego",
        createdAt: new Date(now - 20 * DAY).toISOString(),
        replied: true,
        replyText: "Obrigado pela visita!",
      },
    ];
  }
  const rows: Array<[number, 1 | 2 | 3 | 4 | 5, boolean, string | null]> = [
    [2, 5, false, "Ótimo atendimento."],
    [5, 2, false, "Demorou muito para atender."],
    [9, 5, true, "Pão quentinho."],
    [15, 4, false, null],
    [40, 5, true, "Recomendo."],
    [70, 3, false, "Bom, mas caro."],
  ];
  return rows.map(([daysAgo, rating, replied, text], index) => ({
    externalId: `r-${index + 1}`,
    rating,
    text,
    authorName: `Cliente ${index + 1}`,
    createdAt: new Date(now - daysAgo * DAY).toISOString(),
    replied,
    replyText: replied ? "Obrigado!" : null,
  }));
}

/** The pending token of the fake carries the permissions granted. */
function fakePending(granted: readonly GoogleBusinessPermission[]): string {
  return `fake:${granted.join(",")}`;
}

export function createFakeGoogleBusinessProvider(
  appUrl: string,
  now: () => number = Date.now,
): GoogleBusinessProvider {
  const origin = new URL(appUrl).origin;
  return {
    kind: "fake",
    async connectUrl({ returnUrl }) {
      // The consent stays on the host of the return (a partner's domain too).
      const url = new URL(
        GOOGLE_BUSINESS_FAKE_CONSENT_PATH,
        URL.canParse(returnUrl) ? new URL(returnUrl).origin : origin,
      );
      url.searchParams.set("return", returnUrl);
      return url.toString();
    },
    async completeConnect(params) {
      if (params.get("error")) return { status: "denied" };
      const granted = (params.get("fake_grant") ?? "")
        .split(",")
        .filter((p): p is GoogleBusinessPermission =>
          (GOOGLE_BUSINESS_PERMISSIONS as readonly string[]).includes(p),
        );
      const missing = GOOGLE_BUSINESS_PERMISSIONS.filter(
        (p) => !granted.includes(p),
      );
      if (missing.length > 0) return { status: "missing_permissions", missing };
      return { status: "connected", pending: fakePending(granted) };
    },
    async listLocations(pending) {
      if (!pending.startsWith("fake:")) {
        throw new GoogleBusinessProviderError("fake_pending");
      }
      return FAKE_LOCATIONS;
    },
    async selectLocation(pending, option) {
      if (!pending.startsWith("fake:")) {
        throw new GoogleBusinessProviderError("fake_pending");
      }
      if (!DETAILS[option.id]) {
        throw new GoogleBusinessProviderError("fake_unknown_location");
      }
      return { externalId: option.id, accountRef: option.accountId };
    },
    async readLocation(location: ConnectedLocation) {
      const detail = DETAILS[location.externalId];
      if (!detail)
        throw new GoogleBusinessProviderError("fake_unknown_location");
      return {
        ...detail,
        provider: "fake",
        externalId: location.externalId,
        readAt: new Date(now()).toISOString(),
      };
    },
    async listReviews(location, limit) {
      return fakeReviews(location.externalId, now()).slice(0, limit);
    },
  };
}
