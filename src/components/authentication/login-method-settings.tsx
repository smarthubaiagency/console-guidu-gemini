import { getTranslations } from "next-intl/server";

import { ActionForm } from "@/components/partners/action-form";
import { InfoList } from "@/components/settings/info-list";
import { SettingsCard } from "@/components/settings/settings-shell";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import type { LoginMethods } from "@/core/auth/login-methods";
import {
  LOGIN_METHOD_KEYS,
  type LoginMethodKey,
} from "@/core/auth/login-method-input";
import type { PartnerActionState } from "@/core/partners/actions";
import type { SettingsView } from "@/core/settings/service";

type Action = (
  prev: PartnerActionState,
  formData: FormData,
) => Promise<PartnerActionState>;

/**
 * Autenticação › Google or link by e-mail (CF5b). The platform offers the
 * method; the partner may hide it on its hosts. The login page shows the
 * button only when the provider is also on in Supabase Auth, which
 * operations declares in the environment (docs/operacao/autenticacao.md).
 */
export async function LoginMethodSettings({
  method,
  view,
  providers,
  action,
}: Readonly<{
  method: LoginMethodKey;
  view: SettingsView;
  providers: LoginMethods;
  action: Action;
}>) {
  const t = await getTranslations("authSettings");
  const key = LOGIN_METHOD_KEYS[method];
  const level = view.level === "platform" ? "platform" : "partner";
  const provider = providers[method];
  const offeredAbove = view.inherited.values[key] === true;
  const lockedBy = view.inherited.detail[key].lockedBy;
  const effective = view.effective.values[key] === true;
  const visible = provider && effective;
  const own = view.own[key]?.value;
  const checked = level === "platform" ? own === true : own !== false;
  const testId = method === "google" ? "auth-google" : "auth-magic-link";

  return (
    <SettingsCard
      title={t(`${method}.title`)}
      description={t(`${method}.description.${level}`)}
      testId={testId}
    >
      <InfoList
        items={[
          {
            label: t("provider.label"),
            value: provider ? t("provider.on") : t("provider.off"),
            testId: `${testId}-provider`,
          },
          ...(level === "partner"
            ? [
                {
                  label: t("offered.label"),
                  value: offeredAbove ? t("offered.yes") : t("offered.no"),
                  testId: `${testId}-offered`,
                },
              ]
            : []),
          {
            label: t(`visible.label.${level}`),
            value: visible ? t("visible.yes") : t("visible.no"),
            testId: `${testId}-visible`,
          },
          ...(method === "google" && level === "platform"
            ? [{ label: t("google.ownerLabel"), value: t("google.owner") }]
            : []),
        ]}
      />
      {view.canEdit ? (
        <ActionForm
          action={action}
          submitLabel={t("save")}
          className="flex flex-col items-start gap-3"
        >
          <input type="hidden" name="method" value={method} />
          <Label className="text-14 gap-2 font-normal">
            <Checkbox
              name="enabled"
              defaultChecked={!lockedBy && checked}
              disabled={Boolean(lockedBy)}
            />
            {t(`${method}.toggle.${level}`)}
          </Label>
          {lockedBy ? (
            <p
              className="text-12 text-text-secondary"
              data-testid={`${testId}-locked`}
            >
              {t("notOffered")}
            </p>
          ) : null}
          {!provider ? (
            <p className="text-12 text-text-secondary">
              {t(`providerHint.${level}`)}
            </p>
          ) : null}
        </ActionForm>
      ) : (
        <p className="text-12 text-text-secondary">{t("readOnly")}</p>
      )}
    </SettingsCard>
  );
}
