import { getTranslations } from "next-intl/server";

import { SettingsShell } from "@/components/settings/settings-shell";
import { requireUserPage } from "@/core/auth/page-guard";
import { getModuleCatalog } from "@/core/i18n/modules";
import { translateNavigation } from "@/core/i18n/navigation";
import { loadAppSettingsNavigation } from "@/core/module-runtime/loaders";
import { resolveRequestWorkspaceContext } from "@/core/partners/request-context";
import { prisma } from "@/lib/prisma/client";

/** Workspace › Configurações (CF1): submenu card and content cards. */
export default async function WorkspaceSettingsLayout({
  children,
  params,
}: Readonly<{
  children: React.ReactNode;
  params: Promise<{ workspaceSlug: string }>;
}>) {
  const { workspaceSlug } = await params;
  const identity = await requireUserPage(`/app/${workspaceSlug}/settings`);
  const context = await resolveRequestWorkspaceContext(
    prisma,
    identity.userId,
    workspaceSlug,
  );
  const t = await getTranslations("settings");
  const sections = translateNavigation(
    await loadAppSettingsNavigation(prisma, context, workspaceSlug),
    "app",
    await getTranslations("nav"),
    (await getModuleCatalog()).entryLabel,
  );
  return (
    <SettingsShell label={t("navLabel")} sections={sections}>
      {children}
    </SettingsShell>
  );
}
