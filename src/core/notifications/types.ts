/**
 * Notification port (ADR 0012, P3): one entry point for every message sent
 * to users, always rendered with the brand of the partner that owns the
 * recipient's host. Delivery runs in jobs with idempotency once the worker
 * (F3) and the e-mail provider (D-PA-08) exist; until then the transport is
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
  );

/** Brand fields a template may use. */
export type NotificationBrand = Readonly<{
  name: string;
  supportEmail: string | null;
  supportUrl: string | null;
}>;

export type RenderedMessage = Readonly<{
  subject: string;
  text: string;
  html: string;
}>;

export type OutboundMessage = RenderedMessage &
  Readonly<{
    to: string;
    idempotencyKey: string;
    eventType: NotificationEvent["type"];
  }>;

export type SendResult =
  | Readonly<{ status: "sent"; providerMessageId: string }>
  | Readonly<{ status: "skipped"; reason: "no_provider" }>;

export interface NotificationTransport {
  send(message: OutboundMessage): Promise<SendResult>;
}
