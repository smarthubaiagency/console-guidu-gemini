import type { Metadata } from "next";
import { Building2 } from "lucide-react";

import { ModuleNotice } from "@/components/modules/module-notice";
import { ModulePageHeader } from "@/components/modules/module-page-header";
import { requirePartnerConsolePage } from "@/core/auth/page-guard";
import { partnerGrants } from "@/core/module-runtime/loaders";
import { listPartnerCustomers } from "@/core/partners/members";
import { prisma } from "@/lib/prisma/client";
import { withIdentityContext } from "@/lib/prisma/with-identity-context";

export const metadata: Metadata = { title: "Clientes (Parceiro)" };

const STATUS_LABELS: Record<string, string> = {
  active: "Ativa",
  suspended: "Suspensa",
  inactive: "Inativa",
};

/** Companies of the partner: metadata only (ADR 0012, P4a). */
export default async function PartnerCustomersPage() {
  const { identity, partner, membership } =
    await requirePartnerConsolePage("/admin/customers");
  if (!partnerGrants(membership.role)("partner.customers.read")) {
    return <ModuleNotice variant="denied" />;
  }

  const customers = await withIdentityContext(
    prisma,
    identity.userId,
    (tx) => listPartnerCustomers(tx, partner.partnerId),
    { partnerId: partner.partnerId },
  );

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <ModulePageHeader
        trail={["Parceiro", "Clientes"]}
        title="Clientes"
        description="Empresas atendidas por este parceiro. O cadastro de novos clientes chega na próxima etapa."
        icon={<Building2 className="h-5 w-5" />}
      />
      <ul
        className="border-card-border bg-surface-card divide-border divide-y rounded-xl border shadow-xs"
        data-testid="partner-customers"
      >
        {customers.map((customer) => (
          <li
            key={customer.id}
            className="flex items-center justify-between p-4"
          >
            <div className="text-14 text-text font-semibold">
              {customer.name}
            </div>
            <div className="text-12 text-text-secondary">
              {STATUS_LABELS[customer.status] ?? customer.status} · desde{" "}
              {customer.createdAt.toLocaleDateString("pt-BR")}
            </div>
          </li>
        ))}
        {customers.length === 0 ? (
          <li className="text-12 text-text-secondary p-4">
            Nenhum cliente ainda.
          </li>
        ) : null}
      </ul>
    </div>
  );
}
