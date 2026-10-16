import { eventDefinition } from "@/core/events/catalog";

import {
  EMAIL_TEMPLATE_EVENTS,
  type EmailTemplateGroup,
} from "./template-catalog";
import type { NotificationEvent } from "./types";

/**
 * Channels of each notification event (CF3c): e-mail and the bell in the
 * app. `notify` and the worker deliver an event to the channels the event
 * has and its recipient keeps on; an essential event (security, billing)
 * reaches every channel it has, whatever the preference, and Minha conta
 * shows it locked. Every event today is essential; the matrix is ready for
 * the optional ones that come later. The catalog of events (and of their
 * channels) is the Event Hub's (`core/events/catalog.ts`).
 *
 * Pure and dependency-free: the worker, the server and the screen share it.
 */

export const NOTIFICATION_CHANNELS = ["email", "app"] as const;

export type NotificationChannel = (typeof NOTIFICATION_CHANNELS)[number];

export type NotificationEventType = NotificationEvent["type"];

export type NotificationEventDefinition = Readonly<{
  type: NotificationEventType;
  group: EmailTemplateGroup;
  /** Message key of the event (`email.templates.events.<key>`). */
  key: string;
  essential: boolean;
  channels: readonly NotificationChannel[];
}>;

/**
 * The channels of each event come from the Event Hub catalog (H1). An
 * invitation goes to an address before it has an account, and the test
 * e-mail is the e-mail itself, so both stay e-mail only and out of the
 * preferences. WhatsApp is the hub's own channel (the partner's webhook)
 * and stays out of this matrix.
 */
function channelsOf(type: NotificationEventType): NotificationChannel[] {
  const definition = eventDefinition(type);
  return NOTIFICATION_CHANNELS.filter((channel) =>
    (definition?.channels as readonly string[] | undefined)?.includes(channel),
  );
}

export const NOTIFICATION_EVENTS: readonly NotificationEventDefinition[] =
  EMAIL_TEMPLATE_EVENTS.map((event) => ({
    type: event.type,
    group: event.group,
    key: event.key,
    essential: event.essential,
    channels: channelsOf(event.type),
  }));

/** Events of the preference matrix: those that reach a person's bell. */
export const PREFERENCE_EVENTS: readonly NotificationEventDefinition[] =
  NOTIFICATION_EVENTS.filter((event) => event.channels.includes("app"));

export function notificationEventDefinition(
  type: string,
): NotificationEventDefinition | null {
  return NOTIFICATION_EVENTS.find((event) => event.type === type) ?? null;
}

export function isNotificationChannel(
  value: string,
): value is NotificationChannel {
  return (NOTIFICATION_CHANNELS as readonly string[]).includes(value);
}

/** A row of `notification_preferences`: what the person set. */
export type ChannelPreference = Readonly<{
  eventType: string;
  channel: string;
  enabled: boolean;
}>;

/**
 * Whether a person may change the channel of the event: it must be one of
 * the event's channels and the event must not be essential.
 */
export function canChangeChannel(
  definition: NotificationEventDefinition,
  channel: NotificationChannel,
): boolean {
  return !definition.essential && definition.channels.includes(channel);
}

/**
 * The channel is on for the person: off only when the event has it, it is
 * optional and the person turned it off. An unknown event is treated as
 * essential on e-mail, so nothing is lost by a missing catalog entry.
 */
export function channelEnabled(
  definition: NotificationEventDefinition | null,
  channel: NotificationChannel,
  preferences: readonly ChannelPreference[],
): boolean {
  if (!definition) return channel === "email";
  if (!definition.channels.includes(channel)) return false;
  if (definition.essential) return true;
  const row = preferences.find(
    (p) => p.eventType === definition.type && p.channel === channel,
  );
  return row?.enabled ?? true;
}

/** The channels an event reaches for a person. */
export function resolveChannels(
  definition: NotificationEventDefinition | null,
  preferences: readonly ChannelPreference[],
): ReadonlySet<NotificationChannel> {
  return new Set(
    NOTIFICATION_CHANNELS.filter((channel) =>
      channelEnabled(definition, channel, preferences),
    ),
  );
}
