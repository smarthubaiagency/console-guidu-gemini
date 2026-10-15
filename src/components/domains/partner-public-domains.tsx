import { getTranslations } from "next-intl/server";

import { ActionForm } from "@/components/partners/action-form";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  NativeSelect,
  NativeSelectOption,
} from "@/components/ui/native-select";
import {
  addPartnerPublicDomainAction,
  verifyPartnerPublicDomainAction,
} from "@/core/domains/actions";
import {
  PUBLIC_ROUTE_TYPES,
  type PublicRouteType,
} from "@/core/domains/public-hosts";
import type { PartnerPublicDomainView } from "@/core/domains/public-service";

import { RemoveDomainButton } from "./remove-domain-button";

/** `last_error` codes of a default domain check with a message (CF2c). */
const CHECK_MESSAGES = new Set([
  "not_configured",
  "dns_pending",
  "wildcard_pending",
]);

/**
 * Default domain of each public route type for the partner's customers
 * (CF2c): the platform's, or the partner's own once active. Owners and
 * admins add one per type, point the domain and its wildcard to the proxy,
 * verify and remove it. The house partner uses the platform's domains.
 */
export async function PartnerPublicDomains({
  domains,
  platformBases,
  canManage,
  isHouse,
  cnameTarget,
}: Readonly<{
  domains: readonly PartnerPublicDomainView[];
  platformBases: Readonly<Record<PublicRouteType, string | null>>;
  canManage: boolean;
  isHouse: boolean;
  cnameTarget: string | null;
}>) {
  const t = await getTranslations("domains");
  const free = PUBLIC_ROUTE_TYPES.filter(
    (type) => !domains.some((domain) => domain.routeType === type),
  );

  return (
    <>
      <ul
        className="border-card-border divide-border divide-y rounded-lg border"
        data-testid="public-bases"
      >
        {PUBLIC_ROUTE_TYPES.map((type) => {
          const own = domains.find((domain) => domain.routeType === type);
          const platform = platformBases[type];
          return (
            <li
              key={type}
              className="space-y-3 p-4"
              data-testid="public-base"
              data-route-type={type}
            >
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-14 text-text w-40 font-medium">
                  {t(`routeTypes.${type}`)}
                </span>
                <span className="text-12 text-text-secondary">
                  {platform
                    ? t("bases.platformDefault", { host: platform })
                    : t("bases.platformOff")}
                </span>
              </div>
              {own ? (
                <div className="space-y-3" data-host={own.host}>
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-14 text-text font-mono font-medium break-all">
                      {own.host}
                    </span>
                    <Badge
                      variant={
                        own.status === "active" ? "default" : "secondary"
                      }
                      data-testid="public-base-status"
                    >
                      {t(`status.${own.status}` as "status.pending")}
                    </Badge>
                    <span className="text-12 text-text-secondary">
                      {t("bases.example", { host: `workspace.${own.host}` })}
                    </span>
                  </div>
                  {own.status === "pending" ? (
                    <div className="bg-surface-raised text-12 text-text-secondary space-y-1 rounded-md p-3">
                      <p className="text-text font-medium">
                        {t("instructions.title")}
                      </p>
                      <p data-testid="public-base-instructions">
                        {cnameTarget
                          ? t("bases.instructions", {
                              host: own.host,
                              target: cnameTarget,
                            })
                          : t("instructions.noTarget")}
                      </p>
                      <p>{t("bases.certificate")}</p>
                      {own.lastError && CHECK_MESSAGES.has(own.lastError) ? (
                        <p data-testid="public-base-last-check">
                          {t(`messages.${own.lastError}` as "messages.active")}
                        </p>
                      ) : null}
                    </div>
                  ) : null}
                  {canManage ? (
                    <div className="flex flex-wrap items-center gap-2">
                      {own.status === "pending" ? (
                        <ActionForm
                          action={verifyPartnerPublicDomainAction}
                          submitLabel={t("form.verify")}
                          testId="public-base-verify"
                        >
                          <input type="hidden" name="domainId" value={own.id} />
                        </ActionForm>
                      ) : null}
                      <RemoveDomainButton
                        kind="base"
                        fields={{ domainId: own.id }}
                        labels={{
                          remove: t("form.remove"),
                          title: t("form.removeTitle", { host: own.host }),
                          message: t("bases.removeMessage"),
                          cancel: t("form.cancel"),
                        }}
                      />
                    </div>
                  ) : null}
                </div>
              ) : null}
            </li>
          );
        })}
      </ul>
      {isHouse ? (
        <p className="text-12 text-text-secondary">{t("bases.house")}</p>
      ) : !canManage ? (
        <p className="text-12 text-text-secondary">{t("bases.readOnly")}</p>
      ) : free.length > 0 ? (
        <ActionForm
          action={addPartnerPublicDomainAction}
          submitLabel={t("form.add")}
          className="grid items-end gap-3 sm:grid-cols-3"
          testId="add-public-base"
        >
          <Label className="flex-col items-start">
            {t("bases.routeType")}
            <NativeSelect name="routeType" required className="w-full">
              {free.map((type) => (
                <NativeSelectOption key={type} value={type}>
                  {t(`routeTypes.${type}`)}
                </NativeSelectOption>
              ))}
            </NativeSelect>
          </Label>
          <Label className="flex-col items-start">
            {t("form.host")}
            <Input
              name="host"
              required
              maxLength={200}
              placeholder={t("bases.hostPlaceholder")}
            />
          </Label>
        </ActionForm>
      ) : null}
    </>
  );
}
