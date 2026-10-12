import type { Metadata } from "next";
import { CreditCard } from "lucide-react";
import { getFormatter, getTranslations } from "next-intl/server";

import {
  billingLabels,
  calendarDateFormatter,
  centsFormatter,
  centsInput,
  ProvisionalBadge,
  sectionClass,
} from "@/components/billing/billing-ui";
import {
  NoticesSection,
  PayoutReportsSection,
} from "@/components/billing/automation-panels";
import { ModuleNotice } from "@/components/modules/module-notice";
import { ModulePageHeader } from "@/components/modules/module-page-header";
import { ActionForm } from "@/components/partners/action-form";
import { getPlatformAdminMember } from "@/core/admin/platform";
import { requirePlatformAdminPage } from "@/core/auth/page-guard";
import {
  createPlanAction,
  publishPlanVersionAction,
  publishSplitRuleAction,
  refundPaymentAction,
  setCheckoutBlockedAction,
  setPlanStatusAction,
  updateBillingTermsAction,
} from "@/core/billing/actions";
import {
  listPartnerTotals,
  listPlans,
  listQuotaKeys,
  listRecentPayments,
  listSplitRules,
} from "@/core/billing/catalog";
import {
  getBillingTerms,
  listNotificationDeliveries,
  listPayoutReports,
} from "@/core/billing/operations";
import { platformGrants } from "@/core/module-runtime/loaders";
import { getRequestPartner } from "@/core/partners/resolve";
import { prisma } from "@/lib/prisma/client";
import { withIdentityContext } from "@/lib/prisma/with-identity-context";
import { listRegisteredModules } from "@/modules/registry";
import { getModuleCatalog } from "@/core/i18n/modules";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  NativeSelect,
  NativeSelectOption,
} from "@/components/ui/native-select";
import { Checkbox } from "@/components/ui/checkbox";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("billing.platform");
  return { title: t("metaTitle") };
}

/**
 * Platform billing (P5m, D-PA-14): base plans and insert-only versions,
 * split rules, totals per partner, the checkout block and refunds of manual
 * payments. Values are records; seeded ones are marked provisional. F3c
 * adds the overdue terms, the payout reports and the partner notices.
 */
export default async function PlatformBillingPage() {
  const identity = await requirePlatformAdminPage("/platform/billing");
  const admin = await getPlatformAdminMember(prisma, identity.userId);
  const role = admin?.status === "active" ? admin.role : null;
  const grants = platformGrants(role);
  if (!grants("platform.billing.read")) {
    return <ModuleNotice variant="denied" />;
  }
  const canManage = grants("platform.billing.manage");
  const canBlock = grants("platform.partners.manage");
  const actor = { userId: identity.userId, platformRole: role };
  const partner = await getRequestPartner();

  const data = await withIdentityContext(
    prisma,
    identity.userId,
    async (tx) => ({
      totals: await listPartnerTotals(tx, actor),
      plans: await listPlans(tx),
      rules: await listSplitRules(tx, actor),
      payments: await listRecentPayments(tx, actor, { take: 50 }),
      terms: await getBillingTerms(tx, actor),
      reports: await listPayoutReports(tx, actor, null),
      notices: await listNotificationDeliveries(tx, actor, null),
      partners: await tx.partner.findMany({
        select: {
          id: true,
          name: true,
          checkoutEnabled: true,
          checkoutBlocked: true,
          isHouse: true,
        },
      }),
      organizations: await tx.organization.findMany({
        select: { id: true, name: true },
        take: 1000,
      }),
    }),
    { partnerId: partner?.partnerId ?? null },
  );
  const partnerById = new Map(data.partners.map((p) => [p.id, p]));
  const orgNames = new Map(data.organizations.map((o) => [o.id, o.name]));
  // Module names and quota descriptions in the request language (I4).
  const catalog = await getModuleCatalog();
  const modules = listRegisteredModules().map((m) => ({
    moduleKey: m.manifest.moduleKey,
    displayName: catalog.name(m.manifest.moduleKey, m.manifest.displayName),
  }));
  const quotaKeys = listQuotaKeys().map((q) => ({
    ...q,
    description: catalog.findQuota(q.key)?.description ?? q.description,
  }));
  const tb = await getTranslations("billing");
  const t = await getTranslations("billing.platform");
  const format = await getFormatter();
  const formatDate = await calendarDateFormatter();
  const formatCents = await centsFormatter();
  const labels = await billingLabels();

  return (
    <div className="mx-auto max-w-5xl space-y-6" data-testid="platform-billing">
      <ModulePageHeader
        title={t("title")}
        description={t("description")}
        icon={<CreditCard className="h-5 w-5" />}
      />

      {/* Totals per partner */}
      <section className={sectionClass}>
        <h2 className="text-14 text-text font-semibold">{t("byPartner")}</h2>
        <ul className="divide-border divide-y" data-testid="partner-totals">
          {data.totals.map((total) => {
            const p = partnerById.get(total.partnerId);
            return (
              <li
                key={total.partnerId}
                className="flex flex-wrap items-center justify-between gap-3 py-2"
              >
                <div className="text-12 text-text-secondary">
                  <span className="text-text font-semibold">
                    {total.partnerName}
                  </span>{" "}
                  {t("totalsLine", {
                    received: formatCents(total.receivedCents),
                    refunded: formatCents(total.refundedCents),
                    platform: formatCents(total.platformNetCents),
                    partner: formatCents(total.partnerNetCents),
                    open: total.openSubscriptions,
                  })}
                  {p?.checkoutBlocked
                    ? t("checkoutBlockedTag")
                    : p?.checkoutEnabled
                      ? t("checkoutOnTag")
                      : ""}
                </div>
                {canBlock && p && !p.isHouse ? (
                  <ActionForm
                    action={setCheckoutBlockedAction}
                    submitLabel={
                      p.checkoutBlocked
                        ? t("unblockCheckout")
                        : t("blockCheckout")
                    }
                    tone="neutral"
                  >
                    <input type="hidden" name="partnerId" value={p.id} />
                    <input
                      type="hidden"
                      name="blocked"
                      value={p.checkoutBlocked ? "false" : "true"}
                    />
                  </ActionForm>
                ) : null}
              </li>
            );
          })}
        </ul>
      </section>

      {/* Overdue terms (F3c) */}
      <section className={sectionClass} data-testid="billing-terms">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="text-14 text-text font-semibold">{t("termsTitle")}</h2>
          {data.terms.provisional ? <ProvisionalBadge /> : null}
        </div>
        <p className="text-12 text-text-secondary">
          {t("termsText", {
            pastDue: data.terms.pastDueAfterDays,
            suspend: data.terms.suspendAfterDays,
          })}
        </p>
        {canManage ? (
          <ActionForm
            action={updateBillingTermsAction}
            submitLabel={t("saveTerms")}
            className="grid gap-3 sm:grid-cols-3"
            testId="billing-terms-form"
          >
            <Label className="flex-col items-start">
              {t("pastDueLabel")}
              <Input
                name="pastDueAfterDays"
                required
                inputMode="numeric"
                defaultValue={data.terms.pastDueAfterDays}
              />
            </Label>
            <Label className="flex-col items-start">
              {t("suspendLabel")}
              <Input
                name="suspendAfterDays"
                required
                inputMode="numeric"
                defaultValue={data.terms.suspendAfterDays}
              />
            </Label>
            <Label className="text-12 text-text-subtle flex items-center gap-2 font-medium">
              <Checkbox
                name="provisional"
                defaultChecked={data.terms.provisional}
              />
              {t("provisionalTerms")}
            </Label>
          </ActionForm>
        ) : null}
      </section>

      <PayoutReportsSection reports={data.reports} showPartner />
      <NoticesSection notices={data.notices} showPartner />

      {/* Plans */}
      <section className={sectionClass}>
        <h2 className="text-14 text-text font-semibold">{t("plansTitle")}</h2>
        <ul className="divide-border divide-y" data-testid="platform-plans">
          {data.plans.map((plan) => {
            const current = plan.versions[0];
            return (
              <li key={plan.id} className="space-y-2 py-3">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="text-12 text-text-secondary flex flex-wrap items-center gap-2">
                    <span className="text-14 text-text font-semibold">
                      {plan.name}
                    </span>
                    <span>({plan.key})</span>
                    {plan.status === "retired" ? (
                      <span>{t("retiredTag")}</span>
                    ) : null}
                    {current ? (
                      <span>
                        {t("versionLine", {
                          version: current.version,
                          floor: formatCents(current.minPriceCents),
                          minShare: formatCents(current.minPlatformShareCents),
                          base: formatCents(current.partnerBasePriceCents),
                          interval: labels.interval(current.billingInterval),
                        })}
                        {current.moduleKeys.length
                          ? t("modulesList", {
                              modules: current.moduleKeys.join(", "),
                            })
                          : current.provisional
                            ? t("modulesTbd")
                            : t("noModules")}
                        {Object.keys(current.limits).length
                          ? t("limitsList", {
                              limits: Object.entries(current.limits)
                                .map(([k, v]) => `${k} ${v}`)
                                .join(", "),
                            })
                          : ""}
                      </span>
                    ) : (
                      <span>{t("noVersion")}</span>
                    )}
                    {current?.provisional ? <ProvisionalBadge /> : null}
                  </div>
                  {canManage ? (
                    <ActionForm
                      action={setPlanStatusAction}
                      submitLabel={
                        plan.status === "active"
                          ? t("retire")
                          : tb("console.reactivate")
                      }
                      tone="neutral"
                    >
                      <input type="hidden" name="planId" value={plan.id} />
                      <input
                        type="hidden"
                        name="status"
                        value={plan.status === "active" ? "retired" : "active"}
                      />
                    </ActionForm>
                  ) : null}
                </div>
                {canManage ? (
                  <details className="border-border rounded-lg border p-3">
                    <summary className="text-12 text-text-subtle cursor-pointer font-semibold">
                      {t("publishVersion")}
                    </summary>
                    <ActionForm
                      action={publishPlanVersionAction}
                      submitLabel={t("publishVersionSubmit")}
                      className="mt-3 grid gap-3 sm:grid-cols-3"
                      testId={`publish-version-${plan.key}`}
                    >
                      <input type="hidden" name="planId" value={plan.id} />
                      <Label className="flex-col items-start">
                        {t("floorLabel")}
                        <Input
                          name="minPrice"
                          required
                          inputMode="decimal"
                          defaultValue={
                            current ? centsInput(current.minPriceCents) : ""
                          }
                        />
                      </Label>
                      <Label className="flex-col items-start">
                        {t("minShareLabel")}
                        <Input
                          name="minPlatformShare"
                          required
                          inputMode="decimal"
                          defaultValue={
                            current
                              ? centsInput(current.minPlatformShareCents)
                              : ""
                          }
                        />
                      </Label>
                      <Label className="flex-col items-start">
                        {t("basePriceLabel")}
                        <Input
                          name="partnerBasePrice"
                          required
                          inputMode="decimal"
                          defaultValue={
                            current
                              ? centsInput(current.partnerBasePriceCents)
                              : ""
                          }
                        />
                      </Label>
                      <Label className="flex-col items-start">
                        {t("intervalLabel")}
                        <NativeSelect
                          name="billingInterval"
                          defaultValue={current?.billingInterval ?? "monthly"}
                          className="w-full"
                        >
                          <NativeSelectOption value="monthly">
                            {t("monthly")}
                          </NativeSelectOption>
                          <NativeSelectOption value="yearly">
                            {t("yearly")}
                          </NativeSelectOption>
                        </NativeSelect>
                      </Label>
                      <fieldset className="text-12 text-text-subtle flex flex-col gap-1 font-medium sm:col-span-2">
                        {t("modulesLabel")}
                        <div className="flex flex-wrap gap-3">
                          {modules.map((m) => (
                            <Label key={m.moduleKey} className="font-normal">
                              <Checkbox
                                name="moduleKeys"
                                value={m.moduleKey}
                                defaultChecked={Boolean(
                                  current?.moduleKeys.includes(m.moduleKey),
                                )}
                              />
                              {m.displayName}
                            </Label>
                          ))}
                        </div>
                      </fieldset>
                      {quotaKeys.map((quota) => (
                        <Label key={quota.key} className="flex-col items-start">
                          {t("limitLabel", { key: quota.key })}
                          <Input
                            name={`limit.${quota.key}`}
                            inputMode="numeric"
                            title={quota.description}
                            defaultValue={
                              current?.limits[quota.key] !== undefined
                                ? String(current.limits[quota.key])
                                : ""
                            }
                          />
                        </Label>
                      ))}
                      <Label className="text-12 text-text-subtle flex items-center gap-2 font-medium sm:col-span-3">
                        <Checkbox
                          name="provisional"
                          defaultChecked={current?.provisional ?? true}
                        />
                        {t("provisionalValues")}
                      </Label>
                    </ActionForm>
                  </details>
                ) : null}
              </li>
            );
          })}
        </ul>
        {canManage ? (
          <ActionForm
            action={createPlanAction}
            submitLabel={tb("console.createPlan")}
            className="grid gap-3 sm:grid-cols-2"
            testId="create-plan"
          >
            <Label className="flex-col items-start">
              {tb("console.name")}
              <Input name="name" required maxLength={80} />
            </Label>
            <Label className="flex-col items-start">
              {t("keyLabel")}
              <Input name="key" required maxLength={48} />
            </Label>
          </ActionForm>
        ) : null}
      </section>

      {/* Split rules */}
      <section className={sectionClass}>
        <h2 className="text-14 text-text font-semibold">{t("splitTitle")}</h2>
        <ul
          className="text-12 text-text-secondary space-y-1"
          data-testid="split-rules"
        >
          {data.rules.map((rule) => (
            <li key={rule.id}>
              {rule.partnerId
                ? (partnerById.get(rule.partnerId)?.name ??
                  t("partnerFallback"))
                : t("ruleDefault")}{" "}
              {t("ruleLine", {
                version: rule.version,
                percent: format.number(rule.platformPercentBp / 100),
                date: formatDate(rule.createdAt),
              })}
            </li>
          ))}
        </ul>
        {canManage ? (
          <ActionForm
            action={publishSplitRuleAction}
            submitLabel={t("publishRule")}
            className="grid gap-3 sm:grid-cols-2"
            testId="publish-split-rule"
          >
            <Label className="flex-col items-start">
              {t("appliesTo")}
              <NativeSelect name="partnerId" className="w-full">
                <NativeSelectOption value="">
                  {t("defaultOption")}
                </NativeSelectOption>
                {data.partners
                  .filter((p) => !p.isHouse)
                  .map((p) => (
                    <NativeSelectOption key={p.id} value={p.id}>
                      {p.name}
                    </NativeSelectOption>
                  ))}
              </NativeSelect>
            </Label>
            <Label className="flex-col items-start">
              {t("percentLabel")}
              <Input name="platformPercent" required inputMode="decimal" />
            </Label>
          </ActionForm>
        ) : null}
      </section>

      {/* Payments */}
      <section className={sectionClass}>
        <h2 className="text-14 text-text font-semibold">
          {t("paymentsTitle")}
        </h2>
        <ul className="divide-border divide-y" data-testid="platform-payments">
          {data.payments.map((payment) => (
            <li
              key={payment.id}
              className="flex flex-wrap items-center justify-between gap-3 py-2"
            >
              <div className="text-12 text-text-secondary">
                <span className="text-text font-semibold">
                  {partnerById.get(payment.partnerId)?.name ??
                    t("partnerFallback")}
                </span>{" "}
                ·{" "}
                {orgNames.get(payment.organizationId) ??
                  tb("console.customerFallback")}{" "}
                · {payment.kind === "refund" ? tb("console.refundOf") : ""}
                {formatCents(payment.amountCents)} ·{" "}
                {labels.method(payment.method)} · {formatDate(payment.paidOn)}
                {payment.refunded ? tb("console.refunded") : ""}
              </div>
              <div className="flex items-center gap-2">
                {payment.hasEvidence ? (
                  <a
                    href={`/platform/billing/evidence/${payment.id}`}
                    className="text-12 text-text-subtle font-medium underline"
                  >
                    {tb("console.evidence")}
                  </a>
                ) : null}
                {canManage &&
                payment.kind === "payment" &&
                !payment.refunded ? (
                  <ActionForm
                    action={refundPaymentAction}
                    submitLabel={t("refund")}
                    tone="neutral"
                  >
                    <input type="hidden" name="paymentId" value={payment.id} />
                    <Input
                      name="reason"
                      placeholder={t("reasonPlaceholder")}
                      maxLength={500}
                      aria-label={t("reasonLabel")}
                    />
                  </ActionForm>
                ) : null}
              </div>
            </li>
          ))}
          {data.payments.length === 0 ? (
            <li className="text-12 text-text-secondary py-2">
              {t("noPayments")}
            </li>
          ) : null}
        </ul>
      </section>
    </div>
  );
}
