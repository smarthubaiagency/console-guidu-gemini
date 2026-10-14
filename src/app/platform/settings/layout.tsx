import { getTranslations } from "next-intl/server";

import { SettingsShell } from "@/components/settings/settings-shell";
import { getPlatformAdminMember } from "@/core/admin/platform";
import { requirePlatformAdminPage } from "@/core/auth/page-guard";
import { getModuleCatalog } from "@/core/i18n/modules";
import { translateNavigation } from "@/core/i18n/navigation";
import { loadPlatformSettingsNavigation } from "@/core/module-runtime/loaders";
import { prisma } from "@/lib/prisma/client";

/** Plataforma › Configurações (CF1): submenu card and content cards. */
export default async function PlatformSettingsLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const identity = await requirePlatformAdminPage("/platform/settings");
  const admin = await getPlatformAdminMember(prisma, identity.userId);
  const role = admin?.status === "active" ? admin.role : null;
  const t = await getTranslations("settings");
  const sections = translateNavigation(
    loadPlatformSettingsNavigation(role),
    "platform",
    await getTranslations("nav"),
    (await getModuleCatalog()).entryLabel,
  );
  return (
    <SettingsShell label={t("navLabel")} sections={sections}>
      {children}
    </SettingsShell>
  );
}
