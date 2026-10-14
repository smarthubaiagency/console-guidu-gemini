import "server-only";

import { createHash } from "node:crypto";

import { getLocale } from "next-intl/server";

import { getRequestBrand } from "@/core/brand/resolve";
import { notify } from "@/core/notifications/notify";
import { withSender } from "@/core/notifications/sender";
import { getNotificationTransport } from "@/core/notifications/transport";
import { prisma } from "@/lib/prisma/client";
import { appLog } from "@/lib/telemetry/log";

/**
 * Invitation e-mail (CF3a): sent right after the invitation is saved, with
 * the brand and sender of the host the manager is on, in the manager's
 * language. Never fails the invitation: the link stays on the screen to be
 * copied, and the answer says whether the e-mail left.
 */
export async function emailInvitation(
  invitation: Readonly<{
    email: string;
    organizationName: string;
    expiresAt: Date;
    inviteUrl: string;
  }>,
): Promise<boolean> {
  try {
    const brand = await getRequestBrand();
    const result = await notify(
      {
        type: "invitation.created",
        recipientEmail: invitation.email,
        // One e-mail per link: the hash never reveals the token.
        idempotencyKey: `invitation:${createHash("sha256")
          .update(invitation.inviteUrl)
          .digest("hex")}`,
        data: {
          inviteUrl: invitation.inviteUrl,
          organizationName: invitation.organizationName,
          expiresAt: invitation.expiresAt,
        },
      },
      await withSender(prisma, brand.partnerId, {
        name: brand.name,
        supportEmail: brand.supportEmail,
        supportUrl: brand.supportUrl,
      }),
      getNotificationTransport(),
      { locale: await getLocale() },
    );
    return result.status === "sent";
  } catch (error) {
    appLog.warn("email.invitation_failed", {
      errorName: error instanceof Error ? error.name : "unknown",
    });
    return false;
  }
}
