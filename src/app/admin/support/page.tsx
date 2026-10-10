import type { Metadata } from "next";
import Link from "next/link";
import { Hand } from "lucide-react";

import { ModuleNotice } from "@/components/modules/module-notice";
import { ModulePageHeader } from "@/components/modules/module-page-header";
import {
  ActionForm,
  inputClass,
  labelClass,
} from "@/components/partners/action-form";
import { supportStatusLabel } from "@/components/partners/support-status";
import { requirePartnerConsolePage } from "@/core/auth/page-guard";
import { partnerGrants } from "@/core/module-runtime/loaders";
import {
  endOwnSupportGrantAction,
  requestSupportAccessAction,
} from "@/core/partners/actions";
import { listPartnerCustomers } from "@/core/partners/members";
import {
  listPartnerSupportGrants,
  MAX_SUPPORT_HOURS,
} from "@/core/partners/support";
import { prisma } from "@/lib/prisma/client";
import { withIdentityContext } from "@/lib/prisma/with-identity-context";

export const metadata: Metadata = { title: "Acesso de suporte (Parceiro)" };

/** Temporary support access requests of the partner (ADR 0012, P4b2). */
export default async function PartnerSupportPage() {
  const { identity, partner, membership } =
    await requirePartnerConsolePage("/admin/support");
  if (!partnerGrants(membership.role)("partner.support.request")) {
    return <ModuleNotice variant="denied" />;
  }

  const { customers, grants } = await withIdentityContext(
    prisma,
    identity.userId,
    async (tx) => ({
      customers: await listPartnerCustomers(tx, partner.partnerId),
      grants: await listPartnerSupportGrants(tx, partner.partnerId),
    }),
    { partnerId: partner.partnerId },
  );
  const names = new Map(customers.map((c) => [c.id, c.name]));

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <ModulePageHeader
        trail={["Parceiro", "Acesso de suporte"]}
        title="Acesso de suporte"
        description="Para entrar no workspace de um cliente, peça acesso com o motivo e o prazo. O cliente aprova, vê o histórico e pode revogar a qualquer momento. O acesso é só de leitura."
        icon={<Hand className="h-5 w-5" />}
      />

      <section className="border-card-border bg-surface-card space-y-3 rounded-xl border p-4 shadow-xs">
        <h2 className="text-14 text-text font-semibold">Novo pedido</h2>
        <ActionForm
          action={requestSupportAccessAction}
          submitLabel="Pedir acesso"
          className="grid gap-3 sm:grid-cols-2"
          testId="request-support"
        >
          <label className={labelClass}>
            Cliente
            <select name="organizationId" required className={inputClass}>
              {customers.map((customer) => (
                <option key={customer.id} value={customer.id}>
                  {customer.name}
                </option>
              ))}
            </select>
          </label>
          <label className={labelClass}>
            Prazo (horas, até {MAX_SUPPORT_HOURS})
            <input
              name="durationHours"
              type="number"
              min={1}
              max={MAX_SUPPORT_HOURS}
              defaultValue={4}
              required
              className={inputClass}
            />
          </label>
          <label className={`${labelClass} sm:col-span-2`}>
            Motivo
            <textarea
              name="reason"
              required
              minLength={10}
              maxLength={500}
              rows={3}
              className={inputClass}
            />
          </label>
        </ActionForm>
      </section>

      <ul
        className="border-card-border bg-surface-card divide-border divide-y rounded-xl border shadow-xs"
        data-testid="partner-support-grants"
      >
        {grants.map((grant) => (
          <li
            key={grant.id}
            className="flex flex-wrap items-center justify-between gap-4 p-4"
          >
            <div>
              <div className="text-14 text-text font-semibold">
                {names.get(grant.organizationId) ?? "Cliente"} ·{" "}
                {grant.granteeEmail}
              </div>
              <div className="text-12 text-text-secondary">
                {supportStatusLabel(grant)} · {grant.durationHours} h ·{" "}
                {grant.reason}
              </div>
            </div>
            <div className="flex items-center gap-2">
              {grant.active && grant.workspaceSlug ? (
                <Link
                  href={`/app/${grant.workspaceSlug}`}
                  className="text-12 text-text-subtle font-medium underline"
                >
                  Abrir workspace
                </Link>
              ) : null}
              {grant.status === "pending" || grant.active ? (
                <ActionForm
                  action={endOwnSupportGrantAction}
                  submitLabel={
                    grant.status === "pending" ? "Cancelar" : "Encerrar"
                  }
                  tone="neutral"
                >
                  <input type="hidden" name="grantId" value={grant.id} />
                </ActionForm>
              ) : null}
            </div>
          </li>
        ))}
        {grants.length === 0 ? (
          <li className="text-12 text-text-secondary p-4">
            Nenhum pedido ainda.
          </li>
        ) : null}
      </ul>
    </div>
  );
}
