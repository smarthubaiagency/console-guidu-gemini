import type { Metadata } from "next";
import { ChartLine } from "lucide-react";
import { getTranslations } from "next-intl/server";

import {
  AnalyticsRulesCard,
  PartnerAnalyticsCard,
} from "@/components/analytics/analytics-settings";
import { ModuleNotice } from "@/components/modules/module-notice";
import { ModulePageHeader } from "@/components/modules/module-page-header";
import { requirePartnerConsolePage } from "@/core/auth/page-guard";
import { partnerGrants } from "@/core/module-runtime/loaders";
import { settingsView } from "@/core/settings/service";
import { prisma } from "@/lib/prisma/client";
import { withIdentityContext } from "@/lib/prisma/with-identity-context";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("analytics");
  return { title: t("metaTitle.partner") };
}

/**
 * Admin › Configurações › Analytics (CF7): the partner's own identifier for
 * its brand (login and /app of its customers), optional, with the
 * platform's provider and consent; nothing goes out while the platform's
 * switch is off.
 */
export default async function PartnerAnalyticsSettingsPage() {
  const { identity, partner, membership } = await requirePartnerConsolePage(
    "/admin/settings/analytics",
  );
  if (!partnerGrants(membership.role)("partner.read")) {
    return <ModuleNotice variant="denied" />;
  }
  const view = await withIdentityContext(
    prisma,
    identity.userId,
    (tx) =>
      settingsView(tx, {
        level: "partner",
        userId: identity.userId,
        partnerId: partner.partnerId,
        partnerRole: membership.role,
      }),
    { partnerId: partner.partnerId },
  );
  const t = await getTranslations("analytics");

  return (
    <>
      <ModulePageHeader
        title={t("title")}
        description={t("description.partner")}
        icon={<ChartLine className="h-5 w-5" />}
      />
      <PartnerAnalyticsCard view={view} />
      <AnalyticsRulesCard view={view} />
    </>
  );
}
