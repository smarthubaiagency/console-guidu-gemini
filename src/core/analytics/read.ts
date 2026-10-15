import "server-only";

import { cache } from "react";

import { getRequestPartner } from "@/core/partners/resolve";

import { type AnalyticsClientConfig, analyticsClientConfig } from "./config";
import { cachedAnalyticsValues } from "./values";

export { clearAnalyticsCache } from "./values";

/** Browser configuration of the request host, once per request. */
export const requestAnalytics = cache(
  async (): Promise<AnalyticsClientConfig | null> => {
    try {
      const partner = await getRequestPartner();
      if (!partner) return null;
      const values = await cachedAnalyticsValues(
        partner.isPlatformHost ? null : partner.partnerId,
      );
      return values
        ? analyticsClientConfig(values, {
            partnerOwn: !partner.isPlatformHost,
            production: process.env.NODE_ENV === "production",
          })
        : null;
    } catch {
      return null;
    }
  },
);
