import { notFound, unstable_rethrow } from "next/navigation";
import { requireUserPage } from "@/core/auth/page-guard";
import { resolveRequestWorkspaceContext } from "@/core/partners/request-context";
import { prisma } from "@/lib/prisma/client";
import { listRequestUserWorkspaces } from "@/core/partners/request-context";
import { getConsoleAccess } from "@/core/auth/console-access";
import { loadNotificationBell } from "@/core/notifications/bell";
import { loadAppNavigation } from "@/core/module-runtime/loaders";
import { AppShell } from "@/components/layout/shell/app-shell";
import { WorkspaceSwitcher } from "@/components/layout/shell/workspace-switcher";
import { getRequestBrand } from "@/core/brand/resolve";
import { translateNavigation } from "@/core/i18n/navigation";
import { getModuleCatalog } from "@/core/i18n/modules";
import { getTranslations } from "next-intl/server";

interface WorkspaceShellLayoutProps {
  children: React.ReactNode;
  params: Promise<{ workspaceSlug: string }>;
}

/**
 * AppShell of the workspace routes (ADR 0014). The guards run in the parent
 * layout; the context is resolved again here, memoized per request by
 * `cache()` in request-context.
 */
export default async function WorkspaceShellLayout({
  children,
  params,
}: WorkspaceShellLayoutProps) {
  const brand = await getRequestBrand();
  const { workspaceSlug } = await params;
  const currentPath = `/app/${workspaceSlug}`;
  const identity = await requireUserPage(currentPath);

  let context;
  try {
    context = await resolveRequestWorkspaceContext(
      prisma,
      identity.userId,
      workspaceSlug,
    );
  } catch (error) {
    unstable_rethrow(error);
    notFound();
  }

  // Load all user workspaces for switcher
  const workspaces = await listRequestUserWorkspaces(prisma, identity.userId);

  // Shortcuts to /admin and /platform in the header (ADR 0014).
  const access = await getConsoleAccess(identity.userId);

  // Generated from core entries and the module registry (Adendo §8.1).
  const navigation = translateNavigation(
    await loadAppNavigation(prisma, context, workspaceSlug),
    "app",
    await getTranslations("nav"),
    (await getModuleCatalog()).entryLabel,
  );

  return (
    <AppShell
      area="app"
      sections={navigation}
      header={
        <WorkspaceSwitcher
          currentSlug={workspaceSlug}
          workspaces={workspaces}
          appName={brand.name}
          logoUrl={brand.logoUrl}
          logoDarkUrl={brand.logoDarkUrl}
        />
      }
      user={{ email: identity.email }}
      access={access}
      bell={await loadNotificationBell(identity.userId)}
    >
      {children}
    </AppShell>
  );
}
