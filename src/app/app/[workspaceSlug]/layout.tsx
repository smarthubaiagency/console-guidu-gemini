import { notFound } from "next/navigation";
import { requireUserPage } from "@/core/auth/page-guard";
import { resolveRequestWorkspaceContext } from "@/core/partners/request-context";
import { prisma } from "@/lib/prisma/client";
import { listRequestUserWorkspaces } from "@/core/partners/request-context";
import { getPlatformAdminMember } from "@/core/admin/platform";
import { loadAppNavigation } from "@/core/module-runtime/loaders";
import { AppSidebar } from "@/components/layout/app-sidebar";
import { AppHeader } from "@/components/layout/app-header";
import { appConfig } from "@/core/config/app";

interface WorkspaceLayoutProps {
  children: React.ReactNode;
  params: Promise<{ workspaceSlug: string }>;
}

export default async function WorkspaceLayout({
  children,
  params,
}: WorkspaceLayoutProps) {
  const { workspaceSlug } = await params;
  const currentPath = `/app/${workspaceSlug}`;
  const identity = await requireUserPage(currentPath);

  // Validate user membership and resolve context
  let context;
  try {
    context = await resolveRequestWorkspaceContext(
      prisma,
      identity.userId,
      workspaceSlug,
    );
  } catch {
    // If the workspace does not exist or user is not a member, uniform 404
    notFound();
  }

  // Load all user workspaces for switcher
  const workspaces = await listRequestUserWorkspaces(prisma, identity.userId);

  // Check if current user is platform admin
  const platformAdmin = await getPlatformAdminMember(prisma, identity.userId);

  // Generated from core entries and the module registry (Adendo §8.1).
  const navigation = await loadAppNavigation(prisma, context, workspaceSlug);

  return (
    <div className="bg-surface-hover text-text flex min-h-screen flex-col">
      <AppHeader
        currentSlug={workspaceSlug}
        workspaces={workspaces}
        userEmail={identity.email}
        isPlatformAdmin={Boolean(platformAdmin)}
        appName={appConfig.name}
      />

      <div className="flex flex-1 overflow-hidden">
        <AppSidebar sections={navigation} />
        <main className="bg-surface-card flex-1 overflow-y-auto p-6 md:p-8">
          {children}
        </main>
      </div>
    </div>
  );
}
