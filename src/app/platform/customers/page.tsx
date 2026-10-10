import type { Metadata } from "next";
import { Building2 } from "lucide-react";
import { requirePlatformAdminPage } from "@/core/auth/page-guard";
import { prisma } from "@/lib/prisma/client";
import {
  getPlatformAdminMember,
  listAdminOrganizations,
} from "@/core/admin/platform";
import {
  statusLabel,
  isSubscriptionStatus,
} from "@/core/billing/subscriptions";
import { platformGrants } from "@/core/module-runtime/loaders";
import { withIdentityContext } from "@/lib/prisma/with-identity-context";

export const metadata: Metadata = { title: "Clientes & Empresas (Admin)" };

export default async function AdminCustomersPage() {
  const identity = await requirePlatformAdminPage("/platform/customers");
  const organizations = await listAdminOrganizations(prisma, identity.userId);
  // Plan column (F3b): subscriptions are readable by billing roles only.
  const admin = await getPlatformAdminMember(prisma, identity.userId);
  const canReadBilling = platformGrants(
    admin?.status === "active" ? admin.role : null,
  )("platform.billing.read");
  const plans = canReadBilling
    ? await withIdentityContext(prisma, identity.userId, (tx) =>
        tx.subscription.findMany({
          where: { status: { not: "canceled" } },
          select: {
            organizationId: true,
            status: true,
            planVersion: { select: { plan: { select: { name: true } } } },
          },
        }),
      )
    : [];
  const planByOrg = new Map(plans.map((p) => [p.organizationId, p]));

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <div className="border-border border-b pb-5">
        <div className="text-12 text-warning-text mb-1 flex items-center gap-2 font-semibold tracking-wider uppercase">
          <span>Administração</span>
          <span>/</span>
          <span>Clientes & Empresas</span>
        </div>
        <div className="flex items-center gap-3">
          <div className="bg-primary text-on-primary rounded-lg p-2">
            <Building2 className="h-5 w-5" />
          </div>
          <div>
            <h1 className="text-20 text-text font-bold tracking-tight">
              Empresas Contratantes
            </h1>
            <p className="text-12 text-text-secondary">
              Listagem global das organizações, capacidades contratadas e status
              operacional.
            </p>
          </div>
        </div>
      </div>

      <div className="border-card-border bg-surface-card overflow-hidden rounded-xl border shadow-xs">
        <div className="border-border bg-surface-sidebar flex items-center justify-between border-b px-5 py-3.5">
          <span className="text-12 text-text-subtle font-semibold">
            Total de Organizações ({organizations.length})
          </span>
        </div>

        <div className="overflow-x-auto">
          <table className="text-12 w-full text-left">
            <thead className="bg-surface-raised text-text-secondary border-border border-b font-semibold tracking-wider uppercase">
              <tr>
                <th className="px-5 py-3">Organização</th>
                <th className="px-5 py-3">Assentos Máximos</th>
                <th className="px-5 py-3">Plano</th>
                <th className="px-5 py-3">Status</th>
                <th className="px-5 py-3">Criado em</th>
              </tr>
            </thead>
            <tbody className="divide-border divide-y">
              {organizations.map((org) => (
                <tr key={org.id} className="hover:bg-surface-hover">
                  <td className="px-5 py-3.5">
                    <div className="text-text font-semibold">{org.name}</div>
                    <div className="text-11 text-text-tertiary font-mono">
                      {org.id}
                    </div>
                  </td>
                  <td className="text-text-subtle px-5 py-3.5 font-medium">
                    {org.maxSeats} assentos
                  </td>
                  <td className="text-text-subtle px-5 py-3.5">
                    {!canReadBilling
                      ? "—"
                      : (() => {
                          const plan = planByOrg.get(org.id);
                          if (!plan) return "Legado (sem assinatura)";
                          return `${plan.planVersion.plan.name} · ${
                            isSubscriptionStatus(plan.status)
                              ? statusLabel(plan.status)
                              : plan.status
                          }`;
                        })()}
                  </td>
                  <td className="px-5 py-3.5">
                    <span className="bg-success-bg text-success-text border-success-border text-11 inline-flex items-center gap-1 rounded-full border px-2 py-0.5 font-medium">
                      <span className="bg-success-solid h-1.5 w-1.5 rounded-full" />
                      {org.status}
                    </span>
                  </td>
                  <td className="text-text-secondary px-5 py-3.5">
                    {new Intl.DateTimeFormat("pt-BR", {
                      dateStyle: "short",
                    }).format(org.createdAt)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
