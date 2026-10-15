import type { Metadata } from "next";
import { Sparkles } from "lucide-react";
import { getTranslations } from "next-intl/server";

import { AiDashboardView } from "@/components/ai-agents/ai-dashboard-view";
import { AiTabs } from "@/components/ai-agents/ai-tabs";
import { ModulePageHeader } from "@/components/modules/module-page-header";
import { dashboardPeriod, platformAiDashboard } from "@/core/ai/dashboard";
import { requirePlatformAdminPage } from "@/core/auth/page-guard";
import { prisma } from "@/lib/prisma/client";
import { withIdentityContext } from "@/lib/prisma/with-identity-context";

import { requireAiModule, requirePlatformAiRole } from "./guard";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("aiConsole");
  return { title: t("dashboard.metaTitle") };
}

const BASE = "/platform/ai";

/**
 * IA › Painel of the platform (CF6a): usage and errors by provider and by
 * partner, and the notices (backup key, GUIDS on the backup or paused,
 * providers failing, agents outside the catalog). Aggregates only.
 */
export default async function PlatformAiDashboardPage({
  searchParams,
}: Readonly<{ searchParams: Promise<{ days?: string }> }>) {
  requireAiModule();
  const identity = await requirePlatformAdminPage(BASE);
  const role = await requirePlatformAiRole(identity.userId);
  const days = dashboardPeriod((await searchParams).days);
  const dashboard = await withIdentityContext(prisma, identity.userId, (tx) =>
    platformAiDashboard(tx, role, days),
  );
  const t = await getTranslations("aiConsole");

  return (
    <div className="mx-auto max-w-6xl space-y-6" data-testid="platform-ai">
      <ModulePageHeader
        title={t("dashboard.title")}
        description={t("dashboard.description")}
        icon={<Sparkles className="h-5 w-5" />}
      />
      <AiTabs active="dashboard" />
      <AiDashboardView
        dashboard={dashboard}
        base={BASE}
        groupLabel={t("dashboard.byPartner")}
        groupKind="partner"
      />
    </div>
  );
}
