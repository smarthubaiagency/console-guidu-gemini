import "server-only";

import { recordAudit, type AuditResult } from "@/core/audit/record";
import { getRequestPartner } from "@/core/partners/resolve";
import { prisma } from "@/lib/prisma/client";
import { withIdentityContext } from "@/lib/prisma/with-identity-context";
import { appLog } from "@/lib/telemetry/log";

/**
 * Sign-in and second factor events (CF5a), for Segurança › Eventos. Each
 * names the user and the partner of the host, so the partner reads the
 * sign-ins on its own domain. Recording never blocks the sign-in: a failure
 * is logged and the person goes on.
 */

export type AuthEventAction =
  "auth.sign_in" | "auth.mfa_verified" | "auth.mfa_failed";

export async function recordAuthEvent(
  userId: string,
  action: AuthEventAction,
  result: AuditResult,
  kind?: "password" | "callback",
): Promise<void> {
  try {
    const partner = await getRequestPartner();
    await withIdentityContext(prisma, userId, (tx) =>
      recordAudit(
        tx,
        { userId, workspaceId: "", organizationId: "" },
        {
          action,
          resourceType: "session",
          result,
          origin: "app",
          metadata: {
            ...(partner ? { partnerId: partner.partnerId } : {}),
            ...(kind ? { kind } : {}),
          },
        },
      ),
    );
  } catch (error) {
    appLog.warn("security.auth_event_not_recorded", { action, error });
  }
}
