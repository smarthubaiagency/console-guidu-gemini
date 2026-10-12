import type { Metadata } from "next";
import { Layers } from "lucide-react";
import { getTranslations } from "next-intl/server";

import { ModuleNotice } from "@/components/modules/module-notice";
import { ModulePageHeader } from "@/components/modules/module-page-header";
import { ActionForm } from "@/components/partners/action-form";
import { inputClass, labelClass } from "@/components/partners/form-classes";
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
import { getModuleCatalog } from "@/core/i18n/modules";
import { prisma } from "@/lib/prisma/client";
import { withIdentityContext } from "@/lib/prisma/with-identity-context";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("partnerConsole");
  return { title: t("templates.metaTitle") };
}

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
  const catalog = await getModuleCatalog();
  const names = new Map(
    listOfferableModules().map((m) => [
      m.moduleKey,
      catalog.name(m.moduleKey, m.displayName),
    ]),
  );

  const t = await getTranslations("partnerConsole");

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <ModulePageHeader
        title={t("templates.title")}
        description={t("templates.description")}
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
                  : t("templates.noModules")}
              </div>
            </div>
            <ActionForm
              action={deleteWorkspaceTemplateAction}
              submitLabel={t("templates.remove")}
              tone="neutral"
            >
              <input type="hidden" name="templateId" value={template.id} />
            </ActionForm>
          </li>
        ))}
        {templates.length === 0 ? (
          <li className="text-12 text-text-secondary p-4">
            {t("templates.empty")}
          </li>
        ) : null}
      </ul>

      <section className="border-card-border bg-surface-card space-y-3 rounded-xl border p-4 shadow-xs">
        <h2 className="text-14 text-text font-semibold">
          {t("templates.newTitle")}
        </h2>
        <ActionForm
          action={createWorkspaceTemplateAction}
          submitLabel={t("templates.create")}
          className="space-y-3"
          testId="create-template"
        >
          <label className={labelClass}>
            {t("templates.name")}
            <input name="name" required maxLength={80} className={inputClass} />
          </label>
          <fieldset className="space-y-1">
            <legend className="text-12 text-text-subtle font-medium">
              {t("templates.modules")}
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
                {t("templates.offerHint")}
              </p>
            ) : null}
          </fieldset>
        </ActionForm>
      </section>
    </div>
  );
}
