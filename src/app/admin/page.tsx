import type { Metadata } from "next";
import { LayoutDashboard } from "lucide-react";
import { getTranslations } from "next-intl/server";

import { ModulePageHeader } from "@/components/modules/module-page-header";
import { partnerRoleKey } from "@/components/partners/role-label";
import { requirePartnerConsolePage } from "@/core/auth/page-guard";
import { prisma } from "@/lib/prisma/client";
import { withIdentityContext } from "@/lib/prisma/with-identity-context";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("partnerConsole");
  return { title: t("overview.metaTitle") };
}

export default async function PartnerOverviewPage() {
  const { identity, partner, membership } =
    await requirePartnerConsolePage("/admin");

  const counts = await withIdentityContext(
    prisma,
    identity.userId,
    async (tx) => ({
      customers: await tx.organization.count({
        where: { partnerId: partner.partnerId },
      }),
      members: await tx.partnerMember.count({
        where: { partnerId: partner.partnerId, status: "active" },
      }),
    }),
    { partnerId: partner.partnerId },
  );

  const t = await getTranslations("partnerConsole");
  const tAll = await getTranslations();
  const roleKey = partnerRoleKey(membership.role);

  return (
    <div className="mx-auto max-w-5xl space-y-6" data-testid="partner-console">
      <ModulePageHeader
        title={membership.partnerName}
        description={t("overview.description", {
          role: roleKey ? tAll(roleKey) : membership.role,
        })}
        icon={<LayoutDashboard className="h-5 w-5" />}
      />
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="border-card-border bg-surface-card rounded-xl border p-4 shadow-xs">
          <div className="text-12 text-text-secondary">
            {t("overview.customers")}
          </div>
          <div className="text-30 text-text font-semibold">
            {counts.customers}
          </div>
        </div>
        <div className="border-card-border bg-surface-card rounded-xl border p-4 shadow-xs">
          <div className="text-12 text-text-secondary">
            {t("overview.activeMembers")}
          </div>
          <div className="text-30 text-text font-semibold">
            {counts.members}
          </div>
        </div>
      </div>
    </div>
  );
}
