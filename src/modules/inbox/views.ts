/**
 * Views of the Inbox bar (ADR 0014, revision of 16/10/2026): Minhas, Não
 * atribuídas, Todas and Resolvidas. Shared by the server and the browser.
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
