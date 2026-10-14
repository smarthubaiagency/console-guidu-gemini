import type { Metadata } from "next";
import { Settings } from "lucide-react";
import { getTranslations } from "next-intl/server";

import { ModulePageHeader } from "@/components/modules/module-page-header";
import { InfoList } from "@/components/settings/info-list";
import { RegionSettings } from "@/components/settings/region-settings";
import { SettingsCard } from "@/components/settings/settings-shell";
import { requirePartnerConsolePage } from "@/core/auth/page-guard";
import { savePartnerSettingsAction } from "@/core/settings/actions";
import { settingsView } from "@/core/settings/service";
import { prisma } from "@/lib/prisma/client";
import { withIdentityContext } from "@/lib/prisma/with-identity-context";

export const metadata: Metadata = { title: "Configurações (Admin)" };

/**
 * Admin › Configurações › Geral e região (CF1): the partner's identity and
 * the regional defaults of its customers.
 */
export default async function PartnerGeneralSettingsPage() {
  const { identity, partner, membership } = await requirePartnerConsolePage(
    "/admin/settings/general",
  );
  const { view, details } = await withIdentityContext(
    prisma,
    identity.userId,
    async (tx) => ({
      view: await settingsView(tx, {
        level: "partner",
        userId: identity.userId,
        partnerId: partner.partnerId,
        partnerRole: membership.role,
      }),
      details: await tx.partner.findUnique({
        where: { id: partner.partnerId },
        select: {
          name: true,
          slug: true,
          domains: { select: { host: true }, orderBy: { host: "asc" } },
        },
      }),
    }),
    { partnerId: partner.partnerId },
  );
  const t = await getTranslations("settings");

  return (
    <>
      <ModulePageHeader
        title={t("general.title")}
        description={t("general.description.partner")}
        icon={<Settings className="h-5 w-5" />}
      />
      <SettingsCard
        title={t("general.partner.title")}
        description={t("general.partner.description")}
        testId="partner-info"
      >
        <InfoList
          items={[
            {
              label: t("general.partner.name"),
              value: details?.name ?? membership.partnerName,
            },
            {
              label: t("general.partner.slug"),
              value: details?.slug ?? "-",
              mono: true,
            },
            {
              label: t("general.partner.domains"),
              value:
                details && details.domains.length > 0
                  ? details.domains.map((d) => d.host).join(", ")
                  : "-",
              mono: true,
            },
          ]}
        />
      </SettingsCard>
      <RegionSettings view={view} action={savePartnerSettingsAction} />
    </>
  );
}
