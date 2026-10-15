import type { Metadata } from "next";
import { ChartLine } from "lucide-react";
import { getTranslations } from "next-intl/server";

import {
  AnalyticsRulesCard,
  PlatformAnalyticsCard,
} from "@/components/analytics/analytics-settings";
import { ModuleNotice } from "@/components/modules/module-notice";
import { ModulePageHeader } from "@/components/modules/module-page-header";
import { getPlatformAdminMember } from "@/core/admin/platform";
import { requirePlatformAdminPage } from "@/core/auth/page-guard";
import { platformGrants } from "@/core/module-runtime/loaders";
import { settingsView } from "@/core/settings/service";
import { prisma } from "@/lib/prisma/client";
import { withIdentityContext } from "@/lib/prisma/with-identity-context";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("analytics");
  return { title: t("metaTitle.platform") };
}

/**
 * Plataforma › Configurações › Analytics (CF7): provider, identifier and
 * switch of the product analytics, off by default (D-PA-06).
 */
export default async function PlatformAnalyticsSettingsPage() {
  const identity = await requirePlatformAdminPage(
    "/platform/settings/analytics",
  );
  const admin = await getPlatformAdminMember(prisma, identity.userId);
  const role = admin?.status === "active" ? admin.role : null;
  if (!platformGrants(role)("platform.settings.manage")) {
    return <ModuleNotice variant="denied" />;
  }
  const view = await withIdentityContext(prisma, identity.userId, (tx) =>
    settingsView(tx, {
      level: "platform",
      userId: identity.userId,
      platformRole: role,
    }),
  );
  const t = await getTranslations("analytics");

  return (
    <>
      <ModulePageHeader
        title={t("title")}
        description={t("description.platform")}
        icon={<ChartLine className="h-5 w-5" />}
      />
      <PlatformAnalyticsCard view={view} />
      <AnalyticsRulesCard view={view} />
    </>
  );
}
