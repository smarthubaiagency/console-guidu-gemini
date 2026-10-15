import Link from "next/link";
import { getTranslations } from "next-intl/server";

import { InfoList } from "@/components/settings/info-list";
import { SettingsCard } from "@/components/settings/settings-shell";

/**
 * Autenticação › Cadastro e verificação (CF5b), read only: sign-up only by
 * invitation, e-mail verification always on (the invitation confirms the
 * address) and the second factor, which lives in Segurança.
 */
export async function SignupCard({
  securityHref,
}: Readonly<{ securityHref: string }>) {
  const t = await getTranslations("authSettings.signup");
  return (
    <SettingsCard
      title={t("title")}
      description={t("description")}
      testId="auth-signup"
    >
      <InfoList
        items={[
          {
            label: t("signupLabel"),
            value: t("signupValue"),
            testId: "auth-signup-mode",
          },
          {
            label: t("verificationLabel"),
            value: t("verificationValue"),
            testId: "auth-email-verification",
          },
          {
            label: t("mfaLabel"),
            value: (
              <Link
                href={securityHref}
                className="underline"
                data-testid="auth-mfa-link"
              >
                {t("mfaValue")}
              </Link>
            ),
          },
          { label: t("laterLabel"), value: t("laterValue") },
        ]}
      />
      <p className="text-12 text-text-secondary">{t("note")}</p>
    </SettingsCard>
  );
}
