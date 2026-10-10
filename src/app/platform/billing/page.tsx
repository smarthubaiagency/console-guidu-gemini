import type { Metadata } from "next";
import { CreditCard } from "lucide-react";

import {
  centsInput,
  formatDate,
  intervalLabel,
  METHOD_LABELS,
  ProvisionalBadge,
  sectionClass,
} from "@/components/billing/billing-ui";
import { ModuleNotice } from "@/components/modules/module-notice";
import { ModulePageHeader } from "@/components/modules/module-page-header";
import {
  ActionForm,
  inputClass,
  labelClass,
} from "@/components/partners/action-form";
import { getPlatformAdminMember } from "@/core/admin/platform";
import { requirePlatformAdminPage } from "@/core/auth/page-guard";
import {
  createPlanAction,
  publishPlanVersionAction,
  publishSplitRuleAction,
  refundPaymentAction,
  setCheckoutBlockedAction,
  setPlanStatusAction,
} from "@/core/billing/actions";
import {
  listPartnerTotals,
  listPlans,
  listQuotaKeys,
  listRecentPayments,
  listSplitRules,
} from "@/core/billing/catalog";
import { formatCents } from "@/core/billing/split";
import { platformGrants } from "@/core/module-runtime/loaders";
import { getRequestPartner } from "@/core/partners/resolve";
import { prisma } from "@/lib/prisma/client";
import { withIdentityContext } from "@/lib/prisma/with-identity-context";
import { listRegisteredModules } from "@/modules/registry";

export const metadata: Metadata = { title: "Cobrança (Admin)" };

/**
 * Platform billing (P5m, D-PA-14): base plans and insert-only versions,
 * split rules, totals per partner, the checkout block and refunds of manual
 * payments. Values are records; seeded ones are marked provisional.
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
  const modules = listRegisteredModules().map((m) => m.manifest);
  const quotaKeys = listQuotaKeys();

  return (
    <div className="mx-auto max-w-5xl space-y-6" data-testid="platform-billing">
      <ModulePageHeader
        trail={["Administração", "Cobrança"]}
        title="Cobrança"
        description="Planos base, pisos, repasses e valores devidos por parceiro. Mudanças criam novas versões e não alteram assinaturas existentes."
        icon={<CreditCard className="h-5 w-5" />}
      />

      {/* Totals per partner */}
      <section className={sectionClass}>
        <h2 className="text-14 text-text font-semibold">Por parceiro</h2>
        <ul className="divide-border divide-y" data-testid="partner-totals">
          {data.totals.map((t) => {
            const p = partnerById.get(t.partnerId);
            return (
              <li
                key={t.partnerId}
                className="flex flex-wrap items-center justify-between gap-3 py-2"
              >
                <div className="text-12 text-text-secondary">
                  <span className="text-text font-semibold">
                    {t.partnerName}
                  </span>{" "}
                  · recebido {formatCents(t.receivedCents)} · estornado{" "}
                  {formatCents(t.refundedCents)} · plataforma{" "}
                  {formatCents(t.platformNetCents)} · a repassar ao parceiro{" "}
                  {formatCents(t.partnerNetCents)} · {t.openSubscriptions}{" "}
                  assinatura(s) aberta(s)
                  {p?.checkoutBlocked
                    ? " · checkout bloqueado"
                    : p?.checkoutEnabled
                      ? " · checkout ligado (demonstração)"
                      : ""}
                </div>
                {canBlock && p && !p.isHouse ? (
                  <ActionForm
                    action={setCheckoutBlockedAction}
                    submitLabel={
                      p.checkoutBlocked
                        ? "Liberar checkout"
                        : "Bloquear checkout"
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

      {/* Plans */}
      <section className={sectionClass}>
        <h2 className="text-14 text-text font-semibold">Planos base</h2>
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
                    {plan.status === "retired" ? <span>· retirado</span> : null}
                    {current ? (
                      <span>
                        v{current.version} · piso{" "}
                        {formatCents(current.minPriceCents)} · repasse mínimo{" "}
                        {formatCents(current.minPlatformShareCents)} · valor
                        base {formatCents(current.partnerBasePriceCents)}/
                        {intervalLabel(current.billingInterval)}
                        {current.moduleKeys.length
                          ? ` · módulos: ${current.moduleKeys.join(", ")}`
                          : current.provisional
                            ? " · módulos a definir (não restringe)"
                            : " · nenhum módulo"}
                        {Object.keys(current.limits).length
                          ? ` · limites: ${Object.entries(current.limits)
                              .map(([k, v]) => `${k} ${v}`)
                              .join(", ")}`
                          : ""}
                      </span>
                    ) : (
                      <span>sem versão publicada</span>
                    )}
                    {current?.provisional ? <ProvisionalBadge /> : null}
                  </div>
                  {canManage ? (
                    <ActionForm
                      action={setPlanStatusAction}
                      submitLabel={
                        plan.status === "active" ? "Retirar" : "Reativar"
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
                      Publicar nova versão
                    </summary>
                    <ActionForm
                      action={publishPlanVersionAction}
                      submitLabel="Publicar versão"
                      className="mt-3 grid gap-3 sm:grid-cols-3"
                      testId={`publish-version-${plan.key}`}
                    >
                      <input type="hidden" name="planId" value={plan.id} />
                      <label className={labelClass}>
                        Piso (R$)
                        <input
                          name="minPrice"
                          required
                          inputMode="decimal"
                          defaultValue={
                            current ? centsInput(current.minPriceCents) : ""
                          }
                          className={inputClass}
                        />
                      </label>
                      <label className={labelClass}>
                        Repasse mínimo (R$)
                        <input
                          name="minPlatformShare"
                          required
                          inputMode="decimal"
                          defaultValue={
                            current
                              ? centsInput(current.minPlatformShareCents)
                              : ""
                          }
                          className={inputClass}
                        />
                      </label>
                      <label className={labelClass}>
                        Valor base do parceiro (R$)
                        <input
                          name="partnerBasePrice"
                          required
                          inputMode="decimal"
                          defaultValue={
                            current
                              ? centsInput(current.partnerBasePriceCents)
                              : ""
                          }
                          className={inputClass}
                        />
                      </label>
                      <label className={labelClass}>
                        Periodicidade
                        <select
                          name="billingInterval"
                          defaultValue={current?.billingInterval ?? "monthly"}
                          className={inputClass}
                        >
                          <option value="monthly">Mensal</option>
                          <option value="yearly">Anual</option>
                        </select>
                      </label>
                      <fieldset className={`${labelClass} sm:col-span-2`}>
                        Módulos incluídos
                        <div className="flex flex-wrap gap-3">
                          {modules.map((m) => (
                            <label
                              key={m.moduleKey}
                              className="flex items-center gap-1"
                            >
                              <input
                                type="checkbox"
                                name="moduleKeys"
                                value={m.moduleKey}
                                defaultChecked={current?.moduleKeys.includes(
                                  m.moduleKey,
                                )}
                              />
                              {m.displayName}
                            </label>
                          ))}
                        </div>
                      </fieldset>
                      {quotaKeys.map((quota) => (
                        <label key={quota.key} className={labelClass}>
                          Limite {quota.key} (vazio = padrão)
                          <input
                            name={`limit.${quota.key}`}
                            inputMode="numeric"
                            title={quota.description}
                            defaultValue={
                              current?.limits[quota.key] !== undefined
                                ? String(current.limits[quota.key])
                                : ""
                            }
                            className={inputClass}
                          />
                        </label>
                      ))}
                      <label className="text-12 text-text-subtle flex items-center gap-2 font-medium sm:col-span-3">
                        <input
                          type="checkbox"
                          name="provisional"
                          defaultChecked={current?.provisional ?? true}
                        />
                        Valores provisórios (aguardando o Comercial)
                      </label>
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
            submitLabel="Criar plano"
            className="grid gap-3 sm:grid-cols-2"
            testId="create-plan"
          >
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
              Chave (letras minúsculas e hífen)
              <input
                name="key"
                required
                maxLength={48}
                className={inputClass}
              />
            </label>
          </ActionForm>
        ) : null}
      </section>

      {/* Split rules */}
      <section className={sectionClass}>
        <h2 className="text-14 text-text font-semibold">
          Regras de divisão (modo cliente paga)
        </h2>
        <ul
          className="text-12 text-text-secondary space-y-1"
          data-testid="split-rules"
        >
          {data.rules.map((rule) => (
            <li key={rule.id}>
              {rule.partnerId
                ? (partnerById.get(rule.partnerId)?.name ?? "Parceiro")
                : "Padrão"}{" "}
              · v{rule.version} · plataforma{" "}
              {(rule.platformPercentBp / 100).toLocaleString("pt-BR")}% · desde{" "}
              {formatDate(rule.createdAt)}
            </li>
          ))}
        </ul>
        {canManage ? (
          <ActionForm
            action={publishSplitRuleAction}
            submitLabel="Publicar regra"
            className="grid gap-3 sm:grid-cols-2"
            testId="publish-split-rule"
          >
            <label className={labelClass}>
              Aplica a
              <select name="partnerId" className={inputClass}>
                <option value="">
                  Padrão (todos os parceiros sem regra própria)
                </option>
                {data.partners
                  .filter((p) => !p.isHouse)
                  .map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
              </select>
            </label>
            <label className={labelClass}>
              Percentual da plataforma (%)
              <input
                name="platformPercent"
                required
                inputMode="decimal"
                className={inputClass}
              />
            </label>
          </ActionForm>
        ) : null}
      </section>

      {/* Payments */}
      <section className={sectionClass}>
        <h2 className="text-14 text-text font-semibold">Pagamentos recentes</h2>
        <ul className="divide-border divide-y" data-testid="platform-payments">
          {data.payments.map((payment) => (
            <li
              key={payment.id}
              className="flex flex-wrap items-center justify-between gap-3 py-2"
            >
              <div className="text-12 text-text-secondary">
                <span className="text-text font-semibold">
                  {partnerById.get(payment.partnerId)?.name ?? "Parceiro"}
                </span>{" "}
                · {orgNames.get(payment.organizationId) ?? "Cliente"} ·{" "}
                {payment.kind === "refund" ? "Estorno de " : ""}
                {formatCents(payment.amountCents)} ·{" "}
                {METHOD_LABELS[payment.method] ?? payment.method} ·{" "}
                {formatDate(payment.paidOn)}
                {payment.refunded ? " · estornado" : ""}
              </div>
              <div className="flex items-center gap-2">
                {payment.hasEvidence ? (
                  <a
                    href={`/platform/billing/evidence/${payment.id}`}
                    className="text-12 text-text-subtle font-medium underline"
                  >
                    Comprovante
                  </a>
                ) : null}
                {canManage &&
                payment.kind === "payment" &&
                !payment.refunded ? (
                  <ActionForm
                    action={refundPaymentAction}
                    submitLabel="Estornar"
                    tone="neutral"
                  >
                    <input type="hidden" name="paymentId" value={payment.id} />
                    <input
                      name="reason"
                      placeholder="Motivo"
                      maxLength={500}
                      aria-label="Motivo do estorno"
                      className={inputClass}
                    />
                  </ActionForm>
                ) : null}
              </div>
            </li>
          ))}
          {data.payments.length === 0 ? (
            <li className="text-12 text-text-secondary py-2">
              Nenhum pagamento ainda.
            </li>
          ) : null}
        </ul>
      </section>
    </div>
  );
}
