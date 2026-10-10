import { PrismaClient } from "@prisma/client";
import { withIdentityContext } from "@/lib/prisma/with-identity-context";

/**
 * Represents a workspace to which the authenticated user holds an active membership,
 * including high-level organization metadata and the user's role in both scopes.
 */
export type UserWorkspace = {
  workspaceId: string;
  workspaceName: string;
  workspaceSlug: string;
  workspaceStatus: string;
  workspaceRole: string;
  organizationId: string;
  organizationName: string;
  organizationRole: string;
};

type UserWorkspaceSqlRow = {
  workspace_id: string;
  workspace_name: string;
  workspace_slug: string;
  workspace_status: string;
  workspace_role: string;
  organization_id: string;
  organization_name: string;
  organization_role: string;
};

/**
 * Lists all active workspaces accessible by the given user.
 *
 * Maintenance Rationale:
 * - Operates under `withIdentityContext(prisma, userId)` ensuring the database
 *   session sets `app.user_id = userId`.
 * - Calls the security-definer helper `private.list_user_workspaces()` owned by
 *   `app_rls_helper`, preventing cross-tenant workspace/organization leakage.
 * - Guarantees that only workspaces where `workspace_members.status = 'active'`
 *   are returned. Inactive/revoked members see 0 rows.
 *
 * - Only lists workspaces of organizations that belong to `partnerId`, the
 *   partner of the request host (ADR 0012). No partner, no workspaces.
 *
 * @param prisma PrismaClient instance connected with `app_runtime`
 * @param userId Authenticated user UUID
 * @param partnerId Partner of the request host, or null for an unknown host
 * @returns Array of active user workspaces
 */
export async function listUserWorkspaces(
  prisma: PrismaClient,
  userId: string,
  partnerId: string | null,
): Promise<UserWorkspace[]> {
  if (!partnerId) return [];

  return withIdentityContext(
    prisma,
    userId,
    async (tx) => {
      const rows = await tx.$queryRaw<UserWorkspaceSqlRow[]>`
      select
        workspace_id,
        workspace_name,
        workspace_slug,
        workspace_status,
        workspace_role,
        organization_id,
        organization_name,
        organization_role
      from private.list_user_workspaces()
    `;

      return rows.map((row) => ({
        workspaceId: row.workspace_id,
        workspaceName: row.workspace_name,
        workspaceSlug: row.workspace_slug,
        workspaceStatus: row.workspace_status,
        workspaceRole: row.workspace_role,
        organizationId: row.organization_id,
        organizationName: row.organization_name,
        organizationRole: row.organization_role,
      }));
    },
    { partnerId },
  );
}
