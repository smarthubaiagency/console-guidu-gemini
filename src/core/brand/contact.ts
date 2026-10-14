import type { BrandWhatsapp } from "./types";

/**
 * Presentation helpers of the brand contact (CF2): the WhatsApp link and the
 * plain-text footer, whose https:// addresses become links. Nothing here
 * renders stored HTML.
 */

/** `https://wa.me/<digits>` with the prefilled message, if any. */
export function whatsappHref(whatsapp: BrandWhatsapp): string {
  const url = new URL(`https://wa.me/${whatsapp.number}`);
  if (whatsapp.message) url.searchParams.set("text", whatsapp.message);
  return url.toString();
}

export type FooterPart =
  { kind: "text"; value: string } | { kind: "link"; value: string };

const LINK = /(https:\/\/[^\s<>"']+[^\s<>"'.,;:!?)])/;

/** Splits the footer into text and https links. */
export function footerParts(text: string): FooterPart[] {
  return text
    .split(LINK)
    .filter((part) => part.length > 0)
    .map((part) =>
      LINK.test(part) && part.startsWith("https://")
        ? { kind: "link", value: part }
        : { kind: "text", value: part },
    );
}
