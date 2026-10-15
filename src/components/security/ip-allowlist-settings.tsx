import { getTranslations } from "next-intl/server";

import { ActionForm } from "@/components/partners/action-form";
import { InfoList } from "@/components/settings/info-list";
import { SettingsCard } from "@/components/settings/settings-shell";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import type { PartnerActionState } from "@/core/partners/actions";
import type { AllowlistView } from "@/core/security/ip-allowlist";

type Action = (
  prev: PartnerActionState,
  formData: FormData,
) => Promise<PartnerActionState>;

/**
 * Segurança › Acesso › Lista de IPs (CF5a): optional list of addresses that
 * may enter /platform or the partner's /admin. The saver's own address is
 * shown, and the server refuses a list without it.
 */
export async function IpAllowlistSettings({
  view,
  action,
}: Readonly<{ view: AllowlistView; action: Action }>) {
  const t = await getTranslations("security.ip");
  const level = view.area === "platform" ? "platform" : "partner";

  return (
    <SettingsCard
      title={t(`title.${level}`)}
      description={t(`description.${level}`)}
      testId="security-ip"
    >
      {view.canEdit ? (
        <>
          <InfoList
            items={[
              {
                label: t("state"),
                value:
                  view.entries.length > 0
                    ? t("on", { count: view.entries.length })
                    : t("off"),
                testId: "ip-state",
              },
              {
                label: t("current"),
                value: view.currentIp ?? t("unknown"),
                mono: true,
                testId: "ip-current",
              },
            ]}
          />
          <ActionForm
            action={action}
            submitLabel={t("save")}
            className="flex w-full flex-col items-start gap-3"
          >
            <Label className="w-full flex-col items-start">
              {t("label")}
              <Textarea
                name="entries"
                rows={5}
                maxLength={4000}
                defaultValue={view.entries.join("\n")}
                placeholder={t("placeholder")}
                className="font-mono"
              />
            </Label>
            <p className="text-12 text-text-secondary">{t("hint")}</p>
          </ActionForm>
        </>
      ) : (
        <p className="text-12 text-text-secondary">{t("readOnly")}</p>
      )}
    </SettingsCard>
  );
}
