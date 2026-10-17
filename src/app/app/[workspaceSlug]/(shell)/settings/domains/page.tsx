import type { Metadata } from "next";
import { Globe } from "lucide-react";
import { getTranslations } from "next-intl/server";

import { DomainList } from "@/components/domains/domain-list";
import { PublicAddresses } from "@/components/domains/public-addresses";
import { ModulePageHeader } from "@/components/modules/module-page-header";
import { ActionForm } from "@/components/partners/action-form";
import { SettingsCard } from "@/components/settings/settings-shell";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { requireUserPage } from "@/core/auth/page-guard";
import { addWorkspaceDomainAction } from "@/core/domains/actions";
import { domainsConfig } from "@/core/domains/config";
import { workspacePublicAddresses } from "@/core/domains/public-service";
import {
  canManageWorkspaceDomains,
  listWorkspaceDomains,
  workspaceDomainQuota,
} from "@/core/domains/service";
import { resolveRequestWorkspaceContext } from "@/core/partners/request-context";
import { prisma } from "@/lib/prisma/client";
import { withContext } from "@/lib/prisma/with-context";
import { requireWorkspaceAreaPage } from "@/core/module-runtime/page-access";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("domains");
  return { title: t("metaTitle") };
}

/**
 * Workspace › Configurações › Domínios (CF2b): public domains of the
 * workspace (site, digital profile, quiz). The dashboard domain is the
 * partner's and never changes here. CF2c adds the default address of each
 * public route type (`{slug}.{default domain}`), outside the quota.
 */
export default async function WorkspaceDomainsPage({
  params,
}: Readonly<{ params: Promise<{ workspaceSlug: string }> }>) {
  const { workspaceSlug } = await params;
  const identity = await requireUserPage(
    `/app/${workspaceSlug}/settings/domains`,
  );
  const ctx = await resolveRequestWorkspaceContext(
    prisma,
    identity.userId,
    workspaceSlug,
  );
  // Areas beyond the dashboard need workspace.read (AT1).
  await requireWorkspaceAreaPage(ctx);
  const { addresses, domains, quota, canManage } = await withContext(
    prisma,
    ctx,
    async (tx) => ({
      addresses: await workspacePublicAddresses(tx, workspaceSlug),
      domains: await listWorkspaceDomains(tx, [ctx.workspaceId]),
      quota: await workspaceDomainQuota(tx, ctx),
      canManage: await canManageWorkspaceDomains(tx, {
        kind: "workspace",
        userId: identity.userId,
        ctx,
      }),
    }),
  );
  const { cnameTarget } = domainsConfig();
  const t = await getTranslations("domains");
  const canAdd = quota.limit === null || quota.used < quota.limit;

  return (
    <>
      <ModulePageHeader
        title={t("title")}
        description={t("description.workspace")}
        icon={<Globe className="h-5 w-5" />}
      />
      <SettingsCard
        title={t("addresses.title")}
        description={t("addresses.description")}
        testId="workspace-public-addresses"
      >
        <PublicAddresses addresses={addresses} />
      </SettingsCard>
      <SettingsCard
        title={t("public.title")}
        description={t("public.description")}
        testId="workspace-domains"
      >
        <p className="text-12 text-text-secondary" data-testid="domain-quota">
          {quota.limit === 0
            ? t("public.quotaNone")
            : quota.limit === null
              ? t("public.quotaUnlimited", { used: String(quota.used) })
              : t("public.quota", {
                  used: String(quota.used),
                  limit: String(quota.limit),
                })}
        </p>
        {domains.length === 0 ? (
          <p className="text-12 text-text-secondary">{t("public.empty")}</p>
        ) : (
          <DomainList
            domains={domains}
            kind="workspace"
            canManage={canManage}
            cnameTarget={cnameTarget}
            hidden={{ workspaceSlug }}
          />
        )}
        {!canManage ? (
          <p className="text-12 text-text-secondary">{t("public.readOnly")}</p>
        ) : canAdd ? (
          <ActionForm
            action={addWorkspaceDomainAction}
            submitLabel={t("form.add")}
            testId="add-workspace-domain"
          >
            <input type="hidden" name="workspaceSlug" value={workspaceSlug} />
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
