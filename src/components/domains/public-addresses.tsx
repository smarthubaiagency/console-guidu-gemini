import { getTranslations } from "next-intl/server";

import { Badge } from "@/components/ui/badge";
import type { PublicAddress } from "@/core/domains/public-service";

/**
 * Default address of each public route type for a workspace (CF2c):
 * `{workspace slug}.{default domain}`, on the partner's domain when it
 * replaced the platform's. It never counts in the plan's domain quota.
 */
export async function PublicAddresses({
  addresses,
}: Readonly<{ addresses: readonly PublicAddress[] }>) {
  const t = await getTranslations("domains");
  return (
    <ul
      className="border-card-border divide-border divide-y rounded-lg border"
      data-testid="public-addresses"
    >
      {addresses.map((address) => (
        <li
          key={address.routeType}
          className="flex flex-wrap items-center gap-2 p-4"
          data-testid="public-address"
          data-route-type={address.routeType}
        >
          <span className="text-14 text-text w-40 font-medium">
            {t(`routeTypes.${address.routeType}`)}
          </span>
          {address.host ? (
            <span
              className="text-14 text-text font-mono break-all"
              data-testid="public-address-host"
            >
              {address.host}
            </span>
          ) : (
            <span className="text-12 text-text-secondary">
              {address.base ? t("addresses.unavailable") : t("addresses.off")}
            </span>
          )}
          {address.host ? (
            <Badge variant="outline">
              {address.source === "partner"
                ? t("addresses.partner")
                : t("addresses.platform")}
            </Badge>
          ) : null}
        </li>
      ))}
    </ul>
  );
}
