import type { AnalyticsArea, AnalyticsProvider } from "./config";

/**
 * What a product analytics event may carry (CF7): the area of the screen
 * and its route with every variable part replaced, never personal data.
 * No e-mail, no person or record id, no workspace slug, no token, no query
 * string, no fragment, no referrer, no title, no content. Pure: the
 * browser component and the tests use it.
 */

/** Product events (levantamento item 16): names only, no properties. */
export const PRODUCT_EVENTS = [
  "login",
  "agent_created",
  "channel_connected",
  "guids_activated",
] as const;
export type ProductEvent = (typeof PRODUCT_EVENTS)[number];

export function isProductEvent(name: unknown): name is ProductEvent {
  return (PRODUCT_EVENTS as readonly unknown[]).includes(name);
}

const AUTH_PREFIXES = [
  "/login",
  "/forgot-password",
  "/reset-password",
  "/auth",
  "/invite",
  "/partner-invite",
];

function under(pathname: string, prefix: string): boolean {
  return pathname === prefix || pathname.startsWith(`${prefix}/`);
}

/** Area of the dashboard a path belongs to. */
export function analyticsArea(pathname: string): AnalyticsArea {
  if (under(pathname, "/platform")) return "platform";
  if (under(pathname, "/admin")) return "admin";
  if (under(pathname, "/app")) return "app";
  if (AUTH_PREFIXES.some((prefix) => under(pathname, prefix))) return "auth";
  return "public";
}

/** A static segment of a route: lowercase words joined by hyphens. */
const STATIC_SEGMENT = /^[a-z]+(?:-[a-z]+)*$/;
const MAX_SEGMENTS = 8;

/**
 * The route of a path with every variable part as `:id`. Only lowercase
 * words survive; ids, tokens, numbers, codes and anything with `@`, digits
 * or uppercase become `:id`. The workspace slug of `/app/<slug>` is always
 * replaced (it may carry a company name), as are the tokens of invitations.
 */
export function analyticsPath(pathname: string): string {
  const clean = pathname.split(/[?#]/)[0] ?? "/";
  const segments = clean.split("/").filter(Boolean).slice(0, MAX_SEGMENTS);
  const out = segments.map((segment, index) => {
    if (index === 1 && segments[0] === "app" && segment !== "account") {
      return ":workspace";
    }
    if (
      index === 1 &&
      (segments[0] === "invite" || segments[0] === "partner-invite")
    ) {
      return ":id";
    }
    return segment.length <= 40 && STATIC_SEGMENT.test(segment)
      ? segment
      : ":id";
  });
  return `/${out.join("/")}`;
}

export type AnalyticsRequest = Readonly<{
  url: string;
  body: string;
  contentType: string;
}>;

/**
 * The provider call for one page view or product event. `origin` is the
 * host the person is on (no path); `distinctId` is PostHog's anonymous id,
 * kept only after consent. PostHog is told not to build person profiles.
 */
export function analyticsRequest(
  input: Readonly<{
    provider: AnalyticsProvider;
    endpoint: string;
    siteId: string;
    origin: string;
    pathname: string;
    event: "pageview" | ProductEvent;
    distinctId: string | null;
  }>,
): AnalyticsRequest | null {
  const area = analyticsArea(input.pathname);
  const url = `${input.origin}${analyticsPath(input.pathname)}`;
  if (input.provider === "plausible") {
    return {
      url: input.endpoint,
      contentType: "text/plain",
      body: JSON.stringify({
        name: input.event,
        url,
        domain: input.siteId,
        props: { area },
      }),
    };
  }
  if (!input.distinctId) return null;
  return {
    url: input.endpoint,
    contentType: "application/json",
    body: JSON.stringify({
      api_key: input.siteId,
      event: input.event === "pageview" ? "$pageview" : input.event,
      distinct_id: input.distinctId,
      properties: {
        $current_url: url,
        $pathname: analyticsPath(input.pathname),
        $process_person_profile: false,
        area,
      },
    }),
  };
}
