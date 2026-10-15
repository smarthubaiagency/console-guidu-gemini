import { getTranslations } from "next-intl/server";

import { ActionForm } from "@/components/partners/action-form";
import { InfoList } from "@/components/settings/info-list";
import { SettingsCard } from "@/components/settings/settings-shell";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import type { PartnerActionState } from "@/core/partners/actions";
import type { SettingsView } from "@/core/settings/service";

type Action = (
  prev: PartnerActionState,
  formData: FormData,
) => Promise<PartnerActionState>;

const KEY = "security.mfa.app";

/**
 * Segurança › Acesso › MFA (CF5a). /platform and /admin always require the
 * second factor; the workspaces (/app) require it when the platform, the
 * partner or the workspace asks. A level above that requires it keeps the
 * switch on and disabled below.
 */
export async function MfaSettings({
  view,
  action,
  hidden,
  saverHasMfa = true,
}: Readonly<{
  view: SettingsView;
  action: Action;
  hidden?: Readonly<Record<string, string>>;
  /** The workspace may only require it once the saver has it (CF5a). */
  saverHasMfa?: boolean;
}>) {
  const t = await getTranslations("security.mfa");
  const level = view.level;
  const lockedBy = view.inherited.detail[KEY].lockedBy;
  const required = view.effective.values[KEY] === true;
  const own = view.own[KEY]?.value === true;
  const source = view.effective.detail[KEY].source;

  const appState = !required
    ? t("optional")
    : source === "platform" || source === "partner"
      ? t(`requiredBy.${source}`)
      : t("required");

  return (
    <SettingsCard
      title={t("title")}
      description={t(`description.${level}`)}
      testId="security-mfa"
    >
      <InfoList
        items={[
          ...(level === "workspace"
            ? []
            : [
                {
                  label: t("areas.platform"),
                  value: t("always"),
                  testId: "mfa-area-platform",
                },
                {
                  label: t("areas.admin"),
                  value: t("always"),
                  testId: "mfa-area-admin",
                },
              ]),
          {
            label: t(level === "workspace" ? "areas.team" : "areas.app"),
            value: appState,
            testId: "mfa-area-app",
          },
        ]}
      />
      {view.canEdit ? (
        <ActionForm
          action={action}
          submitLabel={t("save")}
          className="flex flex-col items-start gap-3"
        >
          {Object.entries(hidden ?? {}).map(([name, value]) => (
            <input key={name} type="hidden" name={name} value={value} />
          ))}
          <Label className="text-14 gap-2 font-normal">
            <Checkbox
              name="mfaApp"
              defaultChecked={Boolean(lockedBy) || own}
              disabled={Boolean(lockedBy)}
            />
            {t(`toggle.${level}`)}
          </Label>
          {lockedBy ? (
            <p className="text-12 text-text-secondary">
              {t(`lockedBy.${lockedBy as "platform" | "partner"}`)}
            </p>
          ) : null}
          {!saverHasMfa && !lockedBy ? (
            <p
              className="text-12 text-text-secondary"
              data-testid="mfa-saver-missing"
            >
              {t("saverMissing")}
            </p>
          ) : null}
          <p className="text-12 text-text-secondary">{t("hint")}</p>
        </ActionForm>
      ) : (
        <p className="text-12 text-text-secondary">{t("readOnly")}</p>
      )}
    </SettingsCard>
  );
}
