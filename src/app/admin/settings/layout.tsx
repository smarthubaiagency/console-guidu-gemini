import { getTranslations } from "next-intl/server";

import { SettingsShell } from "@/components/settings/settings-shell";
import { requirePartnerConsolePage } from "@/core/auth/page-guard";
import { translateNavigation } from "@/core/i18n/navigation";
import { partnerGrants } from "@/core/module-runtime/loaders";
import { buildPartnerSettingsNavigation } from "@/core/module-runtime/navigation";

/** Admin › Configurações (CF1): submenu card and content cards. */
export default async function PartnerSettingsLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const { membership } = await requirePartnerConsolePage("/admin/settings");
  const t = await getTranslations("settings");
  const sections = translateNavigation(
    buildPartnerSettingsNavigation(partnerGrants(membership.role)),
    "partner",
    await getTranslations("nav"),
  );
  return (
    <SettingsShell label={t("navLabel")} sections={sections}>
      {children}
    </SettingsShell>
  );
}
