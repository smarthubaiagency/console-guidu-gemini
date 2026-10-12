import { randomUUID } from "node:crypto";

import type { Metadata } from "next";
import { CreditCard } from "lucide-react";
import { getTranslations } from "next-intl/server";

import {
  billingLabels,
  calendarDateFormatter,
  centsFormatter,
  centsInput,
  ProvisionalBadge,
  sectionClass,
  SubscriptionBadge,
  todayInput,
} from "@/components/billing/billing-ui";
import { ModuleNotice } from "@/components/modules/module-notice";
import { ModulePageHeader } from "@/components/modules/module-page-header";
import {
  NoticesSection,
  PayoutReportsSection,
} from "@/components/billing/automation-panels";
import { ActionForm } from "@/components/partners/action-form";
import {
  changeSubscriptionStatusAction,
  createPartnerPlanAction,
  recordManualPaymentAction,
  saveBillingProfileAction,
  setCheckoutEnabledAction,
  setPartnerPlanStatusAction,
  startSubscriptionAction,
} from "@/core/billing/actions";
import { listPayments, listPlans } from "@/core/billing/catalog";
import {
  getBillingTerms,
  listNotificationDeliveries,
  listPayoutReports,
} from "@/core/billing/operations";
import {
  checkoutPrerequisites,
  getBillingProfile,
  listCustomerSubscriptions,
  listPartnerPlans,
  MAX_EVIDENCE_BYTES,
  PREREQUISITE_KEYS,
} from "@/core/billing/partner";
import { PAYMENT_METHODS } from "@/core/billing/provider";
import {
  canTransition,
  MANUAL_STATUS_TARGETS,
  statusKey,
} from "@/core/billing/subscriptions";
import { requirePartnerConsolePage } from "@/core/auth/page-guard";
import { partnerGrants } from "@/core/module-runtime/loaders";
import { prisma } from "@/lib/prisma/client";
import { withIdentityContext } from "@/lib/prisma/with-identity-context";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  NativeSelect,
  NativeSelectOption,
} from "@/components/ui/native-select";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("billing.partner");
  return { title: t("metaTitle") };
}

/**
 * Partner billing (P5m, D-PA-14): partner pays mode with manual records.
 * The partner opens each customer's plan, records monthly payments with
 * evidence and marks arrears, suspension or cancellation. The "Ativar
 * checkout" switch shows a demonstration checkout to customers until P6.
 */
export default async function PartnerBillingPage() {
  const { identity, partner, membership } =
    await requirePartnerConsolePage("/admin/billing");
  const grants = partnerGrants(membership.role);
  if (!grants("partner.billing.read")) {
    return <ModuleNotice variant="denied" />;
  }
  const canManage = grants("partner.billing.manage");
  const actor = { userId: identity.userId, partnerRole: membership.role };

  const data = await withIdentityContext(
    prisma,
    identity.userId,
    async (tx) => ({
      partnerRow: await tx.partner.findUnique({
        where: { id: partner.partnerId },
        select: { checkoutEnabled: true, checkoutBlocked: true },
      }),
      prerequisites: await checkoutPrerequisites(tx, partner.partnerId),
      profile: await getBillingProfile(tx, actor, partner.partnerId),
      customers: await listCustomerSubscriptions(tx, actor, partner.partnerId),
      partnerPlans: await listPartnerPlans(tx, partner.partnerId),
      plans: await listPlans(tx, { activeOnly: true }),
      payments: await listPayments(tx, {
        partnerId: partner.partnerId,
        take: 50,
      }),
      terms: await getBillingTerms(tx, actor),
      notices: await listNotificationDeliveries(tx, actor, partner.partnerId),
      reports: await listPayoutReports(tx, actor, partner.partnerId),
    }),
    { partnerId: partner.partnerId },
  );
  const names = new Map(
    data.customers.map((c) => [c.organizationId, c.organizationName]),
  );
  const checkoutOn = Boolean(data.partnerRow?.checkoutEnabled);
  const blocked = Boolean(data.partnerRow?.checkoutBlocked);
  const tb = await getTranslations("billing");
  const t = await getTranslations("billing.partner");
  const formatDate = await calendarDateFormatter();
  const formatCents = await centsFormatter();
  const labels = await billingLabels();

  return (
    <div className="mx-auto max-w-5xl space-y-6" data-testid="partner-billing">
      <ModulePageHeader
        title={t("title")}
        description={t("description")}
        icon={<CreditCard className="h-5 w-5" />}
      />

      {/* Customers and subscriptions */}
      <section className={sectionClass}>
        <h2 className="text-14 text-text font-semibold">
          {t("customersTitle")}
        </h2>
        <ul className="divide-border divide-y" data-testid="billing-customers">
          {data.customers.map((row) => (
            <li key={row.organizationId} className="space-y-3 py-3">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <div className="text-14 text-text font-semibold">
                    {row.organizationName}
                  </div>
                  {row.subscription ? (
                    <div className="text-12 text-text-secondary flex flex-wrap items-center gap-2">
                      <SubscriptionBadge status={row.subscription.status} />
                      <span>
                        {t("subscriptionLine", {
                          plan: row.subscription.planName,
                          version: row.subscription.planVersion,
                          amount: formatCents(row.subscription.amountCents),
                          interval: labels.interval(
                            row.subscription.billingInterval,
                          ),
                        })}
                      </span>
                      {row.subscription.currentPeriodEnd ? (
                        <span>
                          {t("paidUntil", {
                            date: formatDate(row.subscription.currentPeriodEnd),
                          })}
                        </span>
                      ) : null}
                      {row.subscription.provisional ? (
                        <ProvisionalBadge />
                      ) : null}
                    </div>
                  ) : (
                    <div className="text-12 text-text-secondary">
                      {t("noPlan")}
                    </div>
                  )}
                </div>
                {canManage && row.subscription
                  ? MANUAL_STATUS_TARGETS.filter(
                      (to) =>
                        to !== row.subscription!.status &&
                        canTransition(row.subscription!.status, to),
                    ).map((to) => (
                      <ActionForm
                        key={to}
                        action={changeSubscriptionStatusAction}
                        submitLabel={t(`statusActions.${statusKey(to)}`)}
                        tone="neutral"
                      >
                        <input
                          type="hidden"
                          name="subscriptionId"
                          value={row.subscription!.id}
                        />
                        <input type="hidden" name="to" value={to} />
                      </ActionForm>
                    ))
                  : null}
              </div>

              {canManage && !row.subscription && data.plans.length > 0 ? (
                <ActionForm
                  action={startSubscriptionAction}
                  submitLabel={t("openSubscription")}
                  testId={`start-subscription-${row.organizationId}`}
                >
                  <input
                    type="hidden"
                    name="organizationId"
                    value={row.organizationId}
                  />
                  <Label className="flex-col items-start">
                    {t("plan")}
                    <NativeSelect name="planId" className="w-full">
                      {data.plans.map((plan) => (
                        <NativeSelectOption key={plan.id} value={plan.id}>
                          {plan.name}
                          {plan.versions[0]
                            ? t("planOptionPrice", {
                                price: formatCents(
                                  plan.versions[0].partnerBasePriceCents,
                                ),
                                interval: labels.interval(
                                  plan.versions[0].billingInterval,
                                ),
                              })
                            : ""}
                        </NativeSelectOption>
                      ))}
                    </NativeSelect>
                  </Label>
                </ActionForm>
              ) : null}

              {canManage && row.subscription ? (
                <details className="border-border rounded-lg border p-3">
                  <summary className="text-12 text-text-subtle cursor-pointer font-semibold">
                    {t("recordPayment")}
                  </summary>
                  <ActionForm
                    action={recordManualPaymentAction}
                    submitLabel={t("recordPayment")}
                    className="mt-3 grid gap-3 sm:grid-cols-2"
                    testId={`record-payment-${row.organizationId}`}
                  >
                    <input
                      type="hidden"
                      name="subscriptionId"
                      value={row.subscription.id}
                    />
                    <input
                      type="hidden"
                      name="idempotencyKey"
                      value={randomUUID()}
                    />
                    <Label className="flex-col items-start">
                      {t("amountPaid")}
                      <Input
                        name="amount"
                        required
                        inputMode="decimal"
                        defaultValue={centsInput(row.subscription.amountCents)}
                      />
                    </Label>
                    <Label className="flex-col items-start">
                      {t("paidOn")}
                      <Input
                        name="paidOn"
                        type="date"
                        required
                        max={todayInput()}
                        defaultValue={todayInput()}
                      />
                    </Label>
                    <Label className="flex-col items-start">
                      {t("method")}
                      <NativeSelect name="method" className="w-full">
                        {PAYMENT_METHODS.map((method) => (
                          <NativeSelectOption key={method} value={method}>
                            {labels.method(method)}
                          </NativeSelectOption>
                        ))}
                      </NativeSelect>
                    </Label>
                    <Label className="flex-col items-start">
                      {t("evidenceLabel", {
                        kb: Math.round(MAX_EVIDENCE_BYTES / 1024),
                      })}
                      <Input
                        name="evidence"
                        type="file"
                        required
                        accept="application/pdf,image/png,image/jpeg,image/webp"
                      />
                    </Label>
                    <Label className="flex-col items-start sm:col-span-2">
                      {t("note")}
                      <Input name="note" maxLength={500} />
                    </Label>
                  </ActionForm>
                </details>
              ) : null}
            </li>
          ))}
          {data.customers.length === 0 ? (
            <li className="text-12 text-text-secondary py-3">
              {t("noCustomers")}
            </li>
          ) : null}
        </ul>
      </section>

      {/* Payments */}
      <section className={sectionClass}>
        <h2 className="text-14 text-text font-semibold">
          {t("paymentsTitle")}
        </h2>
        <ul className="divide-border divide-y" data-testid="billing-payments">
          {data.payments.map((payment) => (
            <li
              key={payment.id}
              className="flex flex-wrap items-center justify-between gap-3 py-2"
            >
              <div className="text-12 text-text-secondary">
                <span className="text-text font-semibold">
                  {names.get(payment.organizationId) ??
                    tb("console.customerFallback")}
                </span>{" "}
                · {payment.kind === "refund" ? tb("console.refundOf") : ""}
                {formatCents(payment.amountCents)} ·{" "}
                {labels.method(payment.method)} · {formatDate(payment.paidOn)}
                {payment.periodStart
                  ? t("period", {
                      start: formatDate(payment.periodStart),
                      end: formatDate(payment.periodEnd),
                    })
                  : ""}
                {payment.refunded ? tb("console.refunded") : ""}
              </div>
              {payment.hasEvidence ? (
                <a
                  href={`/admin/billing/evidence/${payment.id}`}
                  className="text-12 text-text-subtle font-medium underline"
                >
                  {tb("console.evidence")}
                </a>
              ) : null}
            </li>
          ))}
          {data.payments.length === 0 ? (
            <li className="text-12 text-text-secondary py-2">
              {t("noPayments")}
            </li>
          ) : null}
        </ul>
      </section>

      <NoticesSection notices={data.notices} showPartner={false} />
      <PayoutReportsSection reports={data.reports} showPartner={false} />

      {/* Checkout switch */}
      <section className={sectionClass} data-testid="checkout-switch">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-14 text-text font-semibold">
              {t("checkoutTitle")}
            </h2>
            <p className="text-12 text-text-secondary">
              {blocked
                ? t("checkoutBlocked")
                : checkoutOn
                  ? t("checkoutOn")
                  : t("checkoutOff")}
            </p>
          </div>
          {canManage && !blocked ? (
            <ActionForm
              action={setCheckoutEnabledAction}
              submitLabel={
                checkoutOn ? t("disableCheckout") : t("enableCheckout")
              }
              tone={checkoutOn ? "neutral" : "primary"}
            >
              <input
                type="hidden"
                name="enabled"
                value={checkoutOn ? "false" : "true"}
              />
            </ActionForm>
          ) : null}
        </div>
        <ul className="text-12 space-y-1">
          {data.prerequisites.map((p) => (
            <li
              key={p.key}
              className={p.met ? "text-success-text" : "text-text-secondary"}
            >
              {p.met ? "✓" : "○"}{" "}
              {t(`prerequisites.${PREREQUISITE_KEYS[p.key]}`)}
              {!p.met && !p.requiredNow ? t("requiredLater") : ""}
            </li>
          ))}
        </ul>
      </section>

      {/* Partner plans */}
      <section className={sectionClass}>
        <h2 className="text-14 text-text font-semibold">{t("plansTitle")}</h2>
        <p className="text-12 text-text-secondary">{t("plansDescription")}</p>
        <ul className="divide-border divide-y" data-testid="partner-plans">
          {data.partnerPlans.map((plan) => (
            <li
              key={plan.id}
              className="flex flex-wrap items-center justify-between gap-3 py-2"
            >
              <div className="text-12 text-text-secondary">
                <span className="text-text font-semibold">{plan.name}</span> ·{" "}
                {t("planLine", {
                  price: formatCents(plan.priceCents),
                  interval: labels.interval(plan.billingInterval),
                  plan: plan.planName,
                  version: plan.planVersion,
                  floor: formatCents(plan.minPriceCents),
                })}
                {plan.status === "archived" ? t("archivedTag") : ""}
              </div>
              {canManage ? (
                <ActionForm
                  action={setPartnerPlanStatusAction}
                  submitLabel={
                    plan.status === "active"
                      ? t("archive")
                      : tb("console.reactivate")
                  }
                  tone="neutral"
                >
                  <input type="hidden" name="partnerPlanId" value={plan.id} />
                  <input
                    type="hidden"
                    name="status"
                    value={plan.status === "active" ? "archived" : "active"}
                  />
                </ActionForm>
              ) : null}
            </li>
          ))}
          {data.partnerPlans.length === 0 ? (
            <li className="text-12 text-text-secondary py-2">{t("noPlans")}</li>
          ) : null}
        </ul>
        {canManage && data.plans.length > 0 ? (
          <ActionForm
            action={createPartnerPlanAction}
            submitLabel={tb("console.createPlan")}
            className="grid gap-3 sm:grid-cols-3"
            testId="create-partner-plan"
          >
            <Label className="flex-col items-start">
              {t("basePlan")}
              <NativeSelect name="planId" className="w-full">
                {data.plans.map((plan) => (
                  <NativeSelectOption key={plan.id} value={plan.id}>
                    {plan.name}
                    {plan.versions[0]
                      ? t("basePlanFloor", {
                          floor: formatCents(plan.versions[0].minPriceCents),
                        })
                      : ""}
                  </NativeSelectOption>
                ))}
              </NativeSelect>
            </Label>
            <Label className="flex-col items-start">
              {tb("console.name")}
              <Input name="name" required maxLength={80} />
            </Label>
            <Label className="flex-col items-start">
              {t("price")}
              <Input name="price" required inputMode="decimal" />
            </Label>
          </ActionForm>
        ) : null}
      </section>

      {/* Billing profile */}
      <section className={sectionClass}>
        <h2 className="text-14 text-text font-semibold">{t("profileTitle")}</h2>
        <p className="text-12 text-text-secondary">
          {t("profileText", {
            provider:
              data.profile?.provider === "manual" || !data.profile
                ? t("manualProvider")
                : data.profile.provider,
          })}
        </p>
        {canManage ? (
          <ActionForm
            action={saveBillingProfileAction}
            submitLabel={t("saveProfile")}
            className="grid gap-3 sm:grid-cols-3"
            testId="billing-profile"
          >
            <Label className="flex-col items-start">
              {t("legalName")}
              <Input
                name="legalName"
                required
                maxLength={160}
                defaultValue={data.profile?.legalName ?? ""}
              />
            </Label>
            <Label className="flex-col items-start">
              {t("taxId")}
              <Input
                name="taxId"
                required
                defaultValue={data.profile?.taxId ?? ""}
              />
            </Label>
            <Label className="flex-col items-start">
              {t("billingEmail")}
              <Input
                name="billingEmail"
                type="email"
                required
                defaultValue={data.profile?.billingEmail ?? ""}
              />
            </Label>
          </ActionForm>
        ) : data.profile ? (
          <p className="text-12 text-text-subtle">
            {data.profile.legalName} · {data.profile.taxId} ·{" "}
            {data.profile.billingEmail}
          </p>
        ) : (
          <p className="text-12 text-text-secondary">{t("notRegistered")}</p>
        )}
      </section>

      <p className="text-11 text-text-secondary">
        {t("statusNote", {
          statuses: MANUAL_STATUS_TARGETS.map((s) =>
            tb(`status.${statusKey(s)}`),
          ).join(", "),
        })}
      </p>
      <p className="text-11 text-text-secondary" data-testid="billing-terms">
        {t("termsNote", {
          pastDue: data.terms.pastDueAfterDays,
          suspend: data.terms.suspendAfterDays,
        })}
        {data.terms.provisional ? t("provisionalTerms") : ""}
      </p>
    </div>
  );
}
