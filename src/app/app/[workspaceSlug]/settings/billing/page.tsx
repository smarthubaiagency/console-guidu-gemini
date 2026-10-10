import type { Metadata } from "next";
import Link from "next/link";
import { CreditCard } from "lucide-react";

import {
  formatDate,
  sectionClass,
  SubscriptionBadge,
} from "@/components/billing/billing-ui";
import { ModuleNotice } from "@/components/modules/module-notice";
import { ModulePageHeader } from "@/components/modules/module-page-header";
import { requireUserPage } from "@/core/auth/page-guard";
import { getRequestBrand } from "@/core/brand/resolve";
import { getWorkspaceBilling } from "@/core/billing/customer";
import { resolveRequestWorkspaceContext } from "@/core/partners/request-context";
import { getRequestPartner } from "@/core/partners/resolve";
import { isPermissionDeniedError } from "@/core/permissions/guard";
import { prisma } from "@/lib/prisma/client";
import { withContext } from "@/lib/prisma/with-context";

export const metadata: Metadata = { title: "Plano e cobrança" };

interface PageProps {
  params: Promise<{ workspaceSlug: string }>;
}

/**
 * Plan and billing state of the company (P5m). In the partner pays mode the
 * customer sees the plan, its state and the partner's contact; never
 * checkout, invoices or payments (criterion 9).
 */
export default async function WorkspaceBillingPage({ params }: PageProps) {
  const { workspaceSlug } = await params;
  const identity = await requireUserPage(
    `/app/${workspaceSlug}/settings/billing`,
  );
  const context = await resolveRequestWorkspaceContext(
    prisma,
    identity.userId,
    workspaceSlug,
  );
  // Sequential: both read the database outside a transaction.
  const partner = await getRequestPartner();
  const brand = await getRequestBrand();

  let view;
  try {
    view = await withContext(prisma, context, (tx) =>
      getWorkspaceBilling(tx, context, partner?.partnerId ?? ""),
    );
  } catch (error) {
    if (isPermissionDeniedError(error)) {
      return <ModuleNotice variant="denied" />;
    }
    throw error;
  }
  const subscription = view.subscription;
  // Without a brand of its own the partner is still named, not the platform.
  const billedBy = brand.source === "partner" ? brand.name : view.partnerName;

  return (
    <div
      className="mx-auto max-w-3xl space-y-6"
      data-testid="workspace-billing"
    >
      <ModulePageHeader
        trail={["Configurações", "Plano e cobrança"]}
        title="Plano e cobrança"
        description="O plano contratado pela sua empresa e a situação da assinatura."
        icon={<CreditCard className="h-5 w-5" />}
      />

      <section className={sectionClass}>
        {subscription ? (
          <div className="space-y-2">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-14 text-text font-semibold">
                Plano {subscription.planName}
              </span>
              <SubscriptionBadge status={subscription.status} />
            </div>
            {subscription.currentPeriodEnd ? (
              <p className="text-12 text-text-secondary">
                Período pago até {formatDate(subscription.currentPeriodEnd)}.
              </p>
            ) : null}
            {subscription.status === "pending" ? (
              <p className="text-12 text-text-secondary">
                A assinatura será ativada quando o pagamento for confirmado.
              </p>
            ) : null}
          </div>
        ) : (
          <p className="text-12 text-text-secondary">
            Sua empresa ainda não tem plano.
          </p>
        )}
        {!subscription || subscription.mode === "partner_pays" ? (
          <p className="text-12 text-text-subtle" data-testid="billing-contact">
            A cobrança é feita por {billedBy}. Para mudar de plano ou tratar de
            pagamentos, fale com {billedBy}
            {brand.supportEmail ? ` pelo e-mail ${brand.supportEmail}` : ""}
            {brand.supportUrl ? ` ou em ${brand.supportUrl}` : ""}.
          </p>
        ) : null}
      </section>

      {view.checkoutAvailable ? (
        <section className={sectionClass}>
          <h2 className="text-14 text-text font-semibold">
            Contratar pelo checkout
          </h2>
          <p className="text-12 text-text-secondary">
            O checkout ainda é uma demonstração: nada é cobrado.
          </p>
          <Link
            href={`/app/${workspaceSlug}/settings/billing/checkout`}
            className="text-12 text-text-subtle font-medium underline"
          >
            Abrir checkout de demonstração
          </Link>
        </section>
      ) : null}
    </div>
  );
}
