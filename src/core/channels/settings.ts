import { z } from "zod";

/**
 * Service settings of a connection (A5b, decided by Marcelo on
 * 13/10/2026): how the consumer's answers reach the contact. They live in
 * the integration (`channel_connections.config.service`), with defaults for
 * every inbox and adjustments per inbox. The ingestion reads
 * `grouping_seconds` in SQL (migration 20261106090000), so its key and
 * place in the JSON must not change.
 *
 * Voice (A5d): with `voice_reply` "mirror", a contact who sent audio gets
 * the answer in audio, when the agent's key has a voice; "off" always
 * answers in text.
 *
 * Back to the bot: after a handoff, the conversation returns to the agent
 * when the team sets it back to "pending" in Chatwoot. That rule is fixed.
 */

export const SERVICE_DEFAULTS = {
  /** Waits for more messages of the contact before answering. */
  grouping_seconds: 5,
  /** Most messages of one answer. */
  max_messages: 3,
  /** Guidance to the model for each message (short texts). */
  max_chars: 300,
  /** Pause between the messages of one answer. */
  interval_ms: 1500,
  /** Answers in audio the contact who sent audio. */
  voice_reply: "mirror",
} as const;

export const VOICE_REPLIES = ["mirror", "off"] as const;

export const ServiceSettings = z.strictObject({
  grouping_seconds: z.coerce.number().int().min(0).max(30),
  max_messages: z.coerce.number().int().min(1).max(5),
  max_chars: z.coerce.number().int().min(100).max(1000),
  interval_ms: z.coerce.number().int().min(0).max(5000),
  voice_reply: z.enum(VOICE_REPLIES),
});
export type ServiceSettings = z.infer<typeof ServiceSettings>;

export const ServiceConfig = z.object({
  defaults: ServiceSettings.partial().default({}),
  inboxes: z.record(z.string(), ServiceSettings.partial()).default({}),
});
export type ServiceConfig = z.infer<typeof ServiceConfig>;

/** The service part of a connection's config, tolerant of old rows. */
export function serviceConfigOf(config: unknown): ServiceConfig {
  const raw =
    config && typeof config === "object" && "service" in config
      ? (config as { service: unknown }).service
      : undefined;
  const parsed = ServiceConfig.safeParse(raw ?? {});
  return parsed.success ? parsed.data : { defaults: {}, inboxes: {} };
}

/** The settings that apply to one inbox: its own, the connection's, ours. */
export function resolveServiceSettings(
  config: unknown,
  scope: string | null,
): ServiceSettings {
  const service = serviceConfigOf(config);
  const own = scope ? service.inboxes[scope] : undefined;
  const pick = <K extends keyof ServiceSettings>(key: K) =>
    (own?.[key] ??
      service.defaults[key] ??
      SERVICE_DEFAULTS[key]) as ServiceSettings[K];
  return {
    grouping_seconds: pick("grouping_seconds"),
    max_messages: pick("max_messages"),
    max_chars: pick("max_chars"),
    interval_ms: pick("interval_ms"),
    voice_reply: pick("voice_reply"),
  };
}

/**
 * The answer as it will be sent: at most `max_messages` parts, the extra
 * ones joined to the last, each within the channel's own limit.
 */
export function shapeAnswer(
  messages: readonly string[],
  settings: Pick<ServiceSettings, "max_messages">,
  channelMax: number,
): string[] {
  const parts = messages.map((m) => m.trim()).filter((m) => m !== "");
  if (parts.length > settings.max_messages) {
    const head = parts.slice(0, settings.max_messages - 1);
    const tail = parts.slice(settings.max_messages - 1).join("\n\n");
    parts.splice(0, parts.length, ...head, tail);
  }
  return parts.map((part) => part.slice(0, channelMax));
}
