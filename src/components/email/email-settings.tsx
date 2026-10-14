import { getTranslations } from "next-intl/server";

import { ActionForm } from "@/components/partners/action-form";
import { InfoList } from "@/components/settings/info-list";
import { SettingsCard } from "@/components/settings/settings-shell";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { fromHeader } from "@/core/notifications/transport";
import type { PartnerActionState } from "@/core/partners/actions";
import type { SettingKey } from "@/core/settings/catalog";
import type { SettingsView } from "@/core/settings/service";

type Action = (
  prev: PartnerActionState,
  formData: FormData,
) => Promise<PartnerActionState>;

const KEYS = ["email.from_name", "email.reply_to"] as const;

/**
 * Configurações › E-mail › Envio (CF3a), at the platform and the partner:
 * the provider state, the sender of the level (empty inherits, and the
 * brand fills what nobody set) and a test e-mail to the signed-in person.
 */
export async function EmailSettings({
  view,
  saveAction,
  testAction,
  brand,
  fromAddress,
  canTest,
}: Readonly<{
  view: SettingsView;
  saveAction: Action;
  testAction: Action;
  brand: Readonly<{ name: string; supportEmail: string | null }>;
  /** The platform's sending address, or null while e-mail is off. */
  fromAddress: string | null;
  canTest: boolean;
}>) {
  const t = await getTranslations("email");
  const level = view.level === "platform" ? "platform" : "partner";

  const effective = (key: SettingKey) =>
    view.effective.values[key] as string | null;
  const inherited = (key: SettingKey) =>
    view.inherited.values[key] as string | null;
  const lockedBy = (key: SettingKey) => view.inherited.detail[key].lockedBy;
  const own = (key: SettingKey) =>
    view.own[key] && !lockedBy(key) ? (view.own[key]!.value as string) : "";

  const fromName = effective("email.from_name") ?? brand.name;
  const replyTo = effective("email.reply_to") ?? brand.supportEmail;
  const placeholder = {
    "email.from_name": inherited("email.from_name") ?? brand.name,
    "email.reply_to":
      inherited("email.reply_to") ?? brand.supportEmail ?? t("sender.none"),
  };

  return (
    <>
      <SettingsCard
        title={t("provider.title")}
        description={t(`provider.description.${level}`)}
        testId="email-provider"
      >
        <InfoList
          items={[
            {
              label: t("provider.state"),
              value: fromAddress ? t("provider.on") : t("provider.off"),
              testId: "email-state",
            },
            {
              label: t("provider.from"),
              value: fromAddress ? fromHeader(fromName, fromAddress) : fromName,
              mono: true,
              testId: "email-from",
            },
            {
              label: t("provider.replyTo"),
              value: replyTo ?? "-",
              mono: true,
              testId: "email-reply-to",
            },
          ]}
        />
        {fromAddress ? null : (
          <p
            className="text-12 text-text-secondary"
            data-testid="email-provider-off"
          >
            {t("provider.offHint")}
          </p>
        )}
        {canTest ? (
          <ActionForm
            action={testAction}
            submitLabel={t("test.send")}
            tone="neutral"
            disabled={!fromAddress}
            testId="email-test"
          />
        ) : null}
      </SettingsCard>

      <SettingsCard
        title={t("sender.title")}
        description={t(`sender.description.${level}`)}
        testId="email-sender"
      >
        {view.canEdit ? (
          <ActionForm
            action={saveAction}
            submitLabel={t("sender.save")}
            className="flex flex-col items-start gap-4"
          >
            <div className="grid w-full gap-4 sm:grid-cols-2 sm:items-start">
              {KEYS.map((key) => (
                <div key={key} className="space-y-2">
                  <input type="hidden" name={`present:${key}`} value="1" />
                  <Label className="flex-col items-start">
                    {t(
                      `sender.${key === "email.from_name" ? "fromName" : "replyTo"}`,
                    )}
                    <Input
                      name={`value:${key}`}
                      type={key === "email.reply_to" ? "email" : "text"}
                      maxLength={key === "email.reply_to" ? 254 : 80}
                      defaultValue={own(key)}
                      placeholder={placeholder[key]}
                      disabled={Boolean(lockedBy(key))}
                      className="w-full"
                    />
                  </Label>
                  {lockedBy(key) ? (
                    <p className="text-12 text-text-secondary">
                      {t(`sender.lockedBy.${lockedBy(key) as "platform"}`)}
                    </p>
                  ) : (
                    <Label className="text-12 text-text-secondary gap-2 font-normal">
                      <Checkbox
                        name={`lock:${key}`}
                        defaultChecked={view.own[key]?.locked ?? false}
                      />
                      {t("sender.lock")}
                    </Label>
                  )}
                </div>
              ))}
            </div>
            <p className="text-12 text-text-secondary">{t("sender.hint")}</p>
          </ActionForm>
        ) : (
          <p className="text-12 text-text-secondary">{t("sender.readOnly")}</p>
        )}
      </SettingsCard>
    </>
  );
}
