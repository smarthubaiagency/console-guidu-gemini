/**
 * Notification port (ADR 0012, P3): one entry point for every message sent
 * to users, always rendered with the brand of the partner that owns the
 * recipient's host. Delivery runs in jobs with idempotency once the worker
 * (F3) and the e-mail provider (D-PA-08) exist; until then the transport is
 * disabled and nothing leaves the platform.
 */

/** Events with a template. Add one template per new event. */
export type NotificationEvent = Readonly<{
  type: "invitation.created";
  recipientEmail: string;
  /** Stable key that makes a retried delivery a no-op. */
  idempotencyKey: string;
  data: Readonly<{
    inviteUrl: string;
    organizationName: string;
    expiresAt: Date;
  }>;
}>;

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
