import { z } from "zod";

/**
 * Product analytics (CF7, levantamento item 16): usage of the dashboard,
 * never marketing and never personal data. Off by default: it waits for the
 * LGPD review (D-PA-06).
 *
 * - The platform picks the provider (Plausible by default, PostHog as the
 *   second option), its site identifier and the switch (`analytics.*`
 *   keys of the settings cascade, platform level).
 * - A partner may add its own identifier for its brand (login and /app of
 *   its customers), with the same provider, the same consent and the same
 *   data rules; it only works while the platform's switch is on.
 * - The CSP allows the provider's origin only while the switch is on.
 */

export const ANALYTICS_PROVIDERS = ["plausible", "posthog"] as const;
export type AnalyticsProvider = (typeof ANALYTICS_PROVIDERS)[number];

export const POSTHOG_REGIONS = ["us", "eu"] as const;
export type PosthogRegion = (typeof POSTHOG_REGIONS)[number];

export const ANALYTICS_AREAS = [
  "platform",
  "admin",
  "app",
  "auth",
  "public",
] as const;
export type AnalyticsArea = (typeof ANALYTICS_AREAS)[number];

/** Areas the partner's own identifier measures: its customers' screens. */
export const PARTNER_AREAS: readonly AnalyticsArea[] = ["auth", "app"];

/** Loose shape of a site identifier; the provider rule comes on save. */
export const SiteIdSchema = z
  .string()
  .trim()
  .min(3)
  .max(100)
  .regex(/^[A-Za-z0-9._-]+$/, "invalid site identifier");

const PLAUSIBLE_DOMAIN =
  /^(?=.{3,100}$)[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/;
const POSTHOG_KEY = /^phc_[A-Za-z0-9]{20,64}$/;

/** The site domain of Plausible or the project key (`phc_`) of PostHog. */
export function isValidSiteId(
  provider: AnalyticsProvider,
  value: string,
): boolean {
  return provider === "plausible"
    ? PLAUSIBLE_DOMAIN.test(value)
    : POSTHOG_KEY.test(value);
}

/** Origin the browser posts to, the only one the CSP opens. */
export function providerOrigin(
  provider: AnalyticsProvider,
  region: PosthogRegion = "us",
): string {
  return provider === "plausible"
    ? "https://plausible.io"
    : `https://${region}.i.posthog.com`;
}

/** Event endpoint of the provider's public API. */
export function providerEndpoint(
  provider: AnalyticsProvider,
  region: PosthogRegion = "us",
): string {
  return provider === "plausible"
    ? `${providerOrigin(provider)}/api/event`
    : `${providerOrigin(provider, region)}/i/v0/e/`;
}

/** PostHog keeps an identifier in the browser, so it waits for consent. */
export function requiresConsent(provider: AnalyticsProvider): boolean {
  return provider === "posthog";
}

export type AnalyticsSite = Readonly<{
  owner: "platform" | "partner";
  siteId: string;
  areas: readonly AnalyticsArea[];
}>;

/** What the browser of one host receives; null sends nothing. */
export type AnalyticsClientConfig = Readonly<{
  provider: AnalyticsProvider;
  endpoint: string;
  requiresConsent: boolean;
  debug: boolean;
  sites: readonly AnalyticsSite[];
}>;

export type AnalyticsValues = Readonly<{
  enabled: boolean;
  provider: AnalyticsProvider;
  siteId: string | null;
  posthogRegion: PosthogRegion;
  partnerEnabled: boolean;
  partnerSiteId: string | null;
}>;

/**
 * The browser configuration of a host from the resolved values. A site
 * whose identifier does not fit the provider is left out. The partner's
 * own site only counts on partner hosts (`partnerOwn`), and nothing goes
 * out while the platform's switch is off.
 */
export function analyticsClientConfig(
  values: AnalyticsValues,
  options: Readonly<{ partnerOwn: boolean; production: boolean }>,
): AnalyticsClientConfig | null {
  if (!values.enabled) return null;
  const sites: AnalyticsSite[] = [];
  if (values.siteId && isValidSiteId(values.provider, values.siteId)) {
    sites.push({
      owner: "platform",
      siteId: values.siteId,
      areas: ANALYTICS_AREAS,
    });
  }
  if (
    options.partnerOwn &&
    values.partnerEnabled &&
    values.partnerSiteId &&
    isValidSiteId(values.provider, values.partnerSiteId)
  ) {
    sites.push({
      owner: "partner",
      siteId: values.partnerSiteId,
      areas: PARTNER_AREAS,
    });
  }
  if (sites.length === 0) return null;
  return {
    provider: values.provider,
    endpoint: providerEndpoint(values.provider, values.posthogRegion),
    requiresConsent: requiresConsent(values.provider),
    debug: !options.production,
    sites,
  };
}

/** Origin the CSP opens for the platform's values (null: none). */
export function analyticsConnectOrigin(
  values: Pick<AnalyticsValues, "enabled" | "provider" | "posthogRegion">,
): string | null {
  return values.enabled
    ? providerOrigin(values.provider, values.posthogRegion)
    : null;
}
