import { recordAudit } from "@/core/audit/record";
import { Permissions } from "@/core/permissions/catalog";
import { requireWorkspacePermission } from "@/core/permissions/guard";
import type {
  ContextTransaction,
  RequestContext,
} from "@/lib/prisma/with-context";
import { AppError } from "@/shared/errors";

import { type Assurance, requireMfa } from "./export";

/**
 * Workspace deletion (F3e, decision of 17/10/2026): logical first, with a
 * 30-day grace period. The owner confirms the slug with MFA verified; from
 * then on the database closes the workspace to everyone (helpers require an
 * active workspace) and the owner may cancel from /app. After the grace
 * period the daily privacy job purges the data and keeps a tombstone.
 */
export const DELETION_GRACE_DAYS = 30;

export async function requestWorkspaceDeletion(
  tx: ContextTransaction,
  ctx: RequestContext,
  input: Readonly<{ confirmSlug: string }>,
  assurance: Assurance,
): Promise<{ deletionId: string; purgeAfter: Date }> {
  await requireWorkspacePermission(tx, ctx, Permissions.WORKSPACE_DELETE);
  requireMfa(assurance);
  const workspace = await tx.workspace.findUniqueOrThrow({
    where: { id: ctx.workspaceId },
    select: { slug: true },
  });
  if (input.confirmSlug.trim() !== workspace.slug) {
    throw new AppError({
      code: "invalid_input",
      safeMessage: `Digite "${workspace.slug}" para confirmar a exclusão.`,
    });
  }
  const rows = await tx.$queryRaw<{ id: string }[]>`
    select private.request_workspace_deletion(${DELETION_GRACE_DAYS}::integer) as id
  `;
  const deletionId = rows[0]?.id;
  if (!deletionId) throw new Error("workspace deletion: no record");
  await recordAudit(tx, ctx, {
    action: "workspace.deletion.request",
    resourceType: "workspace",
    resourceId: ctx.workspaceId,
    result: "success",
    metadata: { status: "deletion_scheduled" },
  });
  return {
    deletionId,
    purgeAfter: new Date(Date.now() + DELETION_GRACE_DAYS * 86_400_000),
  };
}

export type ScheduledDeletionView = Readonly<{
  workspaceId: string;
  organizationId: string;
  workspaceName: string;
  workspaceSlug: string;
  requestedAt: Date;
  purgeAfter: Date;
}>;

/** Scheduled deletions the identity may cancel (active owner only). */
export async function listScheduledDeletions(
  tx: ContextTransaction,
): Promise<ScheduledDeletionView[]> {
  const rows = await tx.$queryRaw<
    {
      workspace_id: string;
      organization_id: string;
      workspace_name: string;
      workspace_slug: string;
      requested_at: Date;
      purge_after: Date;
    }[]
  >`select * from private.list_scheduled_deletions()`;
  return rows.map((row) => ({
    workspaceId: row.workspace_id,
    organizationId: row.organization_id,
    workspaceName: row.workspace_name,
    workspaceSlug: row.workspace_slug,
    requestedAt: row.requested_at,
    purgeAfter: row.purge_after,
  }));
}

export async function cancelWorkspaceDeletion(
  tx: ContextTransaction,
  userId: string,
  workspaceId: string,
  assurance: Assurance,
): Promise<void> {
  requireMfa(assurance);
  const rows = await tx.$queryRaw<{ ok: boolean }[]>`
    select private.cancel_workspace_deletion(${workspaceId}::uuid) as ok
  `;
  if (!rows[0]?.ok) {
    throw new AppError({
      code: "not_found",
      safeMessage: "Exclusão não encontrada ou já concluída.",
    });
  }
  await recordAudit(
    tx,
    { userId, workspaceId: "", organizationId: "" },
    {
      action: "workspace.deletion.cancel",
      resourceType: "workspace",
      resourceId: workspaceId,
      result: "success",
      metadata: { target: workspaceId, status: "active" },
    },
  );
}
