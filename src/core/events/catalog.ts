/**
 * Catalog of the Event Hub (H1, ADR 0022): every event type a module may
 * emit, with what the hub does with it. A type outside the catalog is
 * refused by `emitEvent`.
 *
 * Pure and dependency-free: the worker, the server and the screens share
 * it. The notification channels (`notifications/channels.ts`) and the
 * e-mail templates (`notifications/template-catalog.ts`) derive from it.
 */

export const EVENT_SEVERITIES = ["info", "attention", "urgent"] as const;
export type EventSeverity = (typeof EVENT_SEVERITIES)[number];

/** Who may hear about an event (and read it, by level). */
export const EVENT_AUDIENCES = ["customer", "partner", "platform"] as const;
export type EventAudience = (typeof EVENT_AUDIENCES)[number];

/** Marketing to a lead will need consent (H5); internal notices are transactional. */
export const EVENT_PURPOSES = ["transactional", "marketing"] as const;
export type EventPurpose = (typeof EVENT_PURPOSES)[number];

/**
 * Who the `notify` destination tells (see `private.event_recipients`):
 * - service_mode: standard company → workspace owners and admins; managed
 *   company → the partner's owner, admin and support (the house partner is
 *   GUIDU, with no special case);
 * - customer: the workspace owners and admins, whatever the mode;
 * - partner: the partner (billing e-mail, else its owners) and its owners'
 *   bell;
 * - platform: platform owners and operations (bell);
 * - subject_person: the person written in the event;
 * - explicit: a target the event carries (e.g. the agent's `owner_phone`).
 */
export const EVENT_ROUTES = [
  "service_mode",
  "customer",
  "partner",
  "platform",
  "subject_person",
  "explicit",
] as const;
export type EventRoute = (typeof EVENT_ROUTES)[number];

/**
 * Where an event goes. Only `notify` and `audit` are built (H1); the
 * others are refused by `emitEvent` until their stage:
 * - analytics: H3 (with the digital profile, DP2);
 * - subscribers (hand-off to another agent's job): H4 (with the GB2);
 * - webhook (the customer's): H5.
 */
export const EVENT_DESTINATIONS = [
  "notify",
  "audit",
  "analytics",
  "subscribers",
  "webhook",
] as const;
export type EventDestination = (typeof EVENT_DESTINATIONS)[number];

export const IMPLEMENTED_DESTINATIONS: readonly EventDestination[] = [
  "notify",
  "audit",
];

/** The stage that builds each destination not built yet. */
export const DESTINATION_STAGE: Readonly<
  Partial<Record<EventDestination, string>>
> = {
  analytics: "H3",
  subscribers: "H4",
  webhook: "H5",
};

export const EVENT_CHANNELS = ["app", "email", "whatsapp"] as const;
export type EventChannel = (typeof EVENT_CHANNELS)[number];

/**
 * Where an event lives: a workspace (company and partner known), a partner
 * (the company optional, e.g. billing of a customer) or the platform.
 */
export const EVENT_LEVELS = ["workspace", "partner", "platform"] as const;
export type EventLevel = (typeof EVENT_LEVELS)[number];

export const EVENT_STATUSES = [
  "open",
  "resolved",
  "dismissed",
  // Approvals (H4); the database already accepts them.
  "pending",
  "approved",
  "denied",
  "expired",
] as const;
export type EventStatus = (typeof EVENT_STATUSES)[number];

/** Groups of Configurações › E-mail › Modelos (CF3b). */
export type EmailTemplateGroup = "account" | "billing" | "ai";

type Definition<T extends string> = Readonly<{
  type: T;
  module: string;
  severity: EventSeverity;
  /** Reaches every channel it has, whatever the preference (locked in Minha conta). */
  essential: boolean;
  audiences: readonly EventAudience[];
  purpose: EventPurpose;
  route: EventRoute;
  destinations: readonly EventDestination[];
  channels: readonly EventChannel[];
  level: EventLevel;
  /**
   * Sent by the request itself, which answers with the outcome at once
   * (the invitation link and the test e-mail): the catalog governs it, but
   * no event row is written and `emitEvent` refuses it.
   */
  inline?: boolean;
  /** The e-mail template (`email.templates.events.<key>`), when it has one. */
  template?: Readonly<{ group: EmailTemplateGroup; key: string }>;
  /**
   * The rule of `notifications.rules` starts off (H2: security events):
   * the event is recorded and shown, nobody is told until a level turns
   * it on.
   */
  notifyByDefault?: boolean;
  /**
   * The event waits for a decision (`pending`): a reminder and the
   * escalation of its rule apply while nobody answers (H2).
   */
  approval?: boolean;
}>;

const CATALOG = [
  // -- Account (CF3a/CF3b): sent inline by the request ------------------------
  {
    type: "invitation.created",
    module: "core",
    severity: "info",
    essential: true,
    audiences: ["customer"],
    purpose: "transactional",
    route: "explicit",
    destinations: ["notify"],
    channels: ["email"],
    level: "workspace",
    inline: true,
    template: { group: "account", key: "invitation" },
  },
  {
    type: "email.test",
    module: "core",
    severity: "info",
    essential: true,
    audiences: ["customer", "partner", "platform"],
    purpose: "transactional",
    route: "explicit",
    destinations: ["notify"],
    channels: ["email"],
    level: "platform",
    inline: true,
    template: { group: "account", key: "emailTest" },
  },
  // -- Workspace deletion (WS1): owners and admins of the workspace ---------
  {
    type: "workspace.deletion.scheduled",
    module: "core",
    severity: "urgent",
    essential: true,
    audiences: ["customer"],
    purpose: "transactional",
    route: "customer",
    destinations: ["notify"],
    channels: ["email", "app"],
    level: "workspace",
    template: { group: "account", key: "workspaceDeletionScheduled" },
  },
  {
    type: "workspace.deletion.reminder",
    module: "core",
    severity: "urgent",
    essential: true,
    audiences: ["customer"],
    purpose: "transactional",
    route: "customer",
    destinations: ["notify"],
    channels: ["email", "app"],
    level: "workspace",
    template: { group: "account", key: "workspaceDeletionReminder" },
  },
  {
    type: "workspace.deletion.canceled",
    module: "core",
    severity: "info",
    essential: true,
    audiences: ["customer"],
    purpose: "transactional",
    route: "customer",
    destinations: ["notify"],
    channels: ["email", "app"],
    level: "workspace",
    template: { group: "account", key: "workspaceDeletionCanceled" },
  },
  {
    type: "workspace.deletion.completed",
    module: "core",
    severity: "info",
    essential: true,
    audiences: ["customer"],
    purpose: "transactional",
    route: "customer",
    destinations: ["notify"],
    channels: ["email", "app"],
    level: "workspace",
    template: { group: "account", key: "workspaceDeletionCompleted" },
  },
  // -- Billing (F3c): the partner hears about its customers ------------------
  {
    type: "billing.subscription.past_due",
    module: "billing",
    severity: "attention",
    essential: true,
    audiences: ["partner"],
    purpose: "transactional",
    route: "partner",
    destinations: ["notify"],
    channels: ["email", "app"],
    level: "partner",
    template: { group: "billing", key: "pastDue" },
  },
  {
    type: "billing.subscription.suspended",
    module: "billing",
    severity: "urgent",
    essential: true,
    audiences: ["partner"],
    purpose: "transactional",
    route: "partner",
    destinations: ["notify"],
    channels: ["email", "app"],
    level: "partner",
    template: { group: "billing", key: "suspended" },
  },
  // -- AI key of a GUIDS (A2c) ------------------------------------------------
  {
    type: "ai.agent.key_backup",
    module: "ai_agents",
    severity: "attention",
    essential: true,
    audiences: ["customer"],
    purpose: "transactional",
    route: "service_mode",
    destinations: ["notify"],
    channels: ["email", "app"],
    level: "workspace",
    template: { group: "ai", key: "aiKeyBackup" },
  },
  {
    type: "ai.agent.key_paused",
    module: "ai_agents",
    severity: "urgent",
    essential: true,
    audiences: ["customer"],
    purpose: "transactional",
    route: "service_mode",
    destinations: ["notify"],
    channels: ["email", "app"],
    level: "workspace",
    template: { group: "ai", key: "aiKeyPaused" },
  },
  // -- GUIDS notices to the merchant (A6), WhatsApp by the partner's webhook --
  {
    type: "ai.agent.lead_hot",
    module: "ai_agents",
    severity: "attention",
    essential: false,
    audiences: ["customer"],
    purpose: "transactional",
    route: "explicit",
    destinations: ["notify"],
    channels: ["whatsapp"],
    level: "workspace",
  },
  {
    type: "ai.agent.referral_recommended",
    module: "ai_agents",
    severity: "info",
    essential: false,
    audiences: ["customer"],
    purpose: "transactional",
    route: "explicit",
    destinations: ["notify"],
    channels: ["whatsapp"],
    level: "workspace",
  },
  // -- Google Meu Negócio (GB1a): to whom started the onboarding -------------
  {
    type: "google_business.analyses_done",
    module: "google_business",
    severity: "info",
    essential: false,
    audiences: ["customer"],
    purpose: "transactional",
    route: "subject_person",
    destinations: ["notify"],
    channels: ["app"],
    level: "workspace",
  },
  // -- Service modes (GB1c, ADR 0020): the request, its decision and the way
  //    back to `padrao`. The link goes only by e-mail to the owner, with a
  //    token the dispatch writes (never in the event's data).
  {
    type: "service_mode.change_requested",
    module: "service_modes",
    severity: "attention",
    essential: true,
    audiences: ["customer", "partner"],
    purpose: "transactional",
    route: "explicit",
    destinations: ["notify"],
    channels: ["email", "app"],
    level: "workspace",
  },
  {
    type: "service_mode.changed",
    module: "service_modes",
    severity: "attention",
    essential: true,
    audiences: ["customer", "partner"],
    purpose: "transactional",
    route: "explicit",
    destinations: ["notify"],
    channels: ["app"],
    level: "workspace",
  },
  {
    type: "service_mode.change_denied",
    module: "service_modes",
    severity: "info",
    essential: true,
    audiences: ["customer", "partner"],
    purpose: "transactional",
    route: "explicit",
    destinations: ["notify"],
    channels: ["app"],
    level: "workspace",
  },
  // -- Platform: the seal check found a broken chain -------------------------
  {
    type: "platform.events.chain_broken",
    module: "events",
    severity: "urgent",
    essential: true,
    audiences: ["platform"],
    purpose: "transactional",
    route: "platform",
    destinations: ["audit", "notify"],
    channels: ["app"],
    level: "platform",
  },
  // -- Access to the data of events (H2, ADR 0022 item 7): the customer
  //    decides; emitted by the worker when the request is made.
  {
    type: "events.access_requested",
    module: "events",
    severity: "attention",
    essential: true,
    audiences: ["customer"],
    purpose: "transactional",
    route: "customer",
    destinations: ["notify"],
    channels: ["app", "email"],
    level: "workspace",
    approval: true,
  },
  // -- Security (CF5a) in the hub (H2): recorded and shown, notice off by
  //    default. The audit keeps its own records (`api_keys.*`,
  //    `workspace.settings.save`).
  {
    type: "security.api_key_created",
    module: "security",
    severity: "attention",
    essential: false,
    audiences: ["customer"],
    purpose: "transactional",
    route: "customer",
    destinations: ["notify"],
    channels: ["app", "email"],
    level: "workspace",
    notifyByDefault: false,
  },
  {
    type: "security.api_key_revoked",
    module: "security",
    severity: "info",
    essential: false,
    audiences: ["customer"],
    purpose: "transactional",
    route: "customer",
    destinations: ["notify"],
    channels: ["app", "email"],
    level: "workspace",
    notifyByDefault: false,
  },
  {
    type: "security.mfa_requirement_off",
    module: "security",
    severity: "urgent",
    essential: false,
    audiences: ["customer"],
    purpose: "transactional",
    route: "customer",
    destinations: ["notify"],
    channels: ["app", "email"],
    level: "workspace",
    notifyByDefault: false,
  },
  // -- Digital profile (DP2): catalogued now, emitted when analytics (H3)
  //    exists; `emitEvent` refuses them until then.
  {
    type: "digital_profile.lead.submitted",
    module: "digital_profile",
    severity: "attention",
    essential: false,
    audiences: ["customer"],
    purpose: "transactional",
    route: "service_mode",
    destinations: ["analytics", "notify"],
    channels: ["email", "app"],
    level: "workspace",
  },
  {
    type: "digital_profile.vcard.downloaded",
    module: "digital_profile",
    severity: "info",
    essential: false,
    audiences: ["customer"],
    purpose: "transactional",
    route: "service_mode",
    destinations: ["analytics"],
    channels: [],
    level: "workspace",
  },
] as const satisfies readonly Definition<string>[];

export type EventType = (typeof CATALOG)[number]["type"];

export type EventDefinition = Definition<EventType>;

export const EVENT_CATALOG: readonly EventDefinition[] = CATALOG;

const BY_TYPE: ReadonlyMap<string, EventDefinition> = new Map(
  EVENT_CATALOG.map((definition) => [definition.type, definition]),
);

export function eventDefinition(type: string): EventDefinition | null {
  return BY_TYPE.get(type) ?? null;
}

export function isEventType(type: string): type is EventType {
  return BY_TYPE.has(type);
}

/**
 * The notices of a workspace's own deletion (WS1): the only events of a
 * closed workspace that still reach anyone.
 */
export const WORKSPACE_DELETION_EVENT_TYPES = [
  "workspace.deletion.scheduled",
  "workspace.deletion.reminder",
  "workspace.deletion.canceled",
  "workspace.deletion.completed",
] as const satisfies readonly EventType[];

export type WorkspaceDeletionEventType =
  (typeof WORKSPACE_DELETION_EVENT_TYPES)[number];

export function isWorkspaceDeletionEvent(
  type: string,
): type is WorkspaceDeletionEventType {
  return (WORKSPACE_DELETION_EVENT_TYPES as readonly string[]).includes(type);
}

/** Modules with events, for the filters of the screens. */
export const EVENT_MODULES: readonly string[] = [
  ...new Set(EVENT_CATALOG.map((definition) => definition.module)),
];

/** Destinations of a type that no stage built yet. */
export function missingDestinations(
  definition: EventDefinition,
): EventDestination[] {
  return definition.destinations.filter(
    (destination) => !IMPLEMENTED_DESTINATIONS.includes(destination),
  );
}

/** Types with an e-mail template, in the order of the screen (CF3b). */
export const TEMPLATE_EVENT_TYPES = EVENT_CATALOG.filter(
  (definition) => definition.template !== undefined,
);
