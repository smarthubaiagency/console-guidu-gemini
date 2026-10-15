import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Sparkles } from "lucide-react";
import { getTranslations } from "next-intl/server";

import { AiDashboardView } from "@/components/ai-agents/ai-dashboard-view";
import { ModuleNotice } from "@/components/modules/module-notice";
import { ModulePageHeader } from "@/components/modules/module-page-header";
import { dashboardPeriod, partnerAiDashboard } from "@/core/ai/dashboard";
import { requirePartnerConsolePage } from "@/core/auth/page-guard";
import { partnerGrants } from "@/core/module-runtime/loaders";
import { isModuleTechnicallyAvailable } from "@/core/modules/availability";
import { prisma } from "@/lib/prisma/client";
import { withIdentityContext } from "@/lib/prisma/with-identity-context";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("aiConsole");
  return { title: t("dashboard.metaTitle") };
}

const BASE = "/admin/ai";

/**
 * The partner's AI dashboard (CF6a): usage and errors of its customers'
 * GUIDS and of its own Assistant, by provider and by customer.
 */
export default async function PartnerAiDashboardPage({
  searchParams,
}: Readonly<{ searchParams: Promise<{ days?: string }> }>) {
  if (!isModuleTechnicallyAvailable("ai-agents")) notFound();
  const { identity, partner, membership } =
    await requirePartnerConsolePage(BASE);
  if (!partnerGrants(membership.role)("partner.ai_agents.read")) {
    return <ModuleNotice variant="denied" />;
  }
  const days = dashboardPeriod((await searchParams).days);
  const dashboard = await withIdentityContext(
    prisma,
    identity.userId,
    (tx) =>
      partnerAiDashboard(
        tx,
        { partnerId: partner.partnerId, partnerRole: membership.role },
        days,
      ),
    { partnerId: partner.partnerId },
  );
  const t = await getTranslations("aiConsole");

  return (
    <div className="mx-auto max-w-6xl space-y-6" data-testid="partner-ai">
      <ModulePageHeader
        title={t("dashboard.partnerTitle")}
        description={t("dashboard.partnerDescription")}
        icon={<Sparkles className="h-5 w-5" />}
      />
      <AiDashboardView
        dashboard={dashboard}
        base={BASE}
        groupLabel={t("dashboard.byCustomer")}
        groupKind="customer"
      />
    </div>
  );
}
