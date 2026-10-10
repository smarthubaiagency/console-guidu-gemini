import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { CreditCard } from "lucide-react";

import { intervalLabel, sectionClass } from "@/components/billing/billing-ui";
import { ModulePageHeader } from "@/components/modules/module-page-header";
import { ActionForm } from "@/components/partners/action-form";
import { requireUserPage } from "@/core/auth/page-guard";
import { simulateDemoCheckoutAction } from "@/core/billing/actions";
import { openDemoCheckout } from "@/core/billing/customer";
import { formatCents } from "@/core/billing/split";
import { resolveRequestWorkspaceContext } from "@/core/partners/request-context";
import { getRequestPartner } from "@/core/partners/resolve";
import { prisma } from "@/lib/prisma/client";
import { withContext } from "@/lib/prisma/with-context";

export const metadata: Metadata = { title: "Checkout (demonstração)" };

interface PageProps {
  params: Promise<{ workspaceSlug: string }>;
}

/**
 * Demonstration checkout (P5m, criterion 11): only with the partner's
 * "Ativar checkout" switch on; otherwise 404, even on a direct visit.
 * Nothing is charged or recorded until the provider arrives (P6).
 */
export default async function DemoCheckoutPage({ params }: PageProps) {
  const { workspaceSlug } = await params;
  const identity = await requireUserPage(
    `/app/${workspaceSlug}/settings/billing/checkout`,
  );
  const context = await resolveRequestWorkspaceContext(
    prisma,
    identity.userId,
    workspaceSlug,
  );
  const partner = await getRequestPartner();
  if (!partner) notFound();

  let checkout;
  try {
    checkout = await withContext(prisma, context, (tx) =>
      openDemoCheckout(tx, context, partner.partnerId),
    );
  } catch {
    notFound();
  }

  return (
    <div className="mx-auto max-w-3xl space-y-6" data-testid="demo-checkout">
      <ModulePageHeader
        trail={["Configurações", "Plano e cobrança", "Checkout"]}
        title="Checkout"
        description="Escolha um plano."
        icon={<CreditCard className="h-5 w-5" />}
      />
      <p
        role="note"
        className="bg-warning-bg text-warning-text border-warning-border text-12 rounded-lg border p-3 font-semibold"
      >
        Demonstração: nenhuma cobrança é feita e nenhum dado de pagamento é
        pedido.
      </p>
      <ul className="space-y-3">
        {checkout.plans.map((plan) => (
          <li key={plan.id} className={sectionClass}>
            <div className="text-14 text-text font-semibold">{plan.name}</div>
            <div className="text-12 text-text-secondary">
              {formatCents(plan.priceCents)}/
              {intervalLabel(plan.billingInterval)}
            </div>
            <ActionForm
              action={simulateDemoCheckoutAction}
              submitLabel="Simular contratação"
            >
              <input type="hidden" name="workspaceSlug" value={workspaceSlug} />
              <input type="hidden" name="partnerPlanId" value={plan.id} />
            </ActionForm>
          </li>
        ))}
        {checkout.plans.length === 0 ? (
          <li className="text-12 text-text-secondary">
            Nenhum plano disponível.
          </li>
        ) : null}
      </ul>
    </div>
  );
}
