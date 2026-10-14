import { MessageCircle } from "lucide-react";

import { footerParts, whatsappHref } from "@/core/brand/contact";
import type { BrandWhatsapp } from "@/core/brand/types";

/** Plain-text brand footer (CF2); https:// addresses become links. */
export function BrandFooterText({ text }: Readonly<{ text: string }>) {
  return (
    <p
      className="text-12 text-text-secondary break-words whitespace-pre-line"
      data-testid="brand-footer"
    >
      {footerParts(text).map((part, index) =>
        part.kind === "link" ? (
          <a
            key={index}
            href={part.value}
            target="_blank"
            rel="noopener noreferrer"
            className="text-primary-text underline underline-offset-2"
          >
            {part.value}
          </a>
        ) : (
          <span key={index}>{part.value}</span>
        ),
      )}
    </p>
  );
}

/** WhatsApp sales button of the brand (CF2). */
export function BrandWhatsappLink({
  whatsapp,
  fallbackLabel,
}: Readonly<{ whatsapp: BrandWhatsapp; fallbackLabel: string }>) {
  return (
    <a
      href={whatsappHref(whatsapp)}
      target="_blank"
      rel="noopener noreferrer"
      data-testid="brand-whatsapp"
      className="border-card-border text-14 text-text hover:bg-accent inline-flex items-center gap-2 rounded-md border px-3 py-2 font-medium transition-colors"
    >
      <MessageCircle className="size-4" aria-hidden="true" />
      {whatsapp.label ?? fallbackLabel}
    </a>
  );
}
