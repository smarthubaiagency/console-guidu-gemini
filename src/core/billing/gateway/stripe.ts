import { randomBytes } from "node:crypto";

/**
 * Stripe Connect as the platform's gateway (CF7): what the screen and the
 * webhook need, without the SDK. Real charging stays off until P6
 * (D-PA-14): the adapter in `../providers/planned.ts` keeps answering
 * "provedor não configurado", and processing a webhook event here only
 * records it (no subscription changes).
 */

export const GATEWAY_PROVIDERS = ["stripe"] as const;
export type GatewayProvider = (typeof GATEWAY_PROVIDERS)[number];

export const GATEWAY_MODES = ["test", "live"] as const;
export type GatewayMode = (typeof GATEWAY_MODES)[number];

export function isGatewayMode(value: unknown): value is GatewayMode {
  return value === "test" || value === "live";
}

/** Path of the webhook, under the operator's APP_URL. */
export const STRIPE_WEBHOOK_PATH = "/api/billing/stripe/webhook";

/** Larger bodies are refused (413); Stripe events are a few kilobytes. */
export const MAX_STRIPE_WEBHOOK_BYTES = 256 * 1024;

/** Type of the event sent by "Enviar webhook de teste". */
export const TEST_EVENT_TYPE = "guidu.webhook_test";

const SECRET_KEY = /^(sk|rk)_(test|live)_[A-Za-z0-9]{16,240}$/;
const WEBHOOK_SECRET = /^whsec_[A-Za-z0-9+/=]{16,200}$/;

export type CredentialProblem =
  "secretKeyFormat" | "secretKeyMode" | "webhookSecretFormat";

/** Checks a secret key (standard or restricted) against the mode. */
export function checkSecretKey(
  value: string,
  mode: GatewayMode,
): CredentialProblem | null {
  const match = SECRET_KEY.exec(value);
  if (!match) return "secretKeyFormat";
  return match[2] === mode ? null : "secretKeyMode";
}

export function checkWebhookSecret(value: string): CredentialProblem | null {
  return WEBHOOK_SECRET.test(value) ? null : "webhookSecretFormat";
}

/** The mode a stored secret key belongs to, from its prefix. */
export function secretKeyMode(masked: string | null): GatewayMode | null {
  const match = /^(?:sk|rk)_(test|live)_/.exec(masked ?? "");
  return match ? (match[1] as GatewayMode) : null;
}

/** Prefix and the last four characters: `sk_test_...a1b2`, `whsec_...a1b2`. */
export function maskStripeSecret(value: string): string {
  const prefix = /^((?:sk|rk)_(?:test|live)_|whsec_)/.exec(value)?.[1] ?? "";
  return `${prefix}...${value.slice(-4)}`;
}

export type StripeEventHead = Readonly<{
  id: string;
  type: string;
  livemode: boolean;
}>;

/** The fields of an event this step uses; null for anything else. */
export function parseStripeEvent(raw: string): StripeEventHead | null {
  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) return null;
  const { id, type, livemode } = body as Record<string, unknown>;
  if (
    typeof id !== "string" ||
    !/^evt_[A-Za-z0-9_]{1,250}$/.test(id) ||
    typeof type !== "string" ||
    !/^[a-z0-9_.]{1,120}$/.test(type) ||
    typeof livemode !== "boolean"
  ) {
    return null;
  }
  return { id, type, livemode };
}

/**
 * Processing of a stored event in this step: it is recorded and marked as
 * processed, nothing else changes. An event of the other mode (a live event
 * while the gateway is in test, or the opposite) fails with
 * `mode_mismatch`, so it shows in the health card and can be reprocessed
 * after the mode is fixed. Returns the error code, or null.
 */
export function processStripeEvent(
  raw: string,
  mode: GatewayMode,
): string | null {
  const event = parseStripeEvent(raw);
  if (!event) return "invalid_event";
  if (event.livemode !== (mode === "live")) return "mode_mismatch";
  return null;
}

/** The event of "Enviar webhook de teste": no customer, no data. */
export function buildTestEvent(
  mode: GatewayMode,
  now: Date = new Date(),
): string {
  return JSON.stringify({
    id: `evt_guidu_test_${randomBytes(12).toString("hex")}`,
    object: "event",
    type: TEST_EVENT_TYPE,
    livemode: mode === "live",
    created: Math.floor(now.getTime() / 1000),
    data: { object: {} },
  });
}
