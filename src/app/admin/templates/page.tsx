import type { Metadata } from "next";
import { Layers } from "lucide-react";

import { ModuleNotice } from "@/components/modules/module-notice";
import { ModulePageHeader } from "@/components/modules/module-page-header";
import {
  ActionForm,
  inputClass,
  labelClass,
} from "@/components/partners/action-form";
import { requirePartnerConsolePage } from "@/core/auth/page-guard";
import { partnerGrants } from "@/core/module-runtime/loaders";
import {
  createWorkspaceTemplateAction,
  deleteWorkspaceTemplateAction,
} from "@/core/partners/actions";
import {
  listOfferableModules,
  listOfferedModuleKeys,
  listWorkspaceTemplates,
} from "@/core/partners/customers";
import { prisma } from "@/lib/prisma/client";
import { withIdentityContext } from "@/lib/prisma/with-identity-context";

export const metadata: Metadata = { title: "Modelos de workspace (Parceiro)" };

/** Workspace templates of the partner (ADR 0012, P4b). */
export default async function PartnerTemplatesPage() {
  const { identity, partner, membership } =
    await requirePartnerConsolePage("/admin/templates");
  if (!partnerGrants(membership.role)("partner.customers.manage")) {
    return <ModuleNotice variant="denied" />;
  }

  const { templates, offeredKeys } = await withIdentityContext(
    prisma,
    identity.userId,
    async (tx) => ({
      templates: await listWorkspaceTemplates(tx, partner.partnerId),
      offeredKeys: await listOfferedModuleKeys(tx, partner.partnerId),
    }),
    { partnerId: partner.partnerId },
  );
  const names = new Map(
    listOfferableModules().map((m) => [m.moduleKey, m.displayName]),
  );

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <ModulePageHeader
        trail={["Parceiro", "Modelos de workspace"]}
        title="Modelos de workspace"
        description="Conjuntos de módulos aplicados ao primeiro workspace de um cliente novo."
        icon={<Layers className="h-5 w-5" />}
      />

      <ul
        className="border-card-border bg-surface-card divide-border divide-y rounded-xl border shadow-xs"
        data-testid="partner-templates"
      >
        {templates.map((template) => (
          <li
            key={template.id}
            className="flex items-center justify-between gap-4 p-4"
          >
            <div>
              <div className="text-14 text-text font-semibold">
                {template.name}
              </div>
              <div className="text-12 text-text-secondary">
                {template.moduleKeys.length > 0
                  ? template.moduleKeys
                      .map((key) => names.get(key) ?? key)
                      .join(", ")
                  : "Sem módulos"}
              </div>
            </div>
            <ActionForm
              action={deleteWorkspaceTemplateAction}
              submitLabel="Remover"
              tone="neutral"
            >
              <input type="hidden" name="templateId" value={template.id} />
            </ActionForm>
          </li>
        ))}
        {templates.length === 0 ? (
          <li className="text-12 text-text-secondary p-4">
            Nenhum modelo ainda.
          </li>
        ) : null}
      </ul>

      <section className="border-card-border bg-surface-card space-y-3 rounded-xl border p-4 shadow-xs">
        <h2 className="text-14 text-text font-semibold">Novo modelo</h2>
        <ActionForm
          action={createWorkspaceTemplateAction}
          submitLabel="Criar modelo"
          className="space-y-3"
          testId="create-template"
        >
          <label className={labelClass}>
            Nome
            <input name="name" required maxLength={80} className={inputClass} />
          </label>
          <fieldset className="space-y-1">
            <legend className="text-12 text-text-subtle font-medium">
              Módulos
            </legend>
            {offeredKeys.map((key) => (
              <label
                key={key}
                className="text-14 text-text flex items-center gap-2"
              >
                <input type="checkbox" name="moduleKeys" value={key} />
                {names.get(key) ?? key}
              </label>
            ))}
            {offeredKeys.length === 0 ? (
              <p className="text-12 text-text-secondary">
                Ofereça módulos em &quot;Módulos oferecidos&quot; para
                incluí-los em modelos.
              </p>
            ) : null}
          </fieldset>
        </ActionForm>
      </section>
    </div>
  );
}
