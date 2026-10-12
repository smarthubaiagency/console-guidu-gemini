import type { Metadata } from "next";
import { Building2 } from "lucide-react";
import { getFormatter, getTranslations } from "next-intl/server";

import { ModuleNotice } from "@/components/modules/module-notice";
import { ModulePageHeader } from "@/components/modules/module-page-header";
import { ActionForm } from "@/components/partners/action-form";
import { requirePartnerConsolePage } from "@/core/auth/page-guard";
import { partnerGrants } from "@/core/module-runtime/loaders";
import { createPartnerCustomerAction } from "@/core/partners/actions";
import { listWorkspaceTemplates } from "@/core/partners/customers";
import { listPartnerCustomers } from "@/core/partners/members";
import { prisma } from "@/lib/prisma/client";
import { withIdentityContext } from "@/lib/prisma/with-identity-context";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  NativeSelect,
  NativeSelectOption,
} from "@/components/ui/native-select";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("partnerConsole");
  return { title: t("customers.metaTitle") };
}

const STATUS_KEYS = new Set(["active", "suspended", "inactive"]);

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

  const t = await getTranslations("partnerConsole");
  const format = await getFormatter();

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <ModulePageHeader
        title={t("customers.title")}
        description={t("customers.description")}
        icon={<Building2 className="h-5 w-5" />}
      />
      {canManage ? (
        <section className="border-card-border bg-surface-card space-y-3 rounded-xl border p-4 shadow-xs">
          <h2 className="text-14 text-text font-semibold">
            {t("customers.newTitle")}
          </h2>
          <ActionForm
            action={createPartnerCustomerAction}
            submitLabel={t("customers.submit")}
            className="grid gap-3 sm:grid-cols-2"
            testId="create-customer"
          >
            <Label className="flex-col items-start">
              {t("customers.company")}
              <Input name="organizationName" required maxLength={120} />
            </Label>
            <Label className="flex-col items-start">
              {t("customers.ownerEmail")}
              <Input name="ownerEmail" type="email" required />
            </Label>
            <Label className="flex-col items-start">
              {t("customers.workspaceName")}
              <Input name="workspaceName" required maxLength={80} />
            </Label>
            <Label className="flex-col items-start">
              {t("customers.workspaceSlug")}
              <Input
                name="workspaceSlug"
                required
                pattern="[a-z0-9][a-z0-9-]{1,46}[a-z0-9]"
                placeholder={t("customers.slugPlaceholder")}
              />
            </Label>
            <Label className="flex-col items-start">
              {t("customers.template")}
              <NativeSelect
                name="templateId"
                defaultValue=""
                className="w-full"
              >
                <NativeSelectOption value="">
                  {t("customers.noTemplate")}
                </NativeSelectOption>
                {templates.map((template) => (
                  <NativeSelectOption key={template.id} value={template.id}>
                    {template.name}
                  </NativeSelectOption>
                ))}
              </NativeSelect>
            </Label>
          </ActionForm>
          <p className="text-11 text-text-tertiary">{t("customers.hint")}</p>
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
              {STATUS_KEYS.has(customer.status)
                ? t(`customers.status.${customer.status}`)
                : customer.status}{" "}
              ·{" "}
              {t("customers.since", {
                date: format.dateTime(customer.createdAt, {
                  dateStyle: "short",
                }),
              })}
            </div>
          </li>
        ))}
        {customers.length === 0 ? (
          <li className="text-12 text-text-secondary p-4">
            {t("customers.empty")}
          </li>
        ) : null}
      </ul>
    </div>
  );
}
