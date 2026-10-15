"use client";

import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";
import { useCallback, useEffect, useRef, useSyncExternalStore } from "react";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import type { AnalyticsClientConfig } from "@/core/analytics/config";
import {
  analyticsArea,
  analyticsRequest,
  isProductEvent,
  type ProductEvent,
} from "@/core/analytics/privacy";
import { PRODUCT_EVENT_NAME } from "@/core/analytics/track";

/**
 * Product analytics in the browser (CF7). Sends one page view per route
 * (and the product events) to each site of the host whose areas include
 * the current one, with only the area and the route (`analyticsRequest`).
 * PostHog keeps an anonymous id in the browser, so nothing goes out until
 * the person accepts; Plausible keeps nothing and needs no consent. Outside
 * production each event is also written to the console.
 */

const CONSENT_KEY = "guidu.analytics.consent";
const ID_KEY = "guidu.analytics.id";

/** "unknown" on the server and before hydration: nothing renders or goes out. */
type Consent = "granted" | "denied" | null | "unknown";

function readStorage(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeStorage(key: string, value: string): void {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // Private windows may refuse; the choice then lasts for the page.
  }
}

const listeners = new Set<() => void>();

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  window.addEventListener("storage", listener);
  return () => {
    listeners.delete(listener);
    window.removeEventListener("storage", listener);
  };
}

function consentSnapshot(): Consent {
  const saved = readStorage(CONSENT_KEY);
  return saved === "granted" || saved === "denied" ? saved : null;
}

function serverSnapshot(): Consent {
  return "unknown";
}

function decide(value: "granted" | "denied"): void {
  writeStorage(CONSENT_KEY, value);
  for (const listener of listeners) listener();
}

function anonymousId(): string {
  const saved = readStorage(ID_KEY);
  if (saved) return saved;
  const id = crypto.randomUUID();
  writeStorage(ID_KEY, id);
  return id;
}

export function ProductAnalytics({
  config,
}: Readonly<{ config: AnalyticsClientConfig }>) {
  const t = useTranslations("analytics.consent");
  const pathname = usePathname();
  const consent = useSyncExternalStore(
    subscribe,
    consentSnapshot,
    serverSnapshot,
  );
  const ready = consent !== "unknown";
  const lastPath = useRef<string | null>(null);

  const allowed = !config.requiresConsent || consent === "granted";

  const send = useCallback(
    (path: string, event: "pageview" | ProductEvent) => {
      const area = analyticsArea(path);
      const distinctId = config.requiresConsent ? anonymousId() : null;
      for (const site of config.sites) {
        if (!site.areas.includes(area)) continue;
        const request = analyticsRequest({
          provider: config.provider,
          endpoint: config.endpoint,
          siteId: site.siteId,
          origin: window.location.origin,
          pathname: path,
          event,
          distinctId,
        });
        if (!request) continue;
        if (config.debug) {
          console.debug("[analytics]", site.owner, request.body);
        }
        void fetch(request.url, {
          method: "POST",
          headers: { "content-type": request.contentType },
          body: request.body,
          keepalive: true,
          credentials: "omit",
          referrerPolicy: "no-referrer",
        }).catch(() => undefined);
      }
    },
    [config],
  );

  useEffect(() => {
    if (!ready || !allowed || !pathname) return;
    if (lastPath.current === pathname) return;
    lastPath.current = pathname;
    send(pathname, "pageview");
  }, [ready, allowed, pathname, send]);

  useEffect(() => {
    if (!ready || !allowed) return;
    const listener = (event: Event) => {
      const name = (event as CustomEvent<{ name?: unknown }>).detail?.name;
      if (isProductEvent(name)) send(window.location.pathname, name);
    };
    window.addEventListener(PRODUCT_EVENT_NAME, listener);
    return () => window.removeEventListener(PRODUCT_EVENT_NAME, listener);
  }, [ready, allowed, send]);

  if (!ready || !config.requiresConsent || consent !== null) return null;

  return (
    <Card
      role="region"
      aria-label={t("title")}
      data-testid="analytics-consent"
      className="fixed inset-x-4 bottom-4 z-50 mx-auto max-w-lg gap-3 py-4 shadow-lg"
    >
      <CardHeader className="px-4">
        <CardTitle className="text-14">{t("title")}</CardTitle>
        <CardDescription className="text-12">
          {t("description")}
        </CardDescription>
      </CardHeader>
      <CardContent className="px-4">
        <p className="text-12 text-text-secondary">{t("noPersonalData")}</p>
      </CardContent>
      <CardFooter className="flex justify-end gap-2 px-4">
        <Button variant="outline" size="sm" onClick={() => decide("denied")}>
          {t("decline")}
        </Button>
        <Button size="sm" onClick={() => decide("granted")}>
          {t("accept")}
        </Button>
      </CardFooter>
    </Card>
  );
}
