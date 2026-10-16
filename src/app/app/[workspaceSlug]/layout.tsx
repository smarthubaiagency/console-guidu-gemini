import { notFound, unstable_rethrow } from "next/navigation";
import { requireUserPage } from "@/core/auth/page-guard";
import { requireLegalAcceptance } from "@/core/legal/gate";
import { resolveRequestWorkspaceContext } from "@/core/partners/request-context";
import { prisma } from "@/lib/prisma/client";

interface WorkspaceLayoutProps {
  children: React.ReactNode;
  params: Promise<{ workspaceSlug: string }>;
}

/**
 * Guards shared by every workspace route, with no shell: the routes inside
 * `(shell)/` get the AppShell from their own layout, and the full-screen
 * Inbox (ADR 0014) will get its own. Pages still check access themselves.
 */
export default async function WorkspaceLayout({
  children,
  params,
}: WorkspaceLayoutProps) {
  const { workspaceSlug } = await params;
  const currentPath = `/app/${workspaceSlug}`;
  const identity = await requireUserPage(currentPath);
  await requireLegalAcceptance(identity, currentPath);

  // Validate user membership and resolve context
  try {
    await resolveRequestWorkspaceContext(
      prisma,
      identity.userId,
      workspaceSlug,
    );
  } catch (error) {
    unstable_rethrow(error);
    // If the workspace does not exist or user is not a member, uniform 404
    notFound();
  }

  return children;
}
