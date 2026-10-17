import "server-only";

import type {
  InboxNotice,
  NotificationContent,
} from "@/core/notifications/inbox-content";
import { isHttpUrl } from "@/core/notifications/markup";
import type { ContextTransaction } from "@/lib/prisma/with-context";

import { generateServiceModeToken, linkUrlOf } from "./requests";

/**
 * Recipients of the `service_mode.*` events (route `explicit`), for the
 * `events.dispatch` job (app_worker). The worker never reads members
 * itself: `private.service_mode_issue_link` and
 * `private.service_mode_event_recipients` answer who.
 *
 * - `change_requested`: the company owner, by e-mail and bell. A fresh
 *   token is drawn here and only its hash is written to the request, so the
 *   link exists only in the e-mail; the bell links to the settings.
 * - `changed` and `change_denied`: the bell of who asked, of the company
 *   owners and, when the company goes back to `padrao`, of the partner's
 *   owners and admins, each with the link of their own screen.
 * - `reverted_by_partner` (AJ1): the company owners by e-mail (the hub's
 *   generic e-mail, with the reason) and bell, linked to their settings;
 *   the partner's owners and admins by bell, linked to Clientes.
 */

export type ExplicitRecipient = Readonly<{
  user_id: string | null;
  email: string | null;
  /** The e-mail and bell content of this person, when it is their own. */
  content?: NotificationContent | null;
  /** The bell notice of this person, when it is their own. */
  notice?: InboxNotice | null;
}>;

type EventLike = Readonly<{
  id: string;
  type: string;
  data: Record<string, unknown>;
}>;

const str = (value: unknown): string =>
  typeof value === "string" ? value : "";

function safeLink(value: unknown): string | null {
  const raw = str(value);
  return raw && isHttpUrl(raw) && raw.length <= 2000 ? raw : null;
}

const SERVICE_MODE_TYPES = new Set([
  "service_mode.change_requested",
  "service_mode.changed",
  "service_mode.change_denied",
  "service_mode.reverted_by_partner",
]);

export function isServiceModeEvent(type: string): boolean {
  return SERVICE_MODE_TYPES.has(type);
}

async function requestRecipients(
  tx: ContextTransaction,
  event: EventLike,
): Promise<ExplicitRecipient[]> {
  const baseUrl = safeLink(event.data.baseUrl);
  const settingsUrl = safeLink(event.data.settingsUrl);
  if (!baseUrl || !settingsUrl) return [];
  const { rawToken, tokenHash } = generateServiceModeToken();
  const rows = await tx.$queryRaw<
    { user_id: string; email: string | null; expires_at: Date }[]
  >`select user_id, email, expires_at from private.service_mode_issue_link(${event.id}::uuid, ${tokenHash})`;
  return rows.map((row) => ({
    user_id: row.user_id,
    email: row.email,
    content: {
      type: "service_mode.change_requested",
      data: {
        organizationName: str(event.data.organizationName),
        partnerName: str(event.data.partnerName),
        expiresAt: new Date(row.expires_at),
        approveUrl: linkUrlOf(baseUrl, rawToken),
        settingsUrl,
      },
    },
  }));
}

async function changeRecipients(
  tx: ContextTransaction,
  event: EventLike,
): Promise<ExplicitRecipient[]> {
  const rows = await tx.$queryRaw<
    { user_id: string; kind: string; organization_name: string | null }[]
  >`
    select user_id, kind, organization_name
    from private.service_mode_event_recipients(${event.id}::uuid)
  `;
  const settingsUrl = safeLink(event.data.settingsUrl);
  const consoleUrl = safeLink(event.data.consoleUrl);
  const to = str(event.data.to) === "padrao" ? "padrao" : "gerenciado";
  return rows.map((row) => ({
    user_id: row.user_id,
    email: null,
    notice: {
      eventType: event.type,
      data: { organization: (row.organization_name ?? "").slice(0, 200), to },
      linkUrl: row.kind === "owner" ? settingsUrl : consoleUrl,
    },
  }));
}

async function revertRecipients(
  tx: ContextTransaction,
  event: EventLike,
): Promise<ExplicitRecipient[]> {
  const rows = await tx.$queryRaw<
    {
      user_id: string;
      email: string | null;
      kind: string;
      organization_name: string | null;
      partner_name: string | null;
    }[]
  >`
    select user_id, email, kind, organization_name, partner_name
    from private.service_mode_revert_recipients(${event.id}::uuid)
  `;
  const settingsUrl = safeLink(event.data.settingsUrl);
  const consoleUrl = safeLink(event.data.consoleUrl);
  const reason = str(event.data.reason).slice(0, 200);
  return rows.map((row) => ({
    user_id: row.user_id,
    // Only the owners get the e-mail; the partner's team, the bell.
    email: row.kind === "owner" ? row.email : null,
    notice: {
      eventType: event.type,
      data: {
        organization: (row.organization_name ?? "").slice(0, 200),
        partner: (row.partner_name ?? "").slice(0, 200),
        reason,
      },
      linkUrl: row.kind === "owner" ? settingsUrl : consoleUrl,
    },
  }));
}

/**
 * The recipients of a `service_mode.*` event, or null for any other type
 * (the dispatch then asks `private.event_recipients`).
 */
export async function serviceModeRecipients(
  tx: ContextTransaction,
  event: EventLike,
): Promise<ExplicitRecipient[] | null> {
  if (!isServiceModeEvent(event.type)) return null;
  if (event.type === "service_mode.change_requested") {
    return requestRecipients(tx, event);
  }
  if (event.type === "service_mode.reverted_by_partner") {
    return revertRecipients(tx, event);
  }
  return changeRecipients(tx, event);
}
