import { AppError } from "@/shared/errors";

import type {
  LocationProvider,
  LocationSnapshot,
  ReviewSummary,
} from "../analyses/contract";

/**
 * Port to the Google Business Profile (especificação §11), like the
 * `PaymentProvider` of billing: screens, onboarding and analyses talk only
 * to this port, so the provider (Zernio now, the official API later, the
 * fake in tests) changes without touching them. Nothing here writes to the
 * ficha: GB1a only reads.
 */

/** Permissions the onboarding asks Google for, by our own id. */
export const GOOGLE_BUSINESS_PERMISSIONS = [
  "manage_profile",
  "account_identity",
] as const;
export type GoogleBusinessPermission =
  (typeof GOOGLE_BUSINESS_PERMISSIONS)[number];

/** A ficha the connected account may pick (one at a time). */
export type LocationOption = Readonly<{
  /** Provider id of the ficha. */
  id: string;
  name: string;
  /** One-line address as the provider shows it, when it has one. */
  address: string | null;
  category: string | null;
  /** Provider account that owns the ficha (Zernio: `accounts/123`). */
  accountId: string | null;
}>;

/**
 * Result of the return from Google's consent. `pending` is opaque to the
 * caller: the server keeps it encrypted in a cookie until the ficha is
 * chosen, and never shows it.
 */
export type ConnectResult =
  | Readonly<{ status: "connected"; pending: string }>
  | Readonly<{
      status: "missing_permissions";
      missing: readonly GoogleBusinessPermission[];
    }>
  | Readonly<{ status: "denied" }>
  | Readonly<{ status: "failed"; reason: string }>;

/** Reference of a connected ficha, kept in `gb_locations`. */
export type ConnectedLocation = Readonly<{
  externalId: string;
  accountRef: string | null;
}>;

export type GoogleBusinessProvider = Readonly<{
  kind: LocationProvider;
  /** URL that starts Google's consent; it returns to `returnUrl`. */
  connectUrl(input: Readonly<{ returnUrl: string }>): Promise<string>;
  /** Reads the parameters of the return from the consent. */
  completeConnect(params: URLSearchParams): Promise<ConnectResult>;
  /** Fichas the connected account manages. */
  listLocations(pending: string): Promise<readonly LocationOption[]>;
  /** Connects one ficha (one per onboarding). */
  selectLocation(
    pending: string,
    option: LocationOption,
  ): Promise<ConnectedLocation>;
  /** Reads the ficha as it is now. */
  readLocation(location: ConnectedLocation): Promise<LocationSnapshot>;
  /** Public review data, most recent first. */
  listReviews(
    location: ConnectedLocation,
    limit: number,
  ): Promise<readonly ReviewSummary[]>;
}>;

export class GoogleBusinessProviderError extends AppError {
  constructor(reason: string) {
    super({
      code: "unavailable",
      safeMessage: "O Google não respondeu agora. Tente de novo.",
      messageKey: "googleBusiness.errors.provider",
    });
    this.name = "GoogleBusinessProviderError";
    this.reason = reason;
  }
  /** English, for logs only. */
  readonly reason: string;
}

export class GoogleBusinessNotConfiguredError extends AppError {
  constructor() {
    super({
      code: "unavailable",
      safeMessage: "A conexão com o Google ainda não foi configurada.",
      messageKey: "googleBusiness.errors.notConfigured",
    });
    this.name = "GoogleBusinessNotConfiguredError";
  }
}
