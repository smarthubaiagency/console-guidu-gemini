/** What the window knows about the person (from the server, IN4a). */
export type InboxViewer = Readonly<{
  level: "reply" | "read";
  manages: boolean;
  mxid: string | null;
}>;

export type ConversationCommand =
  | Readonly<{ kind: "take" }>
  | Readonly<{ kind: "resolve" }>
  | Readonly<{ kind: "reopen" }>
  | Readonly<{ kind: "assign"; assignee: string | null }>;
