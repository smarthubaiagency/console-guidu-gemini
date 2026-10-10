import { randomUUID } from "node:crypto";

import type { Metadata } from "next";
import { CreditCard } from "lucide-react";

import {
  centsInput,
  formatDate,
  intervalLabel,
  METHOD_LABELS,
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
import {
  ActionForm,
  inputClass,
  labelClass,
} from "@/components/partners/action-form";
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
} from "@/core/billing/partner";
import { PAYMENT_METHODS } from "@/core/billing/provider";
import { formatCents } from "@/core/billing/split";
import {
  canTransition,
  MANUAL_STATUS_TARGETS,
  statusLabel,
} from "@/core/billing/subscriptions";
import { requirePartnerConsolePage } from "@/core/auth/page-guard";
import { partnerGrants } from "@/core/module-runtime/loaders";
import { prisma } from "@/lib/prisma/client";
import { withIdentityContext } from "@/lib/prisma/with-identity-context";

export const metadata: Metadata = { title: "Cobrança (Parceiro)" };

const STATUS_ACTIONS: Record<(typeof MANUAL_STATUS_TARGETS)[number], string> = {
  past_due: "Marcar em atraso",
  suspended: "Suspender",
  canceled: "Cancelar",
};

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

  return (
    <div className="mx-auto max-w-5xl space-y-6" data-testid="partner-billing">
      <ModulePageHeader
        trail={["Parceiro", "Cobrança"]}
        title="Cobrança"
        description="Modo parceiro paga: você ativa o plano de cada cliente e registra as mensalidades pagas à plataforma, com comprovante. A cobrança automática chega com o provedor de pagamento."
        icon={<CreditCard className="h-5 w-5" />}
      />

      {/* Customers and subscriptions */}
      <section className={sectionClass}>
        <h2 className="text-14 text-text font-semibold">
          Clientes e assinaturas
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
                        {row.subscription.planName} v
                        {row.subscription.planVersion} ·{" "}
                        {formatCents(row.subscription.amountCents)}/
                        {intervalLabel(row.subscription.billingInterval)}
                      </span>
                      {row.subscription.currentPeriodEnd ? (
                        <span>
                          · pago até{" "}
                          {formatDate(row.subscription.currentPeriodEnd)}
                        </span>
                      ) : null}
                      {row.subscription.provisional ? (
                        <ProvisionalBadge />
                      ) : null}
                    </div>
                  ) : (
                    <div className="text-12 text-text-secondary">
                      Sem plano · legado: módulos e limites como antes
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
                        submitLabel={STATUS_ACTIONS[to]}
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
                  submitLabel="Abrir assinatura"
                  testId={`start-subscription-${row.organizationId}`}
                >
                  <input
                    type="hidden"
                    name="organizationId"
                    value={row.organizationId}
                  />
                  <label className={labelClass}>
                    Plano
                    <select name="planId" className={inputClass}>
                      {data.plans.map((plan) => (
                        <option key={plan.id} value={plan.id}>
                          {plan.name}
                          {plan.versions[0]
                            ? ` · ${formatCents(plan.versions[0].partnerBasePriceCents)}/${intervalLabel(plan.versions[0].billingInterval)}`
                            : ""}
                        </option>
                      ))}
                    </select>
                  </label>
                </ActionForm>
              ) : null}

              {canManage && row.subscription ? (
                <details className="border-border rounded-lg border p-3">
                  <summary className="text-12 text-text-subtle cursor-pointer font-semibold">
                    Registrar pagamento
                  </summary>
                  <ActionForm
                    action={recordManualPaymentAction}
                    submitLabel="Registrar pagamento"
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
                    <label className={labelClass}>
                      Valor pago (R$)
                      <input
                        name="amount"
                        required
                        inputMode="decimal"
                        defaultValue={centsInput(row.subscription.amountCents)}
                        className={inputClass}
                      />
                    </label>
                    <label className={labelClass}>
                      Data do pagamento
                      <input
                        name="paidOn"
                        type="date"
                        required
                        max={todayInput()}
                        defaultValue={todayInput()}
                        className={inputClass}
                      />
                    </label>
                    <label className={labelClass}>
                      Meio
                      <select name="method" className={inputClass}>
                        {PAYMENT_METHODS.map((method) => (
                          <option key={method} value={method}>
                            {METHOD_LABELS[method]}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className={labelClass}>
                      Comprovante (PDF, PNG, JPEG ou WebP, até{" "}
                      {Math.round(MAX_EVIDENCE_BYTES / 1024)} KB)
                      <input
                        name="evidence"
                        type="file"
                        required
                        accept="application/pdf,image/png,image/jpeg,image/webp"
                        className={inputClass}
                      />
                    </label>
                    <label className={`${labelClass} sm:col-span-2`}>
                      Observação (opcional)
                      <input
                        name="note"
                        maxLength={500}
                        className={inputClass}
                      />
                    </label>
                  </ActionForm>
                </details>
              ) : null}
            </li>
          ))}
          {data.customers.length === 0 ? (
            <li className="text-12 text-text-secondary py-3">
              Nenhum cliente ainda.
            </li>
          ) : null}
        </ul>
      </section>

      {/* Payments */}
      <section className={sectionClass}>
        <h2 className="text-14 text-text font-semibold">
          Pagamentos registrados
        </h2>
        <ul className="divide-border divide-y" data-testid="billing-payments">
          {data.payments.map((payment) => (
            <li
              key={payment.id}
              className="flex flex-wrap items-center justify-between gap-3 py-2"
            >
              <div className="text-12 text-text-secondary">
                <span className="text-text font-semibold">
                  {names.get(payment.organizationId) ?? "Cliente"}
                </span>{" "}
                · {payment.kind === "refund" ? "Estorno de " : ""}
                {formatCents(payment.amountCents)} ·{" "}
                {METHOD_LABELS[payment.method] ?? payment.method} ·{" "}
                {formatDate(payment.paidOn)}
                {payment.periodStart
                  ? ` · período ${formatDate(payment.periodStart)} a ${formatDate(payment.periodEnd)}`
                  : ""}
                {payment.refunded ? " · estornado" : ""}
              </div>
              {payment.hasEvidence ? (
                <a
                  href={`/admin/billing/evidence/${payment.id}`}
                  className="text-12 text-text-subtle font-medium underline"
                >
                  Comprovante
                </a>
              ) : null}
            </li>
          ))}
          {data.payments.length === 0 ? (
            <li className="text-12 text-text-secondary py-2">
              Nenhum pagamento registrado.
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
            <h2 className="text-14 text-text font-semibold">Ativar checkout</h2>
            <p className="text-12 text-text-secondary">
              {blocked
                ? "Bloqueado pela plataforma."
                : checkoutOn
                  ? "Ligado: seus clientes veem um checkout de demonstração, que não cobra nada."
                  : "Desligado: seus clientes não veem checkout."}
            </p>
          </div>
          {canManage && !blocked ? (
            <ActionForm
              action={setCheckoutEnabledAction}
              submitLabel={
                checkoutOn ? "Desativar checkout" : "Ativar checkout"
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
              {p.met ? "✓" : "○"} {p.label}
              {!p.met && !p.requiredNow
                ? " — pendente, exigido quando o provedor for ativado"
                : ""}
            </li>
          ))}
        </ul>
      </section>

      {/* Partner plans */}
      <section className={sectionClass}>
        <h2 className="text-14 text-text font-semibold">
          Seus planos (preço ao cliente)
        </h2>
        <p className="text-12 text-text-secondary">
          Usados no checkout. O preço não pode ficar abaixo do piso do plano
          base.
        </p>
        <ul className="divide-border divide-y" data-testid="partner-plans">
          {data.partnerPlans.map((plan) => (
            <li
              key={plan.id}
              className="flex flex-wrap items-center justify-between gap-3 py-2"
            >
              <div className="text-12 text-text-secondary">
                <span className="text-text font-semibold">{plan.name}</span> ·{" "}
                {formatCents(plan.priceCents)}/
                {intervalLabel(plan.billingInterval)} · base {plan.planName} v
                {plan.planVersion} (piso {formatCents(plan.minPriceCents)})
                {plan.status === "archived" ? " · arquivado" : ""}
              </div>
              {canManage ? (
                <ActionForm
                  action={setPartnerPlanStatusAction}
                  submitLabel={
                    plan.status === "active" ? "Arquivar" : "Reativar"
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
            <li className="text-12 text-text-secondary py-2">
              Nenhum plano seu ainda.
            </li>
          ) : null}
        </ul>
        {canManage && data.plans.length > 0 ? (
          <ActionForm
            action={createPartnerPlanAction}
            submitLabel="Criar plano"
            className="grid gap-3 sm:grid-cols-3"
            testId="create-partner-plan"
          >
            <label className={labelClass}>
              Plano base
              <select name="planId" className={inputClass}>
                {data.plans.map((plan) => (
                  <option key={plan.id} value={plan.id}>
                    {plan.name}
                    {plan.versions[0]
                      ? ` (piso ${formatCents(plan.versions[0].minPriceCents)})`
                      : ""}
                  </option>
                ))}
              </select>
            </label>
            <label className={labelClass}>
              Nome
              <input
                name="name"
                required
                maxLength={80}
                className={inputClass}
              />
            </label>
            <label className={labelClass}>
              Preço (R$)
              <input
                name="price"
                required
                inputMode="decimal"
                className={inputClass}
              />
            </label>
          </ActionForm>
        ) : null}
      </section>

      {/* Billing profile */}
      <section className={sectionClass}>
        <h2 className="text-14 text-text font-semibold">Dados de cobrança</h2>
        <p className="text-12 text-text-secondary">
          Seus dados como pagador da plataforma. Provedor:{" "}
          {data.profile?.provider === "manual" || !data.profile
            ? "registro manual"
            : data.profile.provider}
          .
        </p>
        {canManage ? (
          <ActionForm
            action={saveBillingProfileAction}
            submitLabel="Salvar dados"
            className="grid gap-3 sm:grid-cols-3"
            testId="billing-profile"
          >
            <label className={labelClass}>
              Razão social
              <input
                name="legalName"
                required
                maxLength={160}
                defaultValue={data.profile?.legalName ?? ""}
                className={inputClass}
              />
            </label>
            <label className={labelClass}>
              CNPJ
              <input
                name="taxId"
                required
                defaultValue={data.profile?.taxId ?? ""}
                className={inputClass}
              />
            </label>
            <label className={labelClass}>
              E-mail financeiro
              <input
                name="billingEmail"
                type="email"
                required
                defaultValue={data.profile?.billingEmail ?? ""}
                className={inputClass}
              />
            </label>
          </ActionForm>
        ) : data.profile ? (
          <p className="text-12 text-text-subtle">
            {data.profile.legalName} · {data.profile.taxId} ·{" "}
            {data.profile.billingEmail}
          </p>
        ) : (
          <p className="text-12 text-text-secondary">Não cadastrados.</p>
        )}
      </section>

      <p className="text-11 text-text-secondary">
        Situações: {MANUAL_STATUS_TARGETS.map(statusLabel).join(", ")} são
        marcadas por você; a assinatura fica ativa com cada pagamento
        registrado.
      </p>
      <p className="text-11 text-text-secondary" data-testid="billing-terms">
        Sem pagamento registrado, a assinatura fica em atraso{" "}
        {data.terms.pastDueAfterDays} dia(s) depois do vencimento e é suspensa{" "}
        {data.terms.suspendAfterDays} dia(s) depois disso, automaticamente.
        {data.terms.provisional ? " Prazos provisórios." : ""}
      </p>
    </div>
  );
}
