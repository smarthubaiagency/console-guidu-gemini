import type { ContextTransaction } from "@/lib/prisma/with-context";

/**
 * Whether a workspace is active (WS1), from the database's own helper
 * (`private.workspace_is_active`), which reads the status of any workspace
 * for app_runtime and app_worker without opening the row. A workspace that
 * is scheduled for deletion, suspended, inactive or deleted is closed to
 * every service: jobs, channels, notices, API and MCP.
 */
export async function isWorkspaceActive(
  tx: ContextTransaction,
  workspaceId: string,
): Promise<boolean> {
  const [row] = await tx.$queryRaw<{ active: boolean }[]>`
    select private.workspace_is_active(${workspaceId}::uuid) as active
  `;
  return row?.active === true;
}
