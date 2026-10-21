import { type ContactLocale, detectContactLocale } from "@/core/matrix/locale";

/**
 * When the team's answer is translated (TR3, traducao.md §5.2): only with
 * the translation on (TR2), the contact's language known and different from
 * the team's, in the "Responder" mode: a private note is never translated.
 * A draft already in the contact's language (detected with confidence, as
 * in the TR1) goes as it is, with no preview (§5.2.4); the ✦ (`force`)
 * asks for the preview anyway. Pure, so the window and the server apply
 * the same rule.
 */

export type OutboundReason =
  | "off"
  | "note"
  | "unknown_locale"
  | "same_locale"
  | "no_text"
  | "already_in_contact_language";

export type OutboundDecision =
  | Readonly<{ translate: true; source: ContactLocale; target: ContactLocale }>
  | Readonly<{ translate: false; reason: OutboundReason }>;

export function decideOutbound(
  input: Readonly<{
    enabled: boolean;
    mode: "reply" | "note";
    teamLocale: ContactLocale;
    contactLocale: ContactLocale | null;
    text: string;
    /** The ✦: the preview is asked for, even for a draft in the contact's language. */
    force?: boolean;
  }>,
): OutboundDecision {
  if (input.mode === "note") return { translate: false, reason: "note" };
  if (!input.enabled) return { translate: false, reason: "off" };
  if (!input.contactLocale) {
    return { translate: false, reason: "unknown_locale" };
  }
  if (input.contactLocale === input.teamLocale) {
    return { translate: false, reason: "same_locale" };
  }
  // Nothing to translate in a text with no letters (an emoji, a number).
  if (!/\p{L}/u.test(input.text)) {
    return { translate: false, reason: "no_text" };
  }
  if (
    !input.force &&
    detectContactLocale(input.text)?.locale === input.contactLocale
  ) {
    return { translate: false, reason: "already_in_contact_language" };
  }
  return {
    translate: true,
    source: input.teamLocale,
    target: input.contactLocale,
  };
}
