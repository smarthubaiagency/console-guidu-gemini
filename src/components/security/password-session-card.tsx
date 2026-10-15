import { getTranslations } from "next-intl/server";

import { InfoList } from "@/components/settings/info-list";
import { SettingsCard } from "@/components/settings/settings-shell";

/**
 * Segurança › Senha e sessão (CF5a), read only: these rules live in the
 * Supabase Auth configuration of the project, not in this dashboard.
 * Changing them touches Auth and needs approval, so the page only says
 * where they are.
 */
export async function PasswordSessionCard() {
  const t = await getTranslations("security.password");
  const auth = t("inAuth");
  return (
    <SettingsCard
      title={t("title")}
      description={t("description")}
      testId="security-password"
    >
      <InfoList
        items={[
          { label: t("rules"), value: auth },
          { label: t("leaked"), value: auth },
          { label: t("session"), value: auth },
          { label: t("attempts"), value: auth },
          { label: t("https"), value: t("httpsValue") },
          { label: t("emailCheck"), value: t("emailCheckValue") },
        ]}
      />
      <p className="text-12 text-text-secondary">{t("note")}</p>
    </SettingsCard>
  );
}
