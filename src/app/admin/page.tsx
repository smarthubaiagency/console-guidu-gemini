import type { Metadata } from "next";
import { LayoutDashboard } from "lucide-react";

import { ModulePageHeader } from "@/components/modules/module-page-header";
import { partnerRoleLabel } from "@/components/partners/role-label";
import { requirePartnerConsolePage } from "@/core/auth/page-guard";
import { prisma } from "@/lib/prisma/client";
import { withIdentityContext } from "@/lib/prisma/with-identity-context";

export const metadata: Metadata = { title: "Console do parceiro" };

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

  return (
    <div className="mx-auto max-w-5xl space-y-6" data-testid="partner-console">
      <ModulePageHeader
        trail={["Parceiro", "Visão Geral"]}
        title={membership.partnerName}
        description={`Seu papel: ${partnerRoleLabel(membership.role)}. O console mostra dados do parceiro, nunca o conteúdo dos workspaces dos clientes.`}
        icon={<LayoutDashboard className="h-5 w-5" />}
      />
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="border-card-border bg-surface-card rounded-xl border p-4 shadow-xs">
          <div className="text-12 text-text-secondary">Empresas clientes</div>
          <div className="text-30 text-text font-semibold">
            {counts.customers}
          </div>
        </div>
        <div className="border-card-border bg-surface-card rounded-xl border p-4 shadow-xs">
          <div className="text-12 text-text-secondary">Membros ativos</div>
          <div className="text-30 text-text font-semibold">
            {counts.members}
          </div>
        </div>
      </div>
    </div>
  );
}
