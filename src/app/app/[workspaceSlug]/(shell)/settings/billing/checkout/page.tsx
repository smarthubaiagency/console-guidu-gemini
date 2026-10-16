import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { CreditCard } from "lucide-react";
import { getFormatter, getTranslations } from "next-intl/server";

import { sectionClass } from "@/components/billing/billing-ui";
import { ModulePageHeader } from "@/components/modules/module-page-header";
import { ActionForm } from "@/components/partners/action-form";
import { requireUserPage } from "@/core/auth/page-guard";
import { simulateDemoCheckoutAction } from "@/core/billing/actions";
import { openDemoCheckout } from "@/core/billing/customer";
import { resolveRequestWorkspaceContext } from "@/core/partners/request-context";
import { getRequestPartner } from "@/core/partners/resolve";
import { prisma } from "@/lib/prisma/client";
import { withContext } from "@/lib/prisma/with-context";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("billing.checkout");
  return { title: t("metaTitle") };
}

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

  const t = await getTranslations("billing");
  const format = await getFormatter();

  return (
    <div className="mx-auto max-w-3xl space-y-6" data-testid="demo-checkout">
      <ModulePageHeader
        title={t("checkout.title")}
        description={t("checkout.description")}
        icon={<CreditCard className="h-5 w-5" />}
      />
      <p
        role="note"
        className="bg-warning-bg text-warning-text border-warning-border text-12 rounded-lg border p-3 font-semibold"
      >
        {t("checkout.demoNote")}
      </p>
      <ul className="space-y-3">
        {checkout.plans.map((plan) => (
          <li key={plan.id} className={sectionClass}>
            <div className="text-14 text-text font-semibold">{plan.name}</div>
            <div className="text-12 text-text-secondary">
              {t("checkout.price", {
                price: format.number(plan.priceCents / 100, {
                  style: "currency",
                  currency: "BRL",
                }),
                interval: t(
                  plan.billingInterval === "yearly"
                    ? "checkout.year"
                    : "checkout.month",
                ),
              })}
            </div>
            <ActionForm
              action={simulateDemoCheckoutAction}
              submitLabel={t("checkout.simulate")}
            >
              <input type="hidden" name="workspaceSlug" value={workspaceSlug} />
              <input type="hidden" name="partnerPlanId" value={plan.id} />
            </ActionForm>
          </li>
        ))}
        {checkout.plans.length === 0 ? (
          <li className="text-12 text-text-secondary">
            {t("checkout.noPlans")}
          </li>
        ) : null}
      </ul>
    </div>
  );
}
