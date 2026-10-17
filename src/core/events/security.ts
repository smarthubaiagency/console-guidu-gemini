import "server-only";

import { appConfig } from "@/core/config/app";
import type {
  ContextTransaction,
  RequestContext,
} from "@/lib/prisma/with-context";

import { contextPartnerId, emitEvent } from "./emit";

/**
 * Security actions of the CF5a that also become events of the hub (H2):
 * the creation and revocation of an API key and the end of the team's
 * two-step verification requirement. Their audit records stay as they were
 * (`api_keys.*`, `workspace.settings.save`); the notice is off by default
 * (`notifyByDefault: false`) until a level turns it on. Emitted by a person
 * in their workspace, in the transaction of the change.
 */
export type SecurityEventType =
  | "security.api_key_created"
  | "security.api_key_revoked"
  | "security.mfa_requirement_off";

export async function emitSecurityEvent(
  tx: ContextTransaction,
  ctx: RequestContext,
  type: SecurityEventType,
  args: Readonly<{
    key: string;
    data?: Readonly<Record<string, unknown>>;
    subject?: Readonly<{ type: string; id: string }> | null;
  }>,
): Promise<void> {
  // Only a person acting in the workspace (the API and the MCP keep their
  // own audit; the web's insert policy names the person).
  if ((ctx.principalType ?? "user") !== "user" || !ctx.workspaceId) return;
  const partnerId = await contextPartnerId(tx);
  if (!partnerId) return;
  await emitEvent(tx, {
    type,
    actor: { userId: ctx.userId, principalType: "user", origin: "app" },
    partnerId,
    organizationId: ctx.organizationId,
    workspaceId: ctx.workspaceId,
    subject: args.subject ?? null,
    data: {
      ...args.data,
      linkUrl: new URL("/app", appConfig.url).toString(),
    },
    idempotencyKey: args.key,
  });
}
