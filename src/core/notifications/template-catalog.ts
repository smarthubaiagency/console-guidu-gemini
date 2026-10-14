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

export type EmailTemplateGroup = "account" | "billing" | "ai";

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

export const EMAIL_TEMPLATE_EVENTS: readonly EmailTemplateDefinition[] = [
  {
    type: "invitation.created",
    group: "account",
    key: "invitation",
    essential: true,
    variables: [text("organizacao"), text("data"), url("link"), text("marca")],
  },
  {
    type: "email.test",
    group: "account",
    key: "emailTest",
    essential: true,
    variables: [url("link"), text("marca")],
  },
  {
    type: "billing.subscription.past_due",
    group: "billing",
    key: "pastDue",
    essential: true,
    variables: [
      text("parceiro"),
      text("organizacao"),
      text("vencimento"),
      text("proximo_passo"),
      url("link"),
      text("marca"),
    ],
  },
  {
    type: "billing.subscription.suspended",
    group: "billing",
    key: "suspended",
    essential: true,
    variables: [
      text("parceiro"),
      text("organizacao"),
      text("vencimento"),
      url("link"),
      text("marca"),
    ],
  },
  {
    type: "ai.agent.key_backup",
    group: "ai",
    key: "aiKeyBackup",
    essential: true,
    variables: [
      text("workspace"),
      text("agente"),
      text("data"),
      url("link"),
      text("marca"),
    ],
  },
  {
    type: "ai.agent.key_paused",
    group: "ai",
    key: "aiKeyPaused",
    essential: true,
    variables: [
      text("workspace"),
      text("agente"),
      text("data"),
      url("link"),
      text("marca"),
    ],
  },
];

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
