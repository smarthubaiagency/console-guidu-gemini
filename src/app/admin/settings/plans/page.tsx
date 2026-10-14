import type { Metadata } from "next";
import { Gauge } from "lucide-react";
import { getTranslations } from "next-intl/server";

import { ModulePageHeader } from "@/components/modules/module-page-header";
import { LimitsTable } from "@/components/plans/limits-table";
import { SettingsCard } from "@/components/settings/settings-shell";
import { requirePartnerConsolePage } from "@/core/auth/page-guard";
import { loadPlansLimits } from "@/core/billing/limits";
import { prisma } from "@/lib/prisma/client";
import { withIdentityContext } from "@/lib/prisma/with-identity-context";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("plans");
  return { title: t("metaTitle") };
}

/**
 * Admin › Configurações › Planos e limites (CF4), read only: the limits of
 * the platform plans the partner sells (a subscription opens on the
 * current version of a plan). Plans are a platform catalog, readable by
 * any signed-in context; ceilings stay on the platform page.
 */
export default async function PartnerPlansLimitsPage() {
  const { identity, partner } = await requirePartnerConsolePage(
    "/admin/settings/plans",
  );
  const view = await withIdentityContext(
    prisma,
    identity.userId,
    (tx) => loadPlansLimits(tx),
    { partnerId: partner.partnerId },
  );
  const t = await getTranslations("plans");

  return (
    <>
      <ModulePageHeader
        title={t("title")}
        description={t("description.partner")}
        icon={<Gauge className="h-5 w-5" />}
      />
      <SettingsCard
        title={t("catalog.title")}
        description={t("partner.note")}
        testId="partner-plans-catalog"
      >
        <LimitsTable view={view} showCeiling={false} />
        {view.plans.length === 0 ? (
          <p className="text-12 text-text-secondary">{t("catalog.noPlans")}</p>
        ) : null}
      </SettingsCard>
    </>
  );
}
