import type { Metadata } from "next";
import { Settings } from "lucide-react";
import { getTranslations } from "next-intl/server";

import { ModulePageHeader } from "@/components/modules/module-page-header";
import { InfoList } from "@/components/settings/info-list";
import { RegionSettings } from "@/components/settings/region-settings";
import { SettingsCard } from "@/components/settings/settings-shell";
import { getPlatformAdminMember } from "@/core/admin/platform";
import { requirePlatformAdminPage } from "@/core/auth/page-guard";
import { appConfig } from "@/core/config/app";
import { savePlatformSettingsAction } from "@/core/settings/actions";
import { settingsView } from "@/core/settings/service";
import { prisma } from "@/lib/prisma/client";
import { withIdentityContext } from "@/lib/prisma/with-identity-context";

export const metadata: Metadata = { title: "Configurações (Plataforma)" };

/**
 * Plataforma › Configurações › Geral e região (CF1): what the platform is
 * and the regional defaults every partner and workspace inherits.
 */
export default async function PlatformGeneralSettingsPage() {
  const identity = await requirePlatformAdminPage("/platform/settings/general");
  const admin = await getPlatformAdminMember(prisma, identity.userId);
  const view = await withIdentityContext(prisma, identity.userId, (tx) =>
    settingsView(tx, {
      level: "platform",
      userId: identity.userId,
      platformRole: admin?.status === "active" ? admin.role : null,
    }),
  );
  const t = await getTranslations("settings");

  return (
    <>
      <ModulePageHeader
        title={t("general.title")}
        description={t("general.description.platform")}
        icon={<Settings className="h-5 w-5" />}
      />
      <SettingsCard
        title={t("general.platform.title")}
        description={t("general.platform.description")}
        testId="platform-info"
      >
        <InfoList
          items={[
            { label: t("general.platform.name"), value: appConfig.name },
            {
              label: t("general.platform.url"),
              value: appConfig.url,
              mono: true,
            },
          ]}
        />
      </SettingsCard>
      <RegionSettings view={view} action={savePlatformSettingsAction} />
    </>
  );
}
