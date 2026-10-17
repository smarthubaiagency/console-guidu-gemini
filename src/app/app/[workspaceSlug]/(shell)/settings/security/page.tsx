import { ShieldCheck } from "lucide-react";
import { getTranslations } from "next-intl/server";

import { ModulePageHeader } from "@/components/modules/module-page-header";
import { MfaSettings } from "@/components/security/mfa-settings";
import { requireUserPage } from "@/core/auth/page-guard";
import { resolveRequestWorkspaceContext } from "@/core/partners/request-context";
import { saveWorkspaceSecurityAction } from "@/core/security/actions";
import { settingsView } from "@/core/settings/service";
import { prisma } from "@/lib/prisma/client";
import { withContext } from "@/lib/prisma/with-context";
import { requireWorkspaceAreaPage } from "@/core/module-runtime/page-access";

export async function generateMetadata() {
  const t = await getTranslations("security");
  return { title: t("title") };
}

/**
 * Workspace › Configurações › Segurança (CF5a): the second factor required
 * of the team. Every member reads; owner and admin change it.
 */
export default async function WorkspaceSecuritySettingsPage({
  params,
}: Readonly<{ params: Promise<{ workspaceSlug: string }> }>) {
  const { workspaceSlug } = await params;
  const identity = await requireUserPage(
    `/app/${workspaceSlug}/settings/security`,
  );
  const context = await resolveRequestWorkspaceContext(
    prisma,
    identity.userId,
    workspaceSlug,
  );
  // Areas beyond the dashboard need workspace.read (AT1).
  await requireWorkspaceAreaPage(context);
  const view = await withContext(prisma, context, (tx) =>
    settingsView(tx, {
      level: "workspace",
      userId: identity.userId,
      ctx: context,
    }),
  );
  const t = await getTranslations("security");

  return (
    <>
      <ModulePageHeader
        title={t("title")}
        description={t("description.workspace")}
        icon={<ShieldCheck className="h-5 w-5" />}
      />
      <MfaSettings
        view={view}
        action={saveWorkspaceSecurityAction}
        hidden={{ workspaceSlug }}
        saverHasMfa={identity.mfaSatisfied}
      />
    </>
  );
}
