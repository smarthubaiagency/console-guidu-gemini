import { notFound } from "next/navigation";
import { requireUserPage } from "@/core/auth/page-guard";
import { resolveWorkspaceContext } from "@/core/auth/context";
import { prisma } from "@/lib/prisma/client";
import { listUserWorkspaces } from "@/core/workspaces/navigation";
import { getPlatformAdminMember } from "@/core/admin/platform";
import { AppSidebar } from "@/components/layout/app-sidebar";
import { AppHeader } from "@/components/layout/app-header";

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
  try {
    await resolveWorkspaceContext(prisma, identity.userId, workspaceSlug);
  } catch {
    // If the workspace does not exist or user is not a member, uniform 404
    notFound();
  }

  // Load all user workspaces for switcher
  const workspaces = await listUserWorkspaces(prisma, identity.userId);

  // Check if current user is platform admin
  const platformAdmin = await getPlatformAdminMember(prisma, identity.userId);

  return (
    <div className="min-h-screen flex flex-col bg-neutral-100 text-neutral-900">
      <AppHeader
        currentSlug={workspaceSlug}
        workspaces={workspaces}
        userEmail={identity.email}
        isPlatformAdmin={Boolean(platformAdmin)}
      />

      <div className="flex-1 flex overflow-hidden">
        <AppSidebar workspaceSlug={workspaceSlug} />
        <main className="flex-1 overflow-y-auto bg-white p-6 md:p-8">
          {children}
        </main>
      </div>
    </div>
  );
}
