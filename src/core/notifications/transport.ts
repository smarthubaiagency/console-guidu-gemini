import { EmailSendError, type NotificationTransport } from "./types";

/**
 * E-mail transports (D-PA-08, CF3a). Resend is used when RESEND_API_KEY and
 * EMAIL_FROM_ADDRESS are set; otherwise renders are still produced and
 * tested, but nothing is delivered.
 */
export const disabledTransport: NotificationTransport = {
  async send() {
    return { status: "skipped", reason: "no_provider" };
  },
};

export const RESEND_API = "https://api.resend.com";

export type EmailEnv = Readonly<{
  RESEND_API_KEY?: string | undefined;
  EMAIL_FROM_ADDRESS?: string | undefined;
  /** Tests point the client at a fake. */
  RESEND_API_BASE?: string | undefined;
}>;

export type EmailConfig = Readonly<{
  apiKey: string;
  fromAddress: string;
  apiBase: string;
}>;

const ADDRESS = /^[^\s@<>"]+@[^\s@<>"]+\.[^\s@<>"]+$/;

/** The provider settings, or null while e-mail is off. */
export function emailConfig(
  env: EmailEnv = process.env as EmailEnv,
): EmailConfig | null {
  const apiKey = env.RESEND_API_KEY?.trim();
  const fromAddress = env.EMAIL_FROM_ADDRESS?.trim().toLowerCase();
  if (!apiKey || !fromAddress || !ADDRESS.test(fromAddress)) return null;
  return {
    apiKey,
    fromAddress,
    apiBase: env.RESEND_API_BASE?.trim().replace(/\/+$/, "") || RESEND_API,
  };
}

/** `Name <address>`, with the characters that would break the header removed. */
export function fromHeader(name: string, address: string): string {
  const clean = name
    .replace(/["<>\r\n\\]/g, "")
    .trim()
    .slice(0, 80);
  return clean ? `"${clean}" <${address}>` : address;
}

/**
 * Resend over its HTTP API. The delivery key goes as `Idempotency-Key`, so a
 * retried job never sends the same e-mail twice.
 */
export function resendTransport(
  config: EmailConfig,
  fetchImpl: typeof fetch = fetch,
): NotificationTransport {
  return {
    provider: "resend",
    async send(message) {
      let response: Response;
      try {
        response = await fetchImpl(`${config.apiBase}/emails`, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${config.apiKey}`,
            "Content-Type": "application/json",
            "Idempotency-Key": message.idempotencyKey.slice(0, 256),
          },
          body: JSON.stringify({
            from: fromHeader(message.fromName, config.fromAddress),
            to: [message.to],
            subject: message.subject,
            text: message.text,
            html: message.html,
            ...(message.replyTo ? { reply_to: message.replyTo } : {}),
            tags: [
              { name: "event", value: message.eventType.replace(/\./g, "_") },
            ],
          }),
          signal: AbortSignal.timeout(15_000),
        });
      } catch {
        throw new EmailSendError(null, "network_error");
      }
      const body = (await response.json().catch(() => null)) as {
        id?: unknown;
        name?: unknown;
      } | null;
      if (!response.ok || typeof body?.id !== "string") {
        const code =
          typeof body?.name === "string"
            ? body.name.replace(/[^a-z_]/gi, "").slice(0, 60) ||
              "provider_error"
            : "provider_error";
        throw new EmailSendError(response.status, code);
      }
      return { status: "sent", providerMessageId: body.id };
    },
  };
}

export function getNotificationTransport(): NotificationTransport {
  const config = emailConfig();
  return config ? resendTransport(config) : disabledTransport;
}
