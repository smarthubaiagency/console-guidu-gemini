/**
 * Views of the Inbox (ADR 0014, revision of 16/10/2026): Minhas, Não
 * atribuídas, Todas and Resolvidas, chosen in the type selector of the list
 * since the IN4c. Shared by the server and the browser.
 */
export const INBOX_VIEWS = ["mine", "unassigned", "all", "resolved"] as const;
export type InboxView = (typeof INBOX_VIEWS)[number];

export function isInboxView(value: unknown): value is InboxView {
  return (INBOX_VIEWS as readonly unknown[]).includes(value);
}

export type ConversationStatus = "open" | "pending" | "resolved";

/** A conversation of the list, from the mirror in the database. */
export type ConversationSummary = Readonly<{
  roomId: string;
  status: ConversationStatus;
  assignee: string | null;
  consumerMxid: string | null;
  consumerName: string | null;
  /** The contact's language (TR1): pt-BR, en or es; null while unknown. */
  contactLocale: "pt-BR" | "en" | "es" | null;
  /** Set by the team: the detection no longer changes it. */
  contactLocaleManual: boolean;
  updatedAt: string;
  /** Labels on the conversation (IN4b). */
  labelIds: readonly string[];
}>;

export type LabelColor = "neutral" | "info" | "success" | "warning" | "danger";

export type LabelView = Readonly<{
  id: string;
  name: string;
  color: LabelColor;
}>;

export type ConversationPage = Readonly<{
  items: ConversationSummary[];
  /** The label catalog of the workspace (IN4b). */
  labels: readonly LabelView[];
  counts: Readonly<Record<InboxView, number>>;
}>;

/** Own cookie of the Inbox bar (ADR 0014, revision of 16/10/2026, item 6). */
export const INBOX_SIDEBAR_COOKIE = "inbox_sidebar_state";

/** The tabs of the context panel (IN4c), kept in the address bar. */
export const CONTEXT_TABS = ["contact", "threads"] as const;
export type ContextTab = (typeof CONTEXT_TABS)[number];

export function isContextTab(value: unknown): value is ContextTab {
  return (
    typeof value === "string" &&
    (CONTEXT_TABS as readonly string[]).includes(value)
  );
}
