import type { ContactLocale } from "@/core/matrix/locale";

import { type PromptLocale, promptLocale } from "../prompt/texts";

const CONTACT_LANGUAGE: Readonly<
  Record<PromptLocale, Readonly<Record<ContactLocale, string>>>
> = {
  "pt-BR": { "pt-BR": "português", en: "inglês", es: "espanhol" },
  en: { "pt-BR": "Portuguese", en: "English", es: "Spanish" },
  es: { "pt-BR": "portugués", en: "inglés", es: "español" },
};

/**
 * The contact's language (TR1), told in the agent's language when it is
 * another one: the GUIDS answers the contact in theirs. The agent's own
 * language stays for everything else (notes, summaries, the team).
 */
export function contactLocaleInstruction(
  locale: PromptLocale,
  contact: ContactLocale | null | undefined,
): string | null {
  if (!contact || promptLocale(contact) === locale) return null;
  const name = CONTACT_LANGUAGE[locale][contact];
  switch (locale) {
    case "en":
      return `The contact writes in ${name}. Answer the contact in ${name}; notes, summaries and messages to the team stay in English.`;
    case "es":
      return `El contacto escribe en ${name}. Responde al contacto en ${name}; las notas, los resúmenes y los mensajes al equipo siguen en español.`;
    default:
      return `O contato escreve em ${name}. Responda ao contato em ${name}; notas, resumos e mensagens à equipe continuam em português.`;
  }
}
