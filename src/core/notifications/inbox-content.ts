import { isHttpUrl } from "./markup";
import type { NotificationEvent } from "./types";

/**
 * What a notice of the bell keeps (CF3c): a few values of the event (names
 * and dates, never a secret) and its link. The text is written when the
 * notice is shown, in the reader's language, so a notice follows a change
 * of language. Pure: the worker writes it and the dashboard reads it.
 */

/** Distributes `Omit` over the events, keeping each type with its data. */
type DistributiveOmit<T, K extends PropertyKey> = T extends unknown
  ? Omit<T, K>
  : never;

/** An event without its recipient: what every channel shares. */
export type NotificationContent = DistributiveOmit<
  NotificationEvent,
  "recipientEmail" | "idempotencyKey"
>;

export type InboxData = Readonly<Record<string, string>>;

export type InboxNotice = Readonly<{
  /** A notification event, or another event of the hub's catalog (H1). */
  eventType: string;
  data: InboxData;
  linkUrl: string | null;
}>;

const MAX_VALUE = 200;

function clip(value: string): string {
  return value.trim().slice(0, MAX_VALUE);
}

function day(value: Date): string {
  return value.toISOString().slice(0, 10);
}

function link(value: string): string | null {
  return isHttpUrl(value) && value.length <= 2000 ? value : null;
}

/** The notice of an event, or null for an event without the bell. */
export function inboxNotice(content: NotificationContent): InboxNotice | null {
  switch (content.type) {
    case "billing.subscription.past_due":
    case "billing.subscription.suspended": {
      const { data } = content;
      return {
        eventType: content.type,
        data: {
          organization: clip(data.organizationName),
          periodEnd: day(data.periodEnd),
          ...(data.nextStepOn ? { nextStepOn: day(data.nextStepOn) } : {}),
        },
        linkUrl: link(data.billingUrl),
      };
    }
    case "ai.agent.key_backup":
    case "ai.agent.key_paused": {
      const { data } = content;
      return {
        eventType: content.type,
        data: {
          workspace: clip(data.workspaceName),
          ...(data.agentName ? { agent: clip(data.agentName) } : {}),
          until: data.backupUntil.toISOString(),
        },
        linkUrl: link(data.credentialsUrl),
      };
    }
    case "service_mode.change_requested": {
      const { data } = content;
      // The bell links to the settings, never to the single-use link.
      return {
        eventType: content.type,
        data: {
          organization: clip(data.organizationName),
          partner: clip(data.partnerName),
        },
        linkUrl: link(data.settingsUrl),
      };
    }
    case "workspace.deletion.scheduled":
    case "workspace.deletion.reminder":
    case "workspace.deletion.canceled":
    case "workspace.deletion.completed": {
      const { data } = content;
      return {
        eventType: content.type,
        data: {
          workspace: clip(data.workspaceName),
          purgeAfter: data.purgeAfter.toISOString(),
        },
        linkUrl: link(data.appUrl),
      };
    }
    case "invitation.created":
    case "email.test":
    case "events.notice":
      return null;
  }
}

/** Translator of the `notificationCenter.events` messages. */
export type InboxTranslator = (
  key: string,
  values: Record<string, string>,
) => string;

/** Date formatter of the reader's language (`format.dateTime`). */
export type InboxDateFormatter = (value: Date, withTime: boolean) => string;

export type RenderedNotice = Readonly<{ title: string; body: string }>;

const EVENT_KEYS: Readonly<Record<string, string>> = {
  "billing.subscription.past_due": "pastDue",
  "billing.subscription.suspended": "suspended",
  "workspace.deletion.scheduled": "workspaceDeletionScheduled",
  "workspace.deletion.reminder": "workspaceDeletionReminder",
  "workspace.deletion.canceled": "workspaceDeletionCanceled",
  "workspace.deletion.completed": "workspaceDeletionCompleted",
  "ai.agent.key_backup": "aiKeyBackup",
  "ai.agent.key_paused": "aiKeyPaused",
  // Posted by the background analyses of a Google ficha (GB1a).
  "google_business.analyses_done": "gbAnalysesDone",
  // Inbox (IN4b): new, assigned and unanswered conversations.
  "inbox.conversation.new": "inboxNew",
  "inbox.conversation.assigned": "inboxAssigned",
  "inbox.conversation.unanswered": "inboxUnanswered",
  // The seal check of the Event Hub found a broken chain (H1).
  "platform.events.chain_broken": "eventsChainBroken",
  // Service modes (GB1c).
  "service_mode.change_requested": "serviceModeRequested",
  "service_mode.changed": "serviceModeChanged",
  "service_mode.change_denied": "serviceModeDenied",
  // The partner (or GUIDU) ended the managed mode (AJ1).
  "service_mode.reverted_by_partner": "serviceModeRevertedByPartner",
  // Event Hub (H2): access to the data, security, reminders and digest.
  "events.access_requested": "accessRequested",
  "security.api_key_created": "apiKeyCreated",
  "security.api_key_revoked": "apiKeyRevoked",
  "security.mfa_requirement_off": "mfaRequirementOff",
  "security.ip_blocked": "ipBlocked",
  "events.reminder": "eventReminder",
  "events.escalation": "eventEscalation",
  "events.digest": "eventDigest",
};

function text(data: unknown, name: string): string {
  if (!data || typeof data !== "object") return "";
  const value = (data as Record<string, unknown>)[name];
  return typeof value === "string" ? value.slice(0, MAX_VALUE) : "";
}

function date(
  data: unknown,
  name: string,
  format: InboxDateFormatter,
  withTime: boolean,
): string {
  const raw = text(data, name);
  if (!raw) return "";
  // A day alone is the calendar day, not a moment in some time zone.
  const parsed = new Date(
    /^\d{4}-\d{2}-\d{2}$/.test(raw) ? `${raw}T12:00:00Z` : raw,
  );
  return Number.isNaN(parsed.getTime()) ? "" : format(parsed, withTime);
}

/** Title and text of a stored notice in the reader's language. */
export function renderInboxNotice(
  notice: Readonly<{ eventType: string; data: unknown }>,
  t: InboxTranslator,
  format: InboxDateFormatter,
): RenderedNotice {
  const key = EVENT_KEYS[notice.eventType];
  const { data } = notice;
  switch (key) {
    case "pastDue":
    case "suspended": {
      const values = {
        organization: text(data, "organization"),
        periodEnd: date(data, "periodEnd", format, false),
        nextStepOn: date(data, "nextStepOn", format, false),
      };
      return {
        title: t(`${key}.title`, values),
        body:
          key === "pastDue" && values.nextStepOn
            ? `${t(`${key}.body`, values)} ${t("pastDue.nextStep", values)}`
            : t(`${key}.body`, values),
      };
    }
    case "aiKeyBackup":
    case "aiKeyPaused": {
      const values = {
        workspace: text(data, "workspace"),
        agent: text(data, "agent") || t("aiAgent", {}),
        date: date(data, "until", format, true),
      };
      return {
        title: t(`${key}.title`, values),
        body: t(`${key}.body`, values),
      };
    }
    case "workspaceDeletionScheduled":
    case "workspaceDeletionReminder":
    case "workspaceDeletionCanceled":
    case "workspaceDeletionCompleted": {
      const values = {
        workspace: text(data, "workspace"),
        date: date(data, "purgeAfter", format, false),
      };
      return {
        title: t(`${key}.title`, values),
        body: t(`${key}.body`, values),
      };
    }
    case "gbAnalysesDone": {
      const values = { location: text(data, "location") };
      return {
        title: t("gbAnalysesDone.title", values),
        body: t("gbAnalysesDone.body", values),
      };
    }
    case "serviceModeRequested": {
      const values = {
        organization: text(data, "organization"),
        partner: text(data, "partner"),
      };
      return {
        title: t("serviceModeRequested.title", values),
        body: t("serviceModeRequested.body", values),
      };
    }
    case "serviceModeChanged": {
      const to = text(data, "to") === "padrao" ? "padrao" : "gerenciado";
      const values = { organization: text(data, "organization") };
      return {
        title: t(`serviceModeChanged.${to}.title`, values),
        body: t(`serviceModeChanged.${to}.body`, values),
      };
    }
    case "serviceModeDenied": {
      const values = { organization: text(data, "organization") };
      return {
        title: t("serviceModeDenied.title", values),
        body: t("serviceModeDenied.body", values),
      };
    }
    case "serviceModeRevertedByPartner": {
      const values = {
        organization: text(data, "organization"),
        partner: text(data, "partner"),
        reason: text(data, "reason"),
      };
      return {
        title: t("serviceModeRevertedByPartner.title", values),
        body: t("serviceModeRevertedByPartner.body", values),
      };
    }
    case "ipBlocked": {
      // The bell may come without the values (the hub's default notice).
      const values = { ip: text(data, "ip"), area: text(data, "area") };
      return {
        title: t("ipBlocked.title", values),
        body:
          values.ip && values.area
            ? t("ipBlocked.body", values)
            : t("ipBlocked.generic", values),
      };
    }
    case "inboxNew":
    case "inboxAssigned":
    case "inboxUnanswered": {
      const values = { contact: text(data, "contact") };
      return {
        title: t(`${key}.title`, values),
        body: t(`${key}.body`, values),
      };
    }
    case "eventsChainBroken": {
      const values = { count: text(data, "count") || "1" };
      return {
        title: t("eventsChainBroken.title", values),
        body: t("eventsChainBroken.body", values),
      };
    }
    case "accessRequested": {
      const values = {
        requester: text(data, "requester"),
        workspace: text(data, "workspace"),
        hours: text(data, "hours") || "72",
      };
      return {
        title: t("accessRequested.title", values),
        body: t("accessRequested.body", values),
      };
    }
    case "apiKeyCreated":
    case "apiKeyRevoked":
    case "mfaRequirementOff": {
      const values = {
        workspace: text(data, "workspace"),
        key: text(data, "key"),
      };
      return {
        title: t(`${key}.title`, values),
        body: t(`${key}.body`, values),
      };
    }
    case "eventReminder":
    case "eventEscalation": {
      const values = {
        event: text(data, "event"),
        hours: text(data, "hours") || "0",
      };
      return {
        title: t(`${key}.title`, values),
        body: t(`${key}.body`, values),
      };
    }
    case "eventDigest": {
      const values = { count: text(data, "count") || "0" };
      return {
        title: t("eventDigest.title", values),
        body: t("eventDigest.body", values),
      };
    }
    default:
      return { title: t("unknown.title", {}), body: t("unknown.body", {}) };
  }
}
