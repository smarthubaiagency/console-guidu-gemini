import type { Metadata } from "next";
import { Building2 } from "lucide-react";

import { ModuleNotice } from "@/components/modules/module-notice";
import { ModulePageHeader } from "@/components/modules/module-page-header";
import {
  ActionForm,
  inputClass,
  labelClass,
} from "@/components/partners/action-form";
import { requirePartnerConsolePage } from "@/core/auth/page-guard";
import { partnerGrants } from "@/core/module-runtime/loaders";
import { createPartnerCustomerAction } from "@/core/partners/actions";
import { listWorkspaceTemplates } from "@/core/partners/customers";
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
  const grants = partnerGrants(membership.role);
  if (!grants("partner.customers.read")) {
    return <ModuleNotice variant="denied" />;
  }
  const canManage = grants("partner.customers.manage");

  const { customers, templates } = await withIdentityContext(
    prisma,
    identity.userId,
    async (tx) => ({
      customers: await listPartnerCustomers(tx, partner.partnerId),
      templates: canManage
        ? await listWorkspaceTemplates(tx, partner.partnerId)
        : [],
    }),
    { partnerId: partner.partnerId },
  );

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <ModulePageHeader
        trail={["Parceiro", "Clientes"]}
        title="Clientes"
        description="Empresas atendidas por este parceiro. O console mostra só os dados cadastrais, nunca o conteúdo dos workspaces."
        icon={<Building2 className="h-5 w-5" />}
      />
      {canManage ? (
        <section className="border-card-border bg-surface-card space-y-3 rounded-xl border p-4 shadow-xs">
          <h2 className="text-14 text-text font-semibold">Novo cliente</h2>
          <ActionForm
            action={createPartnerCustomerAction}
            submitLabel="Cadastrar cliente"
            className="grid gap-3 sm:grid-cols-2"
            testId="create-customer"
          >
            <label className={labelClass}>
              Empresa
              <input
                name="organizationName"
                required
                maxLength={120}
                className={inputClass}
              />
            </label>
            <label className={labelClass}>
              E-mail do responsável
              <input
                name="ownerEmail"
                type="email"
                required
                className={inputClass}
              />
            </label>
            <label className={labelClass}>
              Nome do workspace
              <input
                name="workspaceName"
                required
                maxLength={80}
                className={inputClass}
              />
            </label>
            <label className={labelClass}>
              Endereço do workspace
              <input
                name="workspaceSlug"
                required
                pattern="[a-z0-9][a-z0-9-]{1,46}[a-z0-9]"
                placeholder="empresa-exemplo"
                className={inputClass}
              />
            </label>
            <label className={labelClass}>
              Modelo de workspace
              <select name="templateId" defaultValue="" className={inputClass}>
                <option value="">Sem modelo (nenhum módulo habilitado)</option>
                {templates.map((template) => (
                  <option key={template.id} value={template.id}>
                    {template.name}
                  </option>
                ))}
              </select>
            </label>
          </ActionForm>
          <p className="text-11 text-text-tertiary">
            O responsável recebe um convite de proprietário, válido por 7 dias,
            e entra pelo seu domínio. Até a cobrança (P5), o cliente fica ativo
            assim que é cadastrado.
          </p>
        </section>
      ) : null}

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
