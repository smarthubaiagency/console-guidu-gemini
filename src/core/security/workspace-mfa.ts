import "server-only";

import type { PrismaClient } from "@prisma/client";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { cache } from "react";

import { hasMfaAssurance } from "@/core/auth/claims";
import { AccessDeniedError } from "@/core/auth/errors";
import { readSessionClaims } from "@/core/auth/identity";
import { safeInternalPath } from "@/core/auth/redirects";
import { PATH_HEADER } from "@/core/i18n/path";
import { effectiveSettings } from "@/core/settings/read";
import { type RequestContext, withContext } from "@/lib/prisma/with-context";

/**
 * Second factor required in a workspace (CF5a, key `security.mfa.app`): the
 * platform, the workspace's partner or the workspace itself may require it.
 * Checked by `resolveRequestWorkspaceContext`, which every page, route and
 * action of /app/[workspaceSlug] calls.
 *
 * Without the second factor in this session, a page goes to `/auth/mfa`
 * (which sends whoever has no factor to enrol it at /app/account/security,
 * outside the workspace) and an action fails with "MFA required". API keys
 * and MCP do not resolve the workspace here and are not affected.
 */

/** Claims once per request: the enforcement may run several times. */
const sessionClaims = cache(readSessionClaims);

const requiredInRequest = cache(
  async (prisma: PrismaClient, ctx: RequestContext): Promise<boolean> =>
    withContext(prisma, ctx, async (tx) => {
      const settings = await effectiveSettings(tx);
      return settings.values["security.mfa.app"] === true;
    }),
);

/** True when the context's workspace requires the second factor. */
export async function workspaceRequiresMfa(
  prisma: PrismaClient,
  ctx: RequestContext,
): Promise<boolean> {
  return requiredInRequest(prisma, ctx);
}

export async function enforceWorkspaceMfa(
  prisma: PrismaClient,
  ctx: RequestContext,
): Promise<void> {
  if (hasMfaAssurance(await sessionClaims())) return;
  if (!(await workspaceRequiresMfa(prisma, ctx))) return;

  const requestHeaders = await headers();
  // Server Actions answer through the SmartStatusBanner.
  if (requestHeaders.get("next-action")) {
    throw new AccessDeniedError("mfa_required", 403);
  }
  const next = safeInternalPath(requestHeaders.get(PATH_HEADER));
  redirect(`/auth/mfa?next=${encodeURIComponent(next)}`);
}
