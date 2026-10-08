import { PrismaClient } from "@prisma/client";
import type { RequestContext } from "@/lib/prisma/with-context";

type WorkspaceSlugRow = {
  workspace_id: string;
  organization_id: string;
};

type MembershipRow = {
  is_member: boolean;
};

export class WorkspaceNotFoundError extends Error {
  constructor(slug: string) {
    super(`Workspace not found or inactive: ${slug}`);
    this.name = "WorkspaceNotFoundError";
  }
}

export class NotAMemberError extends Error {
  constructor() {
    super("Access denied: not an active member of this workspace");
    this.name = "NotAMemberError";
  }
}

/**
 * Resolves the full RLS RequestContext from an authenticated user and a
 * workspace slug.  Never accepts workspaceId or role from the request body.
 *
 * 1. Sets app.user_id so membership helpers can read context.
 * 2. Calls the security-definer `private.resolve_workspace_slug(slug)` to
 *    obtain (workspace_id, organization_id).
 * 3. Sets app.workspace_id and app.organization_id.
 * 4. Verifies active workspace membership via
 *    `private.is_workspace_member`.
 *
 * Step 2 is itself membership-bound, so a slug belonging to another tenant
 * raises WorkspaceNotFoundError, exactly like a slug that does not exist:
 * distinguishing the two would disclose which workspaces other tenants own.
 * NotAMemberError therefore stays unreachable while step 2 holds — it is the
 * second line of defence if that resolver is ever loosened.
 */
export async function resolveWorkspaceContext(
  prisma: PrismaClient,
  userId: string,
  workspaceSlug: string,
): Promise<RequestContext> {
  return prisma.$transaction(async (tx) => {
    await tx.$executeRaw`select set_config('app.user_id', ${userId}, true)`;

    const rows = await tx.$queryRaw<WorkspaceSlugRow[]>`
      select workspace_id, organization_id
      from private.resolve_workspace_slug(${workspaceSlug})
    `;

    const workspace = rows[0];
    if (!workspace) {
      throw new WorkspaceNotFoundError(workspaceSlug);
    }

    const { workspace_id: workspaceId, organization_id: organizationId } =
      workspace;

    await tx.$executeRaw`
      select
        set_config('app.workspace_id', ${workspaceId}, true),
        set_config('app.organization_id', ${organizationId}, true)
    `;

    const [memberCheck] = await tx.$queryRaw<MembershipRow[]>`
      select private.is_workspace_member(
        ${workspaceId}::uuid,
        ${organizationId}::uuid
      ) as is_member
    `;

    if (!memberCheck?.is_member) {
      throw new NotAMemberError();
    }

    return { userId, workspaceId, organizationId };
  });
}