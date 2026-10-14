import { fileMessages, SOURCE_MESSAGES } from "@/core/i18n/messages-loader";

/**
 * Texts the engine writes into a prompt, in the agent's language (campos.md
 * §7 and §8, variaveis.md §3). They live in the shipped `aiAgents.json`
 * files, under `prompt`, so the three languages stay side by side with the
 * rest of the module; the platform's text edits do not reach the prompt.
 */

export const PROMPT_LOCALES = ["pt-BR", "en", "es"] as const;
export type PromptLocale = (typeof PROMPT_LOCALES)[number];

/** The agent's `language` (pt-BR, en-US, es) as a language of the files. */
export function promptLocale(language: string | undefined): PromptLocale {
  if (language === "en-US" || language === "en") return "en";
  if (language === "es") return "es";
  return "pt-BR";
}

export type PromptTexts = Readonly<{
  notConfigured: string;
  notInformed: string;
  yes: string;
  no: string;
  noHours: string;
  hours: string;
  weekdays: Readonly<Record<string, string>>;
  handoffMode: Readonly<Record<string, string>>;
  afterHoursBehavior: Readonly<Record<string, string>>;
  outOfScopeAction: Readonly<Record<string, string>>;
  contactBlock: string;
  memoryBlock: string;
  untrustedNotice: string;
  contactFields: Readonly<Record<string, string>>;
  toolError: string;
  toolRestricted: string;
  toolDenied: string;
  /** Notes of the files a contact sent (A5c). */
  media: Readonly<Record<string, string>>;
  /** A message the team wrote to the contact, in the agent's history. */
  teamMessage: string;
  /** The private note of a handoff to the team (A5c). */
  handoffNote: Readonly<{ title: string; reason: string }>;
  /** The local time and whether the business is open (A6c). */
  hoursNow: Readonly<{
    now: string;
    open: string;
    closed: string;
    autoReply: string;
  }>;
}>;

function promptOf(messages: unknown): PromptTexts | null {
  const prompt = (messages as { aiAgents?: { prompt?: unknown } } | null)
    ?.aiAgents?.prompt;
  return prompt && typeof prompt === "object" ? (prompt as PromptTexts) : null;
}

export function promptTexts(locale: PromptLocale): PromptTexts {
  const texts = promptOf(fileMessages(locale)) ?? promptOf(SOURCE_MESSAGES);
  if (!texts) throw new Error("Prompt texts missing from aiAgents.json");
  return texts;
}

/** `{name}` placeholders of a text. */
export function format(
  text: string,
  values: Readonly<Record<string, string>>,
): string {
  return text.replace(/\{(\w+)\}/g, (match, key: string) =>
    key in values ? (values[key] ?? match) : match,
  );
}
