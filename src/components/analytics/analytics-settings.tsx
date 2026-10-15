import { getTranslations } from "next-intl/server";

import { ActionForm } from "@/components/partners/action-form";
import { InfoList } from "@/components/settings/info-list";
import { SettingsCard } from "@/components/settings/settings-shell";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  NativeSelect,
  NativeSelectOption,
} from "@/components/ui/native-select";
import {
  savePartnerAnalyticsAction,
  savePlatformAnalyticsAction,
} from "@/core/analytics/actions";
import {
  ANALYTICS_PROVIDERS,
  POSTHOG_REGIONS,
  providerOrigin,
  requiresConsent,
} from "@/core/analytics/config";
import { PRODUCT_EVENTS } from "@/core/analytics/privacy";
import type { SettingsView } from "@/core/settings/service";

/**
 * Configurações › Analytics (CF7). The platform picks the provider, its
 * identifier and the switch (off by default, D-PA-06); the partner may add
 * its own identifier for its brand, which only works while the platform's
 * switch is on.
 */

function values(view: SettingsView) {
  const v = view.effective.values;
  return {
    enabled: v["analytics.enabled"],
    provider: v["analytics.provider"],
    siteId: v["analytics.site_id"],
    region: v["analytics.posthog_region"],
    partnerEnabled: v["analytics.partner_enabled"],
    partnerSiteId: v["analytics.partner_site_id"],
  };
}

export async function PlatformAnalyticsCard({
  view,
}: Readonly<{ view: SettingsView }>) {
  const t = await getTranslations("analytics");
  const current = values(view);
  return (
    <SettingsCard
      title={t("platform.title")}
      description={t("platform.description")}
      testId="analytics-platform"
    >
      <InfoList
        items={[
          {
            label: t("status.label"),
            value: current.enabled ? t("status.on") : t("status.off"),
            testId: "analytics-status",
          },
          {
            label: t("csp.label"),
            value: current.enabled
              ? providerOrigin(current.provider, current.region)
              : t("csp.none"),
            mono: true,
            testId: "analytics-csp",
          },
        ]}
      />
      <p className="text-12 text-text-secondary">{t("lgpd")}</p>
      {view.canEdit ? (
        <ActionForm
          action={savePlatformAnalyticsAction}
          submitLabel={t("save")}
          className="flex flex-col items-start gap-4"
        >
          <Label className="text-14 gap-2 font-normal">
            <Checkbox name="enabled" defaultChecked={current.enabled} />
            {t("platform.toggle")}
          </Label>
          <div className="grid w-full gap-4 sm:grid-cols-2">
            <div className="space-y-1">
              <Label htmlFor="analytics-provider" className="text-12">
                {t("provider.label")}
              </Label>
              <NativeSelect
                id="analytics-provider"
                name="provider"
                className="w-full"
                defaultValue={current.provider}
              >
                {ANALYTICS_PROVIDERS.map((id) => (
                  <NativeSelectOption key={id} value={id}>
                    {t(`provider.${id}`)}
                  </NativeSelectOption>
                ))}
              </NativeSelect>
            </div>
            <div className="space-y-1">
              <Label htmlFor="analytics-region" className="text-12">
                {t("region.label")}
              </Label>
              <NativeSelect
                id="analytics-region"
                name="region"
                className="w-full"
                defaultValue={current.region}
              >
                {POSTHOG_REGIONS.map((id) => (
                  <NativeSelectOption key={id} value={id}>
                    {t(`region.${id}`)}
                  </NativeSelectOption>
                ))}
              </NativeSelect>
            </div>
          </div>
          <div className="w-full space-y-1">
            <Label htmlFor="analytics-site" className="text-12">
              {t("site.label")}
            </Label>
            <Input
              id="analytics-site"
              name="siteId"
              maxLength={100}
              autoComplete="off"
              defaultValue={current.siteId ?? ""}
            />
            <p className="text-11 text-text-secondary">{t("site.hint")}</p>
          </div>
        </ActionForm>
      ) : (
        <p className="text-12 text-text-secondary">{t("readOnly")}</p>
      )}
    </SettingsCard>
  );
}

/** What goes out, for whoever reviews the LGPD (no form). */
export async function AnalyticsRulesCard({
  view,
}: Readonly<{ view: SettingsView }>) {
  const t = await getTranslations("analytics");
  const current = values(view);
  return (
    <SettingsCard
      title={t("rules.title")}
      description={t("rules.description")}
      testId="analytics-rules"
    >
      <ul className="text-12 text-text-secondary list-disc space-y-1 pl-5">
        <li>{t("rules.data")}</li>
        <li>{t("rules.never")}</li>
        <li>
          {requiresConsent(current.provider)
            ? t("rules.consentPosthog")
            : t("rules.consentPlausible")}
        </li>
        <li>{t("rules.debug")}</li>
      </ul>
      <div className="space-y-2">
        <p className="text-12 text-text font-medium">{t("rules.events")}</p>
        <div className="flex flex-wrap gap-2">
          {PRODUCT_EVENTS.map((event) => (
            <Badge key={event} variant="outline">
              {t(`events.${event}`)}
            </Badge>
          ))}
        </div>
      </div>
    </SettingsCard>
  );
}

export async function PartnerAnalyticsCard({
  view,
}: Readonly<{ view: SettingsView }>) {
  const t = await getTranslations("analytics");
  const current = values(view);
  return (
    <SettingsCard
      title={t("partner.title")}
      description={t("partner.description")}
      testId="analytics-partner"
    >
      <InfoList
        items={[
          {
            label: t("partner.platformStatus"),
            value: current.enabled
              ? t("partner.platformOn", {
                  provider: t(`providerName.${current.provider}`),
                })
              : t("status.off"),
            testId: "analytics-platform-status",
          },
          {
            label: t("partner.sending"),
            value:
              current.enabled && current.partnerEnabled && current.partnerSiteId
                ? t("partner.sendingYes")
                : t("partner.sendingNo"),
            testId: "analytics-partner-sending",
          },
        ]}
      />
      {!current.enabled ? (
        <p
          className="text-12 text-text-secondary"
          data-testid="analytics-platform-off"
        >
          {t("partner.platformOffHint")}
        </p>
      ) : null}
      {view.canEdit ? (
        <ActionForm
          action={savePartnerAnalyticsAction}
          submitLabel={t("save")}
          className="flex flex-col items-start gap-4"
        >
          <Label className="text-14 gap-2 font-normal">
            <Checkbox name="enabled" defaultChecked={current.partnerEnabled} />
            {t("partner.toggle")}
          </Label>
          <div className="w-full space-y-1">
            <Label htmlFor="analytics-partner-site" className="text-12">
              {t("partner.siteLabel", {
                provider: t(`providerName.${current.provider}`),
              })}
            </Label>
            <Input
              id="analytics-partner-site"
              name="siteId"
              maxLength={100}
              autoComplete="off"
              defaultValue={current.partnerSiteId ?? ""}
            />
            <p className="text-11 text-text-secondary">{t("site.hint")}</p>
          </div>
        </ActionForm>
      ) : (
        <p className="text-12 text-text-secondary">{t("readOnly")}</p>
      )}
    </SettingsCard>
  );
}
