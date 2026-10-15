import { getFormatter, getTranslations } from "next-intl/server";

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
  type GoogleAppView,
  VERIFICATION_STATUSES,
} from "@/core/integrations/google/apps";
import { GOOGLE_SCOPES } from "@/core/integrations/google/scopes";
import type { PartnerActionState } from "@/core/partners/actions";

type Action = (
  prev: PartnerActionState,
  formData: FormData,
) => Promise<PartnerActionState>;

const scopeKey = (scope: string) => scope.replace(/\./g, "_");

/**
 * Integrações › Google, the OAuth app card (CF6b): Client ID, Client Secret
 * (written, never shown again: only its masked copy), the redirect URI to
 * register at Google (read only, from APP_URL) and the verification status.
 * Shared by /platform and /admin; the partner may also remove its app.
 */
export async function GoogleAppCard({
  view,
  saveAction,
  removeAction,
}: Readonly<{
  view: GoogleAppView;
  saveAction: Action;
  removeAction?: Action;
}>) {
  const t = await getTranslations("integrations");
  const format = await getFormatter();
  const level = view.level;
  const app = view.app;

  return (
    <SettingsCard
      title={t(`google.app.title.${level}`)}
      description={t(`google.app.description.${level}`)}
      testId="google-app"
    >
      <InfoList
        items={[
          {
            label: t("google.app.redirectUri"),
            value: view.redirectUri ?? t("google.app.noRedirect"),
            mono: true,
            testId: "google-redirect-uri",
          },
          {
            label: t("google.app.state"),
            value: app
              ? t("google.app.configured", {
                  date: format.dateTime(app.updatedAt, {
                    dateStyle: "short",
                    timeStyle: "short",
                  }),
                })
              : level === "partner"
                ? t("google.app.usingPlatform")
                : t("google.app.notConfigured"),
            testId: "google-app-state",
          },
          ...(app
            ? [
                {
                  label: t("google.app.secret"),
                  value: app.secretMasked,
                  mono: true,
                  testId: "google-secret-masked",
                },
                {
                  label: t("google.app.verification"),
                  value: (
                    <Badge variant="outline">
                      {t(`google.verification.${app.verificationStatus}`)}
                    </Badge>
                  ),
                  testId: "google-verification",
                },
              ]
            : []),
        ]}
      />
      {view.canEdit ? (
        <ActionForm
          action={saveAction}
          submitLabel={t("google.app.save")}
          className="grid gap-4 sm:max-w-xl"
          testId="google-app-form"
        >
          <div className="grid gap-2">
            <Label htmlFor="google-client-id">{t("google.app.clientId")}</Label>
            <Input
              id="google-client-id"
              name="clientId"
              defaultValue={app?.clientId ?? ""}
              autoComplete="off"
              required
              maxLength={255}
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="google-client-secret">
              {t("google.app.clientSecret")}
            </Label>
            <Input
              id="google-client-secret"
              name="clientSecret"
              type="password"
              autoComplete="new-password"
              placeholder={
                app
                  ? t("google.app.secretKeep", { masked: app.secretMasked })
                  : ""
              }
              required={!app}
              maxLength={512}
            />
            <p className="text-12 text-text-secondary">
              {t("google.app.secretHint")}
            </p>
          </div>
          <div className="grid gap-2">
            <Label htmlFor="google-verification">
              {t("google.app.verification")}
            </Label>
            <NativeSelect
              id="google-verification"
              name="verificationStatus"
              defaultValue={app?.verificationStatus ?? "testing"}
              className="w-full"
            >
              {VERIFICATION_STATUSES.map((status) => (
                <NativeSelectOption key={status} value={status}>
                  {t(`google.verification.${status}`)}
                </NativeSelectOption>
              ))}
            </NativeSelect>
            <p className="text-12 text-text-secondary">
              {t("google.app.verificationHint")}
            </p>
          </div>
        </ActionForm>
      ) : (
        <p className="text-12 text-text-secondary">{t("readOnly")}</p>
      )}
      {view.canEdit && removeAction ? (
        // Always mounted, so the result of a removal still shows.
        <ActionForm
          action={removeAction}
          submitLabel={t("google.app.remove")}
          tone="neutral"
          testId="google-app-remove"
          disabled={!app}
        >
          <p className="text-12 text-text-secondary w-full">
            {t("google.app.removeHint")}
          </p>
        </ActionForm>
      ) : null}
    </SettingsCard>
  );
}

/**
 * The Google scopes offered to the level's customers (CF6b): the platform
 * turns them on; the partner may only turn off what the platform offers.
 */
export async function GoogleScopesCard({
  view,
  action,
}: Readonly<{ view: GoogleAppView; action: Action }>) {
  const t = await getTranslations("integrations");
  const level = view.level;
  return (
    <SettingsCard
      title={t("google.scopes.title")}
      description={t(`google.scopes.description.${level}`)}
      testId="google-scopes"
    >
      {view.canEdit ? (
        <ActionForm
          action={action}
          submitLabel={t("google.scopes.save")}
          className="flex flex-col items-start gap-3"
        >
          {GOOGLE_SCOPES.map((scope) => {
            const offered = view.offeredScopes.includes(scope);
            return (
              <Label
                key={scope}
                className="text-14 items-start gap-2 font-normal"
              >
                <Checkbox
                  name="scopes"
                  value={scope}
                  defaultChecked={offered && view.scopes.includes(scope)}
                  disabled={!offered}
                  data-testid={`google-scope-${scope}`}
                />
                <span>
                  <span className="text-text font-medium">
                    {t(`google.scope.${scopeKey(scope)}.label`)}
                  </span>{" "}
                  <code className="text-11">{scope}</code>
                  <span className="text-12 text-text-secondary block">
                    {offered
                      ? t(`google.scope.${scopeKey(scope)}.description`)
                      : t("google.scopes.notOffered")}
                  </span>
                </span>
              </Label>
            );
          })}
        </ActionForm>
      ) : (
        <ul className="text-14 space-y-1">
          {view.scopes.map((scope) => (
            <li key={scope}>{t(`google.scope.${scopeKey(scope)}.label`)}</li>
          ))}
        </ul>
      )}
    </SettingsCard>
  );
}
