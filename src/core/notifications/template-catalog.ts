import {
  TEMPLATE_EVENT_TYPES,
  type EmailTemplateGroup,
} from "@/core/events/catalog";

import type { TemplateVariable } from "./markup";
import type { NotificationEvent } from "./types";

/**
 * Editable e-mail templates (CF3b): the events of Configurações › E-mail ›
 * Modelos, grouped as on the screen, with the variables each one offers.
 * Variables are per event only, never a shared bag: a template can show
 * only what its event carries. No variable ever holds a password or a
 * secret; the invitation link is the one the invitation already sends.
 */

export type EmailTemplateEvent = NotificationEvent["type"];

export type { EmailTemplateGroup };

export type EmailTemplateDefinition = Readonly<{
  type: EmailTemplateEvent;
  group: EmailTemplateGroup;
  /** Message key of the event's name and description (`email.templates.events.<key>`). */
  key: string;
  /**
   * Essential e-mails (security, billing, invitation) never turn off.
   * Every event today is essential; a switch for the others is future work.
   */
  essential: boolean;
  variables: readonly TemplateVariable[];
}>;

const text = (name: string): TemplateVariable => ({ name, kind: "text" });
const url = (name: string): TemplateVariable => ({ name, kind: "url" });

/** Workspace deletion (WS1): name, date of the purge, console link, brand. */
const deletionVariables: readonly TemplateVariable[] = [
  text("workspace"),
  text("data"),
  url("link"),
  text("marca"),
];

/** The variables each event offers to its template. */
const VARIABLES: Readonly<
  Record<EmailTemplateEvent, readonly TemplateVariable[]>
> = {
  "invitation.created": [
    text("organizacao"),
    text("data"),
    url("link"),
    text("marca"),
  ],
  "email.test": [url("link"), text("marca")],
  "events.notice": [url("link"), text("marca")],
  "billing.subscription.past_due": [
    text("parceiro"),
    text("organizacao"),
    text("vencimento"),
    text("proximo_passo"),
    url("link"),
    text("marca"),
  ],
  "billing.subscription.suspended": [
    text("parceiro"),
    text("organizacao"),
    text("vencimento"),
    url("link"),
    text("marca"),
  ],
  "workspace.deletion.scheduled": deletionVariables,
  "workspace.deletion.reminder": deletionVariables,
  "workspace.deletion.canceled": deletionVariables,
  "workspace.deletion.completed": deletionVariables,
  "ai.agent.key_backup": [
    text("workspace"),
    text("agente"),
    text("data"),
    url("link"),
    text("marca"),
  ],
  "ai.agent.key_paused": [
    text("workspace"),
    text("agente"),
    text("data"),
    url("link"),
    text("marca"),
  ],
  // Not editable (no template in the catalog): the consent e-mail keeps the
  // code's text, with the single-use link.
  "service_mode.change_requested": [
    text("organizacao"),
    text("parceiro"),
    text("data"),
    url("link"),
    text("marca"),
  ],
};

/**
 * The templates, from the Event Hub catalog (H1): the types with a
 * template, in the catalog's order, with group, key and "essential" from
 * there and the variables from here.
 */
export const EMAIL_TEMPLATE_EVENTS: readonly EmailTemplateDefinition[] =
  TEMPLATE_EVENT_TYPES.flatMap((definition) => {
    const type = definition.type as EmailTemplateEvent;
    const variables = VARIABLES[type];
    if (!definition.template || !variables) return [];
    return [
      {
        type,
        group: definition.template.group,
        key: definition.template.key,
        essential: definition.essential,
        variables,
      },
    ];
  });

export const EMAIL_TEMPLATE_GROUPS: readonly EmailTemplateGroup[] = [
  "account",
  "billing",
  "ai",
];

export function emailTemplateDefinition(
  type: string,
): EmailTemplateDefinition | null {
  return EMAIL_TEMPLATE_EVENTS.find((event) => event.type === type) ?? null;
}

/** The subject and body of a template, as stored and edited. */
export type EmailTemplateContent = Readonly<{
  subject: string;
  body: string;
}>;
