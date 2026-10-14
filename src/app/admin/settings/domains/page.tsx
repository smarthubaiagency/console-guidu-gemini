import type { Metadata } from "next";
import { Globe } from "lucide-react";
import { getTranslations } from "next-intl/server";

import { DomainList } from "@/components/domains/domain-list";
import { ModulePageHeader } from "@/components/modules/module-page-header";
import { ActionForm } from "@/components/partners/action-form";
import { SettingsCard } from "@/components/settings/settings-shell";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  NativeSelect,
  NativeSelectOption,
} from "@/components/ui/native-select";
import { requirePartnerConsolePage } from "@/core/auth/page-guard";
import {
  addPartnerDomainAction,
  addWorkspaceDomainAction,
} from "@/core/domains/actions";
import { domainsConfig } from "@/core/domains/config";
import {
  listPartnerCustomerWorkspaces,
  listPartnerDomains,
  listWorkspaceDomains,
} from "@/core/domains/service";
import { partnerGrants } from "@/core/module-runtime/loaders";
import { prisma } from "@/lib/prisma/client";
import { withIdentityContext } from "@/lib/prisma/with-identity-context";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("domains");
  return { title: t("metaTitle") };
}

/**
 * Admin › Configurações › Domínios (CF2b): the domain of the partner's
 * dashboard and the public domains of its customers' workspaces.
 */
export default async function PartnerDomainsPage() {
  const { identity, partner, membership } = await requirePartnerConsolePage(
    "/admin/settings/domains",
  );
  const grants = partnerGrants(membership.role);
  const canManageDashboard = grants("partner.settings.manage");
  const canManageCustomers = grants("partner.customers.manage");

  const { dashboard, workspaces, customerDomains } = await withIdentityContext(
    prisma,
    identity.userId,
    async (tx) => {
      const workspaces = await listPartnerCustomerWorkspaces(tx);
      return {
        dashboard: await listPartnerDomains(tx, partner.partnerId),
        workspaces,
        customerDomains: await listWorkspaceDomains(
          tx,
          workspaces.map((w) => w.workspaceId),
        ),
      };
    },
    { partnerId: partner.partnerId },
  );
  const { cnameTarget } = domainsConfig();
  const t = await getTranslations("domains");

  return (
    <>
      <ModulePageHeader
        title={t("title")}
        description={t("description.partner")}
        icon={<Globe className="h-5 w-5" />}
      />

      <SettingsCard
        title={t("dashboard.title")}
        description={t("dashboard.description")}
        testId="partner-domains"
      >
        {dashboard.length === 0 ? (
          <p className="text-12 text-text-secondary">{t("dashboard.empty")}</p>
        ) : (
          <DomainList
            domains={dashboard}
            kind="partner"
            canManage={canManageDashboard}
            cnameTarget={cnameTarget}
          />
        )}
        {canManageDashboard ? (
          <ActionForm
            action={addPartnerDomainAction}
            submitLabel={t("form.add")}
            testId="add-partner-domain"
          >
            <Label className="flex-col items-start">
              {t("form.host")}
              <Input
                name="host"
                required
                maxLength={253}
                placeholder="console.suaempresa.com.br"
              />
            </Label>
          </ActionForm>
        ) : null}
      </SettingsCard>

      <SettingsCard
        title={t("customers.title")}
        description={t("customers.description")}
        testId="customer-domains"
      >
        {workspaces.length === 0 ? (
          <p className="text-12 text-text-secondary">
            {t("customers.noWorkspaces")}
          </p>
        ) : null}
        {workspaces
          .filter((w) =>
            customerDomains.some((d) => d.workspaceId === w.workspaceId),
          )
          .map((w) => (
            <div key={w.workspaceId} className="space-y-2">
              <p className="text-12 text-text-secondary font-medium">
                {w.organizationName} · {w.workspaceName}
              </p>
              <DomainList
                domains={customerDomains.filter(
                  (d) => d.workspaceId === w.workspaceId,
                )}
                kind="workspace"
                canManage={canManageCustomers}
                cnameTarget={cnameTarget}
              />
            </div>
          ))}
        {workspaces.length > 0 && customerDomains.length === 0 ? (
          <p className="text-12 text-text-secondary">{t("customers.empty")}</p>
        ) : null}
        {canManageCustomers && workspaces.length > 0 ? (
          <ActionForm
            action={addWorkspaceDomainAction}
            submitLabel={t("form.add")}
            className="grid items-end gap-3 sm:grid-cols-3"
            testId="add-customer-domain"
          >
            <Label className="flex-col items-start">
              {t("customers.workspace")}
              <NativeSelect name="workspaceId" required className="w-full">
                {workspaces.map((w) => (
                  <NativeSelectOption key={w.workspaceId} value={w.workspaceId}>
                    {w.organizationName} · {w.workspaceName}
                  </NativeSelectOption>
                ))}
              </NativeSelect>
            </Label>
            <Label className="flex-col items-start">
              {t("form.host")}
              <Input
                name="host"
                required
                maxLength={253}
                placeholder={t("form.hostPlaceholder")}
              />
            </Label>
          </ActionForm>
        ) : null}
      </SettingsCard>
    </>
  );
}
