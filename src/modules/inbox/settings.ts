import { z } from "zod";

import { SERVICE_DEFAULTS, ServiceSettings } from "@/core/channels/settings";

import { TranslationSettings } from "./translation-settings";

/**
 * Settings of the Inbox of a workspace (IN6), kept in the module's
 * workspace configuration (`workspace_modules.config`, ADR 0006): which
 * GUIDS answers the pending conversations (one per workspace, or none,
 * plano-in4b-in6.md §5 answer 6) and the service rules of the A5b, with
 * the same limits and defaults. The database reads `guids_agent_id` and
 * `service.grouping_seconds` (`private.inbox_guids_of`), so their keys and
 * places must not change.
 */

export const InboxServiceSettings = ServiceSettings.omit({ voice_reply: true });
export type InboxServiceSettings = z.infer<typeof InboxServiceSettings>;

export const INBOX_SERVICE_FIELDS: readonly {
  name: keyof InboxServiceSettings;
  min: number;
  max: number;
  step: number;
}[] = [
  { name: "grouping_seconds", min: 0, max: 30, step: 1 },
  { name: "max_messages", min: 1, max: 5, step: 1 },
  { name: "max_chars", min: 100, max: 1000, step: 50 },
  { name: "interval_ms", min: 0, max: 5000, step: 100 },
];

export const InboxWorkspaceConfig = z.object({
  guids_agent_id: z.uuid().nullable().default(null),
  service: InboxServiceSettings.partial().default({}),
  // TR2: the block "Tradução" (translation-settings.ts); a broken block
  // never takes the rest of the settings with it.
  translation: TranslationSettings.optional().catch(undefined),
});
export type InboxWorkspaceConfig = z.infer<typeof InboxWorkspaceConfig>;

/** The configuration as stored, tolerant of old or empty rows. */
export function inboxConfigOf(config: unknown): InboxWorkspaceConfig {
  const parsed = InboxWorkspaceConfig.safeParse(config ?? {});
  return parsed.success ? parsed.data : { guids_agent_id: null, service: {} };
}

/** The service rules in force: the workspace's, else the A5b defaults. */
export function resolveInboxService(config: unknown): InboxServiceSettings {
  const { service } = inboxConfigOf(config);
  return {
    grouping_seconds:
      service.grouping_seconds ?? SERVICE_DEFAULTS.grouping_seconds,
    max_messages: service.max_messages ?? SERVICE_DEFAULTS.max_messages,
    max_chars: service.max_chars ?? SERVICE_DEFAULTS.max_chars,
    interval_ms: service.interval_ms ?? SERVICE_DEFAULTS.interval_ms,
  };
}
