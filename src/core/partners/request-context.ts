import "server-only";

import type { PrismaClient } from "@prisma/client";

import { resolveWorkspaceContext } from "@/core/auth/context";
import { enforceWorkspaceMfa } from "@/core/security/workspace-mfa";
import {
  listUserWorkspaces,
  type UserWorkspace,
} from "@/core/workspaces/navigation";
import type { RequestContext } from "@/lib/prisma/with-context";

import { getRequestPartner } from "./resolve";

/**
 * Request-aware entry points for pages and server actions: they take the
 * partner from the request host (ADR 0012) so no caller can forget it. The
 * underlying functions keep an explicit `partnerId` for tests and jobs.
 */
export async function resolveRequestWorkspaceContext(
  prisma: PrismaClient,
  userId: string,
  workspaceSlug: string,
): Promise<RequestContext> {
  const partner = await getRequestPartner();
  const ctx = await resolveWorkspaceContext(
    prisma,
    userId,
    workspaceSlug,
    partner?.partnerId ?? null,
  );
  // Second factor required by the workspace, its partner or the platform
  // (CF5a): pages go to /auth/mfa, actions fail. Callers that turn a failed
  // resolution into 404 let this redirect through (`unstable_rethrow`).
  await enforceWorkspaceMfa(prisma, ctx);
  return ctx;
}

export async function listRequestUserWorkspaces(
  prisma: PrismaClient,
  userId: string,
): Promise<UserWorkspace[]> {
  const partner = await getRequestPartner();
  return listUserWorkspaces(prisma, userId, partner?.partnerId ?? null);
}
