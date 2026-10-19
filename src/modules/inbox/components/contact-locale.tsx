"use client";

import { useState } from "react";
import { ChevronDown, Languages } from "lucide-react";
import { useTranslations } from "next-intl";

import { useStatus } from "@/components/feedback/status-context";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { CONTACT_LOCALES, isContactLocale } from "@/core/matrix/locale";

import { setContactLocaleAction } from "../actions";
import type { ConversationSummary } from "../views";
import type { InboxViewer } from "./types";

/**
 * The contact's language in the header of the conversation (TR1): detected
 * from the contact's messages or set by who answers. Who answers corrects
 * it here; the GUIDS answers in it from the next turn. Who only reads sees
 * it, when known.
 */
export function ContactLocaleChip({
  workspaceSlug,
  roomId,
  viewer,
  summary,
  onChanged,
}: Readonly<{
  workspaceSlug: string;
  roomId: string;
  viewer: InboxViewer;
  summary: ConversationSummary | null;
  onChanged: () => Promise<void>;
}>) {
  const t = useTranslations("inbox.locale");
  const { showStatus } = useStatus();
  const [busy, setBusy] = useState(false);
  const value = summary?.contactLocale ?? null;

  if (viewer.level !== "reply") {
    return value ? (
      <Badge variant="neutral" data-testid="inbox-contact-locale">
        <Languages />
        {t(`names.${value}`)}
      </Badge>
    ) : null;
  }

  const choose = async (next: string) => {
    if (!isContactLocale(next) || next === value) return;
    setBusy(true);
    try {
      const result = await setContactLocaleAction({
        workspaceSlug,
        roomId,
        locale: next,
      });
      if ("error" in result) {
        showStatus({ type: "down", title: result.error });
        return;
      }
      showStatus({
        type: "up",
        title: t("saved", { language: t(`names.${next}`) }),
      });
      await onChanged();
    } finally {
      setBusy(false);
    }
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={busy}
          aria-label={t("change")}
          data-testid="inbox-contact-locale"
        >
          <Languages />
          {value ? t(`names.${value}`) : t("unknown")}
          <ChevronDown />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuLabel className="text-12 text-text-secondary font-normal">
          {value
            ? summary?.contactLocaleManual
              ? t("sourceManual")
              : t("sourceDetected")
            : t("sourceUnknown")}
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuRadioGroup
          value={value ?? ""}
          onValueChange={(next) => void choose(next)}
        >
          {CONTACT_LOCALES.map((locale) => (
            <DropdownMenuRadioItem key={locale} value={locale}>
              {t(`names.${locale}`)}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
