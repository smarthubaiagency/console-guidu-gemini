/**
 * Notification port (ADR 0012, P3): one entry point for every message sent
 * to users, always rendered with the brand of the partner that owns the
 * recipient's host. E-mails leave through Resend (D-PA-08, CF3a) when
 * RESEND_API_KEY and EMAIL_FROM_ADDRESS are set; otherwise the transport is
 * disabled and nothing leaves the platform.
 */

type EventBase = Readonly<{
  recipientEmail: string;
  /** Stable key that makes a retried delivery a no-op. */
  idempotencyKey: string;
}>;

/** Notice to the partner about a customer's subscription (F3c). */
export type SubscriptionNoticeData = Readonly<{
  partnerName: string;
  organizationName: string;
  /** Due date: the end of the paid period. */
  periodEnd: Date;
  /** Day the next step happens (suspension), when there is one. */
  nextStepOn: Date | null;
  billingUrl: string;
}>;

/** Notice to the customer about the key of a GUIDS (A2c, §9.2). */
export type AgentKeyNoticeData = Readonly<{
  workspaceName: string;
  agentName: string | null;
  /** End of the 24 hours of backup. */
  backupUntil: Date;
  credentialsUrl: string;
}>;

/** Request to move the company to the managed mode (GB1c), to its owner. */
export type ServiceModeRequestData = Readonly<{
  organizationName: string;
  /** Who manages: the partner, or GUIDU for its direct customers. */
  partnerName: string;
  expiresAt: Date;
  /** The single-use link (never stored: built by the dispatch). */
  approveUrl: string;
  /** Configurações › Modo de serviço, for the bell. */
  settingsUrl: string;
}>;

/** Notice to the owners and admins about a workspace's deletion (WS1). */
export type WorkspaceDeletionNoticeData = Readonly<{
  workspaceName: string;
  /** When the data is purged (or was, for the completed notice). */
  purgeAfter: Date;
  /** The console, where the owner cancels within the grace period. */
  appUrl: string;
}>;

export type WorkspaceDeletionNoticeType =
  | "workspace.deletion.scheduled"
  | "workspace.deletion.reminder"
  | "workspace.deletion.canceled"
  | "workspace.deletion.completed";

/** Events with a template. Add one template per new event. */
export type NotificationEvent = EventBase &
  (
    | Readonly<{
        type: "invitation.created";
        data: Readonly<{
          inviteUrl: string;
          organizationName: string;
          expiresAt: Date;
        }>;
      }>
    | Readonly<{
        type: "billing.subscription.past_due";
        data: SubscriptionNoticeData;
      }>
    | Readonly<{
        type: "billing.subscription.suspended";
        data: SubscriptionNoticeData;
      }>
    | Readonly<{
        type: "ai.agent.key_backup";
        data: AgentKeyNoticeData;
      }>
    | Readonly<{
        type: "ai.agent.key_paused";
        data: AgentKeyNoticeData;
      }>
    | Readonly<{
        type: "service_mode.change_requested";
        data: ServiceModeRequestData;
      }>
    | Readonly<{
        type: WorkspaceDeletionNoticeType;
        data: WorkspaceDeletionNoticeData;
      }>
    | Readonly<{
        /** Test e-mail of Configurações › E-mail (CF3a). */
        type: "email.test";
        data: Readonly<{ settingsUrl: string }>;
      }>
  );

/** Brand fields a template may use. */
export type NotificationBrand = Readonly<{
  name: string;
  supportEmail: string | null;
  supportUrl: string | null;
  /** Brand color (`#rrggbb`) of the header and links, when known (CF3b). */
  color?: string | null;
  /** Sender settings of the brand's partner (CF3a); null uses the brand. */
  sender?: EmailSender;
}>;

/** `email.from_name` and `email.reply_to` of the cascade (CF3a). */
export type EmailSender = Readonly<{
  fromName: string | null;
  replyTo: string | null;
}>;

export type RenderedMessage = Readonly<{
  subject: string;
  text: string;
  html: string;
}>;

export type OutboundMessage = RenderedMessage &
  Readonly<{
    to: string;
    /** Display name of the sender; the address is the platform's. */
    fromName: string;
    replyTo: string | null;
    idempotencyKey: string;
    eventType: NotificationEvent["type"];
  }>;

export type SendResult =
  | Readonly<{ status: "sent"; providerMessageId: string }>
  | Readonly<{ status: "skipped"; reason: "no_provider" }>;

/** The provider refused the message or could not be reached. */
export class EmailSendError extends Error {
  constructor(
    readonly status: number | null,
    readonly code: string,
  ) {
    super(`E-mail não enviado (${status ?? "rede"}: ${code}).`);
    this.name = "EmailSendError";
  }
}

export interface NotificationTransport {
  /** Name of the provider kept with each delivery (H1), when there is one. */
  readonly provider?: string;
  send(message: OutboundMessage): Promise<SendResult>;
}
