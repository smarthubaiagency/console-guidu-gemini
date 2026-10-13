import type { AgentConfig } from "../config/schema";
import type { AgentKind } from "../config/tools";
import {
  type ContextValues,
  dateTimeValues,
  splitName,
} from "../prompt/variables";

/**
 * Values of the context variables of a turn (variaveis.md §2.3), from what
 * the turn loaded. A value GUIDU does not have yet stays null and renders
 * as "(não informado)".
 */
export type TurnFacts = Readonly<{
  kind: AgentKind;
  agentId: string;
  config: AgentConfig;
  now: Date;
  /** Locale used for the weekday name. */
  dateLocale: string;
  company: Readonly<{ name: string | null; locale: string | null }>;
  user: Readonly<{ name: string | null; role: string | null }> | null;
  contact: Readonly<{
    id: string;
    name: string;
    email: string | null;
    phone: string | null;
    companyName: string | null;
    jobTitle: string | null;
  }> | null;
  conversation: Readonly<{
    id: string;
    channel: string;
    startedAt: Date;
    lastMessageAt: Date | null;
    messagesCount: number;
  }>;
}>;

/** The agent's time zone, else Brasília (the platform's default). */
export function turnTimeZone(config: AgentConfig): string {
  return config.scope.timezone ?? "America/Sao_Paulo";
}

export function contextValues(facts: TurnFacts): ContextValues {
  const { config, contact, conversation } = facts;
  const timeZone = turnTimeZone(config);
  const datetime = dateTimeValues(facts.now, timeZone, facts.dateLocale);
  const [firstName, lastName] = splitName(contact?.name);
  const tools = config.integration.tools ?? [];
  return {
    "contact.id": contact?.id,
    "contact.name": contact?.name,
    "contact.first_name": contact ? firstName : null,
    "contact.last_name": contact ? lastName : null,
    "contact.email": contact?.email,
    "contact.phone": contact?.phone,
    "contact.company_name": contact?.companyName,
    "contact.job_title": contact?.jobTitle,
    "company.name": facts.company.name,
    "company.timezone": config.scope.timezone,
    "company.locale": facts.company.locale,
    "company.currency": null,
    "agent.id": facts.agentId,
    "agent.name": config.overview.agent_name,
    "agent.language_default": config.overview.language,
    "agent.role": facts.kind,
    "user.name": facts.user?.name,
    "user.email": null,
    "user.timezone": null,
    "user.role": facts.user?.role,
    "datetime.today": datetime.today,
    "datetime.now": datetime.now,
    "datetime.timezone": datetime.timezone,
    "datetime.weekday": datetime.weekday,
    "datetime.current_time": datetime.current_time,
    "conversation.id": conversation.id,
    "conversation.channel": conversation.channel,
    "conversation.started_at": conversation.startedAt.toISOString(),
    "conversation.last_message_at": conversation.lastMessageAt?.toISOString(),
    "conversation.language": config.overview.language,
    "conversation.messages_count": conversation.messagesCount,
    "channel.type": conversation.channel,
    "tools.crm.enabled":
      tools.includes("create_contact") || tools.includes("add_note"),
    "tools.rag.enabled":
      Boolean(config.model.rag_enabled) && tools.includes("search_knowledge"),
  };
}
