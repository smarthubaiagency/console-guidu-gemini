import { getLocale, getTranslations } from "next-intl/server";

import { ActionForm } from "@/components/partners/action-form";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  NativeSelect,
  NativeSelectOption,
} from "@/components/ui/native-select";
import type { PartnerActionState } from "@/core/partners/actions";
import {
  CURRENCY_CODES,
  type SettingKey,
  TIME_ZONES,
} from "@/core/settings/catalog";
import type { SettingSource } from "@/core/settings/resolve";
import type { SettingsView } from "@/core/settings/service";

import { SettingsCard } from "./settings-shell";

type Action = (
  prev: PartnerActionState,
  formData: FormData,
) => Promise<PartnerActionState>;

/**
 * Regional defaults of a level (CF1): currency and time zone, and at the
 * platform the currencies offered below. Empty inherits from the level
 * above; the platform and the partner may lock a value for the levels
 * below.
 */
export async function RegionSettings({
  view,
  action,
  hidden = {},
}: Readonly<{
  view: SettingsView;
  action: Action;
  hidden?: Readonly<Record<string, string>>;
}>) {
  const t = await getTranslations("settings");
  const locale = await getLocale();
  const names = new Intl.DisplayNames([locale], { type: "currency" });
  const currencyName = (code: string) => `${code} · ${names.of(code) ?? code}`;
  const canLock = view.level !== "workspace";
  const offered = view.inherited.values["region.currencies"];
  const currencyChoices = view.level === "platform" ? CURRENCY_CODES : offered;

  const source = (from: SettingSource) => t(`region.source.${from}`);
  const lockedBy = (key: SettingKey) => view.inherited.detail[key].lockedBy;
  const ownValue = (key: SettingKey) =>
    view.own[key] && !lockedBy(key) ? view.own[key]!.value : undefined;
  const ownLock = (key: SettingKey) => view.own[key]?.locked ?? false;

  const effectiveCurrency = view.effective.values["region.currency"];
  const effectiveZone = view.effective.values["region.timezone"];

  const summary = (
    <dl className="text-12 text-text-secondary grid gap-1 sm:grid-cols-2">
      <div data-testid="region-effective-currency">
        <dt className="inline">{t("region.currency")}: </dt>
        <dd className="text-text inline font-medium">
          {currencyName(effectiveCurrency)}
        </dd>{" "}
        <span>({source(view.effective.detail["region.currency"].source)})</span>
      </div>
      <div data-testid="region-effective-timezone">
        <dt className="inline">{t("region.timezone")}: </dt>
        <dd className="text-text inline font-medium">{effectiveZone}</dd>{" "}
        <span>({source(view.effective.detail["region.timezone"].source)})</span>
      </div>
    </dl>
  );

  if (!view.canEdit) {
    return (
      <SettingsCard
        title={t("region.title")}
        description={t(`region.description.${view.level}`)}
        testId="region-settings"
      >
        {summary}
      </SettingsCard>
    );
  }

  const lockBox = (key: SettingKey) =>
    canLock ? (
      <Label className="text-12 text-text-secondary gap-2 font-normal">
        <Checkbox name={`lock:${key}`} defaultChecked={ownLock(key)} />
        {t("region.lock")}
      </Label>
    ) : null;

  const lockedNote = (key: SettingKey) => {
    const by = lockedBy(key);
    return by ? (
      <p className="text-12 text-text-secondary" data-testid={`locked-${key}`}>
        {t(`region.lockedBy.${by}`)}
      </p>
    ) : null;
  };

  const inheritLabel = (key: SettingKey, label: string) =>
    view.level === "platform"
      ? t("region.systemDefault", { value: label })
      : t("region.inherit", {
          value: label,
          from: source(view.inherited.detail[key].source),
        });

  return (
    <SettingsCard
      title={t("region.title")}
      description={t(`region.description.${view.level}`)}
      testId="region-settings"
    >
      {summary}
      <ActionForm
        action={action}
        submitLabel={t("region.save")}
        className="flex flex-col items-start gap-4"
      >
        {Object.entries(hidden).map(([name, value]) => (
          <input key={name} type="hidden" name={name} value={value} />
        ))}

        <div className="grid w-full gap-4 sm:grid-cols-2 sm:items-start">
          {view.level === "platform" ? (
            <div className="space-y-1 sm:col-span-2">
              <input type="hidden" name="present:region.currencies" value="1" />
              <Label className="flex-col items-start">
                {t("region.currencies")}
                <Input
                  name="value:region.currencies"
                  defaultValue={
                    (
                      ownValue("region.currencies") as string[] | undefined
                    )?.join(", ") ?? ""
                  }
                  placeholder={offered.join(", ")}
                  className="w-full"
                />
              </Label>
              <p className="text-12 text-text-secondary">
                {t("region.currenciesHint")}
              </p>
            </div>
          ) : null}

          <div className="space-y-2">
            <input type="hidden" name="present:region.currency" value="1" />
            <Label className="flex-col items-start">
              {t("region.currency")}
              <NativeSelect
                name="value:region.currency"
                defaultValue={(ownValue("region.currency") as string) ?? ""}
                disabled={Boolean(lockedBy("region.currency"))}
                className="w-full"
              >
                <NativeSelectOption value="">
                  {inheritLabel(
                    "region.currency",
                    currencyName(view.inherited.values["region.currency"]),
                  )}
                </NativeSelectOption>
                {currencyChoices.map((code) => (
                  <NativeSelectOption key={code} value={code}>
                    {currencyName(code)}
                  </NativeSelectOption>
                ))}
              </NativeSelect>
            </Label>
            {lockedNote("region.currency") ?? lockBox("region.currency")}
          </div>

          <div className="space-y-2">
            <input type="hidden" name="present:region.timezone" value="1" />
            <Label className="flex-col items-start">
              {t("region.timezone")}
              <NativeSelect
                name="value:region.timezone"
                defaultValue={(ownValue("region.timezone") as string) ?? ""}
                disabled={Boolean(lockedBy("region.timezone"))}
                className="w-full"
              >
                <NativeSelectOption value="">
                  {inheritLabel(
                    "region.timezone",
                    view.inherited.values["region.timezone"],
                  )}
                </NativeSelectOption>
                {TIME_ZONES.map((zone) => (
                  <NativeSelectOption key={zone} value={zone}>
                    {zone}
                  </NativeSelectOption>
                ))}
              </NativeSelect>
            </Label>
            {lockedNote("region.timezone") ?? lockBox("region.timezone")}
          </div>
        </div>
      </ActionForm>
    </SettingsCard>
  );
}
